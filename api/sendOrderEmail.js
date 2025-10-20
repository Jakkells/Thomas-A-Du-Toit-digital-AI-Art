/**
 * Vercel serverless function to email order contents to the buyer.
 * POST /api/sendOrderEmail { orderId: number }
 *
 * Required env (set in Vercel Project Settings > Environment Variables):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_KEY (anon, limited)
 * Optional email provider via Resend:
 * - RESEND_API_KEY
 * - RESEND_FROM (e.g., "Thomas AI Art <no-reply@yourdomain>")
 */
module.exports = async function handler(req, res) {
  try {
    // Basic CORS for cross-origin calls (e.g., local static UI -> Vercel API)
    const allowOrigin = process.env.CORS_ALLOW_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({ error: 'Server not configured (SUPABASE_URL/KEY missing)' });
    }

    const headers = {
      'apikey': SUPABASE_KEY,
      'authorization': `Bearer ${SUPABASE_KEY}`,
      'accept': 'application/json'
    };

    // Fetch order (includes user_email captured at confirm time)
    const oRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,eft_reference,total_price,user_id,user_email`, { headers });
    if (!oRes.ok) return res.status(oRes.status).json({ error: 'Failed to fetch order' });
    const orders = await oRes.json();
    const order = Array.isArray(orders) ? orders[0] : null;
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Fetch order items snapshot
    const iRes = await fetch(`${SUPABASE_URL}/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}&select=product_name,image_urls`, { headers });
    if (!iRes.ok) return res.status(iRes.status).json({ error: 'Failed to fetch items' });
    const items = await iRes.json();

  // Allow a test override to force all emails to a fixed address during testing
  const OVERRIDE_TO = (process.env.EMAIL_TO_OVERRIDE || process.env.RESEND_TO_OVERRIDE || '').trim();
  const to = String(OVERRIDE_TO || order.user_email || '').trim();
    if (!to) {
      // No email available on order; do not fail the entire admin action
      return res.status(200).json({ ok: true, emailed: false, reason: 'missing_user_email' });
    }

    // Build email content
    const lines = [];
    lines.push('Thanks for your purchase! Here are your images:');
    lines.push('');
    (items || []).forEach((it, idx) => {
      const imgs = String(it.image_urls || '').split(',').map(s => s.trim()).filter(Boolean);
      lines.push(`${idx + 1}. ${it.product_name}`);
      imgs.forEach(u => lines.push(`   - ${u}`));
    });
    lines.push('');
    if (order.eft_reference) lines.push(`Reference: ${order.eft_reference}`);
    const textBody = lines.join('\n');

    // Try Resend if configured
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.RESEND_FROM || 'no-reply@example.com';
    if (RESEND_API_KEY) {
      const htmlItems = (items || []).map((it) => {
        const imgs = String(it.image_urls || '').split(',').map(s => s.trim()).filter(Boolean);
        const imgLinks = imgs.map(u => `<li><a href="${u}">${u}</a></li>`).join('');
        return `<li><strong>${it.product_name}</strong><ul>${imgLinks}</ul></li>`;
      }).join('');
      const html = `
        <div>
          <p>Thanks for your purchase! Here are your images:</p>
          <ol>${htmlItems}</ol>
          ${order.eft_reference ? `<p>Reference: ${order.eft_reference}</p>` : ''}
        </div>`;

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [to],
          subject: `${OVERRIDE_TO ? '[TEST OVERRIDE] ' : ''}Your digital purchase from Thomas AI Art`,
          text: textBody + (OVERRIDE_TO ? `\n\n[Test override active; original: ${order.user_email || 'unknown'}]` : ''),
          html: html + (OVERRIDE_TO ? `<p style="color:#888;font-size:12px;">[Test override active; original: ${order.user_email || 'unknown'}]</p>` : '')
        })
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return res.status(502).json({ error: 'Email send failed', detail: txt });
      }
      return res.status(200).json({ ok: true, emailed: true, provider: 'resend' });
    }

    // SMTP fallback using Nodemailer (e.g., Gmail via App Password)
    try {
      const nodemailer = require('nodemailer');
      // Support generic SMTP or Gmail via app passwords
      const SMTP_HOST = process.env.SMTP_HOST || (process.env.GMAIL_USER ? 'smtp.gmail.com' : '');
      const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
      const SMTP_SECURE = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
      const SMTP_USER = process.env.SMTP_USER || process.env.GMAIL_USER || '';
      const SMTP_PASS = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '';
      const FROM = process.env.SMTP_FROM || RESEND_FROM;

      if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        // No SMTP configured either
        return res.status(200).json({ ok: true, emailed: false, reason: 'no_email_provider', overrideTo: OVERRIDE_TO || null });
      }

      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      });

      const info = await transporter.sendMail({
        from: FROM,
        to,
        subject: `${OVERRIDE_TO ? '[TEST OVERRIDE] ' : ''}Your digital purchase from Thomas AI Art`,
        text: textBody + (OVERRIDE_TO ? `\n\n[Test override active; original: ${order.user_email || 'unknown'}]` : ''),
        html: `
          <div>
            <p>Thanks for your purchase! Here are your images:</p>
            <pre style="white-space:pre-wrap;">${textBody.replace(/</g,'&lt;')}</pre>
            ${OVERRIDE_TO ? `<p style="color:#888;font-size:12px;">[Test override active; original: ${order.user_email || 'unknown'}]</p>` : ''}
          </div>`
      });
      return res.status(200).json({ ok: true, emailed: true, provider: 'smtp', messageId: info.messageId });
    } catch (smtpErr) {
      return res.status(502).json({ error: 'Email send failed (SMTP)', detail: smtpErr?.message || String(smtpErr) });
    }
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
};
