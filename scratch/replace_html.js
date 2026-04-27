const fs = require('fs');
const path = './public/index.html';
let html = fs.readFileSync(path, 'utf8');

// 1. Sidebar
html = html.replace(/class="sidebar-section-header"/g, 'class="standard-collapsible-header"');
html = html.replace(/class="sidebar-nav-link"/g, 'class="standard-collapsible-title"');
html = html.replace(/class="sidebar-section-chevron"/g, 'class="standard-collapsible-toggle"');
html = html.replace(/class="toggle-icon"/g, 'class="standard-collapsible-arrow toggle-icon"');

// 2. YouTube Miner
html = html.replace(/class="youtube-miner-collapsible-toggle"([^>]*)>\s*<span>(.*?)<\/span>\s*<span class="youtube-miner-collapsible-arrow" aria-hidden="true">▾<\/span>\s*<\/button>/g,
  'class="standard-collapsible-header"$1>\n  <span class="standard-collapsible-title">$2</span>\n  <span class="standard-collapsible-toggle">\n    <span class="standard-collapsible-arrow" aria-hidden="true">▾</span>\n  </span>\n</button>');

// 3. Connection Ops
html = html.replace(/class="connection-ops-section-toggle"([^>]*)>\s*<span>(.*?)<\/span>\s*<span class="connection-ops-arrow">▾<\/span>\s*<\/button>/g,
  'class="standard-collapsible-header"$1>\n  <span class="standard-collapsible-title">$2</span>\n  <span class="standard-collapsible-toggle">\n    <span class="standard-collapsible-arrow" aria-hidden="true">▾</span>\n  </span>\n</button>');

// 4. Develop Template
html = html.replace(/class="develop-template-section-toggle"([^>]*)>\s*<span class="develop-template-section-arrow" aria-hidden="true">▾<\/span>\s*<span class="develop-template-section-title">(.*?)<\/span>\s*<\/button>/g,
  'class="standard-collapsible-header"$1>\n  <span class="standard-collapsible-title">$2</span>\n  <span class="standard-collapsible-toggle">\n    <span class="standard-collapsible-arrow" aria-hidden="true">▾</span>\n  </span>\n</button>');

// 4b. Develop Themes Builder Toggle Button
html = html.replace(/<button id="developThemesBuilderToggleBtn" type="button" class="tiny-btn" aria-expanded="false" aria-controls="developThemesBuilderPanel">▸<\/button>/g,
  '<button id="developThemesBuilderToggleBtn" type="button" class="standard-collapsible-toggle" aria-expanded="false" aria-controls="developThemesBuilderPanel" style="position:relative;">\n    <span class="standard-collapsible-arrow" aria-hidden="true">▾</span>\n  </button>');


fs.writeFileSync(path, html);
console.log("Done");
