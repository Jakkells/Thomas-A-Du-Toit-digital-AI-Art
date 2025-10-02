import { onReady, showModal, hideModal, setupShowPassword, showGlobalMsg, showConfirm } from './utils/dom.js';
import { supabase } from './supabaseClient.js';
import { ensureProfile } from './profile.js';
import { setAdminNav } from './nav.js';
import { getFullNumber, isValidNumber } from './phoneInput.js';

// Minimal logger so the app doesn't break if debug helpers were removed.
// Change to a no-op later by setting authDebug = () => {} if you want silence.
function authDebug(...args) {
  try { console.log('[auth]', ...args); } catch {}
}

// Guard so we don't open the reset modal twice
let _resetModalOpened = false;
// During reset verification we may trigger transient SIGNED_IN events; suppress UI updates
let _resetVerifying = false;

async function openResetModalFlow() {
  if (_resetModalOpened) return;
  const modal = document.getElementById('resetModal');
  if (!modal) return;
  _resetModalOpened = true;
  authDebug('openResetModalFlow: opening modal');
  modal.style.display = 'block';
  document.body.classList.add('no-scroll');
  document.body.classList.add('recovery-active');
  bindModalClose(modal);
  try { setupShowPassword('resetNewPassword', 'showResetPassword'); } catch {}

  const form = document.getElementById('resetForm');
  const submitBtn = document.getElementById('resetSubmit');
  // Helper: try signing in with the new password to confirm it works; returns boolean
  const verifyNewPassword = async (email, pwd) => {
    if (!email || !pwd) { authDebug('verify: skipped (missing email or password)'); return; }
    _resetVerifying = true;
    try {
      authDebug('verify: attempting sign-in with new password');
      const verifyPromise = supabase.auth.signInWithPassword({ email, password: pwd });
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('verify-timeout')), 5000));
      let verifyResult;
      try {
        verifyResult = await Promise.race([verifyPromise, timeoutPromise]);
      } catch (verr) {
        verifyResult = verr;
      }
      if (verifyResult && verifyResult.data && verifyResult.data.user) {
        authDebug('verify: success (can sign in with new password)');
        return true;
      } else if (verifyResult && verifyResult.error) {
        authDebug('verify: failed', { message: verifyResult.error?.message || String(verifyResult.error) });
        return false;
      } else if (verifyResult instanceof Error) {
        authDebug('verify: failed', { message: verifyResult.message || 'unknown error' });
        return false;
      } else {
        authDebug('verify: ambiguous result');
        return false;
      }
    } catch (verr) {
      authDebug('verify: exception', { message: verr?.message || String(verr) });
      return false;
    } finally {
      _resetVerifying = false;
    }
  };
  const onReset = async (e) => {
    e?.preventDefault?.();
    authDebug('onReset: click captured');
    if (form && form.dataset.resetting === '1') { authDebug('onReset: ignored (already processing)'); return; }
    if (form) form.dataset.resetting = '1';
    const pwd = document.getElementById('resetNewPassword')?.value || '';
    if (!pwd) return;
    let done = false;
    const finish = async (cb) => {
      if (done) return; done = true;
      authDebug('finish(): starting cleanup');
      try { await cb?.(); } catch {}
      // Clear any cached Supabase auth keys so the user must log in explicitly
      try {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith('sb-')) localStorage.removeItem(k);
        });
      } catch {}
      // Clear any recovery hint flags so the modal does not reopen after reload
      try { sessionStorage.removeItem('sb:recovery'); } catch {}
      document.body.classList.remove('no-scroll');
      document.body.classList.remove('recovery-active');
      setBtnLoading(submitBtn, false);
      if (form) delete form.dataset.resetting;
      // Proactively restore header auth controls (in case onAuthStateChange is slow)
      try {
        const auth = document.getElementById('authControls');
        if (auth) auth.style.visibility = '';
        // Force logged-out UI now; auth listener will reconcile later if needed
        renderLoggedOutUI();
        try { setAdminNav(false); } catch {}
      } catch {}
      // Close mobile nav if open
      document.body.classList.remove('nav-open');
      try { const btn = document.getElementById('menuToggle'); if (btn) btn.setAttribute('aria-expanded','false'); } catch {}
      // Route away from protected pages
      try { if (!location.hash || location.hash === '#maintenance') location.hash = '#shop'; } catch {}
  // Reload the page like pressing the browser reload button
  try { location.reload(); } catch { openLoginUI('login'); }
    };

    try {
      // Show loading immediately so the user gets feedback even if getSession is slow
      setBtnLoading(submitBtn, true, 'Updating…');
      const { data: s } = await supabase.auth.getSession();
      authDebug('onReset: session fetched', { hasSession: !!s?.session });
      if (!s?.session) throw new Error('Auth session missing! Please reopen the reset link from your email.');
      // Listen for USER_UPDATED event in parallel to the API call; whichever resolves first wins
      const { data: subObj } = supabase.auth.onAuthStateChange(async (evt) => {
        authDebug('onReset: auth evt', { evt });
        if (evt === 'USER_UPDATED') {
          try { subObj?.subscription?.unsubscribe?.(); } catch {}
          // Verify before finishing, to log whether new password works
          try {
            const email = s?.session?.user?.email || '';
            await verifyNewPassword(email, pwd);
          } catch {}
          finish(async () => {
            try { hideModal(modal); } catch {}
            await showConfirm({ title: 'Password updated', message: 'You can now sign in with your new password.', confirmText: 'OK', cancelText: '' });
          });
        }
      });

      const t0 = performance.now();
      authDebug('updateUser start');
      const { error } = await supabase.auth.updateUser({ password: pwd });
      const dt = Math.round(performance.now() - t0);
      authDebug('updateUser finished', { ms: dt, error: error || null });
      // If the call itself returns (success or error), cancel the event listener and proceed
      try { subObj?.subscription?.unsubscribe?.(); } catch {}
      if (error) throw error;
      // Verify that the new password actually works, log result only
      try { await verifyNewPassword(s?.session?.user?.email || '', pwd); } catch {}
      await finish(async () => {
        try { hideModal(modal); } catch {}
        await showConfirm({ title: 'Password updated', message: 'You can now sign in with your new password.', confirmText: 'OK', cancelText: '' });
      });
    } catch (err) {
      authDebug('onReset caught error', err);
      // If update failed (e.g., same password), accept success when the provided password already works
      try { subObj?.subscription?.unsubscribe?.(); } catch {}
      let verified = false;
      try {
        const email = s?.session?.user?.email || '';
        verified = await verifyNewPassword(email, pwd);
      } catch {}
      if (verified) {
        await finish(async () => {
          try { hideModal(modal); } catch {}
          await showConfirm({ title: 'Password updated', message: 'You can now sign in with your new password.', confirmText: 'OK', cancelText: '' });
        });
      } else {
        await finish(async () => {
          hideModal(modal);
          await showConfirm({
            title: 'Update failed',
            message: (err && err.message) ? err.message + '\nIf you requested a reset, your password may still have been changed. Please try signing in with the new password.' : 'Please try again.',
            confirmText: 'OK',
            cancelText: ''
          });
        });
      }
    }
  };
  form?.addEventListener('submit', onReset);
  if (submitBtn && !submitBtn.dataset.bound) {
    submitBtn.dataset.bound = '1';
    authDebug('onReset: handlers bound');
  }
}

