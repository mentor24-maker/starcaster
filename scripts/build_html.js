const fs = require('fs');
const path = require('path');

const layoutPath = path.join(__dirname, '../src/layout.html');
const pagesDir = path.join(__dirname, '../src/pages');
const outputPath = path.join(__dirname, '../public/index.html');

console.log('Building index.html from partials...');

function processIncludes(content, baseDir) {
  const includeRegex = /<include\s+src=["']([^"']+)["']\s*\/?>(?:<\/include>)?/gi;
  return content.replace(includeRegex, (match, src) => {
    const filePath = path.join(baseDir, src);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ Warning: Included file not found: ${filePath}`);
      return `<!-- Missing include: ${src} -->`;
    }
    const includedContent = fs.readFileSync(filePath, 'utf8');
    // Recursively process includes in the included file
    return `<!-- START INCLUDED: ${src} -->\n${processIncludes(includedContent, path.dirname(filePath))}\n<!-- END INCLUDED: ${src} -->`;
  });
}

let layout = fs.readFileSync(layoutPath, 'utf8');

// Read all top-level HTML files in src/pages
const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
files.sort();

let pagesContent = '';

for (const file of files) {
  const filePath = path.join(pagesDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  pagesContent += `\n      <!-- INJECTED PAGE: ${file} -->\n${processIncludes(content, pagesDir)}`;
}

const finalHtml = layout.replace('      <!-- INJECT_PAGES -->', pagesContent);

fs.writeFileSync(outputPath, finalHtml, 'utf8');
console.log(`Successfully built public/index.html from ${files.length} top-level partials with recursive includes.`);

const { buildLegalPages } = require('./build_legal');
buildLegalPages();
