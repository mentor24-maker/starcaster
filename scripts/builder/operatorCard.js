'use strict';

const { costlyTriggers, describeTriggers } = require('./costlyAsk.js');

/**
 * The operator card — the fixed shape of every message a loop puts in front
 * of Dane on a ClickUp ticket.
 *
 * WHY THIS EXISTS (2026-08-22). Until now the loops wrote their reasoning as
 * a long free-form ClickUp comment. ClickUp shows comments in the narrow
 * right-hand column, so the reasoning arrived as a wall of text in the
 * skinniest part of the screen, while the roomy left-hand column held a spec
 * written for a machine. Two tickets stalled on exactly that: Sync 6/7
 * (86bbev0g3) and Sync 7/7 (86bbev0gx). The operator could not tell what was
 * being asked of him on either one, and 7/7 sat in his inbox for a day
 * demanding an answer that was never actually needed.
 *
 * The fix Dane specified: detail goes LEFT (the task description, which is a
 * document and has room), and the right-hand column carries a short card with
 * exactly three parts —
 *
 *   1. his own words, verbatim, that caused the ticket to exist
 *   2. the problem and the fix in plain English, 50-100 words
 *   3. the specific ask, under a banner he can spot without reading
 *
 * The word range is the point of the whole thing. Under 50 words the card
 * stops carrying enough context to act on; over 100 it becomes the wall of
 * text this replaces. So it is checked, not suggested — see validateCard.
 *
 * Pulled out of clickup_direct.mjs so the shape is testable without a network
 * or a token, the same way busRelayPlan.js is.
 */

/**
 * CLICKUP EATS BLOCKQUOTES (found live, 2026-08-22, while testing this very
 * module). A comment posted through `POST /task/{id}/comment` comes back with
 * every `> quoted line` **deleted** — not unformatted, gone. The comment as a
 * whole is still non-empty, so a length check calls it a success. The first
 * two cards this module ever posted lost the operator's own words that way,
 * which is the single part of a card that cannot be reconstructed.
 *
 * A probe of six forms against the live API (task 86bbgm68r): fenced blocks,
 * bold-italic, four-space indents, plain quotation marks and bold-with-dash
 * all survive intact. `>` is the only casualty. So the operator's words go in
 * a fence — which is also the only form that guarantees nothing INSIDE them is
 * reinterpreted, and verbatim is the contract — and `validateCard` refuses a
 * `>` anywhere, in any section. DOCTRINE 3.10: a write that normalizes to
 * nothing looks exactly like a success, so it gets checked, not assumed.
 *
 * **Task DESCRIPTIONS do it too**, checked separately the same day: the
 * "## Dane asked for" section of the first rewritten ticket came back with the
 * quoted instruction gone. So `findBlockquoteLines` is exported and the
 * `describe` command refuses a body containing one, for the same reason.
 */

/** The three required sections of the authored input, plus two optional ones.
 *  `@@EVIDENCE` is optional in general and REQUIRED when the ask costs money
 *  or cannot be undone — see evidenceProblems below. */
const MARKERS = ['ASKED', 'WHEN', 'CONTEXT', 'NEEDED', 'EVIDENCE'];

const CONTEXT_MIN_WORDS = 50;
const CONTEXT_MAX_WORDS = 100;

/** The banner, exactly as the operator drew it — including the trailing space
 *  after the colon. Built from a named constant so no editor's
 *  strip-trailing-whitespace can quietly reshape it. */
const BANNER_RULE = '#'.repeat(29);
const BANNER_LABEL = 'NEEDED FROM DANE:' + ' ';

/**
 * Words, counted the way a person counts them: a token has to contain a
 * letter or a digit. Stray punctuation an em-dash on its own line, a bullet
 * character is not a word, and counting it would let a card sneak under the
 * ceiling on dashes.
 */
function countWords(text) {
  return String(text || '')
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
    .length;
}

/**
 * Parse the authored card. The input is plain text with `@@SECTION` markers on
 * their own lines:
 *
 *   @@ASKED
 *   build the chip display
 *   @@WHEN
 *   2026-08-22 10:56am, on this ticket
 *   @@CONTEXT
 *   ...50-100 words...
 *   @@NEEDED
 *   ...the ask...
 *
 *   @@EVIDENCE
 *   ...the command, its output, and when it was run...
 *
 * `@@WHEN` and `@@EVIDENCE` are optional to the parser — `@@EVIDENCE` becomes
 * mandatory in validateCard when the ask itself costs money or cannot be
 * undone. Anything before the first marker is an error rather
 * than silently-dropped text: a card whose first section got eaten is exactly
 * the failure this format exists to prevent.
 */
