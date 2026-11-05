'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

/**
 * Task 86bcyqzhv. A Choose one (`radio`), Choose several (`checkboxes`) or
 * Dropdown list (choose several) (`multiselect`) question reached the CRM
 * form's EMBED CODE — the HTML a tenant pastes onto an outside website — and
 * the editor's PREVIEW PANE as an empty text box, because neither knew those
 * types. public/js/crm.js is a browser script with no exports, so the
 * functions are lifted from its source and run here; the embed is then loaded
 * into a real DOM and submitted, which is the only way to see what a visitor
 * on that outside site actually gets and what reaches the server.
 */

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'crm.js'), 'utf8');

function lift(name) {
  const start = SRC.indexOf(`  function ${name}(`);
  assert.ok(start > -1, `${name} is gone from crm.js — re-point this test`);
  const end = SRC.indexOf('\n  }\n', start);
  return SRC.slice(start, end + 4);
}

const HELPERS = ['escHtml', 'isChoiceGroupFieldType', 'configuredFieldOptions', 'previewFieldInputMarkup', 'embedFieldMarkup'];

function buildEmbed(form) {
  const body = `${HELPERS.map(lift).join('\n')}\n${lift('buildEmbedCode')}\nreturn buildEmbedCode;`;
  const deps = {
    window: { location: { origin: 'https://starcaster.test' } },
    currentConfig: { id: 'cfg1' },
    App: { state: { currentProjectId: 'proj1' } },
    normalizeFormStyles: () => ({
      margin: '0', fieldWidth: '100%', labelAlign: 'left', fieldAlign: 'left', buttonAlign: 'left',
      borderSize: '1px', padding: '18px', borderRadius: '8px', buttonWidth: 'auto',
      buttonTextSize: '1rem', buttonTextWeight: '7',
    }),
    publicFormFields: (fields) => fields,
    formAlignToJustify: () => 'start',
    resolveFormColor: () => '#000',
    DEFAULT_FORM_STYLES: {},
    buildFormThemePaletteVars: () => ({}),
    formEditorThemePalette: null,
    formEditorThemeTypography: null,
    formWeightToCss: () => '700',
  };
  return new Function(...Object.keys(deps), body)(...Object.values(deps))(form);
}

const FIELDS = [
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'size', label: 'Shirt size', type: 'radio', required: true, options: ['Small', 'Large'] },
  { key: 'interests', label: 'Interests', type: 'checkboxes', required: true, options: ['Writing', 'Music', 'Film'] },
  { key: 'days', label: 'Days', type: 'multiselect', required: false, options: ['Mon', 'Tue'] },
  { key: 'colour', label: 'Colour', type: 'select', required: false, options: ['Red', 'Blue'] },
  { key: 'blank', label: 'Nothing to pick', type: 'checkboxes', required: true, options: [] },
];
const FORM = { id: 'f1', name: 'Signup', fields: FIELDS, submitLabel: 'Send' };

function loadEmbed(form) {
  const html = `<!doctype html><html><body>${buildEmbed(form)}</body></html>`;
  const sent = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://outside.example/page',
    beforeParse(window) {
      window.fetch = (url, opts) => {
        sent.push({ url, body: JSON.parse(opts.body) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      };
    },
  });
  return { doc: dom.window.document, window: dom.window, sent };
}

const choiceLabels = (doc, key) =>
  Array.from(doc.querySelectorAll(`input[name="${key}"]`)).map((input) => [input.type, input.value]);

test('the embed shows Choose one, Choose several and Dropdown (choose several) as real choices', () => {
  const { doc } = loadEmbed(FORM);
  assert.deepEqual(choiceLabels(doc, 'size'), [['radio', 'Small'], ['radio', 'Large']]);
  assert.deepEqual(choiceLabels(doc, 'interests'), [['checkbox', 'Writing'], ['checkbox', 'Music'], ['checkbox', 'Film']]);
  assert.deepEqual(choiceLabels(doc, 'days'), [['checkbox', 'Mon'], ['checkbox', 'Tue']],
    'plain HTML has no dropdown of tick boxes, so choose-several dropdowns embed as tick boxes');
  assert.equal(doc.querySelectorAll('input[type="radio"], input[type="checkboxes"], input[type="multiselect"]').length,
    doc.querySelectorAll('input[type="radio"]').length, 'no input is left with an unknown type (drawn as a text box)');
});

