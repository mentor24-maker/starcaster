const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// Replace every ?v=... on <script src> and <link href> tags pointing to local
// JS/CSS files with a short content hash of that file. Files that don't exist
// on disk (CDN URLs, etc.) are left unchanged.
function injectContentHashes(html) {
  return html.replace(
    /((?:src|href)=")(\/[^"]+\.(?:js|css))(?:\?v=[^"]*)?(")/g,
    (match, attrOpen, urlPath, attrClose) => {
      const localFile = path.join(publicDir, urlPath);
      if (!fs.existsSync(localFile)) return match;
      const hash = crypto
        .createHash('md5')
        .update(fs.readFileSync(localFile))
        .digest('hex')
        .slice(0, 8);
      return `${attrOpen}${urlPath}?v=${hash}${attrClose}`;
    }
  );
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
