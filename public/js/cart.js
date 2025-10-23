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
  console.log('[cart] getActiveCartId: start');
  const userId = await getUserId();
  if (!userId) { console.log('[cart] getActiveCartId: no user'); return null; }
  if (_cachedCartId) return _cachedCartId;
  const { data: cart } = await supabase
    .from('carts').select('id')
    .eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (cart?.id) { _cachedCartId = cart.id; console.log('[cart] getActiveCartId: found existing', { cartId: cart.id }); return cart.id; }
  const { data: created, error } = await supabase
    .from('carts').insert([{ user_id: userId }]).select('id').single();
  if (error) throw error;
  _cachedCartId = created.id;
  console.log('[cart] getActiveCartId: created new', { cartId: created.id });
  return _cachedCartId;
}

// ADD THIS: export addToCart
export async function addToCart(product, qty = 1) {
  console.log('[cart] addToCart: start', { productId: product?.id, price: Number(product?.price || 0) });
  const userId = await getUserId();
  // Guest cart -> localStorage
  if (!userId) {
    console.log('[cart] addToCart: guest mode');
    const items = JSON.parse(localStorage.getItem('cart') || '[]');
    const i = items.findIndex(x => String(x.id) === String(product.id));
    if (i >= 0) {
      // Already in cart -> do not add duplicates
      console.log('[cart] addToCart: already in guest cart');
      return { local: true, alreadyInCart: true };
    } else {
      items.push({ id: product.id, name: product.name, price: Number(product.price || 0), qty: 1 });
      console.log('[cart] addToCart: added to guest cart', { count: items.length });
    }
    localStorage.setItem('cart', JSON.stringify(items));
    emitCartChanged();
    console.log('[cart] addToCart: guest emit cart:changed');
    return { local: true };
  }
  // Authenticated -> DB upsert (qty +=)
  const cartId = await getActiveCartId();
  console.log('[cart] addToCart: using cart', { cartId });
  // Optimistic badge update: emit change early in case network is slow
  try { emitCartChanged(); } catch {}
  const { data: existing } = await supabase
    .from('cart_items')
    .select('qty').eq('cart_id', cartId).eq('product_id', product.id).maybeSingle();
  if (existing && existing.qty > 0) {
    // Already in cart -> do not increase quantity
    console.log('[cart] addToCart: already in DB cart');
    return { local: false, alreadyInCart: true };
  }
  const row = {
    cart_id: cartId,
    product_id: product.id,
    qty: 1,
    price_at_add: Number(product.price || 0)
  };
  console.log('[cart] addToCart: inserting cart_items', row);
  const { error } = await supabase
    .from('cart_items')
    .insert([row]);
  if (error) throw error;

  emitCartChanged();
  console.log('[cart] addToCart: inserted and emitted cart:changed');
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
    return items.length;
  }
  const cartId = await getActiveCartId();
  const { data } = await supabase.from('cart_items').select('product_id').eq('cart_id', cartId);
  return (data || []).length;
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
  // Only insert items that don't already exist, with qty = 1
  const rows = items
    .filter(it => !existMap[it.id])
    .map(it => ({
      cart_id: cartId,
      product_id: it.id,
      qty: 1,
      price_at_add: Number(it.price || 0)
    }));

  let error;
  if (rows.length) {
    const res = await supabase.from('cart_items').insert(rows);
    error = res.error;
  }

  if (error) throw error;

  // Clear guest cart and update UI
  localStorage.removeItem('cart');
  emitCartChanged();
}