import { supabase } from './supabaseClient.js';
import { addToCart } from './cart.js';

let pdState = { idx: 0, count: 0 };
let currentLoadToken = 0;

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

function parseCsvImages(csvOrArr) {
  if (Array.isArray(csvOrArr)) {
    return csvOrArr.filter(Boolean).map(s => (typeof s === 'string' ? s.trim() : s));
  }
  if (typeof csvOrArr === 'string') {
    return csvOrArr.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function isMobile() { return window.matchMedia('(max-width: 900px)').matches; }

function setMainImage(url) {
  const img = document.getElementById('pdMainImage');
  if (img) img.src = url || 'https://via.placeholder.com/800x1000?text=No+Image';
}

function updateArrows() {
  // Always hide arrows in single-image mode
  const prev = document.getElementById('pdPrev');
  const next = document.getElementById('pdNext');
  if (prev) prev.style.display = 'none';
  if (next) next.style.display = 'none';
}

function applyDetailVisibility(urls) {
  const thumbs = document.getElementById('pdThumbs');
  const main = document.getElementById('pdMainImage');
  const carousel = document.getElementById('pdCarousel');
  const prev = document.getElementById('pdPrev');
  const next = document.getElementById('pdNext');
  const count = Array.isArray(urls) ? urls.length : 0;
  const single = count <= 1;
  const mobile = isMobile();

  if (single) {
    if (thumbs) thumbs.style.display = 'none';
    if (carousel) carousel.style.display = 'none';
    if (main) main.style.display = 'block';
    if (prev) prev.style.display = 'none';
    if (next) next.style.display = 'none';
    pdState.count = count;
    pdState.idx = 0;
    return;
  }

  if (mobile) {
    if (thumbs) thumbs.style.display = 'none';
    if (main) main.style.display = 'none';
    if (carousel) carousel.style.display = 'flex';
  } else {
    if (thumbs) thumbs.style.display = '';
    if (main) main.style.display = 'block';
    if (carousel) carousel.style.display = 'none';
  }
}

function buildCarousel(urls) {
  // No carousel in single-image design; ensure it is empty
  const wrap = document.getElementById('pdCarousel');
  if (wrap) wrap.innerHTML = '';
  pdState.idx = 0; pdState.count = 0; updateArrows();
}

function goToSlide() { /* disabled in single-image design */ }

function initArrowButtons() {
  const prev = document.getElementById('pdPrev');
  const next = document.getElementById('pdNext');
  if (prev) prev.style.display = 'none';
  if (next) next.style.display = 'none';
}

function renderThumbs() {
  // No thumbs in single-image design; ensure container is empty
  const wrap = document.getElementById('pdThumbs');
  if (wrap) wrap.innerHTML = '';
}

function getHashParams() {
  const hash = location.hash || '';
  const q = hash.split('?')[1] || '';
  const params = new URLSearchParams(q);
  return Object.fromEntries(params.entries());
}

export async function loadProductDetailFromHash() {
  initArrowButtons();

  const { id } = getHashParams();
  const nameEl = document.getElementById('pdName');
  const priceEl = document.getElementById('pdPrice');
  const thumbsEl = document.getElementById('pdThumbs');
  const typeEl = document.getElementById('pdType');
  const descEl = document.getElementById('pdDesc');

  if (!id) {
    if (nameEl) nameEl.textContent = 'Product';
    if (priceEl) priceEl.textContent = '';
    if (thumbsEl) thumbsEl.innerHTML = '';
    setMainImage('');
    buildCarousel([]);
    updateArrows();
    return;
  }

  // Reset UI while loading a new product
  if (nameEl) nameEl.textContent = 'Loading…';
  if (priceEl) priceEl.textContent = '';
  if (typeEl) typeEl.textContent = '';
  if (descEl) descEl.textContent = '';
  setMainImage('');

  const token = ++currentLoadToken;
  const { data: p, error } = await supabase
    .from('products')
    .select('id, name, description, item_type, image_urls, price')
    .eq('id', id)
    .maybeSingle();

  // Ignore stale responses if another load started after this one
  if (token !== currentLoadToken) return;

  if (error || !p) {
    if (nameEl) nameEl.textContent = 'Product not found';
    if (priceEl) priceEl.textContent = '';
    if (thumbsEl) thumbsEl.innerHTML = '';
    setMainImage('');
    buildCarousel([]);
    updateArrows();
    return;
  }

  const urls = parseCsvImages(p.image_urls);
  const section = document.getElementById('product');
  if (section) section.classList.toggle('single-image', urls.length <= 1);

  if (nameEl) nameEl.textContent = p.name || 'Product';
  if (priceEl) priceEl.textContent = ZAR.format(Number(p.price || 0));
  if (typeEl) typeEl.textContent = p.item_type || '';
  if (descEl) descEl.textContent = p.description || '';

  // Thumbs only when more than one image
  renderThumbs();
  // Always set main image (fallback if none)
  setMainImage(urls[0] || 'https://via.placeholder.com/800x1000?text=No+Image');
  // Build carousel only when there is more than one image
  buildCarousel([]);
  updateArrows();
  applyDetailVisibility([urls[0]].filter(Boolean));

  const btn = document.getElementById('pdAddToCart');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      try {
        await addToCart(p, 1);
        alert('Added to cart.');
      } catch (e) {
        alert('Failed: ' + (e?.message || e));
      }
    });
  }
}

// Keep arrows updated on resize/orientation
window.addEventListener('resize', () => {
  updateArrows();
  const main = document.getElementById('pdMainImage');
  applyDetailVisibility(main?.src ? [main.src] : []);
});