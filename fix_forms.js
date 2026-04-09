const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. For forms containing complex internal grids, remove `class="standard-form-grid"`
const formRegex = /<form([^>]*)>([\s\S]*?)<\/form>/g;
let match;
let finalHtml = html;

while ((match = formRegex.exec(html)) !== null) {
  const formTagStart = match[0].indexOf('>') + 1;
  const formAttrs = match[1];
  const formContent = match[2];
  
  if (formAttrs.includes('standard-form-grid')) {
    const hasComplexInternalLayout = 
      formContent.includes('class="grid-form"') || 
      formContent.includes('class="stack-form"') || 
      formContent.includes('class="messaging-create-content-layout"') ||
      formContent.includes('class="youtube-research-left-column"');

    // If it has internal layouts, it was mistakenly blanket-styled. We remove standard-form-grid.
    if (hasComplexInternalLayout) {
      const newFormAttrs = formAttrs.replace(/\bstandard-form-grid\b/, '').replace(/class="\s*"/, '').trim();
      const updatedFormTag = `<form${newFormAttrs ? ' ' + newFormAttrs : ''}>`;
      finalHtml = finalHtml.replace(`<form${formAttrs}>`, updatedFormTag);
    }
  }
}

// 2. For page-heading-actions INSIDE standard-form-grid forms, add standard-form-grid-full
// We can just find all page-heading-actions that are direct children, but regex is tricky.
// Better: just globally replace `class="page-heading-actions"` with `class="page-heading-actions standard-form-grid-full"`
// inside forms that HAVE standard-form-grid!
html = finalHtml;
const activeFormRegex = /<form([^>]*class="[^"]*standard-form-grid[^"]*"[^>]*)>([\s\S]*?)<\/form>/g;
while ((match = activeFormRegex.exec(html)) !== null) {
  const oldFormStr = match[0];
  let newContent = match[2];
  
  // Replace page-heading-actions with standard-form-grid-full appended
  newContent = newContent.replace(/class="page-heading-actions([^"]*)"/g, (m, rest) => {
    if (!rest.includes('standard-form-grid-full')) {
      return `class="page-heading-actions standard-form-grid-full${rest}"`;
    }
    return m;
  });

  const newFormStr = `<form${match[1]}>${newContent}</form>`;
  finalHtml = finalHtml.replace(oldFormStr, newFormStr);
}

fs.writeFileSync('public/index.html', finalHtml);
console.log('Fixed forms.');
