export const onReady = (selector, cb) => {
  const el = document.querySelector(selector);
  if (el) { cb(el); return; }
  const mo = new MutationObserver(() => {
    const el2 = document.querySelector(selector);
    if (el2) { cb(el2); mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
};

export const showModal = (el) => { if (el) el.style.display = 'block'; };
export const hideModal = (el) => { if (el) el.style.display = 'none'; };

export const showGlobalMsg = (text) => {
  const el = document.getElementById('globalMsg');
  if (el) { el.textContent = text; el.style.display = 'block'; }
};

// Generic button loading helper
export function setButtonLoading(btn, loading, textWhenLoading) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    if (textWhenLoading) btn.textContent = textWhenLoading;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

// Lightweight toast (no backdrop, auto-dismiss). Usage: showToast('Added to cart');
export function showToast(message, opts = {}) {
  const { variant = 'success', duration = 2000 } = opts;
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${variant}`;
  toast.textContent = message;
  container.appendChild(toast);
  // trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));
  const remove = () => { try { toast.classList.remove('show'); setTimeout(() => toast.remove(), 200); } catch {} };
  setTimeout(remove, duration);
  return { dismiss: remove };
}

export const setupShowPassword = (inputId, btnId) => {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;
  btn.addEventListener('click', () => {
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';
    btn.textContent = isPwd ? 'Hide' : 'Show';
  });
};

// Simple async confirm dialog using the existing modal styles.
// Usage: const ok = await showConfirm({ title: 'Delete', message: 'Are you sure?', confirmText: 'Delete', cancelText: 'Cancel', variant: 'danger' });
export function showConfirm({ title = 'Confirm', message = 'Are you sure?', confirmText = 'OK', cancelText = 'Cancel', variant = 'solid' } = {}) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal confirm-modal';
    modal.innerHTML = `
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
        <button class="modal-close" aria-label="Close">×</button>
        <h3 id="confirmTitle">${title}</h3>
        <div class="modal-body">
          <p>${message}</p>
        </div>
        <div class="modal-footer" style="display:flex;">
          <button id="confirmCancel" class="btn btn-outline">${cancelText}</button>
          <button id="confirmOk" class="btn ${variant === 'danger' ? 'btn-danger' : 'btn-solid'}">${confirmText}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.body.classList.add('no-scroll');

    const cleanup = (result) => {
      try { document.body.classList.remove('no-scroll'); } catch {}
      try { modal.remove(); } catch {}
      resolve(result);
    };

    const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
    const onEsc = (e) => { if (e.key === 'Escape') cleanup(false); };

    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc, { once: true });
    modal.querySelector('.modal-close')?.addEventListener('click', (e) => { e.preventDefault(); cleanup(false); });
    modal.querySelector('#confirmCancel')?.addEventListener('click', (e) => { e.preventDefault(); cleanup(false); });
    modal.querySelector('#confirmOk')?.addEventListener('click', (e) => { e.preventDefault(); cleanup(true); });

    // show
    modal.style.display = 'block';
  });
}