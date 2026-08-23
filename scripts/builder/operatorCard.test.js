'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CONTEXT_MIN_WORDS,
  CONTEXT_MAX_WORDS,
  BANNER_RULE,
  BANNER_LABEL,
  countWords,
  findBlockquoteLines,
  parseCard,
  validateCard,
  cardSurvived,
  renderCard,
  buildCard,
} = require('./operatorCard.js');

/** A body of exactly n words, for testing the range boundaries. */
function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');
}

function card({ asked = 'build the chip display', when = '', context = words(60), needed = 'Nothing right now.' } = {}) {
  return [
    '@@ASKED', asked,
    ...(when ? ['@@WHEN', when] : []),
    '@@CONTEXT', context,
    '@@NEEDED', needed,
  ].join('\n');
}

// ---------------------------------------------------------------- parsing

test('parses the four sections and trims them', () => {
  const parsed = parseCard(card({ when: '2026-08-22 10:56am' }));
  assert.equal(parsed.asked, 'build the chip display');
  assert.equal(parsed.when, '2026-08-22 10:56am');
  assert.equal(parsed.needed, 'Nothing right now.');
  assert.equal(countWords(parsed.context), 60);
});

test('@@WHEN is optional', () => {
  assert.equal(parseCard(card()).when, '');
});

test('a multi-line @@ASKED keeps its line breaks', () => {
  const parsed = parseCard(card({ asked: 'line one\nline two' }));
  assert.equal(parsed.asked, 'line one\nline two');
});

test('text before the first marker is an error, not silently dropped', () => {
  // The whole point of the format is that nothing goes missing unnoticed.
  assert.throws(() => parseCard('stray words\n' + card()), /text before the first @@ section/);
});

test('an unknown marker is rejected rather than ignored', () => {
  assert.throws(() => parseCard('@@ASKED\nx\n@@SUMMARY\ny'), /"@@SUMMARY" is not a card section/);
});

test('a repeated marker is rejected — the second copy would silently win', () => {
  assert.throws(() => parseCard(card() + '\n@@NEEDED\nsomething else'), /@@NEEDED appears twice/);
});

// ------------------------------------------------------------- validation

test('a well-formed card has no problems', () => {
  assert.deepEqual(validateCard(parseCard(card())), []);
});

test('the context word range is enforced at both ends', () => {
  assert.deepEqual(validateCard(parseCard(card({ context: words(CONTEXT_MIN_WORDS) }))), []);
  assert.deepEqual(validateCard(parseCard(card({ context: words(CONTEXT_MAX_WORDS) }))), []);

  const tooShort = validateCard(parseCard(card({ context: words(CONTEXT_MIN_WORDS - 1) })));
  assert.equal(tooShort.length, 1);
  assert.match(tooShort[0], /is 49 words; the floor is 50/);

  const tooLong = validateCard(parseCard(card({ context: words(CONTEXT_MAX_WORDS + 1) })));
  assert.equal(tooLong.length, 1);
  assert.match(tooLong[0], /is 101 words; the ceiling is 100/);
});

test('punctuation is not a word — a card cannot slip under the ceiling on dashes', () => {
  assert.equal(countWords('one — two · three -- four'), 4);
  const padded = words(CONTEXT_MAX_WORDS) + ' — · -- •';
  assert.deepEqual(validateCard(parseCard(card({ context: padded }))), []);
});

test('every empty section is reported, and all of them at once', () => {
  const problems = validateCard({ asked: '', when: '', context: '', needed: '' });
  assert.equal(problems.length, 3, 'asked, context and needed — three problems in one pass');
  assert.match(problems.join('\n'), /@@ASKED is empty/);
  assert.match(problems.join('\n'), /@@CONTEXT is empty/);
  assert.match(problems.join('\n'), /@@NEEDED is empty/);
});

