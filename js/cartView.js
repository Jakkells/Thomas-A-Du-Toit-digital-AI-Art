import { supabase } from './supabaseClient.js';
import { getActiveCartId, getCartSummaryCount, removeFromCart } from './cart.js';
import { showToast } from './utils/dom.js';

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

function firstImage(csv) {
  return (csv || '').split(',').map(s => s.trim()).filter(Boolean)[0] || 'https://via.placeholder.com/120?text=No+Image';
}

// Keep latest loaded items for optimistic UI updates and instant render
let currentItems = [];

// Tiny helper to prevent long hangs
function withTimeout(promise, ms, label = 'op') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + '-timeout')), ms))
  ]);
}

async function getUserIdFast() {
  // Try getSession quickly, then fall back to getUser
  try {
    const s = await withTimeout(supabase.auth.getSession(), 2500, 'getSession');
    const uid = s?.data?.session?.user?.id;
    if (uid) return uid;
  } catch {}
  try {
    const { data: { user } } = await withTimeout(supabase.auth.getUser(), 2500, 'getUser');
    return user?.id || null;
  } catch {}
  return null;
}

// Admin role cache for this module (updated via auth:changed event)
let _isAdmin = undefined;
window.addEventListener('auth:changed', (e) => {
  _isAdmin = !!e.detail?.isAdmin;
});

async function isCurrentUserAdmin() {
  if (_isAdmin !== undefined) return _isAdmin;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) { _isAdmin = false; return _isAdmin; }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
    _isAdmin = (profile?.role || '').toLowerCase() === 'admin';
  } catch {
    _isAdmin = false;
  }
  return _isAdmin;
}

function getProductsFromCache(ids) {
  const cache = window.__PRODUCTS_CACHE || {};
  const info = {};
  const missing = [];
  ids.forEach(id => {
    const p = cache[String(id)];
    if (p) info[id] = { name: p.name || 'Product', image_urls: p.image_urls || '' };
    else missing.push(id);
  });
  return { info, missing };
}

async function fetchMissingProducts(missingIds) {
  if (!missingIds?.length) return {};
  const { data } = await supabase
    .from('products')
    .select('id, name, image_urls')
    .in('id', missingIds);
  const m = {};
  (data || []).forEach(p => { m[p.id] = { name: p.name || 'Product', image_urls: p.image_urls || '' }; });
  // Warm global cache
  try {
    const cache = window.__PRODUCTS_CACHE || (window.__PRODUCTS_CACHE = {});
    (data || []).forEach(p => { cache[String(p.id)] = { ...(cache[String(p.id)] || {}), ...p }; });
  } catch {}
  return m;
}

function readCachedCart() {
  try {
    const raw = sessionStorage.getItem('cart:last');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeCachedCart(items) {
  try {
    sessionStorage.setItem('cart:last', JSON.stringify({ items, ts: Date.now() }));
  } catch {}
}

async function getCartItems() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const local = JSON.parse(localStorage.getItem('cart') || '[]');
    // Enrich guest items with image URLs from product cache when available
    const ids = local.map(i => i.id);
    const { info } = getProductsFromCache(ids);
    return local.map(it => ({
      product_id: it.id,
      name: it.name || info[it.id]?.name || 'Product',
      qty: it.qty,
      price: Number(it.price || 0),
      image_urls: info[it.id]?.image_urls || ''
    }));
  }
  const cartId = await getActiveCartId();
  const { data: items } = await supabase
    .from('cart_items')
    .select('product_id, qty, price_at_add')
    .eq('cart_id', cartId);

  if (!items?.length) return [];

  const ids = items.map(i => i.product_id);
  const { info, missing } = getProductsFromCache(ids);
  const fetched = await fetchMissingProducts(missing);
  const pm = { ...info, ...fetched };
  return items.map(i => ({
    product_id: i.product_id,
    name: pm[i.product_id]?.name || 'Product',
    qty: i.qty,
    price: Number(i.price_at_add || 0),
    image_urls: pm[i.product_id]?.image_urls || ''
  }));
}