test('a single dropdown carries its options, and a choice group with nothing to pick is left out', () => {
  const { doc } = loadEmbed(FORM);
  const options = Array.from(doc.querySelectorAll('select[name="colour"] option')).map((o) => o.value);
  assert.deepEqual(options, ['', 'Red', 'Blue']);
  assert.equal(doc.querySelectorAll('[name="blank"]').length, 0,
    'the live Builder form drops an option-less choice field; a required one would block every submit');
});

test('submitting sends every ticked choice as a list, and the chosen round button as text', async () => {
  const { doc, window, sent } = loadEmbed(FORM);
  doc.querySelector('input[name="email"]').value = 'a@b.co';
  doc.querySelector('input[name="size"][value="Large"]').checked = true;
  doc.querySelector('input[name="interests"][value="Writing"]').checked = true;
  doc.querySelector('input[name="interests"][value="Film"]').checked = true;
  doc.querySelector('input[name="days"][value="Tue"]').checked = true;
  doc.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://starcaster.test/api/crm/contact-submit');
  assert.equal(sent[0].body.data.size, 'Large');
  assert.deepEqual(sent[0].body.data.interests, ['Writing', 'Film'], 'the old submit kept only the LAST ticked box');
  assert.deepEqual(sent[0].body.data.days, ['Tue']);
  assert.equal(sent[0].body.email, 'a@b.co');
});

test('a required Choose several asks for at least one tick, and any single tick satisfies it', () => {
  const { doc, window } = loadEmbed(FORM);
  const boxes = Array.from(doc.querySelectorAll('input[name="interests"]'));
  const form = doc.querySelector('form');
  doc.querySelector('input[name="email"]').value = 'a@b.co';
  doc.querySelector('input[name="size"][value="Small"]').checked = true;
  assert.ok(boxes.every((b) => b.required));
  assert.equal(form.checkValidity(), false, 'nothing ticked must block the submit');
  boxes[1].checked = true;
  boxes[1].dispatchEvent(new window.Event('change'));
  assert.ok(boxes.every((b) => !b.required));
  assert.equal(form.checkValidity(), true);
  const optional = Array.from(doc.querySelectorAll('input[name="days"]'));
  assert.ok(optional.every((b) => !b.required), 'an optional group never demands a tick');
});

test('text, email, textarea and an option-less dropdown embed exactly as before', () => {
  const plain = {
    id: 'f2', name: 'Plain', submitLabel: 'Send', fields: [
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'name', label: 'Name', type: 'text', required: false },
      { key: 'notes', label: 'Notes', type: 'textarea', required: false },
      { key: 'pick', label: 'Pick', type: 'select', required: true, options: [] },
    ],
  };
  const out = buildEmbed(plain);
  assert.match(out, /<label class="crm-embed-field" for="crmf_email"><span>Email<\/span><input type="email" name="email" id="crmf_email" required \/><\/label>/);
  assert.match(out, /<label class="crm-embed-field" for="crmf_name"><span>Name<\/span><input type="text" name="name" id="crmf_name" \/><\/label>/);
  assert.match(out, /<textarea name="notes" id="crmf_notes"><\/textarea>/);
  assert.match(out, /<select name="pick" id="crmf_pick" required><option value="">Select…<\/option><\/select>/);
  assert.doesNotMatch(out, /crm-embed-choices\{/, 'a form with no choice group gets no choice CSS');
});

test('the editor preview draws the choices, disabled, instead of a text box', () => {
  const preview = new Function(`${HELPERS.map(lift).join('\n')}\nreturn previewFieldInputMarkup;`)();
  const doc = new JSDOM('').window.document;
  const render = (field) => { const d = doc.createElement('div'); d.innerHTML = preview(field); return d; };
  const radio = render({ type: 'radio', options: ['Small', 'Large'] });
  assert.equal(radio.querySelectorAll('input[type="radio"]:disabled').length, 2);
  assert.match(radio.textContent, /Small[\s\S]*Large/);
  for (const type of ['checkboxes', 'multiselect']) {
    const group = render({ type, options: ['A', 'B', 'C'] });
    assert.equal(group.querySelectorAll('input[type="checkbox"]:disabled').length, 3, type);
    assert.equal(group.querySelectorAll('input:not([type="checkbox"])').length, 0, type);
  }
  const empty = render({ type: 'checkboxes', options: [] });
  assert.match(empty.textContent, /Option one[\s\S]*Option two/, 'a field with no options yet shows the canvas sample');
  assert.equal(render({ type: 'text' }).querySelector('input').type, 'text');
});
