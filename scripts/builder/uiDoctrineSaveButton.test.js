'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { b1SaveButtonsMissingClass } = require('../check_ui_doctrine.cjs');

/**
 * B1 — every Save button on the admin screens wears `.btn-save` (task 86bcyjag0).
 *
 * The rule is one class test; what is worth pinning is the tag reader. A JSX
 * `onClick={() => …}` carries a `>`, and a naive `[^>]*` ended the tag there and
 * read the handler body as the label — so these cases cover the shapes the
 * repo actually has, in both directions.
 */

test('flags a blue Save button in page markup', () => {
  const misses = b1SaveButtonsMissingClass('<button type="submit" class="btn btn-primary">Save Project</button>');
  assert.equal(misses.length, 1);
  assert.equal(misses[0].cls, 'btn btn-primary');
});

test('flags a plain black Save button', () => {
  assert.equal(b1SaveButtonsMissingClass('<button class="btn">Save Selected</button>').length, 1);
});

test('passes a Save button that wears btn-save', () => {
  assert.deepEqual(b1SaveButtonsMissingClass('<button class="btn btn-save">Save Project</button>'), []);
});

test('reads a JSX button whose handler contains an arrow', () => {
  const src = `
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => onPaste({ postTitle: title.trim() })}
    >
      {busy === 'paste' ? 'Saving…' : 'Save'}
    </button>`;
  const misses = b1SaveButtonsMissingClass(src);
  assert.equal(misses.length, 1);
  assert.match(misses[0].label, /Save/);
  assert.equal(misses[0].line, 2);
});

test('ignores "Saving…" alone, and labels that only contain the word later', () => {
  assert.deepEqual(b1SaveButtonsMissingClass(`<button className="btn btn-primary">{busy ? 'Saving…' : 'Approve'}</button>`), []);
  assert.deepEqual(b1SaveButtonsMissingClass('<button class="btn">Unsaved Changes</button>'), []);
});

test('leaves client-site and Builder-toolbar class families alone', () => {
  // tenant-admin modules keep the client's theme colours; the Builder's own
  // toolbar is green through `.admin-save-button.submit-button`
  assert.deepEqual(b1SaveButtonsMissingClass('<button className="crm-contacts-modal-btn crm-contacts-modal-btn-primary">Save Changes</button>'), []);
  assert.deepEqual(b1SaveButtonsMissingClass('<button className="submit-button">Save & Publish</button>'), []);
});
