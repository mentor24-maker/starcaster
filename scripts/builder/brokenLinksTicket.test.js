'use strict';

// The "Broken links on client sites" ticket (task 86bcxn69z): rewritten in
// place, Dane assigned only while it lists something, and a project that
// could not be read is named — never counted as clean.

const test = require('node:test');
const assert = require('node:assert/strict');

const ticket = require('../../lib/brokenLinksTicket');

const NOW = Date.parse('2026-11-03T19:00:00-07:00');
const brokenLink = {
  where: 'Saved section "Header" › Header',
  module: 'Menu',
  item: 'Menu item "About"',
  setting: 'Link',
  source: { kind: 'saved-section', id: 's', name: 'Header' },
  shownOn: 4,
  reason: 'goes to /about, and no page has that address',
};

test('broken links are listed by project and Dane is assigned', () => {
  const out = ticket.renderBrokenLinksTicket({
    projects: [
      { id: 'a', name: 'Delray', domain: 'delraytennis.com', broken: [brokenLink] },
      { id: 'b', name: 'Clean', domain: '', broken: [] },
    ],
    now: NOW,
    node: 'mac-mini',
  });
  assert.equal(out.assign, true);
  assert.equal(out.count, 1);
  assert.match(out.body, /^# 1 broken link on 1 site/);
  assert.match(out.body, /## Delray \(delraytennis\.com\) — 1 broken link/);
  assert.match(out.body, /- Saved section "Header" › Header › Menu › Menu item "About" \(shown on 4 pages\) — goes to \/about/);
  assert.doesNotMatch(out.body, /Clean/);
  assert.match(out.body, /Last checked .* from mac-mini: 2 projects read\./);
});

test('nothing broken says so with the date, and nobody is assigned', () => {
  const out = ticket.renderBrokenLinksTicket({ projects: [{ id: 'b', name: 'Clean', broken: [] }], now: NOW });
  assert.equal(out.assign, false);
  assert.equal(out.count, 0);
  assert.match(out.body, /^# No broken links found on any site\n\nLast checked Tue, Nov 3/);
});

test('a project that could not be read is named and is never counted as clean', () => {
  const out = ticket.renderBrokenLinksTicket({
    projects: [{ id: 'b', name: 'Clean', broken: [] }, { id: 'x', name: 'WaveCenter', domain: 'wavecenter.com', error: 'psql failed: timeout' }],
    now: NOW,
  });
  assert.match(out.body, /\*\*could not check: WaveCenter \(wavecenter\.com\)\*\* — psql failed: timeout/);
  assert.match(out.body, /1 could not be checked/);
  assert.match(out.body, /These are not clean/);
  // Its failure is part of what the ticket says, so a change in it is a rewrite.
  const clean = ticket.renderBrokenLinksTicket({ projects: [{ id: 'b', name: 'Clean', broken: [] }], now: NOW });
  assert.notEqual(out.fingerprint, clean.fingerprint);
});

test('when nothing could be read it is CANNOT TELL, not "no broken links", and keeps the last good list', () => {
  const lastGood = { at: '2026-10-27T19:00:00-07:00', count: 1, section: '# 1 broken link on 1 site' };
  const out = ticket.renderBrokenLinksTicket({
    projects: [{ id: 'every project', name: 'every project', error: 'PROD_DB_READONLY_URL is not set' }],
    now: NOW,
    lastGood,
  });
  assert.match(out.body, /^# ⚠️ CANNOT TELL/);
  assert.doesNotMatch(out.body, /No broken links found/);
  assert.match(out.body, /The last good list, from/);
  assert.equal(out.assign, true, 'still assigned while the last good reading listed something');
  const blind = ticket.renderBrokenLinksTicket({ projects: [{ id: 'x', name: 'x', error: 'e' }], now: NOW });
  assert.equal(blind.assign, null, 'with nothing known it leaves the assignment as it is');
});

test('weekly: due with no stamp, not due inside a week, due after it', () => {
  assert.equal(ticket.checkDue({ state: {}, now: NOW }), true);
  assert.equal(ticket.checkDue({ state: { checkedAt: new Date(NOW - 6 * 864e5).toISOString() }, now: NOW }), false);
  assert.equal(ticket.checkDue({ state: { checkedAt: new Date(NOW - 7 * 864e5 - 1).toISOString() }, now: NOW }), true);
});

test('assignee change: Dane only while something is listed, nobody once clean', () => {
  assert.deepEqual(ticket.assigneeChange({ current: [{ id: 5 }], assign: true, operatorId: 9 }), { add: [9], rem: [5] });
  assert.deepEqual(ticket.assigneeChange({ current: [{ id: 9 }], assign: false, operatorId: 9 }), { add: [], rem: [9] });
});
