'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Font Library 4/7 (86bchyd4a): the starter-pack import's decisions — which
 * families come in, under what licence and category, which files, and that a
 * family already on the shelf is left alone so a second run writes nothing.
 */

const {
  parsePackFile,
  planFamily,
  platformFilePath,
  readBackMismatches,
  selectFiles,
  countByCategory,
} = require('../../lib/fontsourceImport.js');

const PACK_PATH = path.join(__dirname, '..', '..', 'docs', 'fonts', 'starter-pack.txt');

function url(id, weight, style) {
  return `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${weight}-${style}.woff2`;
}

/** A Fontsource /v1/fonts/<id> answer with latin woff2 files for the given weights × styles. */
function detail({ id = 'orbitron', family = 'Orbitron', license = 'OFL-1.1', category = 'sans-serif', weights = [400, 700], styles = ['normal'] } = {}) {
  const variants = {};
  for (const w of weights) {
    variants[String(w)] = {};
    for (const s of styles) variants[String(w)][s] = { latin: { url: { woff2: url(id, w, s), woff: 'x', ttf: 'y' } } };
  }
  return { id, family, license, category, weights, styles, subsets: ['latin'], variants };
}

test('the committed starter pack reads cleanly and holds 150–300 families', () => {
  const { entries, problems } = parsePackFile(fs.readFileSync(PACK_PATH, 'utf8'));
  assert.deepEqual(problems, []);
  assert.ok(entries.length >= 150 && entries.length <= 300, `pack has ${entries.length}`);
  // Display and sci-fi first, as the ticket asks.
  assert.equal(entries[0].id, 'orbitron');
});

test('pack file: comments, weights, duplicates and unreadable lines', () => {
  const { entries, problems } = parsePackFile([
    '# heading',
    'orbitron 400,900   # keep two weights',
    '',
    'audiowide',
    'orbitron',
    'Bad Id',
    'exo-2 450',
  ].join('\n'));
  assert.deepEqual(entries.map((e) => [e.id, e.weights]), [['orbitron', [400, 900]], ['audiowide', null]]);
  assert.equal(problems.length, 3);
  assert.match(problems[0].message, /already listed on line 2/);
  assert.match(problems[1].message, /cannot read "Bad Id"/);
  assert.match(problems[2].message, /weights must be 100/);
});

test('licences: OFL and Apache pass, CC0 and Unlicense count as public domain, others are refused', () => {
  const none = new Set();
  const entry = { id: 'x', weights: null };
  assert.equal(planFamily(entry, detail({ license: 'OFL-1.1' }), none).font.licence, 'OFL-1.1');
  assert.equal(planFamily(entry, detail({ license: 'Apache-2.0' }), none).font.licence, 'Apache-2.0');
  const cc0 = planFamily(entry, detail({ license: 'CC0-1.0' }), none);
  assert.equal(cc0.font.licence, 'public-domain');
  assert.match(cc0.font.licenceText, /CC0-1\.0/);
  assert.equal(planFamily(entry, detail({ license: 'Unlicense' }), none).font.licence, 'public-domain');
  for (const refused of ['UFL-1.0', 'mit', '', 'Proprietary']) {
    const plan = planFamily(entry, detail({ license: refused }), none);
    assert.equal(plan.action, 'skip', refused);
    assert.match(plan.reason, /does not allow use on a business website/);
  }
});

test('categories map to the library five; other and icons are skipped', () => {
  const entry = { id: 'x', weights: null };
  const none = new Set();
  assert.equal(planFamily(entry, detail({ category: 'sans-serif' }), none).font.category, 'sans');
  assert.equal(planFamily(entry, detail({ category: 'monospace' }), none).font.category, 'monospace');
  assert.equal(planFamily(entry, detail({ category: 'icons' }), none).action, 'skip');
  assert.equal(planFamily(entry, detail({ category: 'other' }), none).action, 'skip');
});

test('a family name the library cannot hold is skipped with the reason, not rewritten', () => {
  const plan = planFamily({ id: 'x', weights: null }, detail({ family: "Fancy's Font!" }), new Set());
  assert.equal(plan.action, 'skip');
  assert.match(plan.reason, /cannot be used as a font name/);
});

test('an id Fontsource does not have is skipped and named', () => {
  const plan = planFamily({ id: 'no-such-font', weights: null }, null, new Set());
  assert.deepEqual(plan, { action: 'skip', id: 'no-such-font', reason: 'Fontsource has no font with this id' });
});

test('a family already on the shelf is left alone — the second run writes nothing', () => {
  const entry = { id: 'orbitron', weights: null };
  const first = planFamily(entry, detail(), new Set());
  assert.equal(first.action, 'import');
  const second = planFamily(entry, detail(), new Set([first.font.slug]));
  assert.equal(second.action, 'present');
  assert.equal(second.slug, 'orbitron');
});

test('files: latin woff2 only, regular + bold by default, italics where they exist', () => {
  const picked = selectFiles(detail({ weights: [300, 400, 700, 900], styles: ['normal', 'italic'] }), null);
  assert.ok(picked.ok);
  assert.deepEqual(picked.files.map((f) => `${f.weight}-${f.style}`), ['400-normal', '400-italic', '700-normal', '700-italic']);
  assert.ok(picked.files.every((f) => f.url.endsWith('.woff2')));
});

test('files: a one-weight display face keeps the weight nearest regular', () => {
  const picked = selectFiles(detail({ weights: [300, 900] }), null);
  assert.deepEqual(picked.files.map((f) => f.weight), [300]);
});

test('files: weights named in the pack, with the missing ones reported', () => {
  const picked = selectFiles(detail({ weights: [400, 700] }), [400, 900]);
  assert.deepEqual(picked.files.map((f) => f.weight), [400]);
  assert.deepEqual(picked.missing, ['weight 900']);
  const none = selectFiles(detail({ weights: [400] }), [800]);
  assert.equal(none.ok, false);
  assert.match(none.reason, /none of the weights listed/);
});

test('files: no latin subset means the family is skipped', () => {
  const d = detail();
  for (const w of Object.keys(d.variants)) d.variants[w].normal = { 'cyrillic-ext': { url: { woff2: 'https://x/y.woff2' } } };
  const plan = planFamily({ id: 'orbitron', weights: null }, d, new Set());
  assert.equal(plan.action, 'skip');
  assert.match(plan.reason, /no latin woff2/);
});

test('blob paths are fixed per family, so a re-run overwrites rather than piling up', () => {
  assert.equal(platformFilePath('exo-2', { weight: 700, style: 'italic' }), 'Fonts/platform/exo-2/700-italic.woff2');
});

test('read-back: a missing row or a short file list is a mismatch', () => {
  const imported = [{ family: 'Orbitron', slug: 'orbitron', fileCount: 2 }, { family: 'Exo 2', slug: 'exo-2', fileCount: 4 }];
  assert.deepEqual(readBackMismatches(imported, [
    { slug: 'orbitron', category: 'sans', styles: [{}, {}] },
    { slug: 'exo-2', category: 'sans', styles: [{}, {}, {}, {}] },
  ]), []);
  assert.deepEqual(readBackMismatches(imported, [{ slug: 'orbitron', styles: [{}] }]), [
    'Orbitron: 2 file(s) uploaded, row lists 1',
    'Exo 2: no row in the library after it was saved',
  ]);
  assert.deepEqual(countByCategory([{ category: 'sans' }, { category: 'sans' }, { category: 'serif' }]), { sans: 2, serif: 1 });
});