// Reusable: bind close handlers to a modal container
function bindModalClose(modal) {
  if (!modal || modal.dataset.boundClose) return;
  modal.dataset.boundClose = '1';

  const closeModal = () => {
    modal.style.display = 'none';
    document.body.classList.remove('no-scroll');
    document.body.classList.remove('recovery-active');
    modal.dispatchEvent(new Event('modal:unbind'));
  };

  // Buttons/links inside the modal that should close it
  modal.querySelectorAll('.modal-close, [data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
  });

  // Click on backdrop closes for most modals, but NOT for login/signup
  const preventBackdropClose = modal.id === 'loginModal' || modal.id === 'signupModal';
  modal.addEventListener('click', (e) => {
    if (e.target === modal && !preventBackdropClose) closeModal();
  });
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
        if (k.startsWith('sb-')) localStorage.removeItem(k);
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
        // Legacy shim no longer needed; setupShowPassword handles touch natively.
        // Keep for backward-compat only if not already bound by setup.
        ['showLoginPassword','showSignupPassword'].forEach(id => {
          const b = document.getElementById(id);
          if (b && !b.dataset.touchBound && b.dataset.pwdToggleBound !== '1') {
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
          if (b && !b.dataset.touchBound && b.dataset.pwdToggleBound !== '1') {
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
  const forgot = document.getElementById('forgotPasswordLink');
  if (forgot && !forgot.dataset.bound) {
    forgot.dataset.bound = '1';
    forgot.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = (document.getElementById('loginEmail')?.value || '').trim();
      if (!email) {
        await showConfirm({ title: 'Reset password', message: 'Enter your email first, then tap “Forgot your password?”.', confirmText: 'OK', cancelText: '' });
        return;
      }
      try {
        // Send reset email with redirectTo back to this site (no custom hash). Supabase
        // will restore the session in this window on return and emit PASSWORD_RECOVERY.
        const redirectTo = window.location.origin + window.location.pathname;
        authDebug('forgotPassword: sending reset', { email, redirectTo });
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        await showConfirm({ title: 'Email sent', message: `We\'ve emailed a password reset link to ${email}.`, confirmText: 'OK', cancelText: '' });
      } catch (err) {
        await showConfirm({ title: 'Couldn\'t send reset', message: err?.message || 'Please try again.', confirmText: 'OK', cancelText: '' });
      }
    });
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
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('invalid login') || msg.includes('user not found') || (msg.includes('invalid') && msg.includes('credentials'))) {
        await showConfirm({
          title: 'Can’t sign in',
          message: 'We couldn’t find an account for that email. Please check your details or sign up if you don’t have an account.',
          confirmText: 'OK',
          cancelText: ''
        });
      } else if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
        await showConfirm({
          title: 'Confirm your email',
          message: 'Please confirm your email before signing in. Check your inbox for the verification link.',
          confirmText: 'OK',
          cancelText: ''
        });
      } else {
        await showConfirm({
          title: 'Sign in failed',
          message: err?.message || 'An error occurred while signing in.',
          confirmText: 'OK',
          cancelText: ''
        });
      }
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
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { first_name, middle_name, last_name, phone_number, address }
        }
      });
      if (error) {
        const msg = String(error.message || '').toLowerCase();
        // Typical Supabase message: "User already registered"
        if (msg.includes('already') && (msg.includes('registered') || msg.includes('exist'))) {
          // Close the signup modal first so only the notice is visible
          const sm = document.getElementById('signupModal');
          if (sm) sm.style.display = 'none';
          document.body.classList.remove('no-scroll');
          await showConfirm({
            title: 'Account exists',
            message: 'An account with this email already exists. Please log in instead.',
            confirmText: 'OK',
            cancelText: ''
          });
          return; // stop further handling
        }
        throw error;
      }
      // Supabase returns success with data.user.identities = [] when the email already exists
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        // Close the signup modal first so only the notice is visible
        const sm = document.getElementById('signupModal');
        if (sm) sm.style.display = 'none';
        document.body.classList.remove('no-scroll');
        await showConfirm({
          title: 'Account exists',
          message: 'An account with this email already exists. Please log in instead.',
          confirmText: 'OK',
          cancelText: ''
        });
        return;
      }
      // Close the signup modal then show an OK-only popup for success
      const sm2 = document.getElementById('signupModal');
      if (sm2) sm2.style.display = 'none';
      document.body.classList.remove('no-scroll');
      await showConfirm({
        title: 'Check your email',
        message: `We\'ve sent a confirmation link to ${email}. Please verify to finish creating your account.`,
        confirmText: 'OK',
        cancelText: ''
      });
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
    li.innerHTML = '<a id="navLogoutLink" href="#" role="button" tabindex="0" aria-label="Logout">Logout</a>';
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
    // Some mobile browsers may not synthesize click reliably; add touchend fallback
    link.addEventListener('touchend', async (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch {}
      await doLogout('nav');
    }, { passive: false });
    // Keyboard accessibility for Enter/Space
    link.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); await doLogout('nav'); }
    });
  }
}

