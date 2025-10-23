// Minimal build script for Vercel to satisfy Project settings
// Copies static assets to ./public so Vercel can serve them when Output Directory is set

const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch {}

const root = process.cwd();
const outDir = path.join(root, 'public');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

function main() {
  ensureDir(outDir);
  const candidates = ['index.html', 'style.css'];
  for (const file of candidates) {
    const src = path.join(root, file);
    const dest = path.join(outDir, file);
    if (fs.existsSync(src)) copyFile(src, dest);
  }
  copyDir(path.join(root, 'js'), path.join(outDir, 'js'));
  // Generate a small client-side config for convenience to avoid 404 on <script src="config.js">
  const cfgDest = path.join(outDir, 'config.js');
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
  const bank = {
    accountName: 'Cindy Du Toit',
    bankName: 'Nedbank',
    accountNumber: '2911205359',
    branchCode: '198765',
    type: 'Savings',
  };
  const cfg = `// Generated at build-time\n` +
              `window.SUPABASE_URL = ${JSON.stringify(supabaseUrl)};\n` +
              `window.SUPABASE_KEY = ${JSON.stringify(anonKey)};\n` +
              `window.BANK_DETAILS = ${JSON.stringify(bank)};\n`;
  fs.writeFileSync(cfgDest, cfg, 'utf8');
  // Note: serverless functions remain under /api at project root; Vercel will handle them separately.
  console.log('[build] Static assets prepared in ./public');
}

main();
