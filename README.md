# My Store

A modern e-commerce website built with HTML, CSS, and JavaScript.

## Features
- Responsive design
- Modern UI/UX
- Fast loading
- Mobile-friendly

## Coming Soon
- Product catalog
- Shopping cart
- User authentication
- Order management

## Tech Stack
- Frontend: HTML, CSS, JavaScript
- Backend: Supabase
- Emails: Resend
- Deployment: Vercel

## Email delivery on payment confirmation
When an admin marks an order as Paid in the Pending Payments view, the app triggers a serverless API that emails the buyer their artworks with download links.

### How it works
- Frontend (`js/cartView.js`) calls `POST /api/sendOrderEmail` with `{ orderId }` after updating the order status to `paid`.
- The serverless function (`api/sendOrderEmail.js`) fetches the order and its `order_items` from Supabase and sends a thank-you email with download links using Resend.

### Required environment variables
Set these in Vercel Project Settings → Environment Variables (or a local `.env` used by `vercel dev`):

- `SUPABASE_URL` – Your Supabase project URL
- `SUPABASE_ANON_KEY` – Public anon key (used by the browser and serverless function)
- `SUPABASE_SERVICE_ROLE_KEY` – Optional but recommended for the API (allows reading across RLS if needed)
- `RESEND_API_KEY` – Your Resend API key
- `EMAIL_FROM` – Sender, e.g. `Thomas AI Art <no-reply@yourdomain.com>`

### Local development
Use Vercel CLI to run serverless functions locally:

1. Install dependencies:
	- `npm install`
2. Start local dev (requires `vercel`):
	- `vercel dev`

The frontend fetches Supabase config from `/api/config`, which returns `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

### Windows setup troubleshooting
If `npm` or `node` is not recognized in PowerShell:

1. Install Node.js LTS for Windows:
	- Option A (simple): Download the LTS installer from https://nodejs.org and ensure “Add to PATH” is checked.
	- Option B (recommended): Install nvm-windows (Node Version Manager) from https://github.com/coreybutler/nvm-windows/releases, then:
	  - `nvm install lts`
	  - `nvm use lts`

2. Close all terminals and reopen VS Code (or open a new PowerShell). Then verify:
	- `node -v`
	- `npm -v`

3. Install Vercel CLI globally:
	- `npm i -g vercel`

4. Create a local `.env` by copying `.env.example` and filling in values. Then run:
	- `vercel dev`

You can test the config endpoint locally at http://localhost:3000/api/config.
