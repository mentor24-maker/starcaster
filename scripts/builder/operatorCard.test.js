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
  evidenceTimestamp,
  fencedBlocks,
} = require('./operatorCard.js');

/** A body of exactly n words, for testing the range boundaries. */
function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');
}

function card({ asked = 'build the chip display', when = '', context = words(60), needed = 'Nothing right now.', evidence = '' } = {}) {
  return [
    '@@ASKED', asked,
    ...(when ? ['@@WHEN', when] : []),
    '@@CONTEXT', context,
    '@@NEEDED', needed,
    ...(evidence ? ['@@EVIDENCE', evidence] : []),
  ].join('\n');
}

/** A well-formed proof: the command, its real output, and when it was run. */
const GOOD_EVIDENCE = [
  'Re-ran the call that was failing, at 8:04pm:',
  '```',
  '$ curl -sS -w "%{http_code}" .../team/9013/plan',
  '{"plans":[{"plan_name":"Free Forever"}]} 200',
  '```',
].join('\n');

/** The ask from the 2026-08-23 escalation, verbatim in spirit. */
const COSTLY_ASK = 'Put the workspace back on a paid plan.';

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

// ------------------------------------------------------ the evidence gate

/**
 * WHY (2026-08-23). An agent asked Dane to pay for a plan upgrade to fix an
 * outage that was transient and had already cleared. The diagnosis was
 * plausible and wrong, and it reached his wallet without anyone re-running the
 * one call that would have settled it. The gate below makes the escalation
 * itself demand that command and its output. See costlyAsk.js.
 */

test('a costly ask is REFUSED without @@EVIDENCE, and the message says why', () => {
  assert.throws(
    () => buildCard(card({ needed: COSTLY_ASK })),
    (err) => {
      assert.match(err.message, /@@EVIDENCE is missing/);
      assert.match(err.message, /paid plan/);          // names the trigger it fired on
      assert.match(err.message, /2026-08-23/);         // and the incident behind the rule
      assert.match(err.message, /Nothing was posted and no status was moved/);
      return true;
    },
  );
});

test('the same costly ask WITH evidence is accepted', () => {
  const built = buildCard(card({ needed: COSTLY_ASK, evidence: GOOD_EVIDENCE }));
  assert.equal(built.card.evidence, GOOD_EVIDENCE);
});

test('an ordinary ask is unaffected — no evidence needed, none demanded', () => {
  // Criterion 3. A gate that fires on everything gets bypassed, and then it
  // protects nothing. These are the escalations that must still sail through.
  for (const needed of [
    'Nothing right now.',
    'Should the chip show the count or the label?',
    'A or B: keep the sidebar, or fold it into the header?',
    'Confirm the scope is pages only, not posts.',
  ]) {
    assert.deepEqual(validateCard(parseCard(card({ needed }))), [], needed);
  }
});

test('evidence with no output under the command is refused', () => {
  // A command with nothing beneath it is a claim about what WOULD happen,
  // which is exactly the shape of the wrong diagnosis.
  const problems = validateCard(parseCard(card({
    needed: COSTLY_ASK,
    evidence: 'Checked at 8:04pm:\n```\n$ curl -sS .../team/9013/plan\n```',
  })));
  assert.match(problems.join('\n'), /command with no output under it/);
});

test('evidence that only summarises the output is refused', () => {
  const problems = validateCard(parseCard(card({
    needed: COSTLY_ASK,
    evidence: 'I ran the plan endpoint at 8:04pm and it came back Free Forever.',
  })));
  assert.match(problems.join('\n'), /no fenced block/);
});

test('evidence with no time it was run is refused', () => {
  const problems = validateCard(parseCard(card({
    needed: COSTLY_ASK,
    evidence: '```\n$ curl -sS .../team/9013/plan\n{"plan_name":"Free Forever"}\n```',
  })));
  assert.match(problems.join('\n'), /no time it was run/);
});

test('volunteered evidence on an ordinary ask is still shape-checked', () => {
  // Half-evidence is more misleading than none: it reads as proof.
  const problems = validateCard(parseCard(card({
    needed: 'Which column should it sort by?',
    evidence: 'I looked and it seemed fine.',
  })));
  assert.match(problems.join('\n'), /no fenced block/);
});

test('the timestamp is read in the operator\'s own register', () => {
  assert.equal(evidenceTimestamp('measured at 8:04pm'), '8:04pm');
  assert.equal(evidenceTimestamp('measured at 8:04 PM'), '8:04 PM');
  assert.equal(evidenceTimestamp('ran 2026-08-23 8:04pm'), '2026-08-23 8:04pm');
  assert.equal(evidenceTimestamp('ran 8/23 8:04pm'), '8/23 8:04pm');
  // A bare ISO instant is a number he has to convert before he can tell
  // whether the reading is from ten minutes ago or from before the outage.
  assert.equal(evidenceTimestamp('ran at 2026-08-23T20:04:11Z'), null);
});

