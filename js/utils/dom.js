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