import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { showGlobalMsg } from './utils/dom.js';

async function ensureConfig() {
	if (window.SUPABASE_URL && window.SUPABASE_KEY) return;
		// Try friendly path first (works with vercel.json rewrite), then fallback
		let res = await fetch('/config', { cache: 'no-store' }).catch((e) => ({ ok: false, status: 0, error: e }));
		if (!res.ok) {
			res = await fetch('/api/config', { cache: 'no-store' }).catch((e) => ({ ok: false, status: 0, error: e }));
		}
		if (!res.ok) {
		// Helpful guidance for local static servers (Live Server etc.)
		const isLocal = location.hostname === '127.0.0.1' || location.hostname === 'localhost' || location.protocol === 'file:';
		if (res.status === 404 && isLocal) {
			throw new Error('Local dev: /api/config not found. Create a local config.js with window.SUPABASE_URL and window.SUPABASE_KEY at the project root, or run "vercel dev" so /api/config works.');
		}
		throw new Error('Failed to load configuration (status ' + (res.status || 'network error') + ')');
	}
	const { SUPABASE_URL, SUPABASE_KEY } = await res.json();
	if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Configuration missing SUPABASE_URL or SUPABASE_KEY');
	window.SUPABASE_URL = SUPABASE_URL;
	window.SUPABASE_KEY = SUPABASE_KEY;
}

try {
	await ensureConfig();
} catch (err) {
	console.error('Failed to load app configuration from /api/config:', err);
	showGlobalMsg((err && err.message) ? err.message : 'App configuration failed to load. Please try again later.');
	throw err;
}
export const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_KEY, {
	auth: {
		// Persist sessions so password recovery session is available to updateUser.
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
	},
});