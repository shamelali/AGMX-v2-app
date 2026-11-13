import { minify as minifyJS } from 'terser';
import fs from 'fs';
import path from 'path';

// Use createRequire for clean-css (CommonJS module)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const CleanCSS = require('clean-css');
const minifyCSS = (css) => new CleanCSS({}).minify(css).styles;

const FILES_TO_MINIFY = [
  'app-shell.css',
  'styles.css',
  'api.js',
  'app.js',
  'checkout.js',
  'data.js',
  'domain-packs.js',
  'leads.js',
  'login.js',
  'live-meeting.js',
  'runtime-diagnostics.js',
  'supabase-client.js',
  'theme.js',
  'copilot.js'
  // sw.js excluded: minifying the service worker could break cache version checks
  // assessment.js excluded: check.sh pass 22 uses regex that expects specific formatting
  // price-list.js excluded: check.sh pass 22 uses regex that expects specific formatting
  // governance-ui.js excluded: check.sh pass 20 uses regex that expects specific formatting
];

async function minifyJSFile(file) {
  const input = fs.readFileSync(file, 'utf8');
  const result = await minifyJS(input);
  const originalSize = Buffer.byteLength(input);
  const newSize = result.code.length;
  const savings = ((1 - newSize / originalSize) * 100).toFixed(1);
  fs.writeFileSync(file, result.code);
  console.log(`  ${file}: ${(originalSize/1024).toFixed(1)}KB → ${(newSize/1024).toFixed(1)}KB (-${savings}%)`);
  return { original: originalSize, minified: newSize };
}

function minifyCSSFile(file) {
  const input = fs.readFileSync(file, 'utf8');
  const result = minifyCSS(input);
  const originalSize = Buffer.byteLength(input);
  const newSize = result.length;
  const savings = ((1 - newSize / originalSize) * 100).toFixed(1);
  fs.writeFileSync(file, result);
  console.log(`  ${file}: ${(originalSize/1024).toFixed(1)}KB → ${(newSize/1024).toFixed(1)}KB (-${savings}%)`);
  return { original: originalSize, minified: newSize };
}

async function main() {
  let totalOrig = 0, totalMin = 0;

  for (const file of FILES_TO_MINIFY) {
    if (!fs.existsSync(file)) {
      console.log(`  ${file}: not found, skipping`);
      continue;
    }
    if (file.endsWith('.css')) {
      const r = minifyCSSFile(file);
      totalOrig += r.original;
      totalMin += r.minified;
    } else {
      const r = await minifyJSFile(file);
      totalOrig += r.original;
      totalMin += r.minified;
    }
  }

  console.log(`\nJS+CSS total: ${(totalOrig/1024).toFixed(1)}KB → ${(totalMin/1024).toFixed(1)}KB (-${((1-totalMin/totalOrig)*100).toFixed(1)}%)`);
}

main().catch(console.error);