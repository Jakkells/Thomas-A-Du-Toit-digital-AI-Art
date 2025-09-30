// Generates a config.js at the project root using environment variables
// Used by Vercel build (and optionally `vercel dev`).

const fs = require('fs');
const path = require('path');

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const KEY = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || '';

if (!URL || !KEY) {
  console.warn('[generate-config] Missing SUPABASE_URL or SUPABASE_KEY in environment.');
}

const out = `// Generated at build-time. Do NOT commit secrets to the repo.
window.SUPABASE_URL = ${JSON.stringify(URL)};
window.SUPABASE_KEY = ${JSON.stringify(KEY)};
`;

const target = path.join(process.cwd(), 'config.js');
fs.writeFileSync(target, out, 'utf8');
console.log('[generate-config] Wrote config.js');
