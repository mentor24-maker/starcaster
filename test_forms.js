const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');

const regex = /<form([^>]*class="[^"]*standard-form-grid[^"]*"[^>]*)>([\s\S]*?)<\/form>/g;
let match;
while ((match = regex.exec(html)) !== null) {
  const formAttrs = match[1];
  let formContent = match[2];
  
  // if it's got a grid-form or something complex
  const idMatch = formAttrs.match(/id="([^"]+)"/);
  const id = idMatch ? idMatch[1] : 'unnamed';

  let isBad = false;
  
  // Quick dirty check for divs that are direct children (by looking at first level divs)
  // Or just any grid-form, stack-form, page-heading-actions inside that doesn't have standard-form-grid-full
  let childRegex = /<div\s+([^>]+)>/g;
  let childMatch;
  while ((childMatch = childRegex.exec(formContent)) !== null) {
      let attrs = childMatch[1];
      if (attrs.includes('page-heading-actions') && !attrs.includes('standard-form-grid-full')) {
          isBad = true;
      }
      if (attrs.includes('grid-form') || attrs.includes('stack-form') || attrs.includes('messaging-create-content-row')) {
          if (!attrs.includes('standard-form-grid-full')) {
              isBad = true;
          }
      }
  }

  if (isBad) {
      console.log('BAD FORM:', id);
  }
}
