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

const { buildLegalPages } = require('./build_legal');
buildLegalPages();
