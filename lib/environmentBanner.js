'use strict';

/**
 * The strip across the top of the admin app saying which database you are on.
 *
 * WHY THIS EXISTS
 * The local app and the live app are pixel-identical, and the only difference
 * that matters — which database is behind them — was invisible everywhere.
 * The operator kept testing on production partly because nothing ever told
 * him which one he was looking at. A copy of the admin UI pointed at 21 live
 * tenant sites should not be indistinguishable from a scratch copy.
 *
 * SERVER-SIDE ON PURPOSE
 * The obvious build is a small script that asks an endpoint after the page
 * loads. Three reasons this does not:
 *   1. `/api/health` is authenticated, so the banner would be absent on the
 *      login screen — where you are most likely to be about to type real
 *      credentials into the wrong environment.
 *   2. It would appear a beat late, after you had already started clicking.
 *   3. A safety device that depends on a request is a safety device that
 *      fails when the request does.
 * The server already knows. It should just say so.
 *
 * INLINE STYLES, DELIBERATELY
 * Nothing in this repo tests CSS, and `public/styles.css` is a build artifact
 * that can be stale or half-built in a fresh worktree. A banner that silently
 * loses its styling still has to read as a warning, so it carries its own.
 *
 * LOCAL DEV ONLY
 * This is injected by `server.js`, which serves the app on a laptop. The
 * Vercel path (`routes/publicSitePages.js`) is untouched, so no code here
 * runs on the request path that serves real tenant sites.
 */

/** Which database a connection string points at. */
function classify(supabaseUrl) {
  const raw = String(supabaseUrl || '').trim();
  if (!raw) return 'unknown';
  let host;
  try {
    host = new URL(raw).hostname;
  } catch (_) {
    return 'unknown';
  }
  if (!host) return 'unknown';
  return host === 'localhost' || host === '127.0.0.1' ? 'local' : 'production';
}

const STYLE_BASE =
  'position:sticky;top:0;left:0;right:0;z-index:2147483647;' +
  // Single quotes: this string lands inside a double-quoted HTML attribute,
  // and "Segoe UI" would close it early and spray the rest of the CSS into
  // the markup as attributes.
  "font:600 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
  'letter-spacing:.12em;text-transform:uppercase;text-align:center;' +
  'padding:5px 12px;';

const LOOKS = {
  local: {
    style: `${STYLE_BASE}background:#1c3b2a;color:#7fdcab;border-bottom:1px solid #2f6b4f;`,
    text: 'Local — your own machine. Nothing here is real.',
  },
  production: {
    style: `${STYLE_BASE}background:#7a1d12;color:#ffd9d1;border-bottom:2px solid #e2705f;`,
    // The one that matters. Says what is at stake, not just where you are.
    text: 'Production — live tenant data. Every change is real and immediate.',
  },
  unknown: {
    style: `${STYLE_BASE}background:#5a4a12;color:#ffe9a8;border-bottom:1px solid #b08a1c;`,
    text: 'Unknown database — no SUPABASE_URL is set. Run npm run doctor.',
  },
};

/**
 * The banner markup for a given connection string.
 * Returns '' for nothing to say, so callers can concatenate unconditionally.
 */
function bannerHtml(supabaseUrl) {
  const look = LOOKS[classify(supabaseUrl)];
  if (!look) return '';
  return (
    `<div data-starcaster-env-banner style="${look.style}" role="status">` +
    `${look.text}` +
    `</div>`
  );
}

/**
 * Put the banner immediately after <body> so it is the first thing painted.
 *
 * Returns the html unchanged when there is no <body> to open — an injector
 * that guesses at where to put things in a document it does not recognise is
 * how you corrupt a page.
 */
function injectBanner(html, supabaseUrl) {
  const text = String(html);
  const banner = bannerHtml(supabaseUrl);
  if (!banner) return text;
  const bodyOpen = /<body\b[^>]*>/i.exec(text);
  if (!bodyOpen) return text;
  const at = bodyOpen.index + bodyOpen[0].length;
  return text.slice(0, at) + banner + text.slice(at);
}

module.exports = { classify, bannerHtml, injectBanner };
