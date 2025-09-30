// Generates a static "public" directory for Vercel with config.js and site assets
// Uses environment variables for Supabase.

const fs = require('fs');
const path = require('path');

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const KEY = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || '';

if (!URL || !KEY) {
  console.warn('[generate-config] Missing SUPABASE_URL or SUPABASE_KEY in environment.');
}

const outDir = path.join(process.cwd(), 'public');
fs.mkdirSync(outDir, { recursive: true });

// Write config.js into public/
const configJs = `// Generated at build-time. Do NOT commit secrets to the repo.\n` +
  `window.SUPABASE_URL = ${JSON.stringify(URL)};\n` +
  `window.SUPABASE_KEY = ${JSON.stringify(KEY)};\n`;
fs.writeFileSync(path.join(outDir, 'config.js'), configJs, 'utf8');
console.log('[generate-config] Wrote public/config.js');

// Helper to copy files/dirs
function copyFile(src, destDir) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(src));
  fs.copyFileSync(src, dest);
  console.log(`[generate-config] Copied ${src} -> ${dest}`);
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, entry);
    const d = path.join(destDir, entry);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
  console.log(`[generate-config] Copied dir ${srcDir} -> ${destDir}`);
}

// Copy static assets into public/
const root = process.cwd();
copyFile(path.join(root, 'index.html'), outDir);
copyFile(path.join(root, 'style.css'), outDir);
copyDir(path.join(root, 'js'), path.join(outDir, 'js'));
