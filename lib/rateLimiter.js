'use strict';

/**
 * lib/rateLimiter.js
 * In-memory rate limiter with per-endpoint limits and a global ceiling.
 *
 * ── How it works ──────────────────────────────────────────────────────────
 *
 *   Uses a sliding window counter per (key, ip) pair. Each request increments
 *   the counter; once the limit is hit, requests are rejected with a 429 and
 *   a Retry-After header telling the client when the window resets.
 *
 *   Two tiers:
 *     1. Per-endpoint limit — each route key has its own budget and window.
 *     2. Global ceiling     — a separate counter across ALL API calls combined.
 *        If the global ceiling is hit, ALL endpoints reject until reset.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *
 *   const { checkLimit } = require('../lib/rateLimiter');
 *
 *   // In routes/index.js handleRequest(), before routing:
 *   const limited = checkLimit(req, res, 'global');
 *   if (limited) return;
 *
 *   // In a specific route handler:
 *   const limited = checkLimit(req, res, 'acquire.youtube');
 *   if (limited) return true;
 *
 * ── Limit configuration ───────────────────────────────────────────────────
 *
 *   Edit LIMITS below to tune budgets without touching route code.
 *   Each entry: { max: number, windowMs: number }
 *     max      — max requests allowed in the window
 *     windowMs — rolling window size in milliseconds
 */

// ---------------------------------------------------------------------------
// Limit configuration
// ---------------------------------------------------------------------------

const LIMITS = {
  // ── Global ceiling (all API endpoints combined) ──────────────────────────
  global: {
    max:      500,
    windowMs: 60 * 1000,          // 500 req / minute across everything
  },

  // ── Acquire endpoints (expensive — hit external APIs / scrape the web) ───
  'acquire.youtube': {
    max:      10,
    windowMs: 60 * 1000,          // 10 YouTube acquire runs / minute
  },
  'acquire.youtube.rerun': {
    max:      5,
    windowMs: 60 * 1000,          // 5 reruns / minute
  },
  'acquire.direct': {
    max:      20,
    windowMs: 60 * 1000,          // 20 direct website acquire runs / minute
  },
  'siteImport.jobs': {
    max:      10,
    windowMs: 60 * 1000,          // 10 import jobs queued / minute (staff tool)
  },
  'themeWizard.generate': {
    max:      10,
    windowMs: 60 * 1000,          // 10 rounds / minute — each is 3 model calls
  },
  'acquire.x': {
    max:      10,
    windowMs: 60 * 1000,
  },
  'acquire.reddit': {
    max:      10,
    windowMs: 60 * 1000,
  },

  // ── OpenClaw / external API relay ────────────────────────────────────────
  'openclaw': {
    max:      30,
    windowMs: 60 * 1000,          // 30 relay calls / minute
  },

  // ── Bulk writes ──────────────────────────────────────────────────────────
  'import': {
    max:      10,
    windowMs: 60 * 1000,          // 10 import operations / minute
  },

  // The Images page sweep: each call downloads up to four originals, resizes
  // each into four or five copies, and uploads them. Deliberately generous —
  // the browser walks a whole library through this a few images at a time, and
  // a limit that stops a legitimate sweep halfway is worse than none.
  'assets.renditions': {
    max:      120,
    windowMs: 60 * 1000,          // ~480 images / minute of sustained sweeping
  },

  // ── Credential verification (each call is a live authenticated request to
  //    an outside provider; hammering it can trip THEIR rate limits and make a
  //    working integration look broken) ──────────────────────────────────────
  'settings.verifyCredentials': {
    max:      20,
    windowMs: 60 * 1000,          // 20 live credential checks / minute
  },

  // ── Revealing a stored secret (the only endpoint that returns one in
  //    plaintext). Tight on purpose: a human clicking Reveal needs a handful,
  //    while anything enumerating them needs many. ────────────────────────────
  'settings.revealCredential': {
    max:      10,
    windowMs: 60 * 1000,          // 10 reveals / minute
  },

  // ── SEO Alt Text extension (one page/request; each image = a Brave search
  //    + an AI call, so this is deliberately tight) ─────────────────────────
  'builder.seoAltText': {
    max:      20,
    windowMs: 60 * 1000,          // 20 pages / minute per client
  },

  // ── Tenant-admin password reset (public, unauthenticated, sends email) ────
  //    Tight on purpose: caps both reset-email spamming of a third party and
  //    brute-force guessing of the 6-digit code.
  'admin.passwordReset': {
    max:      5,
    windowMs: 15 * 60 * 1000,     // 5 attempts / 15 minutes per client
  },

  // ── Tenant-admin support requests (authenticated; uploads a blob + emails) ─
  //    Login-gated, so this is a runaway-client backstop rather than an
  //    anti-abuse measure: each submission can push several MB into blob
  //    storage and send mail. Comfortably above any human filing rate.
  'admin.supportRequest': {
    max:      10,
    windowMs: 10 * 60 * 1000,     // 10 submissions / 10 minutes per client
  },

  // ── Public bug-report intake (unauthenticated; any tenant site visitor
  //    can hit this). Tight on purpose — a human filing a bug does it once
  //    or twice, and a runaway script hammering it is exactly what this
  //    guards against.
  'public.bugReport': {
    max:      8,
    windowMs: 10 * 60 * 1000,     // 8 submissions / 10 minutes per client
  },
  // Screenshot uploads for those reports: one request per file (see
  // lib/projectBugReportScreenshots.js for why), up to 5 files a report, so
  // the budget is a few reports' worth — not a free public image host.
  'public.bugReportScreenshot': {
    max:      20,
    windowMs: 10 * 60 * 1000,     // 20 files / 10 minutes per client
  },
  // "Which tier is this browser?" — asked once per page load by a gated
  // Bug Report module, so the budget is a browsing session's worth of pages,
  // not a submission budget. Declared explicitly rather than left to fall
  // through to `global`: an undeclared key still limits, but at a rate nobody
  // chose and nobody can find by reading this file.
  'public.bugReportViewer': {
    max:      120,
    windowMs: 10 * 60 * 1000,     // 120 page loads / 10 minutes per client
  },
};

