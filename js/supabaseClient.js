import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

async function ensureConfig() {
	if (window.SUPABASE_URL && window.SUPABASE_KEY) return;
	const res = await fetch('/api/config');
	if (!res.ok) throw new Error('Failed to load configuration');
	const { SUPABASE_URL, SUPABASE_KEY } = await res.json();
	if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Configuration missing SUPABASE_URL or SUPABASE_KEY');
	window.SUPABASE_URL = SUPABASE_URL;
	window.SUPABASE_KEY = SUPABASE_KEY;
}

await ensureConfig();
export const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_KEY);