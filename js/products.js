import { supabase } from './supabaseClient.js';

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

function firstImage(urls) {
  return (urls || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)[0] || 'https://via.placeholder.com/600x600?text=No+Image';
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

  grids.forEach(grid => {
    if (error) {
      grid.innerHTML = '<p style="color:red;">Failed to load products.</p>';
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