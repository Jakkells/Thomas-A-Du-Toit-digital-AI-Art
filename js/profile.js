import { showGlobalMsg } from './utils/dom.js';

export function displayNameFrom(profile, user) {
  const first = profile?.name || user?.user_metadata?.first_name || '';
  if (first) return String(first).trim();
  const local = (user?.email || '').split('@')[0] || 'User';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export function showUserUI(profile, user, supabase) {
  const container = document.querySelector('.auth-buttons');
  if (!container) return;
  container.innerHTML = `
    <span class="user-name">${displayNameFrom(profile, user)}</span>
    <button class="btn btn-outline" id="logoutBtn">Logout</button>
  `;
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });
}

export async function ensureProfile(supabase, user) {
  const { data: rows } = await supabase
    .from('profiles')
    .select('id, name, middle_name, last_name, phone_number, address, role')
    .eq('id', user.id);

  let profile = Array.isArray(rows) ? rows[0] : null;

  if (profile) return profile;

  const meta = user.user_metadata || {};
  const draft = JSON.parse(localStorage.getItem('signupDraft') || 'null') || {};
  const payload = {
    id: user.id,
    name: meta.first_name || draft.first_name || '',
    middle_name: meta.middle_name || draft.middle_name || '',
    last_name: meta.last_name || draft.last_name || '',
    phone_number: meta.phone_number || draft.phone_number || '',
    address: meta.address || draft.address || '',
    role: 'Customer' // default role on first profile creation
  };

  const { error: insertErr } = await supabase.from('profiles').insert([payload]);
  if (insertErr) {
    if ((insertErr.message || '').toLowerCase().includes('duplicate key')) {
      const { error: updErr } = await supabase
        .from('profiles')
        .update({
          name: payload.name,
          middle_name: payload.middle_name,
          last_name: payload.last_name,
          phone_number: payload.phone_number,
          address: payload.address
        })
        .eq('id', user.id);
      if (!updErr) profile = { ...payload };
    }
  } else {
    profile = payload;
  }

  localStorage.removeItem('signupDraft');
  return profile;
}