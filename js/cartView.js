import { supabase } from './supabaseClient.js';
import { getActiveCartId, getCartSummaryCount, removeFromCart } from './cart.js';

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

function firstImage(csv) {
  return (csv || '').split(',').map(s => s.trim()).filter(Boolean)[0] || 'https://via.placeholder.com/120?text=No+Image';
}

// Keep latest loaded items for optimistic UI updates and instant render
let currentItems = [];

function getProductsFromCache(ids) {
  const cache = window.__PRODUCTS_CACHE || {};
  const info = {};
  const missing = [];
  ids.forEach(id => {
    const p = cache[String(id)];
    if (p) info[id] = { name: p.name || 'Product', image_urls: p.image_urls || '' };
    else missing.push(id);
  });
  return { info, missing };
}

async function fetchMissingProducts(missingIds) {
  if (!missingIds?.length) return {};
  const { data } = await supabase
    .from('products')
    .select('id, name, image_urls')
    .in('id', missingIds);
  const m = {};
  (data || []).forEach(p => { m[p.id] = { name: p.name || 'Product', image_urls: p.image_urls || '' }; });
  // Warm global cache
  try {
    const cache = window.__PRODUCTS_CACHE || (window.__PRODUCTS_CACHE = {});
    (data || []).forEach(p => { cache[String(p.id)] = { ...(cache[String(p.id)] || {}), ...p }; });
  } catch {}
  return m;
}

function readCachedCart() {
  try {
    const raw = sessionStorage.getItem('cart:last');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeCachedCart(items) {
  try {
    sessionStorage.setItem('cart:last', JSON.stringify({ items, ts: Date.now() }));
  } catch {}
}

async function getCartItems() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const local = JSON.parse(localStorage.getItem('cart') || '[]');
    // Enrich guest items with image URLs from product cache when available
    const ids = local.map(i => i.id);
    const { info } = getProductsFromCache(ids);
    return local.map(it => ({
      product_id: it.id,
      name: it.name || info[it.id]?.name || 'Product',
      qty: it.qty,
      price: Number(it.price || 0),
      image_urls: info[it.id]?.image_urls || ''
    }));
  }
  const cartId = await getActiveCartId();
  const { data: items } = await supabase
    .from('cart_items')
    .select('product_id, qty, price_at_add')
    .eq('cart_id', cartId);

  if (!items?.length) return [];

  const ids = items.map(i => i.product_id);
  const { info, missing } = getProductsFromCache(ids);
  const fetched = await fetchMissingProducts(missing);
  const pm = { ...info, ...fetched };
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
      <div class="cart-center">
        <div class="cart-name">${it.name}</div>
        <div class="cart-qty">Qty: ${it.qty} × ${ZAR.format(it.price)}</div>
        <div class="cart-subtotal">${ZAR.format(subtotal)}</div>
      </div>
      <a href="#" class="cart-remove-link" data-id="${it.product_id}" aria-label="Remove ${it.name}">Remove</a>
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

function setCartBadge(n) {
  const badge = document.getElementById('cartCount');
  if (badge) badge.textContent = String(n);
}

export async function loadCartPage() {
  // Instant render from cache (if present)
  const cached = readCachedCart();
  if (cached?.items) {
    currentItems = cached.items;
    render(currentItems);
  } else {
    // Show minimal empty state while fetching
    render([]);
  }
  // Background refresh from source of truth
  const fresh = await getCartItems();
  currentItems = fresh;
  writeCachedCart(fresh);
  render(currentItems);
  refreshCartBadge();
}

export function initCartView() {
  // Cart button -> #cart
  const btn = document.getElementById('cartBtn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => { location.hash = '#cart'; });
    // Prefetch on hover/touch to make cart open instantly
    const prefetch = async () => {
      const last = Number(btn.dataset.prefetchedAt || 0);
      const now = Date.now();
      if (now - last < 8000) return; // throttle
      btn.dataset.prefetchedAt = String(now);
      const items = await getCartItems();
      writeCachedCart(items);
    };
    btn.addEventListener('mouseenter', prefetch);
    btn.addEventListener('touchstart', prefetch, { passive: true });
  }

  // Remove handler (delegated)
  const list = document.getElementById('cartList');
  if (list && !list.dataset.bound) {
    list.dataset.bound = '1';
    list.addEventListener('click', async (e) => {
      const link = e.target.closest?.('.cart-remove-link');
      if (!link) return;
      e.preventDefault();

      const id = link.dataset.id;
      // Optimistic UI: remove locally and update totals/badge immediately
      const nextItems = currentItems.filter(it => String(it.product_id) !== String(id));
      currentItems = nextItems;
      render(currentItems);
      const optimisticCount = currentItems.reduce((s, it) => s + (it.qty || 0), 0);
      setCartBadge(optimisticCount);

      try {
        await removeFromCart(id);
        // Success: event cart:changed will refresh the badge; items already removed visually
      } catch (err) {
        alert('Failed to remove: ' + (err?.message || err));
        // Restore state by fully reloading cart from source of truth
        await loadCartPage();
      }
    });
  }

  // Badge updates
  window.addEventListener('cart:changed', refreshCartBadge);
  window.addEventListener('storage', (e) => { if (e.key === 'cart') refreshCartBadge(); });

  refreshCartBadge();
}