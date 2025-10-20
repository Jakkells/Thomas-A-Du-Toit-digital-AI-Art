Payments setup (Ozow)

1) Database migration
- Open Supabase SQL editor (Production)
- Paste and run the contents of `sql/ozow_migration.sql`

2) Environment variables (in Vercel -> Project Settings -> Environment Variables)
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- OZOW_SITE_CODE
- OZOW_PRIVATE_KEY
- OZOW_IS_TEST=true
- OZOW_SUCCESS_URL=https://<your-domain>/#cart?paid=1
- OZOW_CANCEL_URL=https://<your-domain>/#cart?cancelled=1
- OZOW_ERROR_URL=https://<your-domain>/#cart?error=1
- OZOW_NOTIFY_URL=https://<your-domain>/api/ozow/notify
- SITE_URL=https://<your-domain>

3) Deploy
- Commit & deploy; test checkout flow (ensure you’re logged in)
- Verify `orders` row created, `order_items` rows created, redirect to Ozow URL works
- After payment, check that `/api/ozow/notify` receives callbacks and updates order `status` to `paid`

Notes
- The checkout button requires login; guests are prompted to log in
- The server recomputes the total from `cart_items`, not client values
- Hash is computed server-side using `OZOW_PRIVATE_KEY`

Manual EFT + Email delivery

- When a customer clicks "I paid" on the EFT page, an `orders` row is created (status `pending`) and items are snapshotted in `order_items`.
- In the admin Pending list, clicking "Mark Paid" triggers `/api/sendOrderEmail` to email the order contents to the buyer.
- Required env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_KEY`).
- Optional email provider via Resend: `RESEND_API_KEY`, `RESEND_FROM`.

Testing with a forced recipient override

- To direct all emails to a single test address without changing code, set one of:
	- `EMAIL_TO_OVERRIDE=jacoellis222@gmail.com` (preferred), or
	- `RESEND_TO_OVERRIDE=jacoellis222@gmail.com`
- With the override set, emails are sent to the override address regardless of `orders.user_email`.
- The subject will be prefixed with `[TEST OVERRIDE]` and the original recipient is included in the body for traceability.

SMTP/Gmail email sending (alternative to Resend)

- Install dependency (already in package.json): `nodemailer`
- Set environment variables (Vercel → Project Settings → Environment Variables):
	- Option A: Generic SMTP
		- `SMTP_HOST` (e.g., smtp.gmail.com)
		- `SMTP_PORT` (465 recommended)
		- `SMTP_SECURE` (true/false; true for 465)
		- `SMTP_USER`
		- `SMTP_PASS`
		- `SMTP_FROM` (e.g., "Thomas AI Art <no-reply@yourdomain>")
	- Option B: Gmail-specific shortcuts
		- `GMAIL_USER` (your Gmail address)
		- `GMAIL_APP_PASSWORD` (App Password—required; normal password will not work with 2FA)
		- Optional: `SMTP_FROM` (defaults to `RESEND_FROM` or a fallback)
- If both Resend and SMTP are configured, Resend is used first. If Resend is not configured, SMTP is used.
- The recipient override also applies to SMTP.

Local testing of API functions

- Use Vercel CLI to run functions locally so POST /api/sendOrderEmail works:
	1. Install: `npm i -g vercel`
	2. Login and link project: `vercel login`; `vercel link`
	3. Start dev: `vercel dev`
	4. Open the app at the printed localhost URL and test the flow. The API route will be available under the same origin.

Using a local .env file (safer than putting secrets in config.js)

- Create a `.env` file in the project root (use `.env.example` as a template). This file is git-ignored.
- Then run the dev server:
	- `vercel dev` will load `.env` automatically in your function (via dotenv).
	- Alternatively, export the same vars in your PowerShell session using `$env:VAR=...`.