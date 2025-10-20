import { supabase } from './supabaseClient.js';
import { showGlobalMsg } from './utils/dom.js';

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

// Local state for filtering/sorting on the Shop grid
const state = {
  lastProducts: [], // raw data loaded from server
  category: '',     // selected category filter (category)
  type: '',         // selected type filter (item_type)
  sort: ''          // '', 'price.asc', 'price.desc'
};

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
        category: p.category,
        image_urls: p.image_urls,
        price: p.price
      };
    });
  } catch {}
}

// Populate category dropdown from the latest products
function populateCategories(list) {
  try {
    const sel = document.getElementById('filterCategory');
    if (!sel) return;
    const seen = new Set();
    const types = [];
    (list || []).forEach(p => {
      const t = (p.category || '').trim();
      if (!t || seen.has(t)) return;
      seen.add(t);
      types.push(t);
    });
    const cur = sel.value; // try keep the current selection
    // Reset options
    sel.innerHTML = '<option value="">All</option>' + types.map(t => `<option value="${t.replace(/"/g,'&quot;')}">${t}</option>`).join('');
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur; else sel.value = '';
  } catch {}
}

// Populate type dropdown from the latest products
function populateTypes(list) {
  try {
    const sel = document.getElementById('filterType');
    if (!sel) return;
    const seen = new Set();
    const types = [];
    (list || []).forEach(p => {
      const t = (p.item_type || '').trim();
      if (!t || seen.has(t)) return;
      seen.add(t);
      types.push(t);
    });
    const cur = sel.value; // try keep the current selection
    sel.innerHTML = '<option value="">All</option>' + types.map(t => `<option value="${t.replace(/"/g,'&quot;')}">${t}</option>`).join('');
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur; else sel.value = '';
  } catch {}
}

function applyFilterSortAndRender() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  const deletable = false;
  // Filter by category
  let items = state.lastProducts.slice();
  if (state.category) {
    const cat = state.category.toLowerCase();
    items = items.filter(p => String(p.category || '').toLowerCase() === cat);
  }
  // Filter by item type
  if (state.type) {
    const tp = state.type.toLowerCase();
    items = items.filter(p => String(p.item_type || '').toLowerCase() === tp);
  }
  // Sort by price when requested
  if (state.sort === 'price.asc' || state.sort === 'price.desc') {
    const dir = state.sort.endsWith('desc') ? -1 : 1;
    items.sort((a, b) => (Number(a.price || 0) - Number(b.price || 0)) * dir);
  }
  // Render
  if (items.length === 0) {
    grid.innerHTML = '<p style="padding: 12px; color: #666;">No products match your filter.</p>';
    return;
  }
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  items.forEach(p => frag.appendChild(productCard(p, { deletable })));
  grid.appendChild(frag);

  // Bind prefetch on the newly rendered cards
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
  const a = document.createElement('a');
  a.href = `#product?id=${encodeURIComponent(p.id)}`; // route to detail
  a.className = 'product-card';
  a.innerHTML = `
    <div class="thumb">
      <img src="${img}" alt="${(p.name || 'Product').replace(/"/g, '&quot;')}" loading="lazy"/>
    </div>
    <div class="info">
      <div class="name">${p.name || ''}</div>
      <div class="type">${p.item_type || ''}</div>
      <div class="price">${ZAR.format(Number(p.price || 0))}</div>
      ${deletable ? `<div class="card-actions"><button class="btn btn-danger btn-delete-product" data-id="${p.id}" title="Delete">Delete</button></div>` : ''}
    </div>
  `;
  return a;
}

