import { supabase } from './supabaseClient.js';
import { initAuth } from './auth.js';
import { setAdminNav } from './nav.js';
import { showUserUI } from './profile.js';
import { initMaintenance, setMaintenanceAccess } from './maintenance.js';
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
  showSection(section);
  if (section === 'product') loadProductDetailFromHash();
  if (section === 'cart') loadCartPage();
}

document.addEventListener('DOMContentLoaded', async () => {
  initAuth();
  initMaintenance();
  initProducts();
  initCartView();

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

    showUserUI(profile, user, supabase);
    isAdmin = (profile?.role || '').toLowerCase() === 'admin';
    setAdminNav(isAdmin);

    const current = (location.hash || '#shop').split('?')[0].replace('#', '') || 'shop';
    showSection(current);
  } else {
    isAdmin = false;
    setAdminNav(false);
    setMaintenanceAccess(false);
  }
});