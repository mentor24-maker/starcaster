const fs = require('fs');
const path = require('path');

const layoutPath = path.join(__dirname, '../src/layout.html');
const pagesDir = path.join(__dirname, '../src/pages');
const outputPath = path.join(__dirname, '../public/index.html');

console.log('Building index.html from partials...');

let layout = fs.readFileSync(layoutPath, 'utf8');

// Read all HTML files in src/pages
const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));

// Ensure a specific order if necessary, but since they are independent sibling sections,
// order generally doesn't matter for the UI, though it's nice to keep them organized.
files.sort();

let pagesContent = '';

for (const file of files) {
    const filePath = path.join(pagesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    pagesContent += `\n      <!-- INJECTED: ${file} -->\n${content}`;
}

const finalHtml = layout.replace('      <!-- INJECT_PAGES -->', pagesContent);

fs.writeFileSync(outputPath, finalHtml, 'utf8');
console.log(`Successfully built public/index.html from ${files.length} partials.`);
