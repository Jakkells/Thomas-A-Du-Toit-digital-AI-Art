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
  let input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;
  if (btn.dataset.pwdToggleBound === '1') return;
  btn.dataset.pwdToggleBound = '1';

  // Ensure proper button behavior and accessibility
  try { btn.type = 'button'; } catch {}
  btn.setAttribute('aria-controls', inputId);
  btn.setAttribute('aria-pressed', input.type !== 'password' ? 'true' : 'false');

  const iconEye = () => (
    '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
  );
  const iconEyeOff = () => (
    '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-6.94"></path><path d="M1 1l22 22"></path><path d="M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88"></path><path d="M14.12 14.12L9.88 9.88"></path><path d="M21.06 7.06A20.3 20.3 0 0 1 23 12s-4 8-11 8a10.94 10.94 0 0 1-3.95-.76"></path></svg>'
  );

  const renderIcon = () => {
    const isVisible = input.type !== 'password';
    btn.innerHTML = isVisible ? iconEyeOff() : iconEye();
    btn.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
  };
  // Initial render
  renderIcon();

  const toggle = () => {
    const isPwd = input.type === 'password';
    const newType = isPwd ? 'text' : 'password';
    // Preserve caret and value
    const wasFocused = document.activeElement === input;
    const start = input.selectionStart, end = input.selectionEnd;
    const val = input.value;
    let swapped = false;
    try {
      input.type = newType;
    } catch {
      try { input.setAttribute('type', newType); } catch {}
    }
    // Some mobile browsers disallow type toggle on focused inputs; swap the node as fallback
    if (input.type !== newType) {
      const clone = input.cloneNode(true);
      try { clone.type = newType; } catch { clone.setAttribute('type', newType); }
      clone.value = val;
      // Replace in DOM
      const parent = input.parentNode;
      if (parent) {
        parent.replaceChild(clone, input);
        input = clone; // update captured variable
        swapped = true;
      }
    }
  renderIcon();
    btn.setAttribute('aria-pressed', isPwd ? 'true' : 'false');
    // Keep keyboard open on mobile by refocusing and restoring caret
    try {
      if (wasFocused) {
        input.focus({ preventScroll: true });
        if (typeof start === 'number' && typeof end === 'number' && input.setSelectionRange) {
          // If we swapped the node or browser moved the caret, restore it
          const pos = swapped ? val.length : start;
          input.setSelectionRange(pos, pos);
        }
      }
    } catch {}
  };

  // Click support (desktop and most mobile)
  btn.addEventListener('click', (e) => { e.preventDefault(); toggle(); });
  // Touch/pointer fallbacks for mobile browsers that don't synthesize click reliably
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });
  btn.addEventListener('touchend', (e) => { e.preventDefault(); toggle(); }, { passive: false });
  btn.addEventListener('pointerdown', (e) => { /* avoid focus loss */ if (e.pointerType === 'touch') e.preventDefault(); });
  // Keyboard accessibility
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
};

// Simple async confirm dialog using the existing modal styles.
// Usage: const ok = await showConfirm({ title: 'Delete', message: 'Are you sure?', confirmText: 'Delete', cancelText: 'Cancel', variant: 'danger' });
export function showConfirm({ title = 'Confirm', message = 'Are you sure?', confirmText = 'OK', cancelText = 'Cancel', variant = 'solid' } = {}) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal confirm-modal';
    const cancelHtml = cancelText ? `<button id="confirmCancel" class="btn btn-outline">${cancelText}</button>` : '';
    modal.innerHTML = `
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
        <button class="modal-close" aria-label="Close">×</button>
        <h3 id="confirmTitle">${title}</h3>
        <div class="modal-body">
          <p>${message}</p>
        </div>
        <div class="modal-footer" style="display:flex;">
          ${cancelHtml}
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