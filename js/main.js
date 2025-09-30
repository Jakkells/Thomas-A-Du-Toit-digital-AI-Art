import { supabase } from './supabaseClient.js';
import { showGlobalMsg } from './utils/dom.js';
import { initAuth } from './auth.js';
import { setAdminNav } from './nav.js';
import { setMaintenanceAccess, initMaintenance } from './maintenance.js';
import { initProducts } from './products.js';
import { loadProductDetailFromHash } from './productDetail.js';
import { initCartView, loadCartPage } from './cartView.js';

let isAdmin = false;

function showSection(sectionId) {
  const sections = ['shop', 'about', 'contact', 'maintenance', 'product', 'cart'];
  sections.forEach(id => {
    const el = document.getElementById(id) || document.querySelector(`section#${id}`);
    if (el) el.classList.toggle('hidden', id !== sectionId);
  });
  setMaintenanceAccess(isAdmin && sectionId === 'maintenance');
}

function route() {
  const hash = (location.hash || '#shop');
  const section = hash.split('?')[0].replace('#', '') || 'shop';

  // Guard: non-admins cannot view maintenance
  if (section === 'maintenance' && !isAdmin) {
    location.hash = '#shop';
    return;
  }

  showSection(section);
  // Re-assert admin nav link on each navigation (defensive)
  setAdminNav(isAdmin);
  if (section === 'product') loadProductDetailFromHash();
  if (section === 'cart') loadCartPage();
}

function initMobileMenu() {
  const btn = document.getElementById('menuToggle');
  const nav = document.getElementById('siteNav');
  if (!btn || !nav || btn.dataset.bound) return;
  btn.dataset.bound = '1';

  const setOpen = (open) => {
    document.body.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  btn.addEventListener('click', () => {
    setOpen(!document.body.classList.contains('nav-open'));
  });

  // Close on link click
  nav.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.tagName === 'A') setOpen(false);
  });

  // Close on route change
  window.addEventListener('hashchange', () => setOpen(false));
}

document.addEventListener('DOMContentLoaded', async () => {
  // Show any unexpected runtime errors
  window.addEventListener('error', (e) => {
    console.error('Runtime error:', e.error || e.message || e);
    showGlobalMsg('An error occurred while loading the app. Please refresh.');
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    showGlobalMsg('A network or app error occurred. Please try again.');
  });

  initAuth();
  initProducts();
  initCartView();
  initMaintenance();
  initMobileMenu();

  route();
  window.addEventListener('hashchange', route);

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session?.user) {
    const user = sessionData.session.user;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role, name, middle_name, last_name, phone_number, address')
      .eq('id', user.id)
      .maybeSingle();

    isAdmin = (profile?.role || '').toLowerCase() === 'admin';
    setAdminNav(isAdmin);

    const current = (location.hash || '#shop').split('?')[0].replace('#', '') || 'shop';
    showSection(current);
  } else {
    isAdmin = false;
    setAdminNav(false);
    setMaintenanceAccess(false);
  }

  // React to auth changes from auth.js
  window.addEventListener('auth:changed', (e) => {
    isAdmin = !!e.detail?.isAdmin;
    setAdminNav(isAdmin);

    // If user lost admin while on maintenance, kick to shop
    if (!isAdmin && (location.hash || '').startsWith('#maintenance')) {
      location.hash = '#shop';
      return;
    }

    // Update access if currently on maintenance
    const current = (location.hash || '#shop').split('?')[0].replace('#', '') || 'shop';
    setMaintenanceAccess(isAdmin && current === 'maintenance');
  });
});