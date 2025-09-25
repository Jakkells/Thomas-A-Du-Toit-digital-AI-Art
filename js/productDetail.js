import { supabase } from './supabaseClient.js';
import { addToCart } from './cart.js';

let pdState = { idx: 0, count: 0 };

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

function parseCsvImages(csv) {
  return (csv || '').split(',').map(s => s.trim()).filter(Boolean);
}

function isMobile() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function setMainImage(url) {
  const img = document.getElementById('pdMainImage');
  if (img) img.src = url || 'https://via.placeholder.com/800x1000?text=No+Image';
}

function updateArrows() {
  const prev = document.getElementById('pdPrev');
  const next = document.getElementById('pdNext');
  const show = isMobile() && pdState.count > 1;
  if (prev) {
    prev.style.display = show ? 'inline-flex' : 'none';
    prev.disabled = pdState.idx <= 0;
  }
  if (next) {
    next.style.display = show ? 'inline-flex' : 'none';
    next.disabled = pdState.idx >= pdState.count - 1;
  }
}

function buildCarousel(urls) {
  const wrap = document.getElementById('pdCarousel');
  if (!wrap) return;
  const list = urls?.length ? urls : ['https://via.placeholder.com/800x1000?text=No+Image'];
  wrap.innerHTML = '';
  list.forEach((u) => {
    const slide = document.createElement('div');
    slide.className = 'pd-slide';
    const img = document.createElement('img');
    img.src = u;
    img.alt = 'Product image';
    img.loading = 'lazy';
    slide.appendChild(img);
    wrap.appendChild(slide);
  });

  pdState.idx = 0;
  pdState.count = list.length;
  updateArrows();

  if (!wrap.dataset.bound) {
    wrap.dataset.bound = '1';
    wrap.addEventListener('scroll', () => {
      const i = Math.round(wrap.scrollLeft / wrap.clientWidth);
      if (i !== pdState.idx) {
        pdState.idx = Math.max(0, Math.min(pdState.count - 1, i));
        updateArrows();
      }
    }, { passive: true });
  }
}

function goToSlide(index) {
  const wrap = document.getElementById('pdCarousel');
  if (!wrap) return;
  const i = Math.max(0, Math.min(pdState.count - 1, index));
  const slide = wrap.children[i];
  if (slide) {
    wrap.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' });
    pdState.idx = i;
    updateArrows();
  }
}

function initArrowButtons() {
  const prev = document.getElementById('pdPrev');
  const next = document.getElementById('pdNext');
  if (prev && !prev.dataset.bound) {
    prev.dataset.bound = '1';
    prev.addEventListener('click', () => goToSlide(pdState.idx - 1));
  }
  if (next && !next.dataset.bound) {
    next.dataset.bound = '1';
    next.addEventListener('click', () => goToSlide(pdState.idx + 1));
  }
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
      if (isMobile()) goToSlide(idx);
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

export async function loadProductDetailFromHash() {
  initArrowButtons();

  const { id } = getHashParams();
  const nameEl = document.getElementById('pdName');
  const priceEl = document.getElementById('pdPrice');
  const thumbsEl = document.getElementById('pdThumbs');

  if (!id) {
    if (nameEl) nameEl.textContent = 'Product';
    if (priceEl) priceEl.textContent = '';
    if (thumbsEl) thumbsEl.innerHTML = '';
    setMainImage('');
    buildCarousel([]);
    updateArrows();
    return;
  }

  const { data: p, error } = await supabase
    .from('products')
    .select('id, name, image_urls, price')
    .eq('id', id)
    .maybeSingle();

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

  if (nameEl) nameEl.textContent = p.name || 'Product';
  if (priceEl) priceEl.textContent = ZAR.format(Number(p.price || 0));

  renderThumbs(urls.length ? urls : ['https://via.placeholder.com/800x1000?text=No+Image']);
  setMainImage(urls[0] || 'https://via.placeholder.com/800x1000?text=No+Image');
  buildCarousel(urls);
  updateArrows();

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
window.addEventListener('resize', () => updateArrows());