test('fencedBlocks keeps the content of an unclosed fence', () => {
  // A missing back-tick line is a formatting slip, not "you pasted no output".
  assert.deepEqual(fencedBlocks('```\nline one\nline two'), [['line one', 'line two']]);
  assert.deepEqual(fencedBlocks('nothing fenced here'), []);
});

test('the card SHOWS the evidence, under the ask, with its measured-at time', () => {
  // Criterion 2 and the freshness half: a stale proof has to be visible
  // rather than implied, so the time goes in the heading.
  const out = renderCard(parseCard(card({ needed: COSTLY_ASK, evidence: GOOD_EVIDENCE })));
  assert.match(out, /\*\*THE CHECK BEHIND THIS ASK — measured at 8:04pm\*\*/);
  assert.ok(out.indexOf(COSTLY_ASK) < out.indexOf('THE CHECK BEHIND THIS ASK'),
    'the ask comes first, then the proof it rests on');
  assert.ok(out.includes('{"plans":[{"plan_name":"Free Forever"}]} 200'),
    'the pasted output reaches the card verbatim');
});

test('a card with no evidence renders exactly as it always did', () => {
  const out = renderCard(parseCard(card()));
  assert.ok(!out.includes('THE CHECK BEHIND THIS ASK'));
});

test('@@EVIDENCE is parsed as its own section and may not be repeated', () => {
  assert.equal(parseCard(card({ evidence: 'x' })).evidence, 'x');
  assert.throws(() => parseCard(card({ evidence: 'x' }) + '\n@@EVIDENCE\ny'), /@@EVIDENCE appears twice/);
});

/**
 * WHY THESE FIVE (review of this gate, 2026-08-26). The gate shipped reading
 * the first clock ANYWHERE in @@EVIDENCE, and the pasted output is part of
 * @@EVIDENCE — so a log line dated the card instead of the run. That is the
 * exact stale-proof failure the timestamp exists to prevent, arriving through
 * the feature meant to prevent it.
 */

/** The reviewer's own reproduction: a six-day-old log under a fresh reading. */
const LOG_DATED_EVIDENCE = [
  'Re-ran it just now:',
  '```',
  '$ curl -s .../chat',
  '2026-08-20 3:12pm  POST /chat -> 401 refused',
  '```',
  'Measured at 9:40pm today.',
].join('\n');

test('the measured-at time comes from the prose, never from the pasted log', () => {
  assert.equal(evidenceTimestamp(LOG_DATED_EVIDENCE), '9:40pm');
  const out = renderCard(parseCard(card({ needed: COSTLY_ASK, evidence: LOG_DATED_EVIDENCE })));
  assert.match(out, /THE CHECK BEHIND THIS ASK — measured at 9:40pm/);
  assert.doesNotMatch(out, /measured at 2026-08-20/,
    'the card must not date itself by whatever the output happened to print');
});

test('evidence whose only clock is inside the fence is refused', () => {
  // It fails the other way too: a recent-looking time inside an old log would
  // make stale evidence read as fresh.
  const problems = validateCard(parseCard(card({
    needed: COSTLY_ASK,
    evidence: [
      'Re-ran it:',
      '```',
      '$ curl -s .../team/9013/plan',
      '2026-08-20 3:12pm  200 {"plan_name":"Free Forever"}',
      '```',
    ].join('\n'),
  })));
  assert.match(problems.join('\n'), /only inside the pasted block/);
  assert.match(problems.join('\n'), /outside the fences/);
});

test('a command fence and a separate output fence is accepted', () => {
  // The clearer layout. The first version of the rule wanted one fence holding
  // two lines and told this author "you showed a command with no output",
  // which is false — and a gate that misdiagnoses good input gets routed around.
  assert.deepEqual(validateCard(parseCard(card({
    needed: COSTLY_ASK,
    evidence: [
      'Measured at 9:40pm:',
      '```',
      '$ curl -sS .../team/9013/plan',
      '```',
      'and it printed:',
      '```',
      '{"plans":[{"plan_name":"Free Forever"}]}',
      '```',
    ].join('\n'),
  }))), []);
});

test('a clock needs a boundary after am/pm, or a timezone reads as a time', () => {
  assert.equal(evidenceTimestamp('cron next run 10:15 America/New_York'), null);
  assert.equal(evidenceTimestamp('9:30 ambient noise on the recording'), null);
  assert.equal(evidenceTimestamp('measured at 10:15am, America/New_York'), '10:15am');
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
