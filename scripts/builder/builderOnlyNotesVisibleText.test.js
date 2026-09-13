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
 *
 * BOTH DIRECTIONS ARE PINNED BELOW, and for one round only the first was.
 * The original fix kept a short allow-list of "visible" attributes and blanked
 * every other `name="…"` pair — which silently included ordinary React props
 * carrying visitor copy, a shape that appears throughout the scanned files:
 *
 *   caught on main, MISSED by the allow-list:
 *     <EmptyState message="No posts found. Add posts in the Messaging section." />
 *     <Note text="Set a Form ID in module settings" />
 *
 * Both are landmine 16's own example phrases. The tests here only asserted
 * that the four false positives stayed clean, so the gate got narrower with
 * nothing watching (round-2 review of this ticket). It is deny-by-default now
 * — only machinery is blanked — and the recovered direction has its own test.
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

test('a phrase passed as a PROP is still caught — the strip is deny-by-default', () => {
  // The regression the round-2 review measured, verbatim. A component prop can
  // be called anything, so an allow-list of "visible" attributes can never be
  // complete; only the list of things a visitor definitely cannot read can be.
  assert.equal(
    hits('<EmptyState message="No posts found. Add posts in the Messaging section." />'), true);
  assert.equal(hits('<Note text="Set a Form ID in module settings" />'), true);
  // Any prop name at all, not just the two the review happened to name.
  assert.equal(hits('<Empty emptyText="Add posts in module settings" />'), true);
  assert.equal(hits('<Card caption="Custom form builder coming soon" />'), true);
});

test('machinery keeps its value blanked even when a phrase is hiding in it', () => {
  // The other direction of the same rule: these cannot reach a reader, so a
  // phrase inside one is not a leak and must not block a commit.
  assert.equal(hits('<a href="/help/add-tags-in-the-messaging-section">Tags</a>'), false);
  assert.equal(hits('<div data-hint="Set a Form ID in module settings" />'), false);
  assert.equal(hits('<div className="builder-note" id="set-a-form-id-in-module-settings" />'), false);
});

test('aria-label and aria-description are read to a person, so they stay in scope', () => {
  // aria-* is machinery as a family, with two exceptions: a screen-reader user
  // RECEIVES these two, which makes them text a person reads.
  assert.equal(hits('<button aria-label="Set a Form ID in module settings" />'), true);
  assert.equal(hits('<div aria-description="Add tags in the Messaging section" />'), true);
  assert.equal(hits('<div aria-controls="add-tags-in-the-messaging-section" />'), false);
});
