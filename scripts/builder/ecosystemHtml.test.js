'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { renderPage, pageData } = require('./ecosystemHtml');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build_ecosystem_html.mjs');

const doc = {
  meta: { title: 'Test Ecosystem' },
  objects: [
    { id: 'mac-mini', name: 'Mac Mini', kind: 'machine', layer: 'workstations', summary: 'The always-on machine.', links: { doc: 'doctrine/NODES.md', url: 'https://example.com/x' }, detail: { user: 'daneofearth', tags: ['a', 'b'] }, probe: 'ssh' },
    { id: 'github', name: 'GitHub', kind: 'external', layer: 'external', summary: 'Code host </script> with a trap.' },
    { id: 'colima', name: 'Colima', kind: 'runtime', layer: 'local-dev', summary: 'Container VM.', host: 'mac-mini' },
  ],
  relationships: [{ from: 'mac-mini', to: 'github', label: 'gh auth' }],
};
const webSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.node-box{fill:var(--panel)}</style><g id="node-mac-mini" class="node"><rect class="node-box"/></g></svg>';

test('pageData keeps what the page shows and drops what it does not', () => {
  const data = pageData(doc);
  assert.equal(data.title, 'Test Ecosystem');
  assert.equal(data.objects.length, 3);
  assert.deepEqual(data.objects[0].links, { doc: 'doctrine/NODES.md', url: 'https://example.com/x' });
  assert.equal(data.objects[0].probe, undefined);
  assert.equal(data.objects[1].links, null);
  assert.equal(data.objects[2].host, 'mac-mini');
});

test('the page inlines the diagram and the data, and cannot be closed early by a </script> in a summary', () => {
  const html = renderPage(doc, webSvg);
  assert.match(html, /<title>Test Ecosystem<\/title>/);
  assert.match(html, /<div class="stage" id="stage"><svg /);
  assert.match(html, /const DATA = \{/);
  assert.ok(!html.includes('</script> with a trap'), 'the summary must not reach the page as a literal closing tag');
  assert.ok(html.includes('\\u003c/script\\u003e with a trap'));
  // the panel has to be readable in both themes
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /color-scheme: light dark/);
});

test('the page makes no external requests of any kind', () => {
  const html = renderPage(doc, webSvg);
  // Anything that would make the browser fetch: a stylesheet link, a remote
  // script, an @import, a url(...) pointing at a host, or a remote image.
  assert.doesNotMatch(html, /<link[^>]+href=["']?https?:/i, 'no external stylesheets');
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'no external scripts');
  assert.doesNotMatch(html, /@import/i, 'no CSS imports');
  assert.doesNotMatch(html, /url\(\s*["']?https?:/i, 'no remote CSS assets');
  assert.doesNotMatch(html, /<img[^>]+src=["']?https?:/i, 'no remote images');
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/i, 'the prototype\'s Google Fonts link must not come back');
});

test('renderPage refuses a vault-mode diagram — its boxes have no stylesheet to theme or select', () => {
  assert.throws(() => renderPage(doc, '<svg xmlns="http://www.w3.org/2000/svg"><g id="node-x"/></svg>'), /vault-mode/);
  assert.throws(() => renderPage(doc, ''), /web-mode diagram/);
});

test('end to end: the generator is deterministic and writes only into --out', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-html-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-html-b-'));
  try {
    execFileSync(process.execPath, [SCRIPT, '--out', a], { stdio: 'pipe' });
    execFileSync(process.execPath, [SCRIPT, '--out', b], { stdio: 'pipe' });
    const first = fs.readFileSync(path.join(a, 'ecosystem.html'), 'utf8');
    const second = fs.readFileSync(path.join(b, 'ecosystem.html'), 'utf8');
    assert.equal(first, second, 'two runs must be byte-identical');
    assert.deepEqual(fs.readdirSync(a), ['ecosystem.html'], 'nothing else lands in --out');

    // Every inventory object is a live, clickable box in the schematic and
    // appears in the embedded data.
    const inventory = require('js-yaml').load(fs.readFileSync(path.join(ROOT, 'docs', 'ecosystem', 'inventory.yaml'), 'utf8'));
    const dataMatch = first.match(/const DATA = (\{.*?\});\n/s);
    assert.ok(dataMatch, 'DATA is embedded');
    const data = JSON.parse(dataMatch[1]);
    assert.equal(data.objects.length, inventory.objects.length);
    assert.equal(data.relationships.length, inventory.relationships.length);
    for (const o of inventory.objects) {
      assert.ok(first.includes(`id="node-${o.id}"`), `schematic has a box for ${o.id}`);
    }
    // The diagram embedded is the WEB render: it carries its stylesheet and
    // its dark palette, not the vault's attribute-only markup.
    assert.match(first, /<svg[^>]*>[\s\S]*?<style>[\s\S]*?prefers-color-scheme: dark[\s\S]*?<\/style>/);
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
