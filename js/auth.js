import { onReady, showModal, hideModal, setupShowPassword, showGlobalMsg } from './utils/dom.js';
import { supabase } from './supabaseClient.js';
import { ensureProfile } from './profile.js';
import { getFullNumber, isValidNumber } from './phoneInput.js';

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

// Shared logout routine for header button and mobile menu item
async function doLogout(source) {
  // Prevent duplicate invocations from bubbling/global handlers
  if (document.body.dataset.loggingOut === '1') return;
  document.body.dataset.loggingOut = '1';
  const headerBtn = document.getElementById('logoutBtn');
  const navLink = document.getElementById('navLogoutLink');
  try {
    if (source === 'header' && headerBtn) setBtnLoading(headerBtn, true, 'Logging out…');
    if (source === 'nav' && navLink) { navLink.setAttribute('aria-busy', 'true'); navLink.style.opacity = '0.7'; }
    // Sign out globally to ensure all tabs/sessions are cleared
    await supabase.auth.signOut({ scope: 'global' });
    // Hard-clear any lingering sb-* auth token (defensive)
    try {
      Object.keys(localStorage).forEach((k) => {
        if (!k.startsWith('sb-')) return;
        if (k.endsWith('-auth-token') || k.endsWith('-persist-session') || k.includes('auth-token')) {
          localStorage.removeItem(k);
        }
      });
    } catch {}
    // Immediately reflect logged-out UI without waiting on event loop
    try { renderLoggedOutUI(); } catch {}
    // Route home
    try { if (!location.hash || location.hash !== '#shop') location.hash = '#shop'; } catch {}
    // Clear lightweight caches
    try { sessionStorage.removeItem('cart:last'); } catch {}
  } catch (err) {
    // Log but proceed with local cleanup + reload
    console.warn('Logout error (continuing with cleanup):', err);
  } finally {
    if (headerBtn) setBtnLoading(headerBtn, false);
    if (navLink) { navLink.removeAttribute('aria-busy'); navLink.style.opacity = ''; }
    // Close mobile nav if open
    document.body.classList.remove('nav-open');
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
    // Clear in-flight guard
    delete document.body.dataset.loggingOut;
    // As a final guarantee, perform a light reload to fully reset state
    setTimeout(() => { try { location.reload(); } catch {} }, 100);
  }
}

// Open modal/section and bind form + close handlers
function openLoginUI(which = 'login') {
  const modal = document.getElementById('authModal') || document.getElementById(`${which}Modal`);
  if (modal) {
    modal.style.display = 'block';
    document.body.classList.add('no-scroll');   // lock background scroll
    bindModalClose(modal);
    // Bind forms after shown, so submit buttons exist
    setTimeout(() => {
      bindLoginForm();
      bindSignupForm();
      bindOauthButtons();
      // Bind show/hide password toggles
      try {
        setupShowPassword('loginPassword', 'showLoginPassword');
        setupShowPassword('signupPassword', 'showSignupPassword');
        // Touch support: mirror click on touchend for some mobile browsers
        ['showLoginPassword','showSignupPassword'].forEach(id => {
          const b = document.getElementById(id);
          if (b && !b.dataset.touchBound) {
            b.dataset.touchBound = '1';
            b.addEventListener('touchend', (e) => { e.preventDefault(); b.click(); }, { passive: false });
          }
        });
      } catch {}
      if (which === 'signup') ensurePhoneInput();
    }, 0);
    return;
  }
  if (document.getElementById(which)) {
    location.hash = `#${which}`;
    setTimeout(() => {
      bindLoginForm();
      bindSignupForm();
      bindOauthButtons();
      try {
        setupShowPassword('loginPassword', 'showLoginPassword');
        setupShowPassword('signupPassword', 'showSignupPassword');
        ['showLoginPassword','showSignupPassword'].forEach(id => {
          const b = document.getElementById(id);
          if (b && !b.dataset.touchBound) {
            b.dataset.touchBound = '1';
            b.addEventListener('touchend', (e) => { e.preventDefault(); b.click(); }, { passive: false });
          }
        });
      } catch {}
      if (which === 'signup') ensurePhoneInput();
    }, 0);
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

  // Footer button lives outside the form; select it from the document
  const submitBtn = document.getElementById('signupSubmit') || form.querySelector('button[type="submit"]');

  const onSubmit = async (e) => {
    e.preventDefault();
    const email = form.querySelector('#signupEmail, [name="email"]')?.value?.trim();
    const password = form.querySelector('#signupPassword, [name="password"]')?.value || '';
    const first_name = form.querySelector('#signupFirstName')?.value?.trim() || '';
    const middle_name = form.querySelector('#signupMiddleName')?.value?.trim() || '';
    const last_name = form.querySelector('#signupLastName')?.value?.trim() || '';
    const phone_number = getFullNumber();
    const address = form.querySelector('#signupAddress')?.value?.trim() || '';
    if (!email || !password) { alert('Enter email and password.'); return; }
    // Optional: basic phone validation if library is active
    try { if (!isValidNumber()) { /* non-blocking */ } } catch {}

    try {
      setBtnLoading(submitBtn, true, 'Signing up…');
      // Save a local draft so we can create the profile on first login if needed
      try {
        localStorage.setItem('signupDraft', JSON.stringify({ first_name, middle_name, last_name, phone_number, address }));
      } catch {}
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { first_name, middle_name, last_name, phone_number, address }
        }
      });
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
    // Ensure footer button acts as submit on mobile
    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : onSubmit(e);
    });
  }
}