test('"nothing needed" is a valid ask, but it has to be written down', () => {
  assert.deepEqual(validateCard(parseCard(card({ needed: 'Nothing right now.' }))), []);
  assert.match(
    validateCard(parseCard(card({ needed: '   ' }))).join('\n'),
    /"Nothing right now" is a perfectly good/,
  );
});

// -------------------------------------------------------------- rendering

test('renders the banner exactly as the operator drew it', () => {
  const out = renderCard(parseCard(card()));
  assert.equal(BANNER_RULE, '#############################');
  assert.equal(BANNER_LABEL, 'NEEDED FROM DANE: ', 'including the trailing space');
  assert.ok(
    out.includes(['```', BANNER_RULE, BANNER_LABEL, BANNER_RULE, '```'].join('\n')),
    'the banner is fenced so ClickUp renders the hashes literally instead of eating them',
  );
});

test('the three parts appear in the order the operator asked for', () => {
  const out = renderCard(parseCard(card({ when: 'yesterday' })));
  const askedAt = out.indexOf("DANE'S WORDS");
  const contextAt = out.indexOf("WHAT'S GOING ON");
  const bannerAt = out.indexOf(BANNER_LABEL);
  assert.ok(askedAt >= 0 && contextAt > askedAt && bannerAt > contextAt);
});

test("every line of the operator's words is carried, not just the first", () => {
  const out = renderCard(parseCard(card({ asked: 'line one\nline two' })));
  assert.ok(out.includes('```\nline one\nline two\n```'));
});

test('the timestamp is omitted entirely when @@WHEN is absent', () => {
  assert.ok(!renderCard(parseCard(card())).includes('*()*'));
});

// ------------------------------------------- ClickUp eats blockquotes (live)

/**
 * Found against the real API on 2026-08-22: a comment posted through
 * `POST /task/{id}/comment` comes back with every `> quoted line` DELETED.
 * A probe of six forms on task 86bbgm68r showed fenced blocks, bold-italic,
 * four-space indents, plain quotes and bold-with-dash all survive; `>` is the
 * only casualty. The first two cards this module posted lost the operator's
 * words that way, and the length check called it a success.
 */

test('a "> " blockquote is refused in every section — ClickUp deletes those lines', () => {
  for (const section of ['asked', 'context', 'needed']) {
    const bad = { asked: 'x', when: '', context: words(60), needed: 'y', [section]: '> quoted words' };
    const problems = validateCard(bad);
    assert.ok(
      problems.some((p) => p.includes(`@@${section.toUpperCase()} uses a "> " blockquote`)),
      `${section} must be checked for blockquotes`,
    );
  }
});

test('findBlockquoteLines reports 1-based lines and exempts fenced blocks', () => {
  assert.deepEqual(findBlockquoteLines('a\n> b\nc\n  > d'), [2, 4]);
  // A `>` inside a fence is literal and safe — often exactly what is meant.
  assert.deepEqual(findBlockquoteLines('a\n```\n> b\n```\nc'), []);
  assert.deepEqual(findBlockquoteLines('```\n> b\n```\n> c'), [4]);
  assert.deepEqual(findBlockquoteLines(''), []);
});

