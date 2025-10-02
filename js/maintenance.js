import { supabase } from './supabaseClient.js';
import { loadProducts, productCard } from './products.js';
import { showConfirm } from './utils/dom.js';

function show(el) {
  if (el) {
    el.style.display = 'block';
    document.body.classList.add('no-scroll'); // prevent background scroll
  }
}
function hide(el) {
  if (el) {
    el.style.display = 'none';
    document.body.classList.remove('no-scroll'); // restore background scroll
  }
}

const BUCKET = 'pictures';
const FOLDER = 'product-pictures';

let selectedFiles = [];

// Decode a JWT without verifying, to read exp
function decodeJwt(token) {
  try {
    const [, payload] = token.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch { return null; }
}

function getLocalAuthToken() {
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.accessToken || null;
    return token || null;
  } catch { return null; }
}

// Get an access token (tries local fast-path, refreshes if expired/near-expiry)
async function getAccessToken() {
  // 1) Try localStorage first (fast path used by supabase-js)
  const local = getLocalAuthToken();
  if (local) return local;

  // 2) Fallback: try supabase.auth.getSession but with a short timeout to avoid hangs
  try {
    const sessionPromise = supabase.auth.getSession();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('getSession timeout')), 3000));
    const { data } = await Promise.race([sessionPromise, timeout]);
    if (data?.session?.access_token) return data.session.access_token;
  } catch {}
  return null;
}

async function getFreshAccessToken() {
  // Try local and check expiry; if exp <= now+60, refresh session
  const skew = 60; // seconds
  let token = getLocalAuthToken();
  let exp = token ? decodeJwt(token)?.exp : null;
  const now = Math.floor(Date.now() / 1000);
  if (!token || (exp && exp <= now + skew)) {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data?.session?.access_token) {
        return data.session.access_token;
      }
    } catch {}
    // Fallback to getSession (may auto-refresh)
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) return data.session.access_token;
    } catch {}
  }
  if (token) return token;
  // Last resort: use regular getter (may return null)
  return await getAccessToken();
}

function buildPublicUrl(path) {
  // Buckets marked Public can serve via this deterministic URL; avoid network call
  // Use encodeURI to keep path slashes intact but escape spaces, etc.
  return `${window.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURI(path)}`;
}

async function uploadFileDirect(file, path) {
  let token = await getFreshAccessToken();
  if (!token) throw new Error('Not authenticated. Please log in again.');

  const url = `${window.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('upload timeout'), 30000);
  let res = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'apikey': window.SUPABASE_KEY,
      'x-upsert': 'true',
      'content-type': file.type || 'application/octet-stream'
    },
    body: file,
    signal: controller.signal
  });
  clearTimeout(timeoutId);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // If token expired, try to refresh once and retry
    if (/exp\"?\s*claim|jwt|unauthorized|expired/i.test(text) || res.status === 401 || res.status === 403) {
      token = await getFreshAccessToken();
      if (!token) throw new Error(`Upload failed (${res.status}): ${text || res.statusText}`);
      const retry = await fetch(url, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${token}`,
          'apikey': window.SUPABASE_KEY,
          'x-upsert': 'true',
          'content-type': file.type || 'application/octet-stream'
        },
        body: file,
        signal: controller.signal
      });
      if (!retry.ok) {
        const t2 = await retry.text().catch(() => '');
        throw new Error(`Upload failed (${retry.status}): ${t2 || retry.statusText}`);
      }
      return path;
    }
    throw new Error(`Upload failed (${res.status}): ${text || res.statusText}`);
  }
  return path;
}

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
  console.log('acceptFiles called with:', fileList);
  const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
  console.log('Filtered image files:', files.map(f => ({
    name: f.name,
    size: f.size,
    type: f.type,
    isFile: f instanceof File
  })));
  selectedFiles = selectedFiles.concat(files);
  console.log('Total selected files:', selectedFiles.length);
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
  console.log('uploadImages called with', selectedFiles.length, 'files');
  const urls = [];
  
  // If no files selected, return empty array
  if (selectedFiles.length === 0) {
    console.log('No files to upload');
    return urls;
  }
  
  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    console.log(`Uploading file ${i + 1}/${selectedFiles.length}:`, file.name);
    console.log('File object details:', {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      isFile: file instanceof File,
      isBlob: file instanceof Blob
    });
    
    // Ensure we have a valid file
    if (!file || !(file instanceof File)) {
      throw new Error(`Invalid file object at index ${i}`);
    }
    
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${FOLDER}/${productId}/${Date.now()}-${i}.${ext}`;
    console.log('Upload path:', path);

    try {
      console.log('Starting upload (direct REST)...');
      await uploadFileDirect(file, path);
      const publicUrl = buildPublicUrl(path);
      console.log('Public URL:', publicUrl);
      urls.push(publicUrl);
    } catch (uploadError) {
      console.error('Upload failed:', uploadError);
      throw uploadError;
    }
  }
  console.log('All uploads complete:', urls);
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

// Heuristics to detect FK conflicts from REST responses
function isForeignKeyConflictStatus(status) {
  return status === 409 || status === 23503; // PostgREST conflict or PG FK code
}

async function restDelete(path, timeoutMs = 5000) {
  const token = await getFreshAccessToken();
  if (!token) throw new Error('Not authenticated.');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort('delete timeout'), timeoutMs);
  const res = await fetch(`${window.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      'authorization': `Bearer ${token}`,
      'apikey': window.SUPABASE_KEY,
      'accept': 'application/json',
      'prefer': 'return=minimal'
    },
    signal: controller.signal
  });
  clearTimeout(t);
  return res;
}