function parseCard(text) {
  const lines = String(text || '').split(/\r?\n/);
  const sections = {};
  let current = null;
  const preamble = [];

  for (const line of lines) {
    const match = /^@@([A-Z]+)\s*$/.exec(line.trim());
    if (match) {
      const name = match[1];
      if (!MARKERS.includes(name)) {
        throw new Error(
          `"@@${name}" is not a card section. Use ${MARKERS.map((m) => `@@${m}`).join(', ')}.`,
        );
      }
      if (sections[name] !== undefined) {
        throw new Error(`@@${name} appears twice — each section may only be given once.`);
      }
      sections[name] = [];
      current = name;
      continue;
    }
    if (current === null) preamble.push(line);
    else sections[current].push(line);
  }

  if (preamble.some((line) => line.trim())) {
    throw new Error(
      'There is text before the first @@ section. Every line of a card has to belong to a\n' +
      'section, or it would be dropped without anyone noticing. Start the file with @@ASKED.',
    );
  }

  const trim = (name) => (sections[name] || []).join('\n').trim();
  return {
    asked: trim('ASKED'),
    when: trim('WHEN'),
    context: trim('CONTEXT'),
    needed: trim('NEEDED'),
    evidence: trim('EVIDENCE'),
  };
}

/**
 * Everything wrong with a card, as plain sentences an agent can act on.
 * Returns an empty array when the card is good. Reports ALL problems at once
 * rather than the first — a one-at-a-time gate turns into three round trips.
 */
function validateCard(card) {
  const problems = [];
  const words = countWords(card.context);

  if (!card.asked) {
    problems.push(
      '@@ASKED is empty. It must carry the operator\'s own words that caused this ticket to\n' +
      '  exist, quoted verbatim. If there genuinely is no instruction, say so in that section\n' +
      '  and name what the ticket does descend from — never invent a quote.',
    );
  }
  if (!card.context) {
    problems.push('@@CONTEXT is empty. It must explain the problem and the fix in plain English.');
  } else if (words < CONTEXT_MIN_WORDS) {
    problems.push(
      `@@CONTEXT is ${words} words; the floor is ${CONTEXT_MIN_WORDS}. Under that it stops carrying\n` +
      '  enough for the operator to act without opening anything else.',
    );
  } else if (words > CONTEXT_MAX_WORDS) {
    problems.push(
      `@@CONTEXT is ${words} words; the ceiling is ${CONTEXT_MAX_WORDS}. The long version belongs in the\n` +
      '  task description (the left column) — put it there with `clickup describe`.',
    );
  }
  if (!card.needed) {
    problems.push(
      '@@NEEDED is empty. State the specific ask. "Nothing right now" is a perfectly good\n' +
      '  answer and a useful one — but it has to be written down, not left blank.',
    );
  }

  problems.push(...evidenceProblems(card));

  for (const name of ['asked', 'context', 'needed', 'evidence']) {
    const offending = findBlockquoteLines(card[name]);
    if (offending.length) {
      problems.push(
        `@@${name.toUpperCase()} uses a "> " blockquote (line ${offending.join(', ')}). ClickUp DELETES\n` +
        '  blockquote lines — they do not arrive unformatted, they arrive not at all.\n' +
        '  Use plain text, **bold**, or a fenced block instead.',
      );
    }
  }
  return problems;
}

/**
 * A clock time in the register the operator reads — "8:04pm", "8:04 PM",
 * optionally dated ("2026-08-23 8:04pm", "8/23 8:04pm").
 *
 * Only the operator's own register counts. A bare ISO instant or a unix epoch
 * is a number he has to convert before he can tell whether the measurement is
 * from ten minutes ago or from before the outage, and that conversion is
 * exactly the step nobody performs (OPERATIONS SOP 13).
 *
 * The trailing look-ahead is not decoration. Without it `cron next run 10:15
 * America/New_York` reads as "10:15 Am" and `9:30 ambient` as "9:30 am", so
 * the freshness check passes on text that is not a run time at all.
 */
