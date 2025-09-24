import { supabase } from './supabaseClient.js';

function emitCartChanged() {
  window.dispatchEvent(new CustomEvent('cart:changed'));
}

export async function getActiveCartId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: cart } = await supabase
    .from('carts')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (cart?.id) return cart.id;

  const { data: created, error } = await supabase
    .from('carts')
    .insert([{ user_id: user.id }])
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

export async function addToCart(product, qty = 1) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const items = JSON.parse(localStorage.getItem('cart') || '[]');
    const i = items.findIndex(x => x.id === product.id);
    if (i >= 0) items[i].qty += qty;
    else items.push({ id: product.id, name: product.name, price: Number(product.price || 0), qty });
    localStorage.setItem('cart', JSON.stringify(items));
    emitCartChanged();
    return { local: true };
  }

  const cartId = await getActiveCartId();
  const row = { cart_id: cartId, product_id: product.id, qty, price_at_add: Number(product.price || 0) };
  const { error } = await supabase.from('cart_items').upsert([row], { onConflict: 'cart_id,product_id' });
  if (error) throw error;
  emitCartChanged();
  return { local: false };
}

export async function removeFromCart(productId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const items = JSON.parse(localStorage.getItem('cart') || '[]').filter(it => it.id !== productId);
    localStorage.setItem('cart', JSON.stringify(items));
    emitCartChanged();
    return;
  }
  const cartId = await getActiveCartId();
  await supabase.from('cart_items').delete().eq('cart_id', cartId).eq('product_id', productId);
  emitCartChanged();
}

export async function getCartSummaryCount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const items = JSON.parse(localStorage.getItem('cart') || '[]');
    return items.reduce((s, it) => s + (it.qty || 0), 0);
  }
  const cartId = await getActiveCartId();
  const { data } = await supabase.from('cart_items').select('qty').eq('cart_id', cartId);
  return (data || []).reduce((s, r) => s + (r.qty || 0), 0);
}

export async function mergeLocalCartToDb() {
  // Only merge if logged in
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

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