function render(items) {
  console.log('[checkout] render cart items', { count: items.length });
  const list = document.getElementById('cartList');
  const totalEl = document.getElementById('cartTotal');
  const checkout = document.getElementById('checkoutBtn');
  if (!list || !totalEl) return;

  if (!items.length) {
    list.innerHTML = '<p>Your cart is empty.</p>';
    totalEl.textContent = ZAR.format(0);
    if (checkout) checkout.disabled = true;
    return;
  }

  let total = 0;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();

  items.forEach(it => {
    const li = document.createElement('div');
    li.className = 'cart-item';
    const thumb = firstImage(it.image_urls);
    const subtotal = Number(it.price || 0);
    total += subtotal;

    li.innerHTML = `
      <div class="cart-thumb"><img src="${thumb}" alt="Product"/></div>
      <div class="cart-center">
        <div class="cart-name">${it.name}</div>
        <div class="cart-qty">${ZAR.format(it.price)}</div>
        <div class="cart-subtotal">${ZAR.format(subtotal)}</div>
      </div>
      <a href="#" class="cart-remove-link" data-id="${it.product_id}" aria-label="Remove ${it.name}">Remove</a>
    `;
    frag.appendChild(li);
  });

  list.appendChild(frag);
  totalEl.textContent = ZAR.format(total);
  if (checkout) checkout.disabled = false;
}

async function refreshCartBadge() {
  const n = await getCartSummaryCount();
  const badge = document.getElementById('cartCount');
  if (badge) badge.textContent = String(n);
}

function setCartBadge(n) {
  const badge = document.getElementById('cartCount');
  if (badge) badge.textContent = String(n);
}

export async function loadCartPage() {
  console.log('[checkout] loadCartPage');
  // Instant render from cache (if present)
  const cached = readCachedCart();
  if (cached?.items) {
    console.log('[checkout] using cached cart items', { count: cached.items.length });
    currentItems = cached.items;
    render(currentItems);
  } else {
    // Show minimal empty state while fetching
    render([]);
  }
  // Background refresh from source of truth
  const fresh = await getCartItems();
  console.log('[checkout] fetched cart items', { count: fresh.length });
  currentItems = fresh;
  writeCachedCart(fresh);
  render(currentItems);
  refreshCartBadge();

  // Checkout handler -> Manual EFT flow
  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn && !checkoutBtn.dataset.bound) {
    checkoutBtn.dataset.bound = '1';
    checkoutBtn.addEventListener('click', async () => {
      console.log('[checkout] checkout click');
      await startCheckout(checkoutBtn);
    });
  }

  // Defensive rebind in case the DOM was re-rendered or some script prevented the initial bind
  const ensureCheckoutBound = () => {
    const btn = document.getElementById('checkoutBtn');
    if (!btn) return;
    if (!btn.dataset.bound) {
      console.log('[checkout] late-binding checkout button');
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => startCheckout(btn));
    }
  };
  document.addEventListener('visibilitychange', ensureCheckoutBound, { passive: true });
  window.addEventListener('hashchange', ensureCheckoutBound, { passive: true });
}

