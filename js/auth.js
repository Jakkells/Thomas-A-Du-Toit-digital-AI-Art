import { onReady, showModal, hideModal, setupShowPassword, showGlobalMsg } from './utils/dom.js';
import { supabase } from './supabaseClient.js';
import { setAdminNav } from './nav.js';
import { showUserUI } from './profile.js';
import { initPhoneInput, getFullNumber, isValidNumber } from './phoneInput.js';
import { setMaintenanceAccess } from './maintenance.js';
import { mergeLocalCartToDb } from './cart.js';

export function initAuth() {
  const signupModal = document.getElementById('signupModal');
  const loginModal  = document.getElementById('loginModal');

  // Open modals
  onReady('#signupBtn', (btn) => btn.addEventListener('click', () => showModal(signupModal)));
  onReady('#loginBtn',  (btn) => btn.addEventListener('click', () => showModal(loginModal)));

  // Close modals
  onReady('#closeSignup', (btn) => btn.addEventListener('click', () => hideModal(signupModal)));
  onReady('#closeLogin',  (btn) => btn.addEventListener('click', () => hideModal(loginModal)));

  // Switch between modals
  onReady('#switchToSignup', (a) => a.addEventListener('click', (e) => { e.preventDefault(); hideModal(loginModal); showModal(signupModal); }));
  onReady('#switchToLogin',  (a) => a.addEventListener('click', (e) => { e.preventDefault(); hideModal(signupModal); showModal(loginModal); }));

  // Outside click to close
  window.addEventListener('click', (e) => {
    if (e.target === signupModal) hideModal(signupModal);
    if (e.target === loginModal) hideModal(loginModal);
  });

  // Show/hide password toggles
  onReady('#showLoginPassword',  () => setupShowPassword('loginPassword', 'showLoginPassword'));
  onReady('#showSignupPassword', () => setupShowPassword('signupPassword', 'showSignupPassword'));

  // Country code picker
  onReady('#signupPhoneNumber', () => initPhoneInput());

  // Signup submit
  onReady('#signupForm', (form) => {
    if (form.dataset.bound === '1') return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const first_name  = document.getElementById('signupFirstName')?.value?.trim() || '';
      const middle_name = document.getElementById('signupMiddleName')?.value?.trim() || '';
      const last_name   = document.getElementById('signupLastName')?.value?.trim() || '';
      const address     = document.getElementById('signupAddress')?.value?.trim() || '';
      const email       = document.getElementById('signupEmail')?.value?.trim() || '';
      const password    = document.getElementById('signupPassword')?.value || '';
      const phone_number = getFullNumber();

      if (!isValidNumber()) {
        showGlobalMsg('Please enter a valid phone number.');
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { first_name, middle_name, last_name, phone_number, address } }
      });

      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('already registered')) {
          hideModal(signupModal);
          showModal(loginModal);
          let exists = document.getElementById('loginExistsMsg');
          if (!exists) {
            exists = document.createElement('div');
            exists.id = 'loginExistsMsg';
            exists.style.color = 'red';
            exists.style.marginBottom = '10px';
            exists.textContent = 'This email is already registered. Please log in.';
            document.getElementById('loginForm')?.prepend(exists);
          } else {
            exists.style.display = 'block';
          }
          return;
        }
        showGlobalMsg('Sign up failed: ' + error.message);
        return;
      }

      localStorage.setItem('signupDraft', JSON.stringify({ first_name, middle_name, last_name, phone_number, address }));
      hideModal(signupModal);
      showGlobalMsg('Sign up successful! Please confirm your email address in your mailbox before logging in.');
    });
  });

  // Login submit
  onReady('#loginForm', (form) => {
    if (form.dataset.bound === '1') return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail')?.value?.trim() || '';
      const password = document.getElementById('loginPassword')?.value || '';

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('email not confirmed')) {
          let confirmMsg = document.getElementById('loginConfirmMsg');
          if (!confirmMsg) {
            confirmMsg = document.createElement('div');
            confirmMsg.id = 'loginConfirmMsg';
            confirmMsg.style.color = 'red';
            confirmMsg.style.marginTop = '6px';
            confirmMsg.style.fontSize = '0.95em';
            confirmMsg.textContent = 'You need to confirm your email address in your mailbox.';
            const emailInput = document.getElementById('loginEmail');
            emailInput?.parentNode?.insertBefore(confirmMsg, emailInput.nextSibling);
          } else {
            confirmMsg.style.display = 'block';
          }
        } else {
          showGlobalMsg('Login failed: ' + error.message);
        }
        return;
      }

      const user = data.user;

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, name, middle_name, last_name, phone_number, address')
        .eq('id', user.id)
        .maybeSingle();

      hideModal(loginModal);
      showUserUI(profile, user, supabase);
      await mergeLocalCartToDb();

      const isAdmin = (profile?.role || '').toLowerCase() === 'admin';
      setAdminNav(isAdmin);
      setMaintenanceAccess(isAdmin);
    });
  });
}