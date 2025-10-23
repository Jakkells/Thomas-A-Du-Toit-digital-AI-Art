// Returns public configuration to the client
// Only exposes public, safe values required by the browser
// Load .env locally for `vercel dev`
try { require('dotenv').config(); } catch {}

module.exports = async (req, res) => {
  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
  // Frontend expects SUPABASE_KEY as the property name (value comes from ANON key)
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ SUPABASE_URL, SUPABASE_KEY: anonKey }));
};