// Admin view: Pending payments
export async function loadPendingPayments() {
  const list = document.getElementById('pendingList');
  if (!list) return;
  list.innerHTML = '<div>Loading…</div>';
  const { data: s } = await supabase.auth.getSession();
  if (!s?.session) { list.innerHTML = '<div>Please log in.</div>'; return; }
  // Only fetch pending
  const { data, error } = await supabase
    .from('orders')
    .select('id, eft_reference, total_price, status, created_at, user_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) { list.innerHTML = '<div>Error loading pending.</div>'; return; }
  if (!data?.length) { list.innerHTML = '<div>No pending payments.</div>'; return; }
  const fmt = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
  list.innerHTML = '';
  data.forEach(o => {
    const row = document.createElement('div');
    row.className = 'pending-row';
    row.style.border = '1px solid #ddd';
    row.style.borderRadius = '8px';
    row.style.padding = '10px';
    row.innerHTML = `
      <div><strong>Ref:</strong> ${o.eft_reference || '—'}</div>
      <div><strong>Total:</strong> ${fmt.format(Number(o.total_price || 0))}</div>
      <div><strong>Date:</strong> ${new Date(o.created_at).toLocaleString()}</div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn" data-action="copy" data-ref="${o.eft_reference || ''}">Copy Ref</button>
        <button class="btn btn-solid" data-action="mark-paid" data-id="${o.id}" data-user="${o.user_id || ''}">Mark Paid</button>
        <button class="btn" data-action="mark-cancelled" data-id="${o.id}" data-user="${o.user_id || ''}">Mark Cancelled</button>
      </div>
    `;
    list.appendChild(row);
  });

  if (!list.dataset.bound) {
    list.dataset.bound = '1';
    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'copy') {
        const r = btn.dataset.ref || '';
        await navigator.clipboard?.writeText(r);
        alert('Reference copied');
      }
      if (action === 'mark-paid' || action === 'mark-cancelled') {
        console.log('[pending] action click', action, btn?.dataset);
        // Prevent double-clicks
        if (btn.dataset.busy === '1') return;
        btn.dataset.busy = '1';
        const oldText = btn.textContent;
        const isPaid = action === 'mark-paid';
        // Simple text change only, as requested
        btn.textContent = isPaid ? 'Checking…' : 'Updating…';
        btn.disabled = true;
        try { btn.setAttribute('aria-busy', 'true'); } catch {}

        // No Gmail draft prompt; sending handled by server via SMTP

        // Yield to allow the label to paint, then do the work
        setTimeout(async () => {
          try {
          const id = Number(btn.dataset.id);
          const userId = btn.dataset.user || null;
          const status = isPaid ? 'paid' : 'cancelled';
          const patch = { status };
          const { error } = await supabase
            .from('orders')
            .update(patch)
            .eq('id', id)
            .in('status', ['pending','failed']);
          if (error) {
            console.warn('[pending] order update failed', error);
            alert('Update failed');
            throw error;
          }

          // If marked paid, open a Gmail draft (server returns preview text and performs cleanup)
          if (isPaid) {
            try {
              const apiBase = (window.API_BASE_URL || '').replace(/\/+$/, '');
              const url = apiBase ? `${apiBase}/api/sendOrderEmail` : '/api/sendOrderEmail';
              let authHeader = {};
              try {
                const { data: sess } = await supabase.auth.getSession();
                const token = sess?.session?.access_token;
                if (token) authHeader = { Authorization: `Bearer ${token}` };
              } catch {}

              // Open a blank window synchronously to avoid popup blockers
              let gmailWin = null;
              try { gmailWin = window.open('about:blank'); } catch {}

              const resp = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...authHeader },
                body: JSON.stringify({ orderId: id, preview: true })
              });
              console.log('[pending] sendOrderEmail preview status', resp.status);
              if (resp.ok) {
                const j = await resp.json();
                console.log('[pending] sendOrderEmail preview ok', j);
                const to = j?.to || '';
                const su = j?.subject || 'Your order';
                const body = j?.text || '';
                const params = new URLSearchParams();
                if (to) params.set('to', to);
                params.set('su', su);
                params.set('body', body);
                params.set('view', 'cm');
                params.set('fs', '1');
                const gmailUrl = `https://mail.google.com/mail/?${params.toString()}`;
                try {
                  if (gmailWin && !gmailWin.closed) gmailWin.location.href = gmailUrl;
                  else window.location.href = gmailUrl;
                } catch {
                  try { window.location.href = gmailUrl; } catch {}
                }
                try { showToast('Draft opened in Gmail. If not, check your popup blocker.', { variant: 'info', duration: 4000 }); } catch {}
              } else {
                let errText = '';
                let j = null;
                try { j = await resp.json(); console.warn('sendOrderEmail preview failed:', j); errText = j?.error || JSON.stringify(j); }
                catch { try { errText = await resp.text(); } catch {} }
                if (gmailWin && !gmailWin.closed) try { gmailWin.close(); } catch {}
                if (resp.status === 404 && j?.error !== 'order-not-found') {
                  showToast('API /api/sendOrderEmail not found. Make sure the dev server is running (vercel dev).', { variant: 'error', duration: 4500 });
                } else {
                  showToast('Could not prepare Gmail draft: ' + (errText || resp.statusText), { variant: 'error', duration: 4500 });
                }
              }
            } catch (e) {
              console.warn('sendOrderEmail request error:', e?.message || e);
            }
          }
            // Notify success (for paid, we already show draft/open toasts; keep message minimal)
            try {
              if (isPaid) {
                showToast('Order marked as paid.', { variant: 'success', duration: 2000 });
              } else {
                showToast('Order cancelled.', { variant: 'info', duration: 2500 });
              }
            } catch {}
            // Refresh list (also restores buttons)
            loadPendingPayments();
          } catch (err) {
            // Restore UI on error
            try { btn.removeAttribute('aria-busy'); } catch {}
            btn.disabled = false;
            btn.textContent = oldText;
            delete btn.dataset.busy;
            try { showToast('Update failed. Please try again.', { variant: 'error', duration: 3000 }); } catch {}
          }
        }, 0);
      }
    });
  }
}

