'use strict';

/**
 * Outreach wizard 9/19 (task 86bcrmbke) — THREE replies to choose from, in
 * one AI call, for any channel. Reddit uses it first
 * (lib/redditCommentDrafter.js); YouTube (10/19) and Substack (11/19) will
 * pass their own prompt and their own rule check through the same function,
 * so the three channels cannot disagree about what "three options" means.
 *
 * One call asks for `count` replies, each with a short angle label ("adds a
 * personal story", "asks a question back", "offers a resource"). EACH is
 * checked against the channel's rules on its own. An option that breaks one
 * is asked for again ONCE, with the broken rule named; if the replacement
 * breaks one too, that option is DROPPED with its reason and the rest are
 * shown. A dropped option is never replaced by a weaker one — two good
 * options beat three where one is padding (the ticket's own words).
 *
 * The AI call is `generate(system, prompt)` → { ok, text, error }; the caller
 * supplies it (tests pass a stand-in). `check(text)` → { ok, problems:
 * [{ rule, message }] } is the channel's rule check, never trusted to the
 * prompt.
 */

/** How many replies a card offers. */
const OPTION_COUNT = 3;

/** The longest an angle label may be — it is a few words on a card, not a sentence. */
const MAX_ANGLE_LENGTH = 60;

/** The approaches the prompt offers as examples. The model may choose others. */
const EXAMPLE_ANGLES = Object.freeze(['adds a personal story', 'asks a question back', 'offers a resource']);

function safeText(value, max = 20000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];

function countWord(n) {
  return NUMBER_WORDS[n] || String(n);
}

/** The instruction every channel's system message ends with. Pure — tested directly. */
function optionsInstruction(count = OPTION_COUNT) {
  return [
    `Write ${count} different replies, each taking a clearly different approach — for example one that ${EXAMPLE_ANGLES.join(', one that ')}.`,
    'Give each a short label of a few words naming its approach.',
    `Reply with JSON only, exactly {"options": [{"angle": "<its approach, a few words>", "text": "<the reply>"}, …]} with ${count} entries.`,
  ].join('\n');
}

/**
 * The options out of the model's reply: `{"options": [...]}`, fenced or bare,
 * or a bare array. Anything unreadable is an empty list, never a guess.
 */
function parseOptions(text, maxLength = 20000) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.options) ? parsed.options : [];
  return list
    .filter((o) => o && typeof o === 'object')
    .map((o) => ({ angle: safeText(o.angle, MAX_ANGLE_LENGTH), text: safeText(o.text, maxLength + 1) }));
}

function describeProblems(problems) {
  return problems.map((p) => p.message).join('; ');
}

/** "One option was dropped: it names Dane of Earth." — what the card says about the missing ones. */
function droppedSentence(dropped) {
  const list = Array.isArray(dropped) ? dropped : [];
  if (!list.length) return '';
  const reasons = list.map((d) => d.reason).filter(Boolean);
  const head = `${countWord(list.length)} option${list.length === 1 ? ' was' : 's were'} dropped`;
  return reasons.length ? `${head}: ${reasons.join('; ')}.` : `${head}.`;
}

function checkOne(option, check) {
  if (!option || !option.text) {
    return { ok: false, problems: [{ rule: 'empty', message: 'the AI wrote no reply for it' }] };
  }
  const checked = check(option.text) || { ok: false, problems: [{ rule: 'unchecked', message: 'it could not be checked' }] };
  return { ok: Boolean(checked.ok), problems: Array.isArray(checked.problems) ? checked.problems : [] };
}

/**
 * Write `count` options. Returns
 *   { ok: true, data: { options: [{ text, angle, rule: { ok: true } }], dropped: [{ angle, reason, problems }] } }
 * or a refusal: 502 when the AI did not answer at all, 422 when every option
 * was dropped (each reason named).
 */
async function writeOptions({ system, prompt, check, generate, count = OPTION_COUNT, maxLength = 20000 }) {
  if (typeof generate !== 'function') throw new Error('writeOptions needs a generate function');
  if (typeof check !== 'function') throw new Error('writeOptions needs a check function');
  const fullSystem = `${system}\n\n${optionsInstruction(count)}`;

  const first = await generate(fullSystem, prompt);
  if (!first?.ok) {
    return { ok: false, status: 502, error: `The AI did not write any replies: ${safeText(first?.error, 300) || 'no answer'}` };
  }
  // Exactly `count` slots: a missing one counts as broken and is asked for again.
  const slots = parseOptions(first.text, maxLength).slice(0, count);
  while (slots.length < count) slots.push(null);
  const results = slots.map((option) => ({ option, checked: checkOne(option, check) }));

  const failing = results.map((r, i) => (r.checked.ok ? -1 : i)).filter((i) => i >= 0);
  if (failing.length) {
    const kept = results.filter((r) => r.checked.ok).map((r) => r.option);
    const broken = failing.map((i) => {
      const label = results[i].option?.angle ? ` ("${results[i].option.angle}")` : '';
      return `option ${i + 1}${label}: ${describeProblems(results[i].checked.problems)}`;
    });
    const ask = [
      prompt,
      '',
      `These replies broke the rules — ${broken.join('; ')}.`,
      `Write ${failing.length} new ${failing.length === 1 ? 'reply' : 'replies'} to replace ${failing.length === 1 ? 'it' : 'them'}, keeping every rule.`,
      kept.length ? `Take a different approach from the ones already kept: ${kept.map((o) => `"${o.angle || 'unlabelled'}"`).join(', ')}.` : '',
      `Reply with JSON only, exactly {"options": [...]} with ${failing.length} ${failing.length === 1 ? 'entry' : 'entries'}.`,
    ].filter(Boolean).join('\n');
    const retry = await generate(fullSystem, ask);
    const replacements = retry?.ok ? parseOptions(retry.text, maxLength) : [];
    failing.forEach((slot, n) => {
      if (!retry?.ok) {
        results[slot].retryError = `the second try could not be written (${safeText(retry?.error, 200) || 'no answer'})`;
        return;
      }
      const option = replacements[n] || null;
      results[slot] = { option, checked: checkOne(option, check), previous: results[slot] };
    });
  }

  const options = [];
  const dropped = [];
  for (const r of results) {
    if (r.checked.ok) {
      options.push({ text: r.option.text, angle: r.option.angle, rule: { ok: true } });
    } else {
      const angle = r.option?.angle || r.previous?.option?.angle || '';
      const reason = r.retryError || describeProblems(r.checked.problems);
      dropped.push({ angle, reason, problems: r.checked.problems });
    }
  }

  if (!options.length) {
    return {
      ok: false,
      status: 422,
      error: `Every reply broke a rule, so none was kept: ${dropped.map((d) => d.reason).join('; ')}.`,
      problems: dropped.flatMap((d) => d.problems),
      dropped,
    };
  }
  return { ok: true, status: 200, data: { options, dropped } };
}

module.exports = {
  OPTION_COUNT,
  EXAMPLE_ANGLES,
  optionsInstruction,
  parseOptions,
  droppedSentence,
  writeOptions,
};
