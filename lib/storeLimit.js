'use strict';

/**
 * One place to turn a caller's `limit` argument into a number a query can use.
 *
 * It exists for the failure in DOCTRINE 5.10: every list function here takes
 * the limit FIRST and the scope second, so `listSources(scope)` puts a scope
 * object where the limit belongs. `Number({}) || 200` is NaN || 200 = 200, so
 * the call succeeds, the scope is never applied, and the caller gets EVERY
 * project's rows back — a tenant leak that looks exactly like a good query.
 *
 * So an object in the limit position is not coerced. It is refused, before any
 * request is made, with a message naming the real mistake.
 */
function resolveLimit(limit, { fallback = 200, max = 1000 } = {}) {
  if (limit !== undefined && limit !== null && typeof limit === 'object') {
    return {
      ok: false,
      error:
        'limit must be a number — an object was passed where the limit goes. ' +
        'These list functions are (limit, scope); calling one as (scope) would ' +
        'silently drop the project filter and return every project\'s rows.',
    };
  }
  if (limit === undefined || limit === null || limit === '') {
    return { ok: true, limit: fallback };
  }
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return { ok: true, limit: fallback };
  return { ok: true, limit: Math.max(1, Math.min(Math.floor(parsed), max)) };
}

module.exports = { resolveLimit };
