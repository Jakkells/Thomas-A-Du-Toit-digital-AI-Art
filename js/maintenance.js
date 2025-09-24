import { supabase } from './supabaseClient.js';
import { loadProducts } from './products.js';

function show(el) { if (el) el.style.display = 'block'; }
function hide(el) { if (el) el.style.display = 'none'; }

const BUCKET = 'pictures';
const FOLDER = 'product-pictures';

let selectedFiles = [];

function renderPreview() {
  const preview = document.getElementById('imagePreview');
  if (!preview) return;
  preview.innerHTML = '';
  selectedFiles.forEach((file, idx) => {
    const div = document.createElement('div');
    div.className = 'dz-thumb';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    const rm = document.createElement('button');
    rm.className = 'dz-remove';
    rm.type = 'button';
    rm.textContent = '×';
    rm.title = 'Remove';
    rm.addEventListener('click', () => {
      selectedFiles.splice(idx, 1);
      renderPreview();
    });
    div.appendChild(img);
    div.appendChild(rm);
    preview.appendChild(div);
  });
}

function acceptFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
  selectedFiles = selectedFiles.concat(files);
  renderPreview();
}

function setupDropzone() {
  const dz = document.getElementById('imageDropzone');
  const picker = document.getElementById('filePicker');
  if (!dz || !picker) return;

  dz.addEventListener('click', () => picker.click());
  picker.addEventListener('change', (e) => acceptFiles(e.target.files));

  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    acceptFiles(e.dataTransfer?.files);
  });
}

async function uploadImages(productId) {
  const urls = [];
  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${FOLDER}/${productId}/${Date.now()}-${i}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false, cacheControl: '3600', contentType: file.type });

    if (upErr) throw upErr;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  return urls;
}

function parseCsv(csv) {
  return (csv || '').split(',').map(s => s.trim()).filter(Boolean);
}

function urlToPath(u) {
  try {
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) return u.replace(/^\/+/, '');
    const url = new URL(u);
    const p = decodeURIComponent(url.pathname);
    const m = p.match(/\/storage\/v1\/object\/(public|sign)\/([^/]+)\/(.+)/);
    if (!m) return null;
    const bucket = m[2], path = m[3];
    return bucket === BUCKET ? path : null;
  } catch { return null; }
}

async function removeImagesForProduct(productId, image_urls_csv) {
  // Paths from stored URLs (or raw paths)
  const fromUrls = parseCsv(image_urls_csv).map(urlToPath).filter(Boolean);

  // Also list the folder product-pictures/{id} to catch any files not recorded
  const dir = `${FOLDER}/${productId}`;
  let offset = 0;
  const listed = [];
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: 100, offset });
    if (error) break;
    if (!data || data.length === 0) break;
    listed.push(...data.map(f => `${dir}/${f.name}`));
    offset += data.length;
    if (data.length < 100) break;
  }

  // Dedupe and remove
  const paths = [...new Set([...fromUrls, ...listed])];
  if (paths.length > 0) {
    await supabase.storage.from(BUCKET).remove(paths);
  }
}

async function deleteProductById(id) {
  // Fetch to know which images to remove
  const { data: p } = await supabase
    .from('products')
    .select('id, image_urls')
    .eq('id', id)
    .maybeSingle();

  // Try remove images first (ignore failures, continue to DB delete)
  try { await removeImagesForProduct(id, p?.image_urls || ''); } catch (e) { console.warn('Image delete warn:', e); }

  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

export function initMaintenance() {
  const fab = document.getElementById('fabAddProduct');
  const modal = document.getElementById('productModal');
  const closeBtn = document.getElementById('closeProductModal');
  const form = document.getElementById('productForm');

  setupDropzone();

  if (fab) fab.addEventListener('click', () => show(modal));
  if (closeBtn) closeBtn.addEventListener('click', () => hide(modal));
  window.addEventListener('click', (e) => { if (e.target === modal) hide(modal); });

  // Deletion handler on Maintenance grid (event delegation)
  const gridMaint = document.getElementById('productsGridMaintenance');
  if (gridMaint && !gridMaint.dataset.delBound) {
    gridMaint.dataset.delBound = '1';
    gridMaint.addEventListener('click', async (e) => {
      const btn = e.target.closest?.('.btn-delete-product');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const ok = confirm('Delete this product?');
      if (!ok) return;
      try {
        await deleteProductById(id);
        loadProducts();
      } catch (err) {
        alert('Failed to delete: ' + (err?.message || err));
      }
    });
  }

  if (form && !form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('prodName')?.value?.trim() || '';
      const item_type = document.getElementById('prodType')?.value?.trim() || '';
      const stock = parseInt(document.getElementById('prodStock')?.value || '0', 10);
      const price = parseFloat(document.getElementById('prodPrice')?.value || '0');

      if (!name || !item_type) { alert('Please fill in name and type.'); return; }
      if (Number.isNaN(stock) || stock < 0) { alert('Stock must be 0 or more.'); return; }
      if (Number.isNaN(price) || price < 0) { alert('Price must be 0 or more.'); return; }

      try {
        const productId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // Upload images first (if any)
        const imgUrls = await uploadImages(productId);
        const image_urls = imgUrls.join(', ');
        const hidden = document.getElementById('prodImageUrls');
        if (hidden) hidden.value = image_urls;

        const { error } = await supabase.from('products').insert([{
          id: productId,
          name,
          item_type,
          image_urls,
          stock,
          price
        }]);
        if (error) throw error;

        alert('Product added.');
        form.reset();
        selectedFiles = [];
        renderPreview();
        hide(modal);
        loadProducts(); // refresh both grids
      } catch (err) {
        console.error('Add product failed:', err);
        alert('Failed to add product: ' + (err?.message || err));
      }
    });
  }
}

export function setMaintenanceAccess(isAdmin) {
  const fab = document.getElementById('fabAddProduct');
  if (fab) fab.style.display = isAdmin ? 'inline-flex' : 'none';
}