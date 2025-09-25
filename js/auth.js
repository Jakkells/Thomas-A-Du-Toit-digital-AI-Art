import { onReady, showModal, hideModal, setupShowPassword, showGlobalMsg } from './utils/dom.js';
import { supabase } from './supabaseClient.js';

// Reusable: bind close handlers to a modal container
function bindModalClose(modal) {
  if (!modal || modal.dataset.boundClose) return;
  modal.dataset.boundClose = '1';

  const closeModal = () => {
    modal.style.display = 'none';
    document.body.classList.remove('no-scroll');
    modal.dispatchEvent(new Event('modal:unbind'));
  };

  // Buttons/links inside the modal that should close it
  modal.querySelectorAll('.modal-close, [data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
  });

  // Click on backdrop closes (assumes the modal container is the backdrop)
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  modal.querySelector('.modal-content')?.addEventListener('click', (e) => e.stopPropagation());

  // ESC key closes
  const onEsc = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onEsc);
  modal.addEventListener('modal:unbind', () => document.removeEventListener('keydown', onEsc));
}

// Reusable loading state
function setBtnLoading(btn, loading, textWhenLoading) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = textWhenLoading;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

// Keep logout style consistent
function ensureLogoutStyle() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.classList.remove('btn-outline', 'btn-solid', 'btn-primary', 'btn-dark', 'btn-light');
  btn.classList.add('btn', 'btn-outline-light');
}

// Open modal/section and bind form + close handlers
function openLoginUI(which = 'login') {
  const modal = document.getElementById('authModal') || document.getElementById(`${which}Modal`);
  if (modal) {
    modal.style.display = 'block';
    document.body.classList.add('no-scroll');   // lock background scroll
    bindModalClose(modal);
    // Bind forms after shown, so submit buttons exist
    setTimeout(() => { bindLoginForm(); bindSignupForm(); bindOauthButtons(); }, 0);
    return;
  }
  if (document.getElementById(which)) {
    location.hash = `#${which}`;
    setTimeout(() => { bindLoginForm(); bindSignupForm(); bindOauthButtons(); }, 0);
    return;
  }
  console.warn('Auth UI not found.');
}

function bindAuthButtons() {
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn && !loginBtn.dataset.bound) {
    loginBtn.dataset.bound = '1';
    loginBtn.addEventListener('click', (e) => { e.preventDefault(); openLoginUI('login'); });
  }
  const signupBtn = document.getElementById('signupBtn');
  if (signupBtn && !signupBtn.dataset.bound) {
    signupBtn.dataset.bound = '1';
    signupBtn.addEventListener('click', (e) => { e.preventDefault(); openLoginUI('signup'); });
  }
}

// Bind Sign In (supports either #loginForm or form[data-auth="login"])
function bindLoginForm() {
  const form = document.getElementById('loginForm') || document.querySelector('form[data-auth="login"]');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';

  const submitBtn = form.querySelector('button[type="submit"], #loginSubmit');

  const onSubmit = async (e) => {
    e.preventDefault();
    const email = form.querySelector('#loginEmail, [name="email"]')?.value?.trim();
    const password = form.querySelector('#loginPassword, [name="password"]')?.value || '';
    if (!email || !password) { alert('Enter email and password.'); return; }

    try {
      setBtnLoading(submitBtn, true, 'Signing in…');
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Close modal if present
      const modal = document.getElementById('authModal') || document.getElementById('loginModal');
      if (modal) modal.style.display = 'none';
    } catch (err) {
      alert('Sign in failed: ' + (err?.message || err));
    } finally {
      setBtnLoading(submitBtn, false);
    }
  };

  form.addEventListener('submit', onSubmit);
  if (submitBtn && !submitBtn.dataset.bound) {
    submitBtn.dataset.bound = '1';
    submitBtn.addEventListener('click', onSubmit);
  }
}

// Bind Sign Up (supports either #signupForm or form[data-auth="signup"])
function bindSignupForm() {
  const form = document.getElementById('signupForm') || document.querySelector('form[data-auth="signup"]');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';

  const submitBtn = form.querySelector('button[type="submit"], #signupSubmit');

  const onSubmit = async (e) => {
    e.preventDefault();
    const email = form.querySelector('#signupEmail, [name="email"]')?.value?.trim();
    const password = form.querySelector('#signupPassword, [name="password"]')?.value || '';
    if (!email || !password) { alert('Enter email and password.'); return; }

    try {
      setBtnLoading(submitBtn, true, 'Signing up…');
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      alert('Check your email to confirm your account.');
      const modal = document.getElementById('authModal') || document.getElementById('signupModal');
      if (modal) modal.style.display = 'none';
    } catch (err) {
      alert('Sign up failed: ' + (err?.message || err));
    } finally {
      setBtnLoading(submitBtn, false);
    }
  };

  form.addEventListener('submit', onSubmit);
  if (submitBtn && !submitBtn.dataset.bound) {
    submitBtn.dataset.bound = '1';
    submitBtn.addEventListener('click', onSubmit);
  }
}

// Optional: OAuth buttons loading state
function bindOauthButtons() {
  document.querySelectorAll('.oauth-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        setBtnLoading(btn, true, 'Opening…');
        const { error } = await supabase.auth.signInWithOAuth({
          provider: btn.dataset.provider,
          options: { redirectTo: window.location.origin }
        });
        if (error) throw error;
      } catch (err) {
        alert('OAuth failed: ' + (err?.message || err));
        setBtnLoading(btn, false);
      }
    });
  });
}

function emitAuthChanged(isAdmin, user = null) {
  window.dispatchEvent(new CustomEvent('auth:changed', { detail: { isAdmin: !!isAdmin, user } }));
}

function renderLoggedInUI(profile, user) {
  const auth = document.getElementById('authControls');
  if (!auth) return;
  const display = profile?.name || profile?.first_name || user?.email || 'Account';
  auth.innerHTML = `
    <span id="userName" class="user-name">${display}</span>
    <button id="logoutBtn" class="btn btn-outline-light">Logout</button>
  `;
  ensureLogoutStyle();

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = '1';
    logoutBtn.addEventListener('click', async () => {
      setBtnLoading(logoutBtn, true, 'Logging out…');
      await supabase.auth.signOut();
    });
  }
  const role = (profile?.role || '').toLowerCase();
  emitAuthChanged(role === 'admin', user);
}

function renderLoggedOutUI() {
  const auth = document.getElementById('authControls');
  if (!auth) return;
  auth.innerHTML = `
    <button class="btn btn-outline-light" id="loginBtn">Login</button>
    <button class="btn btn-outline-light" id="signupBtn">Sign Up</button>
  `;
  bindAuthButtons();
  // Forms may be in a hidden modal; bind when present
  bindLoginForm();
  bindSignupForm();
  bindOauthButtons();
  emitAuthChanged(false, null);
}

export async function initAuth() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session?.user) {
    const user = sessionData.session.user;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    renderLoggedInUI(profile, user);
  } else {
    renderLoggedOutUI();
  }

  supabase.auth.onAuthStateChange(async (_evt, session) => {
    if (session?.user) {
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      renderLoggedInUI(profile, session.user);
    } else {
      renderLoggedOutUI();
    }
  });
}