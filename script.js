document.addEventListener('DOMContentLoaded', () => {
    import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm').then(async ({ createClient }) => {
        const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_KEY);

        // Helper: wait until an element exists, then run cb(el)
        const onReady = (selector, cb) => {
            const el = document.querySelector(selector);
            if (el) return cb(el);
            const mo = new MutationObserver(() => {
                const el2 = document.querySelector(selector);
                if (el2) { cb(el2); mo.disconnect(); }
            });
            mo.observe(document.body, { childList: true, subtree: true });
        };

        const authButtons = document.querySelector('.auth-buttons');
        function displayNameFrom(profile, user) {
            // First name only
            const first =
                profile?.name ||
                user?.user_metadata?.first_name ||
                '';
            if (first) return String(first).trim();

            // Fallback to email local-part capitalized
            const local = (user?.email || '').split('@')[0] || 'User';
            return local.charAt(0).toUpperCase() + local.slice(1);
        }
        function showUserUI(profile, user) {
            if (!authButtons) return;
            authButtons.innerHTML = `
                <span class="user-name">${displayNameFrom(profile, user)}</span>
                <button class="btn btn-outline" id="logoutBtn">Logout</button>
            `;
            document.getElementById('logoutBtn')?.addEventListener('click', async () => {
                await supabase.auth.signOut();
                location.reload();
            });
        }
        function showGlobalMsg(text) {
            const el = document.getElementById('globalMsg');
            if (el) { el.textContent = text; el.style.display = 'block'; }
        }
        const saveSignupDraft = (d) => localStorage.setItem('signupDraft', JSON.stringify(d));
        const consumeSignupDraft = () => {
            const raw = localStorage.getItem('signupDraft');
            if (!raw) return null;
            localStorage.removeItem('signupDraft');
            try { return JSON.parse(raw); } catch { return null; }
        };

        // Init phone input when field appears
        let iti = null;
        onReady('#signupPhoneNumber', (phoneEl) => {
            if (window.intlTelInput) {
                iti = window.intlTelInput(phoneEl, {
                    initialCountry: 'za',
                    separateDialCode: true,
                });
            }
        });

        const signupModal = document.getElementById('signupModal');
        const loginModal = document.getElementById('loginModal');

        // ===== Modal open/close/switch bindings =====
        const showModal = (m) => { if (m) m.style.display = 'block'; };
        const hideModal = (m) => { if (m) m.style.display = 'none'; };

        onReady('#signupBtn', (btn) => btn.addEventListener('click', () => showModal(signupModal)));
        onReady('#loginBtn',  (btn) => btn.addEventListener('click', () => showModal(loginModal)));

        onReady('#closeSignup', (btn) => btn.addEventListener('click', () => hideModal(signupModal)));
        onReady('#closeLogin',  (btn) => btn.addEventListener('click', () => hideModal(loginModal)));

        onReady('#switchToSignup', (a) => a.addEventListener('click', (e) => {
            e.preventDefault(); hideModal(loginModal); showModal(signupModal);
        }));
        onReady('#switchToLogin', (a) => a.addEventListener('click', (e) => {
            e.preventDefault(); hideModal(signupModal); showModal(loginModal);
        }));

        // Close when clicking outside content
        window.addEventListener('click', (e) => {
            if (e.target === signupModal) hideModal(signupModal);
            if (e.target === loginModal) hideModal(loginModal);
        });

        // ===== Show/Hide password buttons =====
        function setupShowPassword(inputId, btnId) {
            const input = document.getElementById(inputId);
            const btn = document.getElementById(btnId);
            if (!input || !btn) return;
            btn.addEventListener('click', () => {
                const isPwd = input.type === 'password';
                input.type = isPwd ? 'text' : 'password';
                btn.textContent = isPwd ? 'Hide' : 'Show';
            });
        }
        onReady('#showLoginPassword',  () => setupShowPassword('loginPassword', 'showLoginPassword'));
        onReady('#showSignupPassword', () => setupShowPassword('signupPassword', 'showSignupPassword'));

        // ===== SIGNUP submit =====
        const bindSignup = (form) => {
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
                const phone_number = (window.intlTelInput && iti) ? iti.getNumber()
                                   : (document.getElementById('signupPhoneNumber')?.value || '');

                if (window.intlTelInput && iti && !iti.isValidNumber()) {
                    showGlobalMsg('Please enter a valid phone number.');
                    return;
                }

                try {
                    const { data, error } = await supabase.auth.signUp({
                        email, password,
                        options: { data: { first_name, middle_name, last_name, phone_number, address } }
                    });
                    if (error) {
                        if ((error.message || '').toLowerCase().includes('already registered')) {
                            hideModal(signupModal); showModal(loginModal);
                            let msg = document.getElementById('loginExistsMsg');
                            if (!msg) {
                                msg = document.createElement('div');
                                msg.id = 'loginExistsMsg';
                                msg.style.color = 'red';
                                msg.style.marginBottom = '10px';
                                msg.textContent = 'This email is already registered. Please log in.';
                                document.getElementById('loginForm')?.prepend(msg);
                            } else { msg.style.display = 'block'; }
                            return;
                        }
                        showGlobalMsg('Sign up failed: ' + error.message);
                        return;
                    }

                    // Save draft for post-confirmation
                    localStorage.setItem('signupDraft', JSON.stringify({ first_name, middle_name, last_name, phone_number, address }));

                    hideModal(signupModal);
                    showGlobalMsg('Sign up successful! Please confirm your email address in your mailbox before logging in.');
                } catch (err) {
                    console.error('Sign up exception:', err);
                    showGlobalMsg('Sign up failed. See console for details.');
                }
            });
        };
        onReady('#signupForm', bindSignup);

        // ===== LOGIN submit =====
        const bindLogin = (form) => {
            if (form.dataset.bound === '1') return;
            form.dataset.bound = '1';
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('loginEmail')?.value?.trim() || '';
                const password = document.getElementById('loginPassword')?.value || '';

                try {
                    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                    if (error) {
                        if ((error.message || '').toLowerCase().includes('email not confirmed')) {
                            let msg = document.getElementById('loginConfirmMsg');
                            if (!msg) {
                                msg = document.createElement('div');
                                msg.id = 'loginConfirmMsg';
                                msg.style.color = 'red';
                                msg.style.marginTop = '6px';
                                msg.style.fontSize = '0.95em';
                                msg.textContent = 'You need to confirm your email address in your mailbox.';
                                const emailInput = document.getElementById('loginEmail');
                                emailInput?.parentNode?.insertBefore(msg, emailInput.nextSibling);
                            } else { msg.style.display = 'block'; }
                            return;
                        }
                        showGlobalMsg('Login failed: ' + error.message);
                        return;
                    }

                    const user = data.user;

                    // Ensure profile exists; create from metadata/draft if missing
                    let { data: rows } = await supabase
                        .from('profiles')
                        .select('id, name, middle_name, last_name, phone_number, address')
                        .eq('id', user.id);
                    let profile = Array.isArray(rows) ? rows[0] : null;

                    if (!profile) {
                        const meta = user.user_metadata || {};
                        const draft = JSON.parse(localStorage.getItem('signupDraft') || 'null') || {};
                        const payload = {
                            id: user.id,
                            name: meta.first_name || draft.first_name || '',
                            middle_name: meta.middle_name || draft.middle_name || '',
                            last_name: meta.last_name || draft.last_name || '',
                            phone_number: meta.phone_number || draft.phone_number || '',
                            address: meta.address || draft.address || ''
                        };

                        // Try INSERT first (needs INSERT policy). If a race creates it, handle duplicate by updating.
                        const { error: insertErr } = await supabase.from('profiles').insert([payload]);
                        if (insertErr) {
                            if ((insertErr.message || '').toLowerCase().includes('duplicate key')) {
                                // Someone already created it — update fields
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
                                if (updErr) {
                                    console.warn('Profile update failed:', updErr);
                                    showGlobalMsg('Could not update your profile. Check profiles UPDATE policy.');
                                } else {
                                    profile = payload;
                                }
                            } else {
                                console.warn('Profile insert failed:', insertErr);
                                showGlobalMsg('Could not save your profile. Check profiles INSERT/SELECT policies.');
                            }
                        } else {
                            profile = payload;
                        }
                        localStorage.removeItem('signupDraft');
                    }

                    hideModal(loginModal);
                    showUserUI(profile, user);
                } catch (err) {
                    console.error('Login exception:', err);
                    showGlobalMsg('Login failed. See console for details.');
                }
            });
        };
        onReady('#loginForm', bindLogin);

        // Restore UI if already logged in
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData?.session?.user) {
                const user = sessionData.session.user;
                const { data: rows } = await supabase
                    .from('profiles')
                    .select('id, name, middle_name, last_name, phone_number, address')
                    .eq('id', user.id);
                const profile = Array.isArray(rows) ? rows[0] : null;
                showUserUI(profile, user);
            }
        } catch (e) {
            console.warn('Session check failed:', e);
        }
    });
});