export function initCartView() {
  // Cart button -> #cart
  const btn = document.getElementById('cartBtn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => { location.hash = '#cart'; });
    // Prefetch on hover/touch to make cart open instantly
    const prefetch = async () => {
      const last = Number(btn.dataset.prefetchedAt || 0);
      const now = Date.now();
      if (now - last < 8000) return; // throttle
      btn.dataset.prefetchedAt = String(now);
      const items = await getCartItems();
      writeCachedCart(items);
    };
    btn.addEventListener('mouseenter', prefetch);
    btn.addEventListener('touchstart', prefetch, { passive: true });
  }

  // Remove handler (delegated)
  const list = document.getElementById('cartList');
  if (list && !list.dataset.bound) {
    list.dataset.bound = '1';
    list.addEventListener('click', async (e) => {
      const link = e.target.closest?.('.cart-remove-link');
      if (!link) return;
      e.preventDefault();

      const id = link.dataset.id;
      // Optimistic UI: remove locally and update totals/badge immediately
      const nextItems = currentItems.filter(it => String(it.product_id) !== String(id));
      currentItems = nextItems;
      render(currentItems);
  const optimisticCount = currentItems.length;
      setCartBadge(optimisticCount);

      try {
        await removeFromCart(id);
        // Success: event cart:changed will refresh the badge; items already removed visually
      } catch (err) {
        alert('Failed to remove: ' + (err?.message || err));
        // Restore state by fully reloading cart from source of truth
        await loadCartPage();
      }
    });
  }

  // Badge updates
  window.addEventListener('cart:changed', refreshCartBadge);
  window.addEventListener('storage', (e) => { if (e.key === 'cart') refreshCartBadge(); });

  refreshCartBadge();
}

