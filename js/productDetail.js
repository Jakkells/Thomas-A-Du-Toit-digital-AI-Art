import { supabase } from './supabaseClient.js';
import { addToCart } from './cart.js';
import { showToast, setButtonLoading } from './utils/dom.js';

let pdState = { idx: 0, count: 0 };
let currentLoadToken = 0;
// Reference object so the click handler can see updates after network fetch
const productRef = { value: null };

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

// Centralized click handler to prevent multiple bindings
async function handleAddToCartClick(e) {
  e.preventDefault();
  e.stopPropagation();
  const btn = e.currentTarget;
  if (btn.dataset.adding === '1') return; // debounce rapid clicks
  const prod = productRef.value;
  if (!prod || !prod.id) {
    showToast('Loading product…', { variant: 'info', duration: 1500 });
    return;
  }
  try {
    btn.dataset.adding = '1';
    setButtonLoading(btn, true, 'Adding…');
    // If it takes longer than 1.2s, update the label to reassure the user
    const slowTip = setTimeout(() => {
      try { if (btn.getAttribute('aria-busy') === 'true') btn.textContent = 'Almost there…'; } catch {}
    }, 1200);
    // Add a hard timeout so the button never gets stuck on slow/unstable networks
    const TIMEOUT_MS = 7000;
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('add-to-cart-timeout')), TIMEOUT_MS));
    const result = await Promise.race([addToCart(prod, 1), timeout]);
    if (result?.alreadyInCart) {
      showToast('Already added to cart', { variant: 'info', duration: 2000 });
    } else {
      showToast('Added to cart');
    }
  } catch (e2) {
    const msg = String(e2?.message || e2 || '').toLowerCase();
    if (msg.includes('timeout')) {
      // Graceful fallback on slow links
      showToast('Still working… please check your cart in a moment.', { variant: 'info', duration: 3500 });
    } else {
      showToast('Failed to add', { variant: 'error', duration: 2500 });
    }
  } finally {
    try { clearTimeout(slowTip); } catch {}
    setButtonLoading(btn, false);
    delete btn.dataset.adding;
  }
}

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
  const btn = document.getElementById('pdAddToCart');
  // Reset reference while loading a new product
  productRef.value = null;

  if (!id) {
    if (nameEl) nameEl.textContent = 'Product';
    if (priceEl) priceEl.textContent = '';
    if (thumbsEl) thumbsEl.innerHTML = '';
    setMainImage('');
    buildCarousel([]);
    updateArrows();
    return;
  }

  // Try cache-first for instant paint
  const cached = (window.__PRODUCTS_CACHE || {})[String(id)];
  if (cached) {
    const urlsC = parseCsvImages(cached.image_urls);
    if (nameEl) nameEl.textContent = cached.name || 'Product';
    if (priceEl) priceEl.textContent = ZAR.format(Number(cached.price || 0));
    if (typeEl) typeEl.textContent = cached.item_type || '';
    if (descEl) descEl.textContent = cached.description || '';
    setMainImage(urlsC[0] || 'https://via.placeholder.com/800x1000?text=No+Image');
    applyDetailVisibility([urlsC[0]].filter(Boolean));
    productRef.value = cached;
  } else {
    // Reset UI while loading a new product
    if (nameEl) nameEl.textContent = 'Loading…';
    if (priceEl) priceEl.textContent = '';
    if (typeEl) typeEl.textContent = '';
    if (descEl) descEl.textContent = '';
    setMainImage('');
  }

  // Bind click immediately; will use productRef which updates when fetch completes
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    // Ensure clicking doesn't submit any surrounding form
    try { btn.setAttribute('type', 'button'); } catch {}
    btn.addEventListener('click', handleAddToCartClick);
  }

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
    productRef.value = null;
    return;
  }

  // Update cache with fresh data
  try {
    const cache = window.__PRODUCTS_CACHE || (window.__PRODUCTS_CACHE = {});
    cache[String(p.id)] = p;
  } catch {}

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

  // Point the click handler at the fresh product
  productRef.value = p;
}

// Keep arrows updated on resize/orientation
window.addEventListener('resize', () => {
  updateArrows();
  const main = document.getElementById('pdMainImage');
  applyDetailVisibility(main?.src ? [main.src] : []);
});