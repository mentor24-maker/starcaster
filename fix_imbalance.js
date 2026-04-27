const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Fix studio-collapsible-wrapper
const target = `<div class="studio-collapsible-wrapper" id="curationStudioWrapper">`;
const idx = html.indexOf(target);
if (idx > -1) {
    // find the end of developTemplatesPage
    const endIdx = html.indexOf('</section>', idx);
    html = html.substring(0, endIdx) + '</div>\n      ' + html.substring(endIdx);
}

// 2. Fix appShell
const target2 = `    <!-- SDKs -->`;
html = html.replace(target2, '    </div>\n    <!-- SDKs -->');

fs.writeFileSync('public/index.html', html);
console.log("Fixed imbalance");