async function restGet(path, timeoutMs = 5000) {
  const token = await getFreshAccessToken();
  if (!token) throw new Error('Not authenticated.');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort('get timeout'), timeoutMs);
  const res = await fetch(`${window.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'GET',
    headers: {
      'authorization': `Bearer ${token}`,
      'apikey': window.SUPABASE_KEY,
      'accept': 'application/json'
    },
    signal: controller.signal
  });
  clearTimeout(t);
  return res;
}

async function restPost(table, row, timeoutMs = 8000) {
  const token = await getFreshAccessToken();
  if (!token) throw new Error('Not authenticated.');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort('post timeout'), timeoutMs);
  const res = await fetch(`${window.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'apikey': window.SUPABASE_KEY,
      'content-type': 'application/json',
      'accept': 'application/json',
      'prefer': 'return=representation'
    },
    body: JSON.stringify(row),
    signal: controller.signal
  });
  clearTimeout(t);
  return res;
}

// Try to delete any cart items that reference this product (REST)
async function deleteCartItemsForProduct(productId) {
  console.log('[delete] removing cart_items for product', productId);
  const res = await restDelete(`cart_items?product_id=eq.${encodeURIComponent(productId)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: new Error(`cart_items delete failed (${res.status}): ${text}`) };
  }
  return { ok: true };
}

// Delete a product and, if needed, its dependent cart_items. Remove images last (non-blocking)
async function deleteProductById(id) {
  console.log('[delete] start for product', id);
  // Get product image_urls to clean up later. If this fails, proceed.
  let imageCsv = '';
  try {
    const res = await restGet(`products?id=eq.${encodeURIComponent(id)}&select=id,image_urls`);
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr[0]?.image_urls) imageCsv = arr[0].image_urls || '';
    } else {
      console.warn('[delete] fetch product failed', res.status);
    }
  } catch (e) {
    console.warn('[delete] fetch product error', e);
  }

  // First direct delete
  let res = await restDelete(`products?id=eq.${encodeURIComponent(id)}`);
  if (!res.ok && isForeignKeyConflictStatus(res.status)) {
    // Remove dependent cart_items then retry once
    const cartDel = await deleteCartItemsForProduct(id);
    if (!cartDel.ok) {
      throw cartDel.error;
    }
    res = await restDelete(`products?id=eq.${encodeURIComponent(id)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`product delete failed (${res.status}): ${text}`);
  }

  console.log('[delete] product deleted, scheduling image cleanup');
  // Fire-and-forget image cleanup so UI is not blocked
  setTimeout(() => {
    removeImagesForProduct(id, imageCsv).catch(e => console.warn('Image removal warning:', e));
  }, 0);
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
      const ok = await showConfirm({
        title: 'Delete Product',
        message: 'Are you sure you want to delete this product? This cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        variant: 'danger'
      });
      if (!ok) return;
      try {
        const origLabel = btn.textContent;
        btn.textContent = 'Deleting…';
        btn.disabled = true;
        await deleteProductById(id);
        // Optimistically remove card from both grids
        document.querySelectorAll(`.btn-delete-product[data-id="${CSS.escape(id)}"]`).forEach(b => {
          const card = b.closest('a.product-card');
          if (card && card.parentElement) card.parentElement.removeChild(card);
        });
        // If product detail is currently showing this product, navigate back to shop
        try {
          const current = (location.hash || '').toLowerCase();
          if (current.startsWith('#product')) {
            const params = new URLSearchParams(current.split('?')[1] || '');
            const currentId = params.get('id');
            if (currentId && String(currentId) === String(id)) {
              location.hash = '#shop';
            }
          }
        } catch {}
        // Refresh grids from server in background
        loadProducts();
        // Force a light page refresh after a short delay to guarantee clean state
        setTimeout(() => { try { location.reload(); } catch {} }, 200);
      } catch (err) {
        alert('Failed to delete: ' + (err?.message || err));
      } finally {
        try { btn.textContent = origLabel || 'Delete'; btn.disabled = false; } catch {}
      }
    });
  }

  if (form && !form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      console.log('Form submission started...');

      // Skip connection test - proceed directly with form processing
      console.log('Processing form submission...');

      const name = document.getElementById('prodName')?.value?.trim() || '';
  const item_type = document.getElementById('prodType')?.value?.trim() || '';
  const description = document.getElementById('prodDesc')?.value?.trim() || '';
      const stock = parseInt(document.getElementById('prodStock')?.value || '0', 10);
      const price = parseFloat(document.getElementById('prodPrice')?.value || '0');

  console.log('Form values:', { name, item_type, description, stock, price });

      if (!name || !item_type) { 
        console.log('Validation failed: name or type missing');
        alert('Please fill in name and type.'); 
        return; 
      }
      if (Number.isNaN(stock) || stock < 0) { 
        console.log('Validation failed: invalid stock');
        alert('Stock must be 0 or more.'); 
        return; 
      }
      if (Number.isNaN(price) || price < 0) { 
        console.log('Validation failed: invalid price');
        alert('Price must be 0 or more.'); 
        return; 
      }

      // Disable the submit button to prevent double submissions
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
      }

      try {
        const productId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        console.log('Generated product ID:', productId);

        // Upload images first (if any)
        console.log('Uploading images...', selectedFiles.length, 'files');
        let imgUrls = [];
        
        if (selectedFiles.length > 0) {
          try {
            console.log('Starting image upload process...');
            imgUrls = await uploadImages(productId);
            console.log('All images uploaded successfully:', imgUrls);
          } catch (uploadError) {
            console.error('Image upload failed:', uploadError);
            const continueWithoutImages = confirm(`Image upload failed: ${uploadError.message}\n\nContinue saving product without images?`);
            if (!continueWithoutImages) {
              throw uploadError;
            }
            console.log('User chose to continue without images...');
            imgUrls = [];
          }
        } else {
          console.log('No images selected - proceeding without images');
        }
        
        const image_urls = imgUrls.join(', ');
        const hidden = document.getElementById('prodImageUrls');
        if (hidden) hidden.value = image_urls;

        console.log('Skipping auth check for now...');

        console.log('Inserting product into database...');
        const productData = {
          id: productId,
          name,
          item_type,
          description,
          image_urls,
          stock,
          price
        };
        console.log('Product data:', productData);

        // Use direct REST API call with authentication
        console.log('Inserting via REST (PostgREST) with timeout...');
        const res = await restPost('products', productData);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Insert failed (${res.status}): ${text}`);
        }
        const createdArr = await res.json().catch(() => null);
        const created = Array.isArray(createdArr) ? createdArr[0] : createdArr || productData;
        console.log('Insert successful!', created);
        console.log('Product added successfully');
        alert('Product added.');
        form.reset();
        selectedFiles = [];
        renderPreview();
        hide(modal);

        // Optimistically render in both grids for instant feedback
        const grids = [
          document.getElementById('productsGrid'),
          document.getElementById('productsGridMaintenance')
        ].filter(Boolean);
        grids.forEach(grid => {
          const deletable = grid.id === 'productsGridMaintenance';
          const card = productCard(created, { deletable });
          grid.insertBefore(card, grid.firstChild);
        });

        // Reconcile with server state in background
        loadProducts(); // refresh both grids

        // User request: force a full refresh after a product has been uploaded
        // to avoid any blank/stale state issues from prior navigation
        setTimeout(() => {
          try { location.reload(); } catch {}
        }, 200);
      } catch (err) {
        console.error('Add product failed:', err);
        alert('Failed to add product: ' + (err?.message || err));
      } finally {
        // Re-enable the submit button
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Product';
        }
      }
    });
  }
}

export function setMaintenanceAccess(isAdmin) {
  const fab = document.getElementById('fabAddProduct');
  if (fab) fab.style.display = isAdmin ? 'inline-flex' : 'none';
}