// Populate EFT page if user lands directly (e.g., after refresh)
export function loadEftPageFromCache() {
  try {
    const raw = sessionStorage.getItem('eft:last');
    if (!raw) return;
    const data = JSON.parse(raw);
    console.log('[checkout] EFT page load', { ref: data.ref, amountValue: data.amountValue, itemCount: data.itemCount });
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('eftpRef', data.ref || '');
    setVal('eftpAmount', data.amount || '');
    const bd = data.bank || {};
    setVal('eftpAccName', bd.accountName || '');
    setVal('eftpBank', bd.bankName || '');
    setVal('eftpAccNo', bd.accountNumber || '');
    setVal('eftpBranch', bd.branchCode || '');
    setVal('eftpType', bd.type || '');
    // Copy button removed from UI; no binding needed

    // Edit toggle (allows editing only bank fields; reference/amount stay read-only)
    const editBtn = document.getElementById('eftpEdit');
    // Only admins may edit EFT fields
    if (editBtn) {
      isCurrentUserAdmin().then((isAdmin) => {
        if (!isAdmin) {
          // Hide the edit button for non-admins and keep fields read-only
          editBtn.style.display = 'none';
          return;
        }
        if (!editBtn.dataset.bound) {
          editBtn.dataset.bound = '1';
          editBtn.addEventListener('click', () => {
            const editable = document.querySelectorAll('#eft input[data-editable="1"]');
            const currentlyLocked = [...editable].every(el => el.readOnly);
            editable.forEach(el => { el.readOnly = !currentlyLocked; });
            editBtn.textContent = currentlyLocked ? 'Lock fields' : 'Edit fields';
          });
        }
      }).catch(() => {
        // On error determining admin, default to hiding the edit button
        editBtn.style.display = 'none';
      });
    }

    // Persist edits back into sessionStorage
    // Persist edits only for admins
    isCurrentUserAdmin().then((isAdmin) => {
      if (!isAdmin) return;
      const persist = () => {
        try {
          const next = {
            ref: document.getElementById('eftpRef')?.value || data.ref || '',
            amount: document.getElementById('eftpAmount')?.value || data.amount || '',
            bank: {
              accountName: document.getElementById('eftpAccName')?.value || '',
              bankName: document.getElementById('eftpBank')?.value || '',
              accountNumber: document.getElementById('eftpAccNo')?.value || '',
              branchCode: document.getElementById('eftpBranch')?.value || '',
              type: document.getElementById('eftpType')?.value || ''
            }
          };
          sessionStorage.setItem('eft:last', JSON.stringify(next));
        } catch {}
      };
      ['eftpAccName','eftpBank','eftpAccNo','eftpBranch','eftpType'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.persistBound) {
          el.dataset.persistBound = '1';
          el.addEventListener('input', persist);
          el.addEventListener('change', persist);
        }
      });
    }).catch(() => {/* ignore */});

    // "I paid" button -> customer marks order ready for admin review
    const paidBtn = document.getElementById('eftpPaid');
    if (paidBtn && !paidBtn.dataset.bound) {
      paidBtn.dataset.bound = '1';
      paidBtn.addEventListener('click', async () => {
        console.log('[checkout] confirm payment click');
        // Prevent double-submission
        if (paidBtn.dataset.submitting === '1') return;
        paidBtn.dataset.submitting = '1';

        // Immediately show loading state for instant feedback
        const old = paidBtn.textContent;
        paidBtn.disabled = true;
        try { paidBtn.setAttribute('aria-busy', 'true'); } catch {}
        paidBtn.textContent = 'Checking...';

  const DO_TIMEOUT_MS = 10000; // overall guard; individual steps also have timeouts

        const doConfirm = async () => {
          console.log('[checkout] doConfirm start', { ref: data.ref, orderId: data.orderId || null });
          // If we don't have an orderId yet, try to look it up by reference for this user
          if (!data.orderId && data.ref) {
            try {
              const uid = await getUserIdFast();
              if (!uid) { alert('Please log in to confirm your payment.'); throw new Error('not-logged-in'); }
              const { data: found } = await supabase
                .from('orders')
                .select('id, status')
                .eq('eft_reference', data.ref)
                .eq('user_id', uid)
                .order('created_at', { ascending: false })
                .limit(1);
              if (Array.isArray(found) && found[0]?.id) {
                data.orderId = found[0].id;
                try { sessionStorage.setItem('eft:last', JSON.stringify(data)); } catch {}
                console.log('[checkout] found existing order by ref', { orderId: data.orderId });
              }
            } catch {}
          }
          // If no order exists yet, create it now with status 'pending'
          if (!data.orderId) {
            try {
              const uid = await getUserIdFast();
              if (!uid) { alert('Please log in to confirm your payment.'); throw new Error('not-logged-in'); }
              const insertPayload = {
                status: 'pending',
                total_price: Number(data.amountValue ?? 0),
                quantity: Number(data.itemCount ?? 1),
                eft_reference: data.ref,
                user_id: uid,
                user_email: (await supabase.auth.getUser()).data?.user?.email || null
              };
              console.log('[checkout] creating order', insertPayload);
              const ins = await withTimeout(
                supabase.from('orders').insert([insertPayload]).select('id').single(),
                5000,
                'orders-insert'
              );
              if (ins.error) {
                // If duplicate reference, try fetch existing order by ref and proceed
                try {
                  const { data: found } = await supabase
                    .from('orders')
                    .select('id')
                    .eq('eft_reference', data.ref)
                    .eq('user_id', uid)
                    .order('created_at', { ascending: false })
                    .limit(1);
                  if (Array.isArray(found) && found[0]?.id) {
                    data.orderId = found[0].id;
                    console.log('[checkout] using duplicate-existing order', { orderId: data.orderId });
                  } else {
                    throw ins.error;
                  }
                } catch (e) {
                  throw ins.error;
                }
              } else {
                data.orderId = ins.data?.id;
                console.log('[checkout] created order', { orderId: data.orderId });
              }
              try { sessionStorage.setItem('eft:last', JSON.stringify(data)); } catch {}
            } catch (e) {
              alert('Could not create your order. Please try again.');
              throw e;
            }
          }
          // Ensure status is 'pending' (idempotent)
          try {
            console.log('[checkout] updating order to pending', { orderId: data.orderId });
            await withTimeout(
              supabase.from('orders').update({ status: 'pending' }).eq('id', data.orderId),
              4000,
              'orders-update'
            );
          } catch (e) {
            console.warn('[checkout] update pending timed out/failed, continuing', e?.message || e);
          }
          // Snapshot purchased items into order_items (so admin can email links)
          try {
            const snapshotRows = (currentItems || []).map(it => ({
              order_id: data.orderId,
              product_id: String(it.product_id || it.id),
              product_name: it.name || 'Product',
              image_urls: it.image_urls || ''
            }));
            if (snapshotRows.length) {
              await withTimeout(
                supabase.from('order_items').insert(snapshotRows),
                6000,
                'order-items-insert'
              );
              console.log('[checkout] order_items inserted', { count: snapshotRows.length });
            }
          } catch (e) {
            console.warn('[checkout] order_items snapshot failed (continuing):', e?.message || e);
          }
          // Clean up the user's current cart and close it
          try {
            const cartId = await getActiveCartId();
            if (cartId) {
              console.log('[checkout] clearing cart after confirm', { cartId });
              await withTimeout(supabase.from('cart_items').delete().eq('cart_id', cartId), 4000, 'cart-items-delete');
              await withTimeout(supabase.from('carts').update({ status: 'checked_out' }).eq('id', cartId), 4000, 'carts-update');
            }
          } catch (e) {
            console.warn('Cart cleanup after confirm payment failed:', e?.message || e);
          }
          // Clear local/session caches and UI
          try { sessionStorage.removeItem('cart:last'); } catch {}
          console.log('[checkout] cleared cart cache');
          try { currentItems = []; render(currentItems); } catch {}
          try {
            const badge = document.getElementById('cartCount');
            if (badge) badge.textContent = '0';
            window.dispatchEvent(new CustomEvent('cart:changed'));
          } catch {}
          // Hide the button, show a toast, and navigate back to shop
          paidBtn.style.display = 'none';
          try { showToast('Thanks! We\'ll review your payment shortly.', { variant: 'success', duration: 3500 }); } catch {}
          console.log('[checkout] navigate back to #shop');
          location.hash = '#shop';
        };

        try {
          // Race the confirmation flow against a timeout so the UI never hangs
          await Promise.race([
            doConfirm(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('confirm-timeout')), DO_TIMEOUT_MS))
          ]);
        } catch (e) {
          // Even if there was an error or timeout, proceed to shop so the user is not blocked
          console.warn('Confirm payment encountered an error:', e?.message || e);
          try { showToast('We\'re processing your confirmation. You can continue shopping.', { variant: 'info', duration: 3500 }); } catch {}
          location.hash = '#shop';
        } finally {
          try { paidBtn.removeAttribute('aria-busy'); } catch {}
          paidBtn.disabled = false;
          paidBtn.textContent = old;
          delete paidBtn.dataset.submitting;
        }
      });
    }

    const backBtn = document.getElementById('eftpBack');
    if (backBtn && !backBtn.dataset.bound) {
      backBtn.dataset.bound = '1';
      backBtn.addEventListener('click', () => { location.hash = '#shop'; });
    }
  } catch {}
}