const CLOCK = /((?:\d{4}-\d{2}-\d{2}\s+|\d{1,2}\/\d{1,2}\s+)?\d{1,2}:\d{2}\s*(?:am|pm))(?![A-Za-z0-9])/i;

/**
 * Split a section into the prose OUTSIDE its fences and the blocks inside
 * them. Both halves are needed and they mean different things: the fences hold
 * what the machine said, the prose holds what the author said about it.
 *
 * NESTED FENCES ARE OUT OF SCOPE, deliberately. Output that itself contains a
 * ``` line toggles this counter, so which text counts as prose gets scrambled.
 * Raised in review (2026-08-26) and left alone: the scrambling makes the
 * section fail its shape checks rather than mis-date the card, which is the
 * safe direction — the author is told to fix the formatting, and nothing goes
 * out asserting a measurement time that is not the measurement.
 */
function splitFences(text) {
  const prose = [];
  const blocks = [];
  let open = null;
  for (const line of String(text || '').split('\n')) {
    if (/^\s*```/.test(line)) {
      if (open === null) open = [];
      else { blocks.push(open); open = null; }
      continue;
    }
    if (open !== null) open.push(line);
    else prose.push(line);
  }
  // An unclosed fence still carried content; count what it holds rather than
  // discarding it, so a missing back-tick line reads as a formatting slip and
  // not as "you pasted no output".
  if (open !== null && open.length) blocks.push(open);
  return { prose: prose.join('\n'), fenced: blocks.map((lines) => lines.join('\n')).join('\n'), blocks };
}

/**
 * The non-empty lines of a fenced block, with shell line-continuations folded
 * into the single line they actually are.
 *
 * WHY (review round 3, 2026-08-26). The output rule counts pasted lines and
 * wants at least two — a command plus something it printed. A backslash-
 * continued command is two lines on its own, so
 *
 *   curl -s https://api.clickup.com/api/v2/team \\
 *     -H "Authorization: $TOKEN"
 *
 * satisfied the count with NO output under it at all — which is precisely "a
 * claim about what would happen", the thing the refusal message says it
 * rejects. Folding the continuation makes the count mean what it says.
 *
 * ONLY the backslash is folded. A trailing pipe looks like a continuation too,
 * but it is also how a markdown table row ends, and real pasted output is full
 * of those — folding them would undercount genuine output and refuse a good
 * card, which is the failure mode that gets a gate routed around.
 */
function contentLines(lines) {
  const out = [];
  let carry = '';
  for (const raw of lines) {
    const line = String(raw).trim();
    if (!line) continue;
    carry = carry ? `${carry} ${line}` : line;
    if (/\\$/.test(carry)) {
      carry = carry.replace(/\\+$/, '').trim();
      continue;
    }
    out.push(carry);
    carry = '';
  }
  if (carry) out.push(carry);
  return out;
}

/** The fenced blocks inside a section, as arrays of their content lines. */
function fencedBlocks(text) {
  return splitFences(text).blocks;
}

/**
 * The words that mean "I performed this check". A clock sitting next to one of
 * these is the measurement; a clock next to anything else is narration.
 */
const MEASUREMENT_CUES = /\b(?:measured|measure|measuring|ran|re-ran|reran|re-run|rerun|run|running|checked|check|rechecked|re-checked|executed|sampled|verified|tested|queried|called|captured|pulled|took|taken|as of)\b/i;

/**
 * Every clock in the PROSE of a section, in order, each marked with whether a
 * measurement cue governs it.
 *
 * "Governs" means the cue attaches to THIS clock: it sits between the previous
 * clock and this one, with no sentence end in between. So in "The outage began
 * at 3:12pm. I re-ran the failing call at 8:04pm:" only the second is a
 * measurement, and in "I re-ran the chat POST at 9:40pm, well after the outage
 * that began at 3:12pm" only the FIRST is — the cue is spent on the clock it
 * introduces and does not reach past it.
 *
 * WHY THE PREVIOUS CLOCK IS THE BOUNDARY (review round 3, 2026-08-26). Every
 * earlier version scoped the cue to the whole sentence, which made a cue
 * govern every clock after it, and then picked one of them by position — first
 * (round 1), first-in-prose (round 2), last (round 3). Each fix moved WHICH
 * clock is picked instead of changing what makes a clock the measurement, so
 * the same mis-dating kept reappearing in a new sentence shape. Authors
 * routinely narrate after the run time, and that spelling dated the card by the
 * outage. Attaching the cue to its own clock is the rule those three were
 * approximating.
 */
function evidenceClocks(text) {
  const { prose } = splitFences(text);
  const scan = new RegExp(CLOCK.source, 'gi');
  const found = [];
  let previousEnd = 0;
  let match;
  while ((match = scan.exec(prose)) !== null) {
    // Only the span since the previous clock, and only back to the nearest
    // sentence end inside it — a cue in an earlier sentence governs nothing
    // here, and a cue already used by an earlier clock is not reused.
    const lead = prose.slice(previousEnd, match.index).split(/[.!?;\n]/).pop();
    found.push({ time: match[1].trim(), measured: MEASUREMENT_CUES.test(lead) });
    previousEnd = match.index + match[0].length;
    if (scan.lastIndex === match.index) scan.lastIndex += 1;
  }
  return found;
}

/**
 * When was this evidence measured? Read from the PROSE ONLY — never from
 * inside a fenced block — and only from a clock a measurement cue attaches to.
 *
 * Returns `{ time, ambiguous, reason, clocks }`. A null `time` always carries a
 * `reason`, because the caller has a different sentence to say for each one and
 * "add a time" is unhelpful to an author who wrote three.
 *
 * WHY THE PROSE (review round 1, 2026-08-26). The first version took the first
 * clock anywhere in the section, and the pasted output is part of the section.
 * So an author who wrote "measured at 9:40pm" under a log containing
 * `2026-08-20 3:12pm POST /chat -> 401` got a card headed *measured at
 * 2026-08-20 3:12pm* — six days stale, asserted by the card itself.
 *
 * WHY NO TIE-BREAK BY POSITION (review round 3, the same day). Rounds 1-3 each
 * picked a clock by where it sat — first, first-in-prose, last — and each was
 * wrong on the next sentence shape somebody wrote. There is no position that
 * means "this is the measurement"; only the cue means that. So exactly one
 * cue-governed time is the answer, and two rival ones are REFUSED rather than
 * ranked. The heading is the single place this gate asserts something to Dane
 * instead of refusing something, and a wrong "measured at" is a false
 * statement about a live system — the very shape of the incident behind the
 * ticket. A wrong refusal costs a reword.
 *
 * ONE UNMARKED CLOCK is still taken at its word — the ordinary "8:04pm" card,
 * with nothing to confuse it with. Unless the fenced output carries a clock
 * too, in which case there IS something to confuse it with (round 3 again:
 * "the channel began refusing at 3:12pm" over a log stamped 8:04pm dated the
 * card by the outage), and it asks instead.
 */
function readEvidenceTime(text) {
  const { fenced } = splitFences(text);
  const loggedClock = CLOCK.test(fenced);
  const clocks = evidenceClocks(text);
  const measured = [...new Set(clocks.filter((clock) => clock.measured).map((clock) => clock.time))];

  if (measured.length === 1) return { time: measured[0], ambiguous: false, reason: null, clocks };
  if (measured.length > 1) return { time: null, ambiguous: true, reason: 'rival-measurements', clocks };
  if (clocks.length === 1) {
    if (loggedClock) return { time: null, ambiguous: true, reason: 'unmarked-beside-log', clocks };
    return { time: clocks[0].time, ambiguous: false, reason: null, clocks };
  }
  if (clocks.length > 1) return { time: null, ambiguous: true, reason: 'rival-clocks', clocks };
  return { time: null, ambiguous: false, reason: loggedClock ? 'log-clock-only' : 'none', clocks };
}

function evidenceTimestamp(text) {
  return readEvidenceTime(text).time;
}

/**
 * The evidence rule. An ask that costs money or cannot be undone must arrive
 * with the check that establishes it — see costlyAsk.js for the incident.
 *
 * Three things are demanded, and all three are mechanical:
 *
 *   1. the COMMAND or request, in runnable form — a fenced block, which is
 *      also the only verbatim form ClickUp is known to keep intact;
 *   2. its ACTUAL OUTPUT, pasted rather than summarised — so the fence has to
 *      hold more than the one command line. A command with nothing underneath
 *      it is a claim about what would happen, which is what went wrong;
 *   3. WHEN it was run, in the operator's clock. Evidence gathered before a
 *      sixteen-hour outage is not evidence about now.
 *
 * What is deliberately NOT checked: whether the evidence is CORRECT. That is
 * a reasoning task and it belongs to the reader. This gate only enforces that
 * a costly ask arrives with a reproducible check and the time it was run.
 */
function evidenceProblems(card) {
  const problems = [];
  const triggers = costlyTriggers(card.needed);
  const evidence = String(card.evidence || '').trim();

  if (!triggers.length) {
    // An ordinary ask is untouched — including one that volunteered evidence.
    // Narrowness is the value: a gate that fires on everything gets routed
    // around, and then it protects nothing.
    if (!evidence) return problems;
  } else if (!evidence) {
    problems.push(
      `@@EVIDENCE is missing, and this ask is a costly one: ${describeTriggers(triggers)}.\n` +
      '  An ask that spends money or cannot be undone has to carry the check that proves it —\n' +
      '  the command or request in runnable form, its ACTUAL output pasted in a fenced block,\n' +
      '  and when you ran it in his clock ("8:04pm"). On 2026-08-23 an agent asked Dane to pay\n' +
      '  for a plan upgrade on a diagnosis that was wrong; re-running the one failing call\n' +
      '  would have settled it in seconds. Re-run it now and paste what it says.',
    );
    return problems;
  }

  // From here the section exists, so its SHAPE is checked — for a costly ask
  // because it is owed, and for a volunteered one because half-evidence is
  // more misleading than none.
  const { blocks } = splitFences(evidence);
  const filled = blocks.filter((lines) => lines.some((line) => line.trim()));
  // Counted ACROSS the fences, not within one. The clearer layout puts the
  // command in its own fence and the output in a second, and the first version
  // of this rule told that author "you showed a command with no output" — which
  // was false. A gate that misdiagnoses good input is one people route around,
  // and then it protects nothing.
  const pastedLines = filled.reduce((total, lines) => total + contentLines(lines).length, 0);
  if (!filled.length) {
    problems.push(
      '@@EVIDENCE has no fenced block. Put the command and its output inside ``` fences:\n' +
      '  a fence is the only form ClickUp is known to keep verbatim, and verbatim is the\n' +
      '  whole point — a summary of the output is the judgment this gate exists to skip.',
    );
  } else if (pastedLines < 2) {
    problems.push(
      '@@EVIDENCE shows a command with no output under it. Paste what it actually printed,\n' +
      '  not what it should print — the 2026-08-23 escalation was wrong precisely because\n' +
      '  nobody re-ran the failing call before asking him to pay for the diagnosis.\n' +
      '  One fence holding both, or one for the command and one for its output, both count.',
    );
  }

  const timing = readEvidenceTime(evidence);
  if (!timing.time) {
    if (timing.reason === 'rival-measurements') {
      // Two times, both written as though they were the run. Ranking them by
      // position is what rounds 1-3 each tried, and each ranking was wrong on
      // the next sentence somebody wrote — so this asks instead.
      problems.push(
        '@@EVIDENCE marks more than one time as the run, and the card can only show one.\n' +
        '  "I re-ran it at 9:40pm, after checking at 3:12pm" gives the heading two answers, and\n' +
        '  the heading is the one place this card ASSERTS something rather than asking for it —\n' +
        '  a wrong "measured at" is a false statement about a live system. Leave one time\n' +
        '  marked as the measurement: "measured at 9:40pm", and say the rest without a cue.',
      );
    } else if (timing.reason === 'unmarked-beside-log') {
      // One bare prose clock and a clock in the output too. The docstring used
      // to say a lone clock has "nothing to confuse it with"; here it does.
      problems.push(
        '@@EVIDENCE has one time in the prose and another inside the pasted block, and nothing\n' +
        '  says which one you ran it at. A bare time next to a log is usually the thing that\n' +
        '  BROKE rather than the check — "the channel began refusing at 3:12pm" over output\n' +
        '  stamped 8:04pm would date this card by the outage. Mark the run explicitly:\n' +
        '  "re-ran it at 8:04pm", or "measured at 8:04pm".',
      );
    } else if (timing.reason === 'rival-clocks') {
      problems.push(
        '@@EVIDENCE has more than one time in it, and nothing says which one you actually ran\n' +
        '  it at. The card puts that time in its heading ("measured at ..."), so a wrong one is\n' +
        '  worse than none — an outage time read as a measurement is what makes a stale proof\n' +
        '  look fresh. Mark the run: "re-ran it at 8:04pm", or "measured at 8:04pm".',
      );
    } else if (timing.reason === 'log-clock-only') {
      // The section HAS a clock, but it is the log's, not the author's — the
      // exact confusion that would otherwise date the card by whatever the
      // output happened to print. See readEvidenceTime.
      problems.push(
        '@@EVIDENCE has a time in it, but only inside the pasted block — that is the LOG\'s\n' +
        '  clock, not yours, and it is what the output happened to print rather than when you\n' +
        '  ran it. A log line from last week would date this card as measured last week.\n' +
        '  Say when YOU ran it, in prose outside the fences: "measured at 8:04pm".',
      );
    } else {
      problems.push(
        '@@EVIDENCE carries no time it was run. Add it in his clock — "measured at 8:04pm",\n' +
        '  dated if it was not today, in prose outside the fenced block. Evidence gathered\n' +
        '  before a sixteen-hour outage is not evidence about now, and a stale proof has to\n' +
        '  be visible rather than implied.',
      );
    }
  }
  return problems;
}

