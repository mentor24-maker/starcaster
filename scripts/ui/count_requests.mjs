#!/usr/bin/env node
/**
 * Count /api/* requests fired by one screen load.
 *
 * Written for the `/api/messaging/topics` request storm (694 requests per load
 * of acquireYoutubePage). Keep it: it is the only thing that catches a caller
 * re-introducing an unawaited per-row fetch.
 *
 *   npm run dev                      # in another shell — RESTART before each run,
 *                                    # the rate limiter's window is per-process
 *   npm run seed:ui-fixture
 *   export UI_HARNESS_PROJECT_ID=<printed id>
 *   node scripts/ui/count_requests.mjs [screenId]
 */
import { launch, signIn, activateProject, gotoScreen } from './app-driver.mjs';

const screenId   = process.argv[2] || 'acquireYoutubePage';
const projectId  = process.env.UI_HARNESS_PROJECT_ID;
if (!projectId) {
  console.error('UI_HARNESS_PROJECT_ID is not set — run `npm run seed:ui-fixture` first.');
  process.exit(1);
}

const { browser, page } = await launch({ width: 1440 });
const counts = new Map();
let phase = 'login+activate';
const phases = new Map();

page.on('request', (r) => {
  let pathname;
  try { pathname = new URL(r.url()).pathname; } catch { return; }
  if (!pathname.startsWith('/api/')) return;
  counts.set(pathname, (counts.get(pathname) || 0) + 1);
  phases.set(phase, (phases.get(phase) || 0) + 1);
});

let throttled = 0;
page.on('response', (r) => { if (r.status() === 429) throttled += 1; });

try {
  await signIn(page);
  await activateProject(page, projectId);
  phase = 'navigate';
  await gotoScreen(page, screenId);

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nscreen: ${screenId}   project: ${projectId}`);
  console.log(`API requests — ${[...phases].map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  console.log('top endpoints:');
  top.slice(0, 8).forEach(([u, n]) => console.log(String(n).padStart(6), u));

  // Budget, not 1. After the core.js cache fix, one load of acquireYoutubePage
  // makes ~7 topics requests, and none of them are the storm:
  //   4x HTTP 400 during boot — assets.js / assetsVideo.js populate topic
  //     dropdowns before a project is active, so the request is rejected and
  //     (correctly) not cached. Separate defect; see the handoff doc.
  //   1x through App.ui.ensureMessagingTopicsLoaded — the real, cached fetch.
  //   2x direct api('/api/messaging/topics?limit=5000') from callers that need
  //     the full topic records, not the cache's flat name list
  //     (youtube.js loadYoutubeResearchMessagingCache, campaigns.js).
  // Anything that reintroduces a per-row or per-render fetch lands in the
  // hundreds, so this threshold catches the regression it is meant to catch.
  const TOPICS_BUDGET = 10;
  const topics = counts.get('/api/messaging/topics') || 0;
  console.log(`\n/api/messaging/topics: ${topics} (budget ${TOPICS_BUDGET})   HTTP 429s: ${throttled}`);
  if (topics > TOPICS_BUDGET || throttled > 0) {
    console.log('FAIL — topics request storm or rate limiting detected.');
    process.exitCode = 1;
  } else {
    console.log('OK');
  }
} finally {
  await browser.close();
}