export async function loadProducts() {
  // Ensure a global retry handler exists for inline retry links
  if (!window.__retryLoadProducts) {
    window.__retryLoadProducts = () => { try { loadProducts(); } catch {} };
  }

  const grids = [
    document.getElementById('productsGrid'),
    document.getElementById('productsGridMaintenance')
  ].filter(Boolean);

  if (grids.length === 0) return;

  // Show a lightweight loading state so the page doesn't look blank while fetching
  grids.forEach(g => {
    g.innerHTML = '<div class="grid-loading">Loading products…</div>';
  });

  // Safety net: if something stalls (e.g., auth.getSession hanging), replace loader with a retry after 9s
  const safetyTimer = setTimeout(() => {
    try {
      document.querySelectorAll('#productsGrid, #productsGridMaintenance').forEach(grid => {
        if (grid && /Loading products/i.test(grid.textContent || '')) {
          grid.innerHTML = '<div style="grid-column:1/-1; padding:12px; text-align:center; color:#666;">Still loading… <button class="btn" style="margin-left:8px;border:1px solid #000;padding:6px 10px;" onclick="window.__retryLoadProducts && window.__retryLoadProducts()">Try again</button></div>';
        }
      });
    } catch {}
  }, 9000);

  // REST-first fetch with timeout so UI doesn't hang forever on network stalls
  let data, error, httpStatus = 0, httpDetail = '';
  async function restFetch(orderClause) {
    const fields = 'id,name,item_type,category,description,image_urls,stock,price,created_at';
    const base = `${window.SUPABASE_URL}/rest/v1/products?select=${encodeURIComponent(fields)}`;
    const url = orderClause ? `${base}&order=${encodeURIComponent(orderClause)}` : base;
    const headers = { 'apikey': window.SUPABASE_KEY, 'accept': 'application/json' };
    try {
      // Avoid indefinite waits if supabase.auth.getSession() stalls; proceed without token on timeout
      const getSess = supabase.auth.getSession();
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('getSession-timeout')), 1500));
      let s;
      try {
        const r = await Promise.race([getSess, timeout]);
        s = r?.data;
      } catch {}
      const tok = s?.session?.access_token;
      if (tok) headers['authorization'] = `Bearer ${tok}`;
    } catch {}
    
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort('rest-timeout'), 8000);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(to);
    httpStatus = res.status;
    if (res.ok) {
      const body = await res.json().catch(() => []);
      return { data: Array.isArray(body) ? body : [] };
    }
    const txt = await res.text().catch(() => '');
    return { error: new Error(`REST ${res.status}: ${txt || res.statusText}`), detail: txt };
  }
  try {
    // Try created_at ordering first, then id, then no order
    let r = await restFetch('created_at.desc');
    if (r.data) {
      data = r.data;
    } else {
      httpDetail = r.detail || '';
      const msg = String(r.error?.message || httpDetail).toLowerCase();
      if (httpStatus === 400 || msg.includes('created_at')) {
        console.warn('[products] falling back to id.desc');
        r = await restFetch('id.desc');
      }
      if (r.data) {
        data = r.data;
      } else {
        console.warn('[products] falling back to no order');
        r = await restFetch('');
        if (r.data) data = r.data; else { error = r.error; httpDetail = r.detail || httpDetail; }
      }
    }
  } catch (e) {
    // Normalize timeout/exception into an error-like object
    error = { message: e?.message || String(e), code: e?.name === 'AbortError' ? 'abort' : undefined };
  }

  if (Array.isArray(data)) cacheProducts(data);

  grids.forEach(grid => {
    // Keep a copy for the Shop page tooling
    if (grid.id === 'productsGrid' && Array.isArray(data)) {
      state.lastProducts = data.slice();
      // Update categories dropdown when data changes
      populateCategories(state.lastProducts);
      populateTypes(state.lastProducts);
    }
    // Any outcome means we can clear the safety timer
    try { clearTimeout(safetyTimer); } catch {}
    // Clear loading state before rendering result
    if (error) {
        console.error('Failed to load products:', error?.message || error, { status: httpStatus, detail: httpDetail });
      const isTimeout = /timeout/i.test(String(error?.message || ''));
      const errText = isTimeout
        ? 'Loading products took too long.'
        : 'Failed to load products.';
      grid.innerHTML = `
        <div style="grid-column:1/-1; padding:12px; text-align:center;">
          <p style="color:${isTimeout ? '#666' : 'red'};">${errText}</p>
          <div style="font-size:12px; color:#888; margin-top:4px;">${httpStatus ? `HTTP ${httpStatus}` : ''} ${(error?.message || '')}</div>
          <button class="btn" style="margin-top:8px; border:1px solid #000; padding:6px 10px;" onclick="window.__retryLoadProducts()">Try again</button>
        </div>`;
      // Helpful hint in production if RLS blocks public SELECT
      const low = String(error?.message || '').toLowerCase();
      if (error?.code === '401' || error?.code === '403' || low.includes('permission') || low.includes('rls')) {
        showGlobalMsg('Products are not publicly readable. In Supabase, enable a SELECT policy for public on table "products".');
      }
        // One-shot auto-retry for transient hiccups
        if (!window.__LP_AUTO_RETRIED) {
          window.__LP_AUTO_RETRIED = true;
          setTimeout(() => { try { window.__LP_AUTO_RETRIED = false; loadProducts(); } catch {} }, 1500);
        }
      return;
    }
    if (!data || data.length === 0) {
      grid.innerHTML = '<p style="padding: 12px; color: #666;">No products yet.</p>';
      return;
  }
  // Success: render
  if (grid.id === 'productsGrid') {
      // Shop grid: apply current filter/sort
      applyFilterSortAndRender();
    } else {
      // Maintenance grid: render all without filtering
      grid.innerHTML = '';
      const frag = document.createDocumentFragment();
      const deletable = true;
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
    }
  });
}

export function initProducts() {
  loadProducts();

  // Ensure product clicks always navigate with correct hash
  const bindClick = (grid) => {
    if (!grid || grid.dataset.clickBound) return;
    grid.dataset.clickBound = '1';
    grid.addEventListener('click', (e) => {
      // If the delete button was clicked, do not navigate to the product
      if (e.target && e.target.closest && e.target.closest('.btn-delete-product')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
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

  // Bind filter/sort controls (Shop only)
  try {
    const catSel = document.getElementById('filterCategory');
    const typeSel = document.getElementById('filterType');
    const sortSel = document.getElementById('sortPrice');
    if (catSel && !catSel.dataset.bound) {
      catSel.dataset.bound = '1';
      catSel.addEventListener('change', () => {
        state.category = catSel.value || '';
        applyFilterSortAndRender();
      });
    }
    if (typeSel && !typeSel.dataset.bound) {
      typeSel.dataset.bound = '1';
      typeSel.addEventListener('change', () => {
        state.type = typeSel.value || '';
        applyFilterSortAndRender();
      });
    }
    if (sortSel && !sortSel.dataset.bound) {
      sortSel.dataset.bound = '1';
      sortSel.addEventListener('change', () => {
        state.sort = sortSel.value || '';
        applyFilterSortAndRender();
      });
    }
  } catch {}
}