// Also allow switching from Login modal to Signup and initialize phone input
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.id === 'switchToSignup') {
    e.preventDefault();
    const loginModal = document.getElementById('loginModal');
    if (loginModal) loginModal.style.display = 'none';
    openLoginUI('signup');
  }
});

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

// Insert a Logout item into the hamburger nav (mobile)
function ensureLogoutInMenu() {
  const menu = document.querySelector('.nav-menu');
  if (!menu) return;
  let li = document.getElementById('nav-logout');
  if (!li) {
    li = document.createElement('li');
    li.id = 'nav-logout';
    li.innerHTML = '<a id="navLogoutLink" href="#">Logout</a>';
    menu.appendChild(li);
  }
  const link = document.getElementById('navLogoutLink');
  if (link && !link.dataset.bound) {
    link.dataset.bound = '1';
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await doLogout('nav');
    });
  }
}

// Global click fallback: if elements are re-rendered before specific bindings,
// still catch logout clicks reliably.
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t) return;
  if (t.id === 'logoutBtn') {
    e.preventDefault();
    await doLogout('header');
  } else if (t.id === 'navLogoutLink') {
    e.preventDefault();
    e.stopPropagation();
    await doLogout('nav');
  }
});

function removeLogoutFromMenu() {
  const li = document.getElementById('nav-logout');
  if (li) li.remove();
}

// Insert a greeting at the very top of the hamburger nav (mobile)
function ensureGreetingInMenu(displayName) {
  const menu = document.querySelector('.nav-menu');
  if (!menu) return;
  let li = document.getElementById('nav-greeting');
  const name = (displayName || '').trim();
  const friendly = name || 'friend';
  const text = `Browsing are we, ${friendly}?`;
  if (!li) {
    li = document.createElement('li');
    li.id = 'nav-greeting';
    li.className = 'nav-greeting';
    li.textContent = text;
    // Insert at the top
    menu.insertBefore(li, menu.firstChild);
  } else {
    li.textContent = text;
  }
}

function removeGreetingFromMenu() {
  const li = document.getElementById('nav-greeting');
  if (li) li.remove();
}