// Global click fallback: if elements are re-rendered before specific bindings,
// still catch logout clicks reliably.
document.addEventListener('click', async (e) => {
  const root = e.target;
  if (!root || !root.closest) return;
  const el = root.closest('#logoutBtn, #navLogoutLink');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  const source = el.id === 'navLogoutLink' ? 'nav' : 'header';
  await doLogout(source);
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
    <button id="logoutBtn" type="button" class="btn btn-outline-light">Logout</button>
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
  authDebug('initAuth start');
  const { data: sessionData } = await supabase.auth.getSession();
  // Detect recovery intent early so we don't sign out the temporary recovery session
  const hash = location.hash || '';
  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const recoveryIntent = (hashParams.get('type') || '').toLowerCase() === 'recovery' || hash.includes('recovery') || sessionStorage.getItem('sb:recovery') === '1';
  const confirmIntent = (hashParams.get('type') || '').toLowerCase() === 'signup' || sessionStorage.getItem('sb:confirmed') === '1';
  authDebug('initAuth: initial session fetched', { hasSession: !!sessionData?.session, recoveryIntent });

  // If a session is persisted from a previous visit and this is NOT a recovery flow,
  // sign out immediately ONLY on the first load of this tab, so users stay signed in on reloads.
  const firstLoadKey = 'sb:first-load-done';
  const isFirstLoad = !sessionStorage.getItem(firstLoadKey);
  if (sessionData?.session && !recoveryIntent && isFirstLoad) {
    try {
      await supabase.auth.signOut({ scope: 'global' });
      try {
        Object.keys(localStorage).forEach((k) => { if (k.startsWith('sb-')) localStorage.removeItem(k); });
      } catch {}
    } catch (e) { console.warn('Early sign-out failed:', e); }
  }
  // Mark that this tab has completed the first-load cycle
  try { sessionStorage.setItem(firstLoadKey, '1'); } catch {}

  // Re-check session after possible early sign-out
  const { data: sessionData2 } = await supabase.auth.getSession();
  const activeSession = sessionData2?.session || null;
  // If we detected email confirmation intent, show a one-time success message and sign the user out
  // so they can explicitly log in (avoids ambiguity of temporary sessions after confirm).
  if (confirmIntent) {
    try {
      sessionStorage.removeItem('sb:confirmed');
      await showConfirm({ title: 'Email confirmed', message: 'Your email has been verified. You can now sign in.', confirmText: 'OK', cancelText: '' });
    } catch {}
    try {
      await supabase.auth.signOut({ scope: 'global' });
      Object.keys(localStorage).forEach((k) => { if (k.startsWith('sb-')) localStorage.removeItem(k); });
    } catch {}
    // Clean up URL hash to a friendly route
    try { if (!location.hash || location.hash === '#') location.hash = '#shop'; } catch {}
  }
  if (sessionData?.session?.user) {
    const user = (activeSession || sessionData.session).user;
    const profile = await ensureProfile(supabase, user);
    renderLoggedInUI(profile, user);
  } else {
    renderLoggedOutUI();
  }

  supabase.auth.onAuthStateChange(async (evt, session) => {
    authDebug('onAuthStateChange', { evt, hasSession: !!session });
    // During reset verification we may trigger transient SIGNED_IN/SIGNED_OUT events - suppress UI churn
    if (!_resetVerifying) {
      if (session?.user) {
        const profile = await ensureProfile(supabase, session.user);
        renderLoggedInUI(profile, session.user);
      } else {
        renderLoggedOutUI();
      }
    } else {
      authDebug('onAuthStateChange: suppressed during reset verify', { evt });
    }

    // If Supabase returns from the reset link, evt === 'PASSWORD_RECOVERY' and a session is present.
    if (evt === 'PASSWORD_RECOVERY') {
      try { await openResetModalFlow(); } catch {}
    }
  });

  // Fallbacks at startup: detect recovery tokens or type in the URL and open the reset modal.
  try {
    const hash = location.hash || '';
    const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const isRecovery = (hashParams.get('type') || '').toLowerCase() === 'recovery' || hash.includes('recovery') || sessionStorage.getItem('sb:recovery') === '1';
    const isConfirm = (hashParams.get('type') || '').toLowerCase() === 'signup' || sessionStorage.getItem('sb:confirmed') === '1';
    authDebug('startup recovery check', { isRecovery, hash });
    if (isRecovery) {
      const { data: s } = await supabase.auth.getSession();
      if (s?.session) {
        authDebug('startup: session present, opening reset modal');
        await openResetModalFlow();
        history.replaceState(null, '', location.pathname + location.search);
        sessionStorage.removeItem('sb:recovery');
      }
    }
    // If confirming email, ensure we clear the hash so subsequent loads don't retrigger popups
    if (isConfirm) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    }
  } catch {}
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