// Shared checkout starter used by direct and fallback bindings
async function startCheckout(checkoutBtn) {
  console.log('[checkout] startCheckout invoked');
  // Prevent double click submissions
  if (checkoutBtn.dataset.submitting === '1') return;
  checkoutBtn.dataset.submitting = '1';
  const oldText = checkoutBtn.textContent;
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = 'Preparing EFT…';
  try {
    // Basic validation
    if (!Array.isArray(currentItems) || currentItems.length === 0) {
      alert('Your cart is empty.');
      return;
    }

    // Build total and unique reference (do this before any awaits)
    const total = currentItems.reduce((sum, it) => sum + Number(it.price || 0), 0);
    const totalQty = currentItems.length;
    const short = Math.random().toString(36).slice(2, 8).toUpperCase();
    const ref = `TAA-${short}`;
    console.log('[checkout] prepared EFT data', { ref, total, totalQty });

    // Populate EFT page fields immediately
    const fmt = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
    const bd = window.BANK_DETAILS || {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('eftpRef', ref);
    setVal('eftpAmount', fmt.format(total));
    setVal('eftpAccName', bd.accountName || '');
    setVal('eftpBank', bd.bankName || '');
    setVal('eftpAccNo', bd.accountNumber || '');
    setVal('eftpBranch', bd.branchCode || '');
    setVal('eftpType', bd.type || '');
    try {
      sessionStorage.setItem('eft:last', JSON.stringify({
        ref,
        amount: fmt.format(total),
        amountValue: Number(total.toFixed(2)),
        itemCount: totalQty,
        bank: bd
      }));
      console.log('[checkout] wrote eft:last to sessionStorage');
    } catch {}

    // Navigate right away so the user sees progress
    console.log('[checkout] navigating to #eft');
    location.hash = '#eft';

    // Optionally ensure they are logged in for the next step; if not, prompt without blocking navigation
    try {
      const { data: s } = await supabase.auth.getSession();
      if (!s?.session) {
        console.log('[checkout] no session; prompting login modal');
        setTimeout(() => { document.getElementById('loginBtn')?.click(); }, 200);
      }
    } catch {}
  } catch (err) {
    console.warn('[checkout] Checkout error', err);
    alert('Checkout error: ' + (err?.message || err));
  } finally {
    try {
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = oldText;
      delete checkoutBtn.dataset.submitting;
      console.log('[checkout] checkout button restored');
    } catch {}
  }
}