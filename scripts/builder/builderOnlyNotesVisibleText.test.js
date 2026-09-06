'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { visibleText, BUILDER_PHRASES } = require('../check_builder_only_notes.cjs');

/**
 * Ticket 86bbvqcbk, finding 2, from the round-5 review of 86bbugd2e.
 *
 * PR #627 added a "says coming soon AND names our tooling" rule to the
 * builder-only-notes gate. It tested the WHOLE source line, so the
 * "names our tooling" half was satisfied by any `builder-*` / `*-module` /
 * `*-editor` CSS class — and nearly every JSX line in the scanned files
 * carries one. Nothing failed on the day, because the one "Coming soon."
 * in the repo sits on a bare `<p>`. The first time a tenant's own copy
 * ("our new clubhouse is coming soon") landed on a line with a builder- class,
 * the gate would have blocked a correct commit.
 *
 * A false positive is the expensive direction here: it teaches people to reach
 * for SKIP_CONVENTIONS, and then the check is off for everything. So the
 * phrases are tested against the text a visitor would SEE — not the raw line.
 */

const hits = (line) => BUILDER_PHRASES.some((re) => re.test(visibleText(line)));

test('a CSS class is not evidence that a line names our tooling', () => {
  // The four cases the review measured, verbatim.
  assert.equal(hits('<p>Coming soon.</p>'), false);
  assert.equal(hits('<p className="builder-public-site-empty">Coming soon.</p>'), false);
  assert.equal(
    hits('<div className="builder-preview-module">Our new clubhouse is coming soon.</div>'), false);
  assert.equal(hits('<div className="site-hero">Our new clubhouse is coming soon.</div>'), false);
});

test('a real leak still fails, class or no class', () => {
  assert.equal(hits('<p>Custom form builder coming soon. Standard fields are shown for now.</p>'), true);
  assert.equal(
    hits('<p className="builder-contact-form-stub">Set a Form ID in module settings.</p>'), true);
  assert.equal(hits('<span>No tags found. Add tags in the Messaging section.</span>'), true);
});

test('an attribute a visitor READS is still in scope', () => {
  // Deliberately not "strip every attribute": text pasted into a placeholder,
  // a title or an aria-label reaches the reader exactly as surely as text
  // between the tags, and stripping those would hide a real leak.
  assert.equal(hits('<input placeholder="Add tags in the Messaging section" />'), true);
  assert.equal(hits('<button aria-label="Set a Form ID in module settings" />'), true);
  assert.equal(hits('<img alt="Custom form builder coming soon" />'), true);
});

test('machinery attributes are stripped, values and all', () => {
  assert.equal(visibleText('<p className="builder-x" id="module-1">Hi</p>'), '<p className= id=>Hi</p>');
  // A brace value goes the same way — the class is often computed.
  assert.equal(
    visibleText('<p className={`builder-${kind}-module`}>Coming soon.</p>'),
    '<p className=>Coming soon.</p>');
});
