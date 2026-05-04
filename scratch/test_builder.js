const fs = require('fs');
const cheerio = require("cheerio");

global.window = {};
global.document = { getElementById: () => null };
global.localStorage = { getItem: () => null, setItem: () => {} };

global.App = {
  state: {},
  els: {},
  api: async () => ({}),
  notify: console.log,
  parseJsonInput: (x) => JSON.parse(x),
  setPreview: () => {}
};

// mock escapeHtml, safeText
global.escapeHtml = (str) => str;
global.safeText = (str) => str || '';

// load develop.js
const developCode = fs.readFileSync('public/js/develop.js', 'utf8');
eval(developCode);

const payload = {
  layoutSections: [
    {
      layout: '3-3',
      title: 'Acquire Hub',
      collapsed: false,
      modules: [
        { type: 'pod', column: 'col1', settings: { title: 'Web Domain', description: 'Automated crawler fetching external site content.', logoUrl: '/images/logos/web.svg', targetPage: 'acquireWebPage' } },
        { type: 'pod', column: 'col2', settings: { title: 'YouTube', description: 'Video indexing and transcript mining tools.', logoUrl: '/images/logos/youtube.svg', targetPage: 'acquireYoutubePage' } },
      ]
    }
  ]
};

console.log(App.develop.buildModularPageTemplatePreviewMarkup(payload));
