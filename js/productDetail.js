import { supabase } from './supabaseClient.js';
import { showGlobalMsg } from './utils/dom.js';
import { addToCart } from './cart.js';

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

function parseCsvImages(csv) {
  return (csv || '').split(',').map(s => s.trim()).filter(Boolean);
}

function setMainImage(url) {
  const img = document.getElementById('pdMainImage');
  if (img) img.src = url || 'https://via.placeholder.com/800x1000?text=No+Image';
}

function renderThumbs(urls) {
  const wrap = document.getElementById('pdThumbs');
  if (!wrap) return;
  wrap.innerHTML = '';
  urls.forEach((u, idx) => {
    const div = document.createElement('div');
    div.className = 'pd-thumb' + (idx === 0 ? ' selected' : '');
    const img = document.createElement('img');
    img.src = u;
    img.alt = 'Thumbnail';
    div.appendChild(img);
    div.addEventListener('click', () => {
      document.querySelectorAll('.pd-thumb').forEach(t => t.classList.remove('selected'));
      div.classList.add('selected');
      setMainImage(u);
    });
    wrap.appendChild(div);
  });
}

function getHashParams() {
  const hash = location.hash || '';
  const q = hash.split('?')[1] || '';
  const params = new URLSearchParams(q);
  return Object.fromEntries(params.entries());
}

function getCart() {
  try { return JSON.parse(localStorage.getItem('cart') || '[]'); } catch { return []; }
}
function setCart(items) {
  localStorage.setItem('cart', JSON.stringify(items));
}

export async function loadProductDetailFromHash() {
  const { id } = getHashParams();
  const nameEl = document.getElementById('pdName');
  const priceEl = document.getElementById('pdPrice');
  const thumbsEl = document.getElementById('pdThumbs');

  if (!id) {
    if (nameEl) nameEl.textContent = 'Product';
    if (priceEl) priceEl.textContent = '';
    if (thumbsEl) thumbsEl.innerHTML = '';
    setMainImage('');
    return;
  }

  const { data: p, error } = await supabase
    .from('products')
    .select('id, name, item_type, image_urls, stock, price')
    .eq('id', id)
    .maybeSingle();

  if (error || !p) {
    if (nameEl) nameEl.textContent = 'Product not found';
    if (priceEl) priceEl.textContent = '';
    if (thumbsEl) thumbsEl.innerHTML = '';
    setMainImage('');
    return;
  }

  const urls = parseCsvImages(p.image_urls);
  if (nameEl) nameEl.textContent = p.name || 'Product';
  if (priceEl) priceEl.textContent = ZAR.format(Number(p.price || 0));
  renderThumbs(urls.length ? urls : ['https://via.placeholder.com/800x1000?text=No+Image']);
  setMainImage(urls[0] || 'https://via.placeholder.com/800x1000?text=No+Image');

  const btn = document.getElementById('pdAddToCart');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      try { await addToCart(p, 1); alert('Added to cart.'); } catch (e) { alert('Failed: ' + e.message); }
    });
  }
}