// ---------------------------------------------------------------------------
// In-memory store — Map<key, { count, resetAt }>
// ---------------------------------------------------------------------------

const store = new Map();

/**
 * Get or create a counter entry for a (limitKey, ip) pair.
 */
function getEntry(limitKey, ip) {
  const storeKey = `${limitKey}::${ip}`;
  const now      = Date.now();
  let entry      = store.get(storeKey);

  if (!entry || now >= entry.resetAt) {
    const config = LIMITS[limitKey] || LIMITS.global;
    entry = { count: 0, resetAt: now + config.windowMs };
    store.set(storeKey, entry);
  }

  return { entry, storeKey };
}

// ---------------------------------------------------------------------------
// Periodic cleanup — prevent unbounded memory growth in long-running processes
// ---------------------------------------------------------------------------

// .unref() so this timer does not, by itself, keep the Node process alive. In a
// server the HTTP listener holds the event loop open and cleanup still runs; in
// a short-lived script or a test that merely requires this module (directly or
// through a route), the process can now exit instead of hanging for five
// minutes. Without it, `node --test` on anything that reaches a route never
// finishes.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now >= entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);   // clean up every 5 minutes
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

// ---------------------------------------------------------------------------
// Core check function
// ---------------------------------------------------------------------------

/**
 * Check a rate limit and send a 429 if exceeded.
 *
 * @param   {object}  req      - Node IncomingMessage
 * @param   {object}  res      - Node ServerResponse
 * @param   {string}  limitKey - Key from LIMITS (e.g. 'acquire.youtube', 'global')
 * @returns {boolean} true if the request was rate-limited (response already sent),
 *                    false if the request is within limits and may proceed.
 */
function checkLimit(req, res, limitKey) {
  const config = LIMITS[limitKey];
  if (!config) {
    // Unknown key — log a warning but don't block
    console.warn(`[rateLimiter] Unknown limit key: "${limitKey}" — request allowed through`);
    return false;
  }

  const ip = (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );

  const { entry } = getEntry(limitKey, ip);
  entry.count++;

  const retryAfterSec = Math.ceil((entry.resetAt - Date.now()) / 1000);
  const remaining     = Math.max(0, config.max - entry.count);

  // Always set rate limit headers so the frontend can read them
  res.setHeader('X-RateLimit-Limit',     String(config.max));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset',     String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > config.max) {
    res.setHeader('Retry-After', String(retryAfterSec));

    const { sendErr } = require('../routes/http');
    sendErr(res, 429,
      `Rate limit exceeded. Try again in ${retryAfterSec} second${retryAfterSec !== 1 ? 's' : ''}.`,
      { code: 'RATE_LIMITED', details: [`Limit: ${config.max} requests per ${config.windowMs / 1000}s`, `Retry after: ${retryAfterSec}s`] }
    );

    console.warn(`[rateLimiter] ${limitKey} — limit hit for IP ${ip} (${entry.count}/${config.max}), retry in ${retryAfterSec}s`);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Convenience: check both a specific limit AND the global ceiling.
// Returns true (limited) if either check fails.
// ---------------------------------------------------------------------------

/**
 * Check a named endpoint limit plus the global ceiling in one call.
 * Use this in route handlers for endpoints that need per-endpoint limits.
 *
 * @param   {object} req
 * @param   {object} res
 * @param   {string} limitKey  - Specific endpoint key from LIMITS
 * @returns {boolean}
 */
function checkEndpointLimit(req, res, limitKey) {
  if (checkLimit(req, res, 'global'))   return true;
  if (checkLimit(req, res, limitKey))   return true;
  return false;
}

// ---------------------------------------------------------------------------
// Expose current store state (for a /api/admin/rate-limits debug endpoint)
// ---------------------------------------------------------------------------

function getStats() {
  const now    = Date.now();
  const result = [];
  for (const [key, entry] of store.entries()) {
    const [limitKey, ip] = key.split('::');
    const config = LIMITS[limitKey] || {};
    result.push({
      key:        limitKey,
      ip,
      count:      entry.count,
      max:        config.max,
      remaining:  Math.max(0, config.max - entry.count),
      resetsIn:   Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
    });
  }
  return result;
}

module.exports = { checkLimit, checkEndpointLimit, getStats, LIMITS };
