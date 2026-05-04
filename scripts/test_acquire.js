const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="acquirePage"><div class="page-heading-row"><h2>Acquire</h2></div><div id="acquireHubBody"></div></div></body></html>`);
const window = dom.window;
global.window = window;
global.document = window.document;
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

// Mock App and API
window.App = {
  els: {},
  api: async () => ({}),
  notify: console.log,
  state: { assets: [] }
};

// Load scripts
const legacyJs = fs.readFileSync('public/js/develop.js', 'utf8');
const acquireJs = fs.readFileSync('public/js/acquire.js', 'utf8');

try {
  eval(legacyJs);
  eval(acquireJs);
  
  // Call acquire init
  window.App.develop.init();
  window.App.acquire.init();

  console.log("Acquire Page HTML after init:");
  console.log(window.document.getElementById('acquirePage').innerHTML);
} catch (err) {
  console.error("Error evaluating scripts:", err);
}
