import { supabase } from './supabaseClient.js';
import { showGlobalMsg } from './utils/dom.js';

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

function firstImage(urls) {
  return (urls || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)[0] || 'https://via.placeholder.com/600x600?text=No+Image';
}

// Simple in-memory cache to accelerate product detail
window.__PRODUCTS_CACHE = window.__PRODUCTS_CACHE || {};
function cacheProducts(list) {
  try {
    const cache = window.__PRODUCTS_CACHE;
    (list || []).forEach(p => {
      if (!p || p.id == null) return;
      cache[String(p.id)] = {
        id: p.id,
        name: p.name,
        description: p.description,
        item_type: p.item_type,
        image_urls: p.image_urls,
        price: p.price
      };
    });
  } catch {}
}

function preloadImage(src) {
  if (!src) return;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = src;
  } catch {}
}

export function productCard(p, { deletable = false } = {}) {
  const img = firstImage(p.image_urls);
  const out = (p.stock ?? 0) <= 0;
  const a = document.createElement('a');
  a.href = `#product?id=${encodeURIComponent(p.id)}`; // route to detail
  a.className = 'product-card';
  a.innerHTML = `
    <div class="thumb">
      <img src="${img}" alt="${(p.name || 'Product').replace(/"/g, '&quot;')}" loading="lazy"/>
      ${out ? '<span class="badge-out">Out of stock</span>' : ''}
      ${deletable ? `<button class="delete-btn btn-delete-product" data-id="${p.id}" title="Delete">🗑️</button>` : ''}
    </div>
    <div class="info">
      <div class="name">${p.name || ''}</div>
      <div class="type">${p.item_type || ''}</div>
      <div class="price">${ZAR.format(Number(p.price || 0))}</div>
    </div>
  `;
  return a;
}

export async function loadProducts() {
  const grids = [
    document.getElementById('productsGrid'),
    document.getElementById('productsGridMaintenance')
  ].filter(Boolean);

  if (grids.length === 0) return;

  grids.forEach(g => g.innerHTML = '');

  const { data, error } = await supabase
    .from('products')
    .select('id, name, item_type, description, image_urls, stock, price, created_at')
    .order('created_at', { ascending: false });

  if (Array.isArray(data)) cacheProducts(data);

  grids.forEach(grid => {
    if (error) {
      console.error('Failed to load products:', error);
      grid.innerHTML = '<p style="color:red;">Failed to load products.</p>';
      // Helpful hint in production if RLS blocks public SELECT
      const msg = String(error?.message || '').toLowerCase();
      if (error?.code === '401' || error?.code === '403' || msg.includes('permission') || msg.includes('rls')) {
        showGlobalMsg('Products are not publicly readable. In Supabase, enable a SELECT policy for public on table "products".');
      }
      return;
    }
    if (!data || data.length === 0) {
      grid.innerHTML = '<p>No products yet.</p>';
      return;
    }
    const frag = document.createDocumentFragment();
    const deletable = grid.id === 'productsGridMaintenance';
    data.forEach(p => frag.appendChild(productCard(p, { deletable })));
    grid.appendChild(frag);

    // Prefetch first image and ensure cache is warm on hover/touch
    grid.querySelectorAll('a.product-card').forEach(a => {
      if (a.dataset.prefetchBound) return;
      a.dataset.prefetchBound = '1';
      const doPrefetch = () => {
        const href = a.getAttribute('href') || '';
        const id = (href.split('id=')[1] || '').split('&')[0];
        const p = (window.__PRODUCTS_CACHE || {})[String(id)];
        const img = p ? firstImage(p.image_urls) : null;
        if (img) preloadImage(img);
      };
      a.addEventListener('mouseenter', doPrefetch);
      a.addEventListener('touchstart', doPrefetch, { passive: true });
      a.addEventListener('click', doPrefetch);
    });
  });
}

export function initProducts() {
  loadProducts();

  // Ensure product clicks always navigate with correct hash
  const bindClick = (grid) => {
    if (!grid || grid.dataset.clickBound) return;
    grid.dataset.clickBound = '1';
    grid.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a.product-card');
      if (!a || !grid.contains(a)) return;
      const href = a.getAttribute('href');
      if (href && href.startsWith('#product?id=')) {
        e.preventDefault();
        if (location.hash !== href) {
          location.hash = href;
        } else {
          // Force re-navigation if the same hash is clicked again
          location.hash = '#shop';
          setTimeout(() => { location.hash = href; }, 0);
        }
      }
    });
  };

  bindClick(document.getElementById('productsGrid'));
  bindClick(document.getElementById('productsGridMaintenance'));
}