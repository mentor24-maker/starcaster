'use strict';

/**
 * Outreach wizard 8/19 (task 86bcrmbje) — Dane of Earth's canon, turned into
 * what a drafter needs, in ONE place for all three channels. Reddit wrote this
 * first (lib/redditCommentDrafter.js, task 86bch3jp3); YouTube and Substack
 * used only a free-text "voice" setting, so the three did not sound like the
 * same person. Now every drafter reads the canon through here.
 *
 * What the canon gives a draft:
 *   - VOICE            how Dane writes — followed, in the system message
 *   - AIISM-BLOCKLIST  phrases he never uses — in the prompt AND checked in
 *                      code (`blocklistProblem`), never trusted to the prompt
 *   - everything else  his thesis documents, as background only
 *
 * NO CANON, NO DRAFT. With nothing copied (or VOICE or the blocklist missing)
 * `prepareCanon` refuses with "no canon copied yet — run npm run canon:sync",
 * and a drafter returns that refusal rather than writing without it.
 */

/** Canon documents a draft cannot be written without: his voice, and the banned phrases. */
const REQUIRED_CANON = Object.freeze(['VOICE', 'AIISM-BLOCKLIST']);

const NO_CANON_ERROR = 'no canon copied yet — run npm run canon:sync';

/** The hard-rule line every drafter's prompt carries. */
const BLOCKLIST_RULE = 'Never use any phrase or sentence shape the AI-ism blocklist below fences off.';

function safeText(value, max = 20000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The entries of `avoidWords` that `text` contains, as whole words, ignoring
 * case. One matcher for the blocklist and for every account's own
 * words-to-avoid list, so the channels cannot disagree about what a match is.
 */
function findAvoidedWords(text, avoidWords) {
  const body = String(text || '');
  return (Array.isArray(avoidWords) ? avoidWords : [])
    .map((word) => String(word || '').trim())
    .filter(Boolean)
    .filter((word) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'iu').test(body));
}

/**
 * The phrases the AI-ism blocklist fences off, read out of the canon copy of
 * wiki/aiism-blocklist.md: every quoted entry in the first column of the
 * "FENCE" and "RESTRICTED VOCABULARY" tables. RATION entries are allowed at a
 * frequency and NOT-AN-AIISM entries are allowed, so neither is read.
 *
 * Quotes inside parentheses are examples of a family, not the phrase itself
 * ("(and the "lives in / rests on" metaphor family)"), so they are skipped,
 * as is a template like "the X that matters". Leading/trailing dots and
 * sentence punctuation are trimmed: "...that matters" fences "that matters".
 */
function parseBlocklist(markdown) {
  const phrases = [];
  let section = '';
  for (const line of String(markdown || '').split('\n')) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      section = heading[1].toUpperCase();
      continue;
    }
    if (!/^(FENCE|RESTRICTED VOCABULARY)\b/.test(section)) continue;
    if (!line.startsWith('|')) continue;
    const cell = line.split('|')[1] || '';
    const beforeAside = cell.split('(')[0];
    for (const m of beforeAside.matchAll(/"([^"]+)"/g)) {
      const phrase = m[1].replace(/^[.\s…]+|[.\s…!?:,;]+$/g, '').trim();
      if (!phrase || /\bX\b/.test(phrase)) continue;
      if (!phrases.some((p) => p.toLowerCase() === phrase.toLowerCase())) phrases.push(phrase);
    }
  }
  return phrases;
}

/**
 * The canon rows (lib/canonStore.js) split into what a draft needs. Returns
 * { ok, voice, blocklistText, blocked, background, used } or a refusal.
 * `used` is what a draft records as `canon_used`.
 */
function prepareCanon(docs) {
  const list = Array.isArray(docs) ? docs.filter((d) => safeText(d?.body)) : [];
  if (!list.length) return { ok: false, status: 409, error: `Not written: ${NO_CANON_ERROR}.`, code: 'NO_CANON' };
  const byKey = new Map(list.map((d) => [d.docKey, d]));
  const missing = REQUIRED_CANON.filter((key) => !byKey.has(key));
  if (missing.length) {
    return {
      ok: false,
      status: 409,
      error: `Not written: the canon has no ${missing.join(' or ')} document — run npm run canon:sync.`,
      code: 'NO_CANON',
    };
  }
  const blocklistText = byKey.get('AIISM-BLOCKLIST').body;
  return {
    ok: true,
    voice: byKey.get('VOICE').body,
    blocklistText,
    blocked: parseBlocklist(blocklistText),
    background: list.filter((d) => !REQUIRED_CANON.includes(d.docKey)),
    used: list.map((d) => ({ docKey: d.docKey, syncedAt: d.syncedAt || null })),
  };
}

/**
 * The canon part of a system message: the voice to follow, the blocklist, and
 * the thesis documents as background. `focus` says what the piece answers
 * instead of the background — Reddit's is "the comment answers THIS post, in
 * its own terms, and never explains or names these ideas".
 */
function canonPromptLines(canon, { focus }) {
  return [
    'HOW DANE WRITES (his voice document — follow it):',
    canon.voice,
    '',
    'THE AI-ISM BLOCKLIST:',
    canon.blocklistText,
    '',
    `BACKGROUND — how Dane thinks. This is background only: it shapes the angle he would take, but ${focus}.`,
    ...canon.background.map((d) => `--- ${d.title || d.docKey} ---\n${d.body}`),
  ];
}

/** The blocklist rule's problem for `text`, or null when it uses none of `blocked`. */
function blocklistProblem(text, blocked) {
  const avoided = findAvoidedWords(text, blocked);
  if (!avoided.length) return null;
  return { rule: 'aiism', message: `it uses ${avoided.map((w) => `"${w}"`).join(', ')}, which ${avoided.length === 1 ? 'is' : 'are'} on the AI-ism blocklist` };
}

/**
 * The canon rows a store drafts or approves with: `options.canonDocs` when a
 * test supplies them, else the project's copy (lib/canonStore.js). A failed
 * read is a refusal starting with `verb` ("Not written", "Not approved") —
 * never an empty canon, which would read as "nothing copied".
 */
async function readCanonDocs(scope, options = {}, verb = 'Not written') {
  if (Array.isArray(options.canonDocs)) return { ok: true, data: options.canonDocs };
  const canon = await require('./canonStore').listCanon(100, scope);
  if (!canon.ok) return { ok: false, status: canon.status || 502, error: `${verb}: the canon could not be read (${canon.error}).` };
  return { ok: true, data: canon.data };
}

/** The SQL that adds `canon_used` to the YouTube and Substack tables. */
const CANON_USED_SQL = 'docs/SQL/outreach_canon_used.sql';

/**
 * A write PostgREST refused because `canon_used` is not on the table yet,
 * turned into a refusal naming the SQL to run; any other result unchanged.
 * Loud on purpose: a draft saved without its canon record is the thing this
 * column exists to rule out.
 */
function explainMissingCanonColumn(res) {
  if (res && !res.ok && /canon_used/.test(String(res.error || ''))) {
    return { ...res, error: `The draft was written but not saved: the canon_used column is missing — run ${CANON_USED_SQL}.` };
  }
  return res;
}

module.exports = {
  CANON_USED_SQL,
  readCanonDocs,
  explainMissingCanonColumn,
  REQUIRED_CANON,
  NO_CANON_ERROR,
  BLOCKLIST_RULE,
  findAvoidedWords,
  parseBlocklist,
  prepareCanon,
  canonPromptLines,
  blocklistProblem,
};
