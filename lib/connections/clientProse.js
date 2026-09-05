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
 * The longest a cause may be and still be a sentence on a card.
 *
 * Measured, not guessed. The longest prose the sweep itself composes is the
 * identity-drift sentence with two full Bluesky handles in it — 189 characters
 * ("This connection was saved as delray-beach-tennis-center.bsky.social and now
 * authenticates as …"). The 409 branch then appends "(it was saved as X.)" to
 * an adapter's own sentence, which is shorter. 300 clears every one of those
 * with room to spare, and a raw gateway error page — the thing this exists to
 * stop — is thousands.
 *
 * Length alone would NOT have caught the round-2 defect: the 502 page arriving
 * on the connect path measured 165 characters, comfortably inside this limit.
 * The markup test below is what catches that one, and the two are kept together
 * because each covers what the other misses.
 */
const MAX_CAUSE_LENGTH = 300;

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
 *   length   — longer than any sentence the sweep composes (see above)
 */
function readsAsClientProse(text) {
  const trimmed = safeText(text).trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_CAUSE_LENGTH) return false;
  // A doctype, or an opening/closing tag. Deliberately narrow: a bare "<" or a
  // stray ">" is arithmetic or an arrow and appears in ordinary prose ("the
  // grant has < 24 hours left"), so only "<" immediately followed by a letter,
  // "/" or "!" counts as markup.
  if (/<[a-zA-Z!/]/.test(trimmed)) return false;
  return true;
}

module.exports = {
  MAX_CAUSE_LENGTH,
  readsAsClientProse,
};
