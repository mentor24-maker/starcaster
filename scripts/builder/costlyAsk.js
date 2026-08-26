'use strict';

/**
 * Does this ask cost the operator MONEY, or something he cannot undo?
 *
 * WHY THIS EXISTS (2026-08-23). An agent escalated to Dane and asked him to
 * spend money on a diagnosis that was wrong. The bus chat channel had been
 * refusing every write for sixteen hours; a custom-field write failed the same
 * day with "Custom field usages exceeded for your plan"; the agent read
 * `GET /team/{id}/plan` back as `Free Forever`, joined the three, and wrote it
 * up with a clean evidence table and three options — option A being "put the
 * workspace back on a paid plan". Confident, well argued, and in his inbox.
 *
 * It was wrong. Re-measured hours later on the SAME token and the SAME
 * unchanged Free plan: chat POST 200 and verified in the channel, custom-field
 * write verified by read-back. The plan was Free before, during and after.
 * Paying would have fixed nothing; the outage was transient and cleared itself.
 *
 * The mistake was not the hypothesis — a plausible correlation on the day two
 * features broke is reasonable. It was that the hypothesis reached the
 * operator's WALLET without anyone re-running the failing call. One command
 * would have settled it, and the escalation was the last moment it was cheap
 * to run and the first moment being wrong was expensive.
 *
 * So the gate is deliberately NOT a checking agent. A general
 * assumption-checker adds a round trip, makes assertions of its own, and burns
 * tokens continuously to catch a class a free rule catches — and the evidence
 * for "assertions of its own" is this very incident, where the agent that
 * produced the wrong diagnosis was already the careful one. This is cheap,
 * narrow and mechanical: it fires only on asks that cost money or cannot be
 * undone, and it demands a command and its output rather than a judgment.
 *
 * Narrowness is the whole value. A gate that fires on every escalation gets
 * routed around, and then it protects nothing — so an ordinary ask (a design
 * question, a scope choice, an A-or-B with no cost) must sail through
 * untouched, and there is a test pinning exactly that.
 */

/**
 * The trigger words, each with the reason it is here. Adding one is a one-line
 * change with a test beside it — that is the contract this list is shaped for.
 *
 * `word` is matched case-insensitively on whole-word boundaries, so `spend`
 * does not fire on `spending` — every form that should fire is listed
 * explicitly rather than stemmed. Stemming is where a list like this quietly
 * grows a reach nobody reviewed.
 *
 * That explicitness has a cost, and it was paid once already: the first
 * version of this list carried the base and gerund forms but no THIRD-PERSON
 * ones, and review (2026-08-26) found that "this deletes all 550 rows", "it
 * rotates the key" and "approving this upgrades the workspace" all posted with
 * no evidence at all. Third person is how an approval is most naturally
 * phrased — the agent describes what the operator's yes will do — so every
 * verb here now carries its `-s` form beside its base and gerund. When you add
 * a verb, add all three.
 *
 * `class` is one of:
 *   money         — he is being asked to part with money
 *   plan          — an account or subscription level changes
 *   irreversible  — it cannot be taken back once he does it
 */
