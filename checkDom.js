const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('public/index.html', 'utf-8');
const dom = new JSDOM(html, {
  url: "http://localhost:3000/",
  runScripts: "dangerously",
  resources: "usable"
});

// Polyfills
dom.window.fetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => ([]),
  text: async () => '[]'
});
dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 16);

dom.window.addEventListener("error", (event) => {
  console.error("JSDOM Error:", event.error.message);
});

dom.window.addEventListener("unhandledrejection", (event) => {
  console.error("JSDOM Unhandled Rejection:", event.reason);
});

setTimeout(() => {
  console.log("JSDOM execution finished.");
}, 5000);
