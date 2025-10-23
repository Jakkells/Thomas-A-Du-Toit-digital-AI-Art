// Serverless function (Vercel) to send order delivery emails via Resend
// Expects: POST { orderId: number }
// Env vars required:
// - SUPABASE_URL: Your Supabase project URL
// - SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_ANON_KEY: to read orders/order_items

// Load .env locally for `vercel dev`
try { require('dotenv').config(); } catch {}
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

function badRequest(res, msg) {
  res.statusCode = 400;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: msg || 'bad-request' }));
}

function serverError(res, msg, code = 500, details) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  const payload = { ok: false, error: msg || 'server-error' };
  if (details) payload.details = details;
  res.end(JSON.stringify(payload));
}

function ok(res, data) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, ...data }));
}

// Build a simple HTML email body listing purchased items and links
function renderEmail({ order, items }) {
  const safe = (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const listHtml = (items || []).map((it) => {
    const urls = String(it.image_urls || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    const thumb = urls[0] || '';
    const links = urls
      .map((u, i) => `<a href="${safe(u)}" target="_blank" rel="noreferrer">Download ${i + 1}</a>`) 
      .join(' | ');
    const thumbImg = thumb ? `<div style="margin-top:6px"><img src="${safe(thumb)}" alt="${safe(it.product_name)}" style="max-width:180px;border-radius:6px;border:1px solid #eee"/></div>` : '';
    return `
      <li style="margin:14px 0; padding:12px; border:1px solid #eee; border-radius:8px; list-style:none;">
        <div style="font-weight:600">${safe(it.product_name || 'Artwork')}</div>
        <div style="margin-top:4px">${links}</div>
        ${thumbImg}
      </li>
    `;
  }).join('');

  const total = Number(order.total_price || 0).toFixed(2);
  const ref = safe(order.eft_reference || order.id);

  return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'; line-height:1.5; color:#222">
      <h2 style="margin:0 0 12px">Thank you for your purchase!</h2>
      <p style="margin:0 0 12px">Your payment has been confirmed. Here are your artworks and download links.</p>
      <p style="margin:0 0 12px">
        <strong>Reference:</strong> ${ref}<br/>
        <strong>Total Paid:</strong> R ${total}
      </p>
      <ul style="padding:0; margin:16px 0 8px">${listHtml}</ul>
      <p style="margin-top:18px; font-size:14px; color:#555">If any link doesn’t open, copy and paste it into your browser. If you need help, just reply to this email.</p>
    </div>
  `;
}

function renderTextEmail({ order, items }) {
  const urlsFor = (it) => String(it.image_urls || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const total = Number(order.total_price || 0).toFixed(2);
  const ref = String(order.eft_reference || order.id);
  const parts = [];
  parts.push('Thank you for your purchase!');
  parts.push('Your payment has been confirmed. Here are your artworks and download links.');
  parts.push('');
  parts.push(`Reference: ${ref}`);
  parts.push(`Total Paid: R ${total}`);
  parts.push('');
  (items || []).forEach((it, idx) => {
    const urls = urlsFor(it);
    parts.push(`${idx + 1}. ${it.product_name || 'Artwork'}`);
    urls.forEach((u, i) => parts.push(`   - Download ${i + 1}: ${u}`));
    parts.push('');
  });
  parts.push('If any link doesn’t open, copy and paste it into your browser.');
  return parts.join('\n');
}

async function fetchBufferWithTimeout(url, ms = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms).unref?.();
  try {
    const resp = await fetch(url, { signal: ctl.signal });
    if (!resp.ok) throw new Error('fetch-failed ' + resp.status);
    const arr = await resp.arrayBuffer();
    return Buffer.from(arr);
  } finally {
    clearTimeout(t);
  }
}

function filenameFromUrl(u, fallback) {
  try {
    const { pathname } = new URL(u);
    const base = pathname.split('/').filter(Boolean).pop();
    if (base) return base.split('?')[0];
  } catch {}
  return fallback || 'image.jpg';
}

module.exports = async (req, res) => {
  try {
    console.log('[sendOrderEmail] request start', { method: req.method, path: req.url });
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return serverError(res, 'method-not-allowed', 405);
    }

    // Parse body (Vercel provides already-parsed body for JSON requests, but handle string too)
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
  const orderId = Number(body?.orderId);
  const preview = !!body?.preview || !!body?.nosend;
    console.log('[sendOrderEmail] parsed body', { orderId, preview });
    if (!orderId || Number.isNaN(orderId)) return badRequest(res, 'missing-orderId');

    const SUPABASE_URL = process.env.SUPABASE_URL || '';
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      const missing = [];
      if (!SUPABASE_URL) missing.push('SUPABASE_URL');
      if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY or SUPABASE_KEY');
      console.error('[sendOrderEmail] env missing', missing);
      return serverError(res, 'supabase-env-missing: ' + missing.join(', '));
    }

    // Init clients
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    // Optional user client to satisfy RLS if we lack service role
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    const token = (authHeader || '').startsWith('Bearer ') ? authHeader.slice(7) : '';
    let userClient = null;
    if (token && process.env.SUPABASE_ANON_KEY) {
      userClient = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      });
    }

    // If no service role, verify admin via user token and use userClient for data reads
    let dataClient = sb;
    const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!hasServiceRole) {
      if (!userClient) return serverError(res, 'unauthorized-no-token', 401);
      try {
        const { data: ures, error: uerr } = await userClient.auth.getUser();
        if (uerr || !ures?.user?.id) return serverError(res, 'unauthorized-getuser-failed', 401, uerr?.message || uerr);
        const uid = ures.user.id;
        const { data: prof, error: perr } = await userClient
          .from('profiles')
          .select('role')
          .eq('id', uid)
          .maybeSingle();
        if (perr) return serverError(res, 'unauthorized-profile-read-failed', 401, perr?.message || perr);
        const role = String(prof?.role || '').toLowerCase();
        if (role !== 'admin') return serverError(res, 'forbidden-not-admin', 403);
        dataClient = userClient; // use RLS-authorized client for reads
        console.log('[sendOrderEmail] using user client under RLS');
      } catch (e) {
        return serverError(res, 'unauthorized-exception', 401, e?.message || e);
      }
    }

    // Load order
    const { data: order, error: orderErr } = await dataClient
      .from('orders')
      .select('id, user_email, user_id, eft_reference, total_price, status, created_at')
      .eq('id', orderId)
      .maybeSingle();
  if (orderErr) return serverError(res, 'order-load-failed', 500, orderErr?.message || orderErr);
    if (!order) return serverError(res, 'order-not-found', 404);

    if (!order.user_email) return serverError(res, 'recipient-missing', 422);

    // Load items
    const { data: items, error: itemsErr } = await dataClient
      .from('order_items')
      .select('product_id, product_name, image_urls')
      .eq('order_id', orderId);
  if (itemsErr) return serverError(res, 'order-items-load-failed', 500, itemsErr?.message || itemsErr);

    // Compose email content
  const subject = `Your Thomas AI Art order ${order.eft_reference || '#' + order.id}`;
  const emailItems = items || [];
  console.log('[sendOrderEmail] order loaded', { orderId: order.id, email: order.user_email, items: emailItems.length });
  const html = renderEmail({ order, items: emailItems });
  const text = renderTextEmail({ order, items: emailItems });

    // Optional server-side cart cleanup using service role (avoids client needing UPDATE/DELETE grants)
    if (hasServiceRole) {
      try {
        if (order.user_id) {
          const { data: carts } = await sb
            .from('carts')
            .select('id')
            .eq('user_id', order.user_id)
            .eq('status', 'active');
          const ids = (carts || []).map(c => c.id);
          if (ids.length) {
            await sb.from('cart_items').delete().in('cart_id', ids);
            await sb.from('carts').update({ status: 'checked_out' }).in('id', ids);
          }
        }
      } catch (cleanupErr) {
        console.warn('[sendOrderEmail] cleanup failed', cleanupErr?.message || cleanupErr);
      }
    } else {
      console.log('[sendOrderEmail] skipping cart cleanup (no service role key)');
    }

    // If preview requested, do not send; return content for client-side draft
    if (preview) {
      return ok(res, { id: order.id, to: order.user_email, subject, text });
    }

    // Send via SMTP (Nodemailer)
    try {
      // Build attachments from first N unique image URLs across items
      const ATTACH_LIMIT = Number(process.env.EMAIL_ATTACH_LIMIT || 8);
      const FETCH_TIMEOUT = Number(process.env.EMAIL_FETCH_TIMEOUT_MS || 10000);
      const allUrls = [];
      for (const it of emailItems) {
        const urls = String(it.image_urls || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
        for (const u of urls) allUrls.push(u);
      }
      const uniqUrls = [...new Set(allUrls)].slice(0, Math.max(0, ATTACH_LIMIT));
      const attachments = [];
      for (let i = 0; i < uniqUrls.length; i++) {
        const u = uniqUrls[i];
        try {
          const content = await fetchBufferWithTimeout(u, FETCH_TIMEOUT);
          const filename = filenameFromUrl(u, `artwork-${i + 1}.jpg`);
          attachments.push({ filename, content });
        } catch (e) {
          console.warn('[sendOrderEmail] attachment fetch failed', u, e?.message || e);
          // Skip failed download; links remain in body
        }
      }
      console.log('[sendOrderEmail] prepared attachments', { requested: uniqUrls.length, attached: attachments.length });

      const host = process.env.SMTP_HOST || 'smtp.gmail.com';
      const port = Number(process.env.SMTP_PORT || 465);
      const secure = String(process.env.SMTP_SECURE || 'true') === 'true';
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;
      if (!user || !pass) return serverError(res, 'smtp-env-missing');

      const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
      try { await transporter.verify(); console.log('[sendOrderEmail] SMTP verify: OK'); } catch (e) { console.error('[sendOrderEmail] SMTP verify failed', e?.message || e); }
      const fromName = process.env.EMAIL_FROM_NAME || 'Thomas AI Art';
      const from = `${fromName} <${user}>`;
      const info = await transporter.sendMail({
        from,
        to: order.user_email,
        subject,
        text,
        html,
        attachments,
      });
      console.log('[sendOrderEmail] sent', { messageId: info?.messageId, to: order.user_email });
      return ok(res, { id: order.id, messageId: info?.messageId || null, attached: attachments.length });
    } catch (e) {
      console.error('[sendOrderEmail] smtp-send-failed', e?.message || e);
      return serverError(res, 'smtp-send-failed', 500, e?.message || e);
    }
  } catch (e) {
    return serverError(res, 'unexpected-error');
  }
};
