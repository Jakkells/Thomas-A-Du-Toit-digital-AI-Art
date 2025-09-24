import { supabase } from './supabaseClient.js';
import { getActiveCartId, getCartSummaryCount, removeFromCart } from './cart.js';

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

function firstImage(csv) {
  return (csv || '').split(',').map(s => s.trim()).filter(Boolean)[0] || 'https://via.placeholder.com/300?text=No+Image';
}

async function getCartItems() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const local = JSON.parse(localStorage.getItem('cart') || '[]');
    return local.map(it => ({
      product_id: it.id, name: it.name, qty: it.qty, price: Number(it.price || 0), image_urls: ''
    }));
  }
  const cartId = await getActiveCartId();
  const { data: items } = await supabase
    .from('cart_items')
    .select('product_id, qty, price_at_add')
    .eq('cart_id', cartId);

  if (!items?.length) return [];

  const ids = items.map(i => i.product_id);
  const { data: products } = await supabase
    .from('products')
    .select('id, name, image_urls')
    .in('id', ids);

  const pm = Object.fromEntries((products || []).map(p => [p.id, p]));
  return items.map(i => ({
    product_id: i.product_id,
    name: pm[i.product_id]?.name || 'Product',
    qty: i.qty,
    price: Number(i.price_at_add || 0),
    image_urls: pm[i.product_id]?.image_urls || ''
  }));
}

function render(items) {
  const list = document.getElementById('cartList');
  const totalEl = document.getElementById('cartTotal');
  const checkout = document.getElementById('checkoutBtn');
  if (!list || !totalEl) return;

  if (!items.length) {
    list.innerHTML = '<p>Your cart is empty.</p>';
    totalEl.textContent = ZAR.format(0);
    if (checkout) checkout.disabled = true;
    return;
  }

  let total = 0;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();

  items.forEach(it => {
    const li = document.createElement('div');
    li.className = 'cart-item';
    const thumb = firstImage(it.image_urls);
    const subtotal = it.qty * it.price;
    total += subtotal;

    li.innerHTML = `
      <div class="cart-thumb"><img src="${thumb}" alt="Product"/></div>
      <div>
        <div class="cart-name">${it.name}</div>
        <div class="cart-qty">Qty: ${it.qty} × ${ZAR.format(it.price)}</div>
      </div>
      <div class="cart-subtotal">${ZAR.format(subtotal)}</div>
      <button class="cart-remove" data-id="${it.product_id}">Remove</button>
    `;
    frag.appendChild(li);
  });

  list.appendChild(frag);
  totalEl.textContent = ZAR.format(total);
  if (checkout) checkout.disabled = false;
}

async function refreshCartBadge() {
  const n = await getCartSummaryCount();
  const badge = document.getElementById('cartCount');
  if (badge) badge.textContent = String(n);
}

export async function loadCartPage() {
  const items = await getCartItems();
  render(items);
  refreshCartBadge();
}

export function initCartView() {
  const btn = document.getElementById('cartBtn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => { location.hash = '#cart'; });
  }

  // Remove handler
  const list = document.getElementById('cartList');
  if (list && !list.dataset.bound) {
    list.dataset.bound = '1';
    list.addEventListener('click', async (e) => {
      const btn = e.target.closest?.('.cart-remove');
      if (!btn) return;
      const id = btn.dataset.id;
      await removeFromCart(id);
      await loadCartPage();
    });
  }

  // Update badge on changes
  window.addEventListener('cart:changed', refreshCartBadge);
  window.addEventListener('storage', (e) => { if (e.key === 'cart') refreshCartBadge(); });

  // Initial badge
  refreshCartBadge();
}