test('`describe` refuses a blockquote before sending — descriptions eat them too', () => {
  const block = code.slice(code.indexOf("cmd === 'describe'"), code.indexOf("cmd === 'ask'"));
  const guardAt = block.indexOf('findBlockquoteLines(');
  const callAt = block.search(/await call\(/);
  assert.ok(guardAt >= 0, '`describe` must check the body for blockquotes');
  assert.ok(guardAt < callAt, 'the check has to run before the write, not after it');
  assert.match(block, /process\.exit\(2\)/);
});

test('the rendered card never contains a blockquote line', () => {
  const out = renderCard(parseCard(card({ asked: 'build the chip display' })));
  assert.ok(!out.split('\n').some((line) => /^\s*>/.test(line)));
});

test("the operator's words are fenced, so nothing inside them gets reinterpreted", () => {
  // A `#` or `*` in his own words must not become a heading or a bullet.
  const out = renderCard(parseCard(card({ asked: '# ship it *now*' })));
  assert.ok(out.includes('```\n# ship it *now*\n```'));
});

test('cardSurvived passes when the words came back and fails when they did not', () => {
  const parsed = parseCard(card({ asked: 'build the chip display' }));
  assert.equal(cardSurvived(parsed, renderCard(parsed)), null);

  // Exactly what ClickUp returned for the first two real cards: a long, healthy
  // comment with the quoted line silently removed from the middle of it.
  const mangled = renderCard(parsed).replace('build the chip display', '');
  assert.match(cardSurvived(parsed, mangled), /did NOT survive/);
});

test('cardSurvived ignores whitespace reflow — only real loss counts', () => {
  const parsed = parseCard(card({ asked: 'build   the\nchip display' }));
  assert.equal(cardSurvived(parsed, 'noise build the chip display noise'), null);
});

// ----------------------------------------------------------------- buildCard

test('buildCard refuses a bad card and says so without posting anything', () => {
  assert.throws(
    () => buildCard(card({ context: words(10), needed: '' })),
    (err) => {
      assert.match(err.message, /is 10 words; the floor is 50/);
      assert.match(err.message, /@@NEEDED is empty/);
      assert.match(err.message, /Nothing was posted and no status was moved/);
      return true;
    },
  );
});

test('buildCard returns the rendered card AND the parsed one', () => {
  const built = buildCard(card());
  assert.ok(built.rendered.includes(BANNER_LABEL));
  // The parsed card comes back too, so the caller can check after posting that
  // ClickUp actually kept the operator's words.
  assert.equal(built.card.asked, 'build the chip display');
});

// --------------------------------------------- the guard inside clickup_direct

/**
 * Source-level, for the same reason clickupUrgentGuard.test.js is: everything
 * past the guard in clickup_direct.mjs needs CLICKUP_API_TOKEN, which Doppler
 * supplies and CI never holds (DOCTRINE 4.1). The card SHAPE above is real
 * behaviour; these two assert that the shape is actually wired into the one
 * command that hands a ticket to the operator, and that nothing routes past it.
 */
const source = fs.readFileSync(path.join(__dirname, '..', 'clickup_direct.mjs'), 'utf8');
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('`status` refuses to move a ticket into an operator status on its own', () => {
  const block = code.slice(code.indexOf("cmd === 'status'"), code.indexOf("cmd === 'priority'"));
  assert.match(block, /OPERATOR_STATUSES\.includes\(status\.toLowerCase\(\)\)/);
  assert.match(block, /flag\('no-card'\)/, 'the only way past the guard is an explicit written claim');
  assert.match(block, /process\.exit\(2\)/, 'a missing card must stop the command');
});

test('`ask` validates the card BEFORE any network call — a bad card posts nothing', () => {
  const block = code.slice(code.indexOf("cmd === 'ask'"), code.indexOf("cmd === 'lists'"));
  const buildAt = block.indexOf('buildCard(');
  const callAt = block.search(/await call\(/);
  assert.ok(buildAt >= 0, '`ask` must build the card through the validated path');
  assert.ok(callAt >= 0, '`ask` must eventually talk to ClickUp');
  assert.ok(buildAt < callAt, 'validation has to run before the first request, not after it');
});

test("`ask` checks the operator's words survived BEFORE it moves the status", () => {
  const block = code.slice(code.indexOf("cmd === 'ask'"), code.indexOf("cmd === 'lists'"));
  const survivedAt = block.indexOf('cardSurvived(');
  const statusAt = block.search(/await call\('PUT'/);
  assert.ok(survivedAt >= 0, '`ask` must verify the posted card by reading it back');
  assert.ok(statusAt >= 0, '`ask` must move the status');
  assert.ok(
    survivedAt < statusAt,
    'a card that lost his words must not become a handoff — check first, move second',
  );
});