/**
 * The 1-based line numbers that start a markdown blockquote. Lines inside a
 * fenced block are exempt — a fence is literal, so a `>` in there is safe and
 * is often exactly what someone means to show.
 */
function findBlockquoteLines(text) {
  const found = [];
  let fenced = false;
  String(text || '').split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (!fenced && /^\s*>/.test(line)) found.push(i + 1);
  });
  return found;
}

/**
 * Did the card actually survive the trip? Compares the operator's words, as
 * ClickUp read them back, against what was sent. Returns a problem sentence,
 * or null when the words are intact.
 *
 * This is the check that caught the blockquote bug. It stays because the next
 * thing ClickUp silently swallows will not announce itself either.
 */
function cardSurvived(card, savedText) {
  const flatten = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const asked = flatten(card.asked);
  if (!asked) return null;
  if (flatten(savedText).includes(asked)) return null;
  return (
    "The card posted, but the operator's own words did NOT survive it. ClickUp read back a\n" +
    'comment that does not contain @@ASKED. That is the one part of a card nobody can\n' +
    'reconstruct later — fix the formatting and post it again before relying on this ticket.'
  );
}

/** The card as it will read in ClickUp's right-hand column. */
function renderCard(card) {
  const parts = [
    "**DANE'S WORDS — the instruction behind this ticket**",
    '',
    // Fenced, not blockquoted: see the note at the top of this file. A fence
    // is the only form ClickUp keeps that also leaves the contents
    // uninterpreted, and "verbatim" is the whole promise of this section.
    '```',
    card.asked,
    '```',
  ];
  if (card.when) parts.push('', `*(${card.when})*`);
  parts.push(
    '',
    "**WHAT'S GOING ON**",
    '',
    card.context,
    '',
    '```',
    BANNER_RULE,
    BANNER_LABEL,
    BANNER_RULE,
    '```',
    '',
    card.needed,
    '',
  );
  if (card.evidence) {
    // Under the ask, not above it: he reads what is being asked of him first,
    // then the proof it rests on. The measurement time goes in the HEADING
    // rather than being left inside the paste, so a stale proof is visible at
    // a glance instead of implied — that is the half of the 2026-08-23 failure
    // that survives even when evidence is attached.
    const when = evidenceTimestamp(card.evidence);
    parts.push(
      '',
      `**THE CHECK BEHIND THIS ASK${when ? ` — measured at ${when}` : ''}**`,
      '',
      card.evidence,
      '',
    );
  }
  return parts.join('\n');
}

/**
 * Parse + validate + render in one call. Throws with every problem listed.
 * Returns both the rendered text and the parsed card, because the caller needs
 * the parsed `asked` again after posting, to run `cardSurvived` against what
 * ClickUp actually stored.
 */
function buildCard(text) {
  const card = parseCard(text);
  const problems = validateCard(card);
  if (problems.length) {
    throw new Error(
      `The card is not in the required shape:\n\n- ${problems.join('\n- ')}\n\n` +
      'Nothing was posted and no status was moved.',
    );
  }
  return { card, rendered: renderCard(card) };
}

module.exports = {
  MARKERS,
  CLOCK,
  evidenceTimestamp,
  evidenceClocks,
  readEvidenceTime,
  MEASUREMENT_CUES,
  splitFences,
  fencedBlocks,
  contentLines,
  evidenceProblems,
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
};
