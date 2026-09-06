'use strict';

/**
 * lib/connections/clientProse.js
 * ONE definition of "is this text fit for a client to read off a card".
 *
 * Connections 6b of 7 (86bbu50mb). It lives here rather than in either caller
 * because BOTH halves of that slice need it and they are in different files:
 *
 *   routes/connections.js   the STORED cause — `last_error`, written by the
 *                           verify sweep, rendered on an amber card
 *   routes/engage.js        the CARRIED cause — `connect_error` on the return
 *                           URL after a refused connect, rendered against the
 *                           card for that provider
 *
 * Round 1 of review found a raw 502 HTML page reaching a client on the first of
 * those, and round 2 found the identical defect on the second — because the
 * gate had been written inside the route that needed it first. A predicate
 * copied into the second caller would drift the first time either is tuned, so
 * there is one copy and both require it.
 *
 * ── What this is NOT ───────────────────────────────────────────────────────
 *
 * It is not a sanitiser and it must never become one. Acceptance criterion 5 of
 * the slice says the sentence a client reads is the platform's own words; so
 * the only two outcomes are "through, untouched" and "dropped for the generic
 * line the caller already has". There is no middle setting where we edit a
 * platform's wording into something we like better.
 */

/**
 * How long a cause may be and still be a sentence on a card — PER PATH.
 *
 * ── Why this is a table and not one number ─────────────────────────────────
 *
 * It was one number, 300, and round 3 of review sent the ticket back for it.
 * The 300 was honestly measured — against the SWEEP's longest sentence. Round 2
 * then pointed the same predicate at the CONNECT path without re-measuring, and
 * the connect path composes prose that is far longer, so an ordinary Instagram
 * refusal was silently replaced by "Instagram refused the connection" — which
 * is acceptance criterion 5 broken by the fix for criterion 5.
 *
 * The lesson is not "300 was too small". It is that a limit measured on one
 * path is evidence about that path only, and a single shared number invites
 * exactly the substitution that happened. So each path states its own measured
 * value here, and `readsAsClientProse` REFUSES to run without being told which
 * path it is on — see the throw below. A default would have re-created the
 * defect: round 2's mistake was a value silently applying where it was never
 * measured, and a default is that mistake spelled as a language feature.
 *
 * ── stored: 300 ───────────────────────────────────────────────────────────
 *
 * The longest prose the sweep itself composes is the identity-drift sentence
 * with two full Bluesky handles in it — 189 characters ("This connection was
 * saved as delray-beach-tennis-center.bsky.social and now authenticates as …").
 * The 409 branch then appends "(it was saved as X.)" to an adapter's own
 * sentence, which is shorter. 300 clears every one of those with room to spare.
 * Unchanged, because nothing about the sweep moved.
 *
 * ── connect: 1000 ─────────────────────────────────────────────────────────
 *
 * Measured on 2026-09-05 against what the adapters can actually compose at
 * their fields' real limits, not against a sample:
 *
 *   x.js          notConfigured, incl. the callback URL          470  (fixed)
 *   instagram.js  noPageToken + a 75-char Page name              381
 *   instagram.js  personal + a 30-char handle + 75-char Page     343
 *   instagram.js  notLinked + ONE 75-char Page name              325
 *   x.js          noRefreshToken                                 267  (fixed)
 *   instagram.js  noPages                                        217  (fixed)
 *
 * 470 is the longest sentence with a FIXED ceiling. The limit is not 470,
 * because one branch has no fixed ceiling at all: `instagram.js` notLinked
 * lists EVERY Page the client manages, growing 79 characters per Page at
 * Facebook's 75-character Page-name limit. There is no worst case to measure
 * there, so 1000 is a stated design ceiling and this is what it buys:
 *
 *   9 Pages at Facebook's maximum 75-character name    958   clears
 *   10 Pages at that maximum                          1037   does NOT
 *   20 Pages at a realistic 25-character name          827   clears
 *
 * Past that the sentence is dropped for the caller's generic line — the same
 * behaviour as today, on a case far rarer than the ordinary one that is broken
 * today. Raising it further trades away the only thing the length half does.
 *
 * ── What the length half is actually for ──────────────────────────────────
 *
 * Not much, and knowing that is what makes 1000 affordable. The gateway page
 * this file exists to stop measured 165 characters on the connect path — inside
 * even the 300 — so the MARKUP test is what catches it, at any limit. Length is
 * the backstop for a blob carrying no tags: a JSON body, a stack trace, a
 * plain-text dump. Those run to kilobytes, so 1000 stops them just as well as
 * 300 did, while 300 was demonstrably stopping real sentences too.
 */
const CAUSE_LIMITS = Object.freeze({
  stored: 300,
  connect: 1000,
});

function safeText(value) {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Is this cause something a client can actually read off a card?
 *
 * A cause is not always prose. It is whatever an adapter put in `error`, and
 * `lib/connections/adapters/facebookPage.js` `fetchJson` demonstrably falls
 * back to the ENTIRE raw response body when it will not parse as JSON — which
 * for a gateway 502 is an HTML page. A client's card then reads
 * "<!DOCTYPE html><html><head><title>502 Bad Gateway</title>… Reconnect to fix
 * it." That is landmine 16: internal text on a surface a client reads.
 *
 * That function is on BOTH paths. The sweep calls it through `verify`, which is
 * what round 1 of review caught; `exchange() -> completeOAuthCodeExchange() ->
 * exchangeCodeForToken() -> fetchJson()` is the connect path, which is what
 * round 2 caught still open.
 *
 * The test is about what the text IS, not about what it says. Two structural
 * disqualifications, both of which real prose passes:
 *   markup   — a tag or a doctype, which no sentence written for a client has
 *   length   — longer than any sentence THAT PATH composes (see CAUSE_LIMITS)
 *
 * @param {string} text  the recorded or carried cause
 * @param {'stored'|'connect'} path  which surface this text is bound for.
 *   Required, and an unknown value throws rather than defaulting. This is the
 *   whole guard against round 3's defect: a caller that does not say which path
 *   it is on cannot silently inherit a limit measured somewhere else. It is a
 *   programming error, not client data — both call sites are covered by tests,
 *   so it fails on the first run rather than in front of a client.
 */
function readsAsClientProse(text, path) {
  const limit = CAUSE_LIMITS[path];
  if (typeof limit !== 'number') {
    throw new TypeError(
      `readsAsClientProse needs to be told which path it is on: ${
        Object.keys(CAUSE_LIMITS).join(' or ')}, got ${JSON.stringify(path)}. `
      + 'Each path has its own measured limit and neither may be inherited by accident.'
    );
  }
  const trimmed = safeText(text).trim();
  if (!trimmed) return false;
  if (trimmed.length > limit) return false;
  // A doctype, or an opening/closing tag. Deliberately narrow: a bare "<" or a
  // stray ">" is arithmetic or an arrow and appears in ordinary prose ("the
  // grant has < 24 hours left"), so only "<" immediately followed by a letter,
  // "/" or "!" counts as markup.
  if (/<[a-zA-Z!/]/.test(trimmed)) return false;
  return true;
}

module.exports = {
  CAUSE_LIMITS,
  readsAsClientProse,
};
