'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SPEC = path.join(ROOT, '.claude', 'skills', 'loop-spec', 'SKILL.md');
const REVIEW = path.join(ROOT, '.claude', 'skills', 'loop-review', 'SKILL.md');

/**
 * A hand-off the operator can act on without asking a follow-up question.
 *
 * Dane, on task 86bbh7qer: "This should include a clickable link I can click to
 * test... none of the 'How to test' options are clear how I actually do it."
 *
 * A "How to test" written for a developer — run the generator, open the SVG —
 * is a developer's instruction wearing a test's clothes. It reads as done and
 * hands the verifying straight back to him, at the exact moment the loop was
 * supposed to have finished it.
 *
 * This is a docs change, so what a test can hold is that the instruction is
 * PRESENT and says the demanding thing rather than the polite one. It cannot
 * make a future pass write a good link. What it can do is fail the moment
 * somebody softens the rule back into a suggestion, which is how the previous
 * version of this idea evaporated.
 */

const readSpec = () => fs.readFileSync(SPEC, 'utf8');
const readReview = () => fs.readFileSync(REVIEW, 'utf8');

test('loop-spec demands operator-runnable test steps', async (t) => {
  const text = readSpec();
  const section = text.slice(text.indexOf('## How to test'), text.indexOf('## Risk'));

  await t.test('a step is a link or an exact command, and nothing else', () => {
    assert.match(section, /a link he can click/i);
    assert.match(section, /exact command to copy and paste/i);
    assert.match(section, /output it should\s+print/i, 'the expected output is part of the step');
  });

  await t.test('it names the two shapes that are NOT steps', () => {
    // Naming the failure is what makes a rule enforceable — "write good steps"
    // is advice, "this exact sentence is not a step" is a rule.
    assert.match(section, /is not a step/i);
    assert.match(section, /generator/i, "the SVG example from Dane's own complaint is kept");
  });

  await t.test('and the guardrail tells the speccer to re-read it as Dane', () => {
    const guardrails = text.slice(text.indexOf('## Guardrails'));
    assert.match(guardrails, /Read your own "How to test" back as Dane/i);
    assert.match(guardrails, /clickable link I can click to test/, "his words, verbatim");
    assert.match(guardrails, /86bbh7qer/, 'and where he said them');
  });
});

test('loop-review requires a clickable link on a Ready-to-launch card', async (t) => {
  const text = readReview();
  const rule = text.slice(text.indexOf('### A `Ready to launch` card must carry a link'));
  assert.ok(rule.length > 200, 'the rule must be findable by its heading');

  await t.test('it ranks the three link sources', () => {
    assert.match(rule, /Vercel preview URL/i, 'the preview is first — it already exists');
    assert.match(rule, /Artifact page/i);
    assert.match(rule, /localhost URL with the command that starts the server/i);
  });

  await t.test('it insists on the PAGE, not the site root', () => {
    // "here is the preview" is not actionable on a 138-page site.
    assert.match(rule, /not the site root/i);
  });

  await t.test('a missing link is a FAILURE, not a footnote', () => {
    assert.match(rule, /review FAILURE/i);
    assert.match(rule, /send it back/i);
    assert.doesNotMatch(
      rule,
      /(?:should|try to|where possible|if you can)\s+include a link/i,
      'the rule must not be softened into a suggestion — that is how it evaporates'
    );
  });

  await t.test('and work with no visible surface must SAY so', () => {
    // The other half: silence is indistinguishable from forgetting.
    assert.match(rule, /no visible surface/i);
    assert.match(rule, /nothing to look at/i);
  });

  await t.test("it quotes Dane rather than paraphrasing him", () => {
    assert.match(rule, /clickable link I can click to test/);
    assert.match(rule, /86bbh7qer/);
  });
});

test('both skills point at the same rule, so neither can drift alone', () => {
  // loop-spec writes the test steps; loop-review is the last chance to catch a
  // ticket that has none. If only one of them carries the rule, a ticket can
  // pass through the gap.
  for (const [read, label] of [[readSpec, 'loop-spec'], [readReview, 'loop-review']]) {
    const text = read();
    assert.match(text, /clickable link I can click to test/, `${label} must carry his words`);
    assert.match(text, /86bbh7qer/, `${label} must cite where they came from`);
  }
});