// Insert Login/Sign Up items into the hamburger nav (mobile when logged out)
function ensureAuthLinksInMenu() {
  const menu = document.querySelector('.nav-menu');
  if (!menu) return;
  // Login
  let liLogin = document.getElementById('nav-login');
  if (!liLogin) {
    liLogin = document.createElement('li');
    liLogin.id = 'nav-login';
    liLogin.innerHTML = '<a id="navLoginLink" href="#">Login</a>';
    menu.appendChild(liLogin);
  }
  const loginLink = document.getElementById('navLoginLink');
  if (loginLink && !loginLink.dataset.bound) {
    loginLink.dataset.bound = '1';
    loginLink.addEventListener('click', (e) => {
      e.preventDefault();
      // Close nav then open Login modal
      document.body.classList.remove('nav-open');
      const menuToggle = document.getElementById('menuToggle');
      if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
      openLoginUI('login');
    });
  }
  // Sign Up
  let liSignup = document.getElementById('nav-signup');
  if (!liSignup) {
    liSignup = document.createElement('li');
    liSignup.id = 'nav-signup';
    liSignup.innerHTML = '<a id="navSignupLink" href="#">Sign Up</a>';
    menu.appendChild(liSignup);
  }
  const signupLink = document.getElementById('navSignupLink');
  if (signupLink && !signupLink.dataset.bound) {
    signupLink.dataset.bound = '1';
    signupLink.addEventListener('click', (e) => {
      e.preventDefault();
      document.body.classList.remove('nav-open');
      const menuToggle = document.getElementById('menuToggle');
      if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
      openLoginUI('signup');
    });
  }
}

function removeAuthLinksFromMenu() {
  const ids = ['nav-login', 'nav-signup'];
  ids.forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });
}

function renderLoggedInUI(profile, user) {
  const auth = document.getElementById('authControls');
  if (!auth) return;
  const display = profile?.first_name || profile?.name || user?.email || 'Account';
  auth.innerHTML = `
    <span id="userName" class="user-name" title="${display}">Hi ${display}</span>
    <button id="logoutBtn" class="btn btn-outline-light">Logout</button>
  `;
  ensureLogoutStyle();

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = '1';
    logoutBtn.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); await doLogout('header'); });
  }
  const role = (profile?.role || '').toLowerCase();
  // Expose Logout inside hamburger menu for mobile
  ensureLogoutInMenu();
  // Friendly greeting at the top of the hamburger
  ensureGreetingInMenu(profile?.first_name || profile?.name || user?.email?.split('@')[0] || 'friend');
  // Remove Login/Signup menu items when logged in
  removeAuthLinksFromMenu();
  emitAuthChanged(role === 'admin', user);
}

function renderLoggedOutUI() {
  const auth = document.getElementById('authControls');
  if (!auth) return;
  auth.innerHTML = `
    <button class="btn btn-outline-light" id="loginBtn">Login</button>
    <button class="btn btn-outline-light" id="signupBtn">Sign Up</button>
  `;
  // Remove mobile nav logout item when logged out
  removeLogoutFromMenu();
  // Remove greeting when logged out
  removeGreetingFromMenu();
  // Add Login/Sign Up into hamburger menu (mobile)
  ensureAuthLinksInMenu();
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
    const profile = await ensureProfile(supabase, user);
    renderLoggedInUI(profile, user);
  } else {
    renderLoggedOutUI();
  }

  supabase.auth.onAuthStateChange(async (_evt, session) => {
    if (session?.user) {
      const profile = await ensureProfile(supabase, session.user);
      renderLoggedInUI(profile, session.user);
    } else {
      renderLoggedOutUI();
    }
  });
}

// Lazy-load phone input assets only when needed (signup)
let intlAssetsLoaded = false;
function ensurePhoneInput() {
  if (intlAssetsLoaded) {
    import('./phoneInput.js').then(m => m.initPhoneInput?.()).catch(() => {});
    return;
  }
  const head = document.head;
  const cssHref = 'https://cdn.jsdelivr.net/npm/intl-tel-input@19.5.6/build/css/intlTelInput.min.css';
  const jsSrc = 'https://cdn.jsdelivr.net/npm/intl-tel-input@19.5.6/build/js/intlTelInput.min.js';
  const utilSrc = 'https://cdn.jsdelivr.net/npm/intl-tel-input@19.5.6/build/js/utils.js';

  // Add CSS once
  if (!document.querySelector(`link[href="${cssHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssHref;
    head.appendChild(link);
  }
  // Load JS then utils, then init
  const script = document.createElement('script');
  script.src = jsSrc; script.defer = true;
  script.onload = () => {
    const utils = document.createElement('script');
    utils.src = utilSrc; utils.defer = true;
    utils.onload = () => {
      intlAssetsLoaded = true;
      import('./phoneInput.js').then(m => m.initPhoneInput?.()).catch(() => {});
    };
    head.appendChild(utils);
  };
  head.appendChild(script);
}