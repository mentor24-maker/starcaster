const fs = require('fs');
const path = require('path');
const { pinHtmlAssetVersions } = require('./pin_asset_versions.cjs');

const layoutPath = path.join(__dirname, '../src/layout.html');
const pagesDir = path.join(__dirname, '../src/pages');
const publicDir = path.join(__dirname, '../public');
const outputPath = path.join(__dirname, '../public/app-shell.html');

console.log('Building app-shell.html from partials...');

function processIncludes(content, baseDir) {
  const includeRegex = /<include\s+src=["']([^"']+)["']\s*\/?>(?:<\/include>)?/gi;
  return content.replace(includeRegex, (match, src) => {
    const filePath = path.join(baseDir, src);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ Warning: Included file not found: ${filePath}`);
      return `<!-- Missing include: ${src} -->`;
    }
    const includedContent = fs.readFileSync(filePath, 'utf8');
    return `<!-- START INCLUDED: ${src} -->\n${processIncludes(includedContent, path.dirname(filePath))}\n<!-- END INCLUDED: ${src} -->`;
  });
}

// Content-hash cache busting for local JS/CSS (see scripts/pin_asset_versions.cjs).
function injectContentHashes(html) {
  return pinHtmlAssetVersions(html, publicDir);
}

let layout = fs.readFileSync(layoutPath, 'utf8');

const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
files.sort();

let pagesContent = '';
for (const file of files) {
  const filePath = path.join(pagesDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  pagesContent += `\n      <!-- INJECTED PAGE: ${file} -->\n${processIncludes(content, pagesDir)}`;
}

const assembled = layout.replace('      <!-- INJECT_PAGES -->', pagesContent);
const finalHtml = injectContentHashes(assembled);

fs.writeFileSync(outputPath, finalHtml, 'utf8');
console.log(`Successfully built public/app-shell.html from ${files.length} top-level partials with recursive includes.`);

// Static standalone pages (2026-08-24, task 86bbkh288). These four used to be
// COMMITTED in public/ with ?v= pins written into them in place — which meant
// a computed hash lived in files git merges. That one arrangement produced the
// months of ?v= trouble: branches conflicting on files neither edited, catch-up
// merges restoring stale hashes CI then rejected, and GitHub reporting phantom
// conflicts because it cannot run a local merge driver. Now they follow the
// same shape as app-shell.html: bare references in committed source, hashes
// applied to the generated, gitignored output. Vercel bundles them into the
// functions via includeFiles ("public/*.html"), exactly as it already does for
// app-shell.html.
const staticPagesDir = path.join(__dirname, '../src/static-pages');
const staticPages = fs.readdirSync(staticPagesDir).filter((f) => f.endsWith('.html')).sort();
for (const page of staticPages) {
  const html = fs.readFileSync(path.join(staticPagesDir, page), 'utf8');
  fs.writeFileSync(path.join(publicDir, page), injectContentHashes(html), 'utf8');
}
console.log(`Built ${staticPages.length} static page(s) from src/static-pages: ${staticPages.join(', ')}`);

const { buildLegalPages } = require('./build_legal');
buildLegalPages();