const TRIGGERS = [
  // ---- money -------------------------------------------------------------
  { word: 'spend', class: 'money', why: 'the plainest form of the ask that started this: "spend money on X".' },
  { word: 'spending', class: 'money', why: 'the gerund form of the same ask — "spending on a paid plan".' },
  { word: 'spends', class: 'money', why: 'third person: "this spends the rest of the month\'s budget".' },
  { word: 'buy', class: 'money', why: 'a purchase is money out with no re-measurement in between.' },
  { word: 'buying', class: 'money', why: 'the gerund reads as an ask in progress — "buying the seat now".' },
  { word: 'buys', class: 'money', why: 'third person: "approving this buys another seat".' },
  { word: 'purchase', class: 'money', why: 'the noun and verb both read as an instruction to pay.' },
  { word: 'purchases', class: 'money', why: 'third person, and the plural noun: "it purchases two more seats".' },
  { word: 'subscribe', class: 'money', why: 'a subscription is recurring money, so a wrong diagnosis keeps costing.' },
  { word: 'subscribes', class: 'money', why: 'third person: "this subscribes the workspace to the paid tier".' },
  { word: 'subscription', class: 'money', why: 'the noun names the recurring charge itself — "start a subscription".' },
  { word: 'pay', class: 'money', why: 'direct. Innocent uses ("pay attention") are stripped before matching.' },
  { word: 'paying', class: 'money', why: 'the gerund is how an ask is softened — "it means paying for the tier".' },
  { word: 'pays', class: 'money', why: 'third person: "this pays for a year up front". "Pays off" is stripped first.' },
  { word: 'payment', class: 'money', why: 'authorising a payment is the moment the money leaves.' },
  { word: 'billing', class: 'money', why: 'a billing change is a money change wearing an administrative name.' },
  { word: 'invoice', class: 'money', why: 'an invoice to approve is a bill to pay.' },
  { word: 'costs', class: 'money', why: 'the commonest third-person money sentence: "it costs $29 a month". "Costs nothing" is stripped first.' },

  // ---- plan / account level ---------------------------------------------
  { word: 'upgrade', class: 'plan', why: 'the exact word in the 2026-08-23 escalation. Upgrades cost money monthly.' },
  { word: 'upgrading', class: 'plan', why: 'the gerund is how the ask usually arrives — "upgrading would fix it".' },
  { word: 'upgrades', class: 'plan', why: 'third person: "approving this upgrades the workspace to Business".' },
  { word: 'downgrade', class: 'plan', why: 'the other direction is not free either — it can drop data or limits.' },
  { word: 'downgrades', class: 'plan', why: 'third person, and the same loss of data or limits.' },
  { word: 'paid plan', class: 'plan', why: 'the literal phrase option A used. Bare "plan" is far too common to match.' },
  { word: 'plan change', class: 'plan', why: 'names the act directly, without saying which direction.' },

  // ---- irreversible ------------------------------------------------------
  { word: 'delete', class: 'irreversible', why: 'a deletion done on a wrong diagnosis cannot be undone by re-measuring.' },
  { word: 'deleting', class: 'irreversible', why: 'the gerund describes the act mid-proposal — "deleting the stale rows".' },
  { word: 'deletion', class: 'irreversible', why: 'the noun is the administrative spelling — "approve the deletion".' },
  { word: 'deletes', class: 'irreversible', why: 'third person: "this deletes all 550 untenanted rows".' },
  { word: 'rotate', class: 'irreversible', why: 'rotating a credential breaks every consumer of the old one at once.' },
  { word: 'rotating', class: 'irreversible', why: 'the gerund form — "rotating it will fix the 401" — is the same request.' },
  { word: 'rotation', class: 'irreversible', why: 'the noun form of the same act — "authorise the key rotation".' },
  { word: 'rotates', class: 'irreversible', why: 'third person: "it rotates CHANNELS_ENCRYPTION_KEY".' },
  { word: 'revoke', class: 'irreversible', why: 'a revoked token cannot be un-revoked; it can only be re-minted.' },
  { word: 'revokes', class: 'irreversible', why: 'third person: "this revokes the old publishable key".' },
  { word: 'migrate', class: 'irreversible', why: 'a database migration rewrites rows; the down path is rarely tested.' },
  { word: 'migration', class: 'irreversible', why: 'same, noun — "run the migration" is an operator action here.' },
  { word: 'migrates', class: 'irreversible', why: 'third person: "this migrates every page to the new schema".' },
  { word: 'force-push', class: 'irreversible', why: 'rewrites shared history; a standing deny rule in this repo already.' },
  { word: 'force push', class: 'irreversible', why: 'the same act, spelled without the hyphen.' },
  { word: 'wipe', class: 'irreversible', why: 'no partial wipe — it is all of it, and then it is gone.' },
  { word: 'wipes', class: 'irreversible', why: 'third person, and the same absence of a partial.' },
  { word: 'purge', class: 'irreversible', why: 'as above, and usually applied to the backup as well.' },
  { word: 'purges', class: 'irreversible', why: 'third person: "it purges the archive too".' },
  { word: 'truncate', class: 'irreversible', why: 'empties a table with no row-level undo.' },
  { word: 'truncates', class: 'irreversible', why: 'third person: "this truncates observe_usage_logs".' },
];

/**
 * Phrases that contain a trigger word but ask for nothing costly. They are
 * removed from the text BEFORE matching, so "pay attention to the second
 * column" does not demand a command and its output.
 *
 * Keep this list short and obvious. It is an escape hatch, and a long escape
 * hatch is a hole: anything genuinely ambiguous should fire and be answered
 * with evidence, which costs one paste.
 */
const INNOCENT_PHRASES = [
  'pay attention',
  'pays attention',
  'pays off',
  'paying attention',
  'paying off',
  // "costs" earns its place on "it costs $29 a month", but the same word is
  // how an agent says an option is free. Both spellings of that, and nothing
  // more — anything genuinely ambiguous should fire and be answered with a
  // paste.
  'costs nothing',
  'costs you nothing',
];

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A whole-word, whitespace-flexible matcher for one trigger. Multi-word
 * triggers ("paid plan") tolerate a line break between the words, because a
 * card wrapped by an editor should read the same as one that was not.
 */
function triggerPattern(word) {
  const body = String(word).trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  // \b would not fire next to a hyphen, so "force-push" is bounded by
  // "not a word character or hyphen" on each side instead.
  return new RegExp(`(^|[^\\w-])${body}($|[^\\w-])`, 'i');
}

/**
 * Which triggers does this ask contain? Returns the matched trigger entries,
 * in list order, deduplicated by word. An empty array means an ordinary ask.
 */
function costlyTriggers(text) {
  let haystack = String(text || '').toLowerCase();
  for (const phrase of INNOCENT_PHRASES) {
    haystack = haystack.split(phrase).join(' ');
  }
  // A bare dollar amount is a money ask however it is phrased — "$25/month",
  // "$0.02 a call". It has no word form to list, so it is matched separately.
  const matches = TRIGGERS.filter((trigger) => triggerPattern(trigger.word).test(haystack));
  if (/\$\s?\d/.test(haystack)) {
    matches.unshift({ word: '$ amount', class: 'money', why: 'a figure in dollars is a money ask whatever words surround it.' });
  }
  return matches;
}

/** True when this ask costs money or cannot be undone. */
function isCostlyAsk(text) {
  return costlyTriggers(text).length > 0;
}

/** "spend, upgrade (money, plan)" — for naming the reason in a refusal. */
function describeTriggers(triggers) {
  const words = triggers.map((t) => t.word);
  const classes = [...new Set(triggers.map((t) => t.class))];
  return `${words.join(', ')} (${classes.join(', ')})`;
}

module.exports = {
  TRIGGERS,
  INNOCENT_PHRASES,
  triggerPattern,
  costlyTriggers,
  isCostlyAsk,
  describeTriggers,
};
