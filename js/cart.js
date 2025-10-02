import { supabase } from './supabaseClient.js';

function emitCartChanged() {
  window.dispatchEvent(new CustomEvent('cart:changed'));
}

// Simple per-session caches to avoid extra round-trips
let _cachedUserId = undefined;
let _cachedCartId = undefined;

async function getUserId() {
  if (_cachedUserId !== undefined) return _cachedUserId;
  try {
    const { data: s } = await supabase.auth.getSession();
    const id = s?.session?.user?.id;
    if (id) { _cachedUserId = id; return id; }
  } catch {}
  const { data: { user } } = await supabase.auth.getUser();
  _cachedUserId = user?.id || null;
  return _cachedUserId;
}

// Clear caches when auth changes (event emitted by auth.js)
window.addEventListener('auth:changed', () => { _cachedUserId = undefined; _cachedCartId = undefined; });

// Ensure this exists
export async function getActiveCartId() {
  const userId = await getUserId();
  if (!userId) return null;
  if (_cachedCartId) return _cachedCartId;
  const { data: cart } = await supabase
    .from('carts').select('id')
    .eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (cart?.id) { _cachedCartId = cart.id; return cart.id; }
  const { data: created, error } = await supabase
    .from('carts').insert([{ user_id: userId }]).select('id').single();
  if (error) throw error;
  _cachedCartId = created.id;
  return _cachedCartId;
}

// ADD THIS: export addToCart
export async function addToCart(product, qty = 1) {
  const userId = await getUserId();
  // Guest cart -> localStorage
  if (!userId) {
    const items = JSON.parse(localStorage.getItem('cart') || '[]');
    const i = items.findIndex(x => String(x.id) === String(product.id));
    if (i >= 0) items[i].qty += qty;
    else items.push({ id: product.id, name: product.name, price: Number(product.price || 0), qty });
    localStorage.setItem('cart', JSON.stringify(items));
    emitCartChanged();
    return { local: true };
  }
  // Authenticated -> DB upsert (qty +=)
  const cartId = await getActiveCartId();
  // Optimistic badge update: emit change early in case network is slow
  try { emitCartChanged(); } catch {}
  const { data: existing } = await supabase
    .from('cart_items')
    .select('qty').eq('cart_id', cartId).eq('product_id', product.id).maybeSingle();
  const newQty = (existing?.qty || 0) + qty;

  const row = {
    cart_id: cartId,
    product_id: product.id,
    qty: newQty,
    price_at_add: Number(product.price || 0)
  };
  const { error } = await supabase
    .from('cart_items')
    .upsert([row], { onConflict: 'cart_id,product_id' });
  if (error) throw error;

  emitCartChanged();
  return { local: false };
}

export async function removeFromCart(productId) {
  const userId = await getUserId();

  // Guest: remove from localStorage
  if (!userId) {
    const items = JSON.parse(localStorage.getItem('cart') || '[]')
      .filter(it => String(it.id) !== String(productId));
    localStorage.setItem('cart', JSON.stringify(items));
    emitCartChanged();
    return { local: true };
  }

  // Logged-in: delete from cart_items
  const cartId = await getActiveCartId();
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('cart_id', cartId)
    .eq('product_id', productId);

  if (error) {
    console.error('Remove from cart failed:', error);
    throw error;
  }
  emitCartChanged();
  return { local: false };
}

export async function getCartSummaryCount() {
  const userId = await getUserId();
  if (!userId) {
    const items = JSON.parse(localStorage.getItem('cart') || '[]');
    return items.reduce((s, it) => s + (it.qty || 0), 0);
  }
  const cartId = await getActiveCartId();
  const { data } = await supabase.from('cart_items').select('qty').eq('cart_id', cartId);
  return (data || []).reduce((s, r) => s + (r.qty || 0), 0);
}

export async function mergeLocalCartToDb() {
  // Only merge if logged in
  const userId = await getUserId();
  if (!userId) return;

  // Read guest cart
  const items = JSON.parse(localStorage.getItem('cart') || '[]');
  if (!items.length) return;

  const cartId = await getActiveCartId();

  // Merge quantities with existing DB items
  const ids = items.map(i => i.id);
  const { data: existing } = await supabase
    .from('cart_items')
    .select('product_id, qty')
    .eq('cart_id', cartId)
    .in('product_id', ids);

  const existMap = Object.fromEntries((existing || []).map(r => [r.product_id, r.qty]));

  const rows = items.map(it => ({
    cart_id: cartId,
    product_id: it.id,
    qty: (existMap[it.id] || 0) + (it.qty || 0),
    price_at_add: Number(it.price || 0)
  }));

  const { error } = await supabase
    .from('cart_items')
    .upsert(rows, { onConflict: 'cart_id,product_id' });

  if (error) throw error;

  // Clear guest cart and update UI
  localStorage.removeItem('cart');
  emitCartChanged();
}