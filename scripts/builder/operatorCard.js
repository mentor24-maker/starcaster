'use strict';

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

/** The three (plus one optional) sections of the authored input. */
const MARKERS = ['ASKED', 'WHEN', 'CONTEXT', 'NEEDED'];

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
 * `@@WHEN` is optional. Anything before the first marker is an error rather
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

  for (const name of ['asked', 'context', 'needed']) {
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
