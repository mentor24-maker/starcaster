'use strict';

/**
 * Form layout: labels above or beside the boxes, half-width questions and the
 * Required Mark (task SC-860). These pin the STORAGE half — what a form keeps
 * through every save path — because the failure this guards against is a
 * silent one: the Contacts › Forms editor (public/js/crm.js, frozen) knows
 * nothing about any of the three, and rebuilds every field and every style
 * from its own copy on each save. Taken as sent, one save there would put
 * every half-width question back to full and the labels back beside, with the
 * save reporting success (the 86bcgcnkw shape).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  sanitizeFormField, normalizeCrmFormStyles, keepFieldWidths, applyFieldLayoutPatch, keepUnsentStyles,
} = require('../../lib/crmFormStyles.js');
const { resolveStylesPatch, sanitizeForm, formInputToRow } = require('../../lib/crmFormsStore.js');

const STORED = {
  styles: normalizeCrmFormStyles({ labelPosition: 'above', requiredMarker: 'none', padding: '20px' }),
  fields: [
    { key: 'first_name', label: 'First', type: 'text', required: true, options: [], width: 'half' },
    { key: 'last_name', label: 'Last', type: 'text', required: true, options: [], width: 'half' },
    { key: 'email', label: 'Email', type: 'email', required: true, options: [] },
  ],
};

/** A field list exactly as crm.js saveForm builds it: no width, ever. */
const fromCrmEditor = () => STORED.fields.map(({ width, ...f }) => ({ ...f, label: `${f.label}!` }));

test('a half-width question keeps the key; full, missing or nonsense leave it off', () => {
  assert.equal(sanitizeFormField({ key: 'a', width: 'half' }).width, 'half');
  assert.equal(sanitizeFormField({ key: 'a', width: 'HALF' }).width, 'half');
  for (const width of ['full', undefined, '', 'third', 50]) {
    assert.equal('width' in sanitizeFormField({ key: 'a', width }), false, `width ${width}`);
  }
});

test('Label Position and Required Mark default to the old look and refuse nonsense', () => {
  const plain = normalizeCrmFormStyles({});
  assert.equal(plain.labelPosition, 'beside', 'every form saved before SC-860 keeps its labels beside');
  assert.equal(plain.requiredMarker, 'asterisk');
  const odd = normalizeCrmFormStyles({ labelPosition: 'under', requiredMarker: '!!' });
  assert.equal(odd.labelPosition, 'beside');
  assert.equal(odd.requiredMarker, 'asterisk');
  assert.equal(normalizeCrmFormStyles({ label_position: 'above' }).labelPosition, 'above');
});

test('a Contacts › Forms save keeps every question\'s width and both layout styles', () => {
  const crmEditorStyles = { ...STORED.styles };
  delete crmEditorStyles.labelPosition;
  delete crmEditorStyles.requiredMarker;
  crmEditorStyles.headingColor = '#112233';
  const input = resolveStylesPatch({ fields: fromCrmEditor(), styles: crmEditorStyles }, STORED);
  assert.deepEqual(input.fields.map((f) => [f.label, f.width || 'full']), [['First!', 'half'], ['Last!', 'half'], ['Email!', 'full']]);
  assert.equal(input.styles.labelPosition, 'above');
  assert.equal(input.styles.requiredMarker, 'none');
  assert.equal(input.styles.headingColor, '#112233', 'what the editor DID change is saved');
});

test('a save that names a width is obeyed — full included', () => {
  const fields = fromCrmEditor();
  fields[0].width = 'full';
  const kept = keepFieldWidths(fields, STORED.fields);
  assert.equal(kept[0].width, 'full');
  assert.equal(kept[1].width, 'half');
});

test('a fieldLayoutPatch changes only the questions it names, on the stored fields', () => {
  const input = resolveStylesPatch({ fieldLayoutPatch: { email: 'half', last_name: 'full', nobody: 'half' } }, STORED);
  assert.deepEqual(input.fields.map((f) => [f.key, f.width || 'full']), [
    ['first_name', 'half'], ['last_name', 'full'], ['email', 'half'],
  ]);
  assert.equal('fieldLayoutPatch' in input, false);
  assert.equal(input.fields.find((f) => f.key === 'nobody'), undefined, 'a key naming no question adds none');
  assert.equal(input.fields[0].label, 'First', 'wording comes from the stored form, not a stale copy');
});

test('a whole field list wins over a fieldLayoutPatch sent with it', () => {
  const input = resolveStylesPatch({ fields: fromCrmEditor(), fieldLayoutPatch: { email: 'half' } }, STORED);
  assert.equal(input.fields.find((f) => f.key === 'email').width, undefined);
});

test('the width survives the store\'s write shape and read shape', () => {
  const row = formInputToRow({ id: 'crmf_1', name: 'F', styles: STORED.styles, fields: STORED.fields }, { includeStylesMeta: true });
  const back = sanitizeForm(row);
  assert.deepEqual(back.fields.map((f) => f.width || 'full'), ['half', 'half', 'full']);
  assert.equal(back.styles.labelPosition, 'above');
});

test('helpers leave odd input alone rather than inventing fields', () => {
  assert.equal(keepFieldWidths(undefined, STORED.fields), undefined);
  assert.deepEqual(applyFieldLayoutPatch(STORED.fields, null), STORED.fields);
  assert.deepEqual(applyFieldLayoutPatch(undefined, { a: 'half' }), []);
  assert.deepEqual(keepUnsentStyles({ padding: '1px' }, null), { padding: '1px' });
});

test('the PUT route hands fieldLayoutPatch to the store', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'crm.js'), 'utf8');
  assert.match(source, /patch\.fieldLayoutPatch\s*=\s*body\.fieldLayoutPatch/);
});
