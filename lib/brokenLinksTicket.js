'use strict';

/**
 * The weekly broken-link check's ClickUp ticket — what it says, and when to
 * write it (task 86bcxn69z). The scan itself is lib/pageInboundLinks.js; the
 * reading and writing are scripts/broken_links_check.mjs.
 *
 * ONE ticket, "Broken links on client sites", rewritten in place. Dane is
 * assigned while it lists something and nobody is once it is clean — the shape
 * of "SQL waiting for you" (lib/unappliedSql.js), whose assignee and time
 * helpers this reuses. No comments, no bus posts, no "all is well" ×52: the
 * ticket is the whole output, because Dane is the one who fixes a link and the
 * bus does not reach him (his decision, 2026-11-03).
 *
 * A project that could not be read is named on the ticket — "could not check:
 * <project>" — and is NEVER counted as clean (DOCTRINE §3.11). If every project
 * failed, the ticket says CANNOT TELL at the top and keeps the last good list.
 */

const { mountainTime, assigneeChange } = require('./unappliedSql');
const { describeLink } = require('./pageInboundLinks');

const TASK_NAME = 'Broken links on client sites';

/** Once a week. The relay wakes every ten minutes; all but one wake a week do nothing. */
const CHECK_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Is a fresh reading due?
 *   state — { checkedAt } from this machine's stamp
 */
function checkDue({ state = {}, now = Date.now(), everyMs = CHECK_EVERY_MS } = {}) {
  const then = Date.parse(state && state.checkedAt);
  return !(Number.isFinite(then) && now - then < everyMs);
}

function projectTitle(project) {
  const name = String(project.name || '').trim() || project.id;
  return project.domain ? `${name} (${project.domain})` : name;
}

function footer() {
  return [
    '---',
    `The **${TASK_NAME}** ticket. Do not build this, do not close it, do not delete it.`,
    'It is rewritten in place once a week by `npm run broken-links -- --check` on the bus relay\'s wake '
      + '(task 86bcxn69z), and Dane is assigned exactly while it lists a broken link. It only reads — it never '
      + 'changes a site. Fix a link in the Builder (open the page, edit the module, Save and Publish); this ticket '
      + 'clears itself at the next check.',
    'Not checked: links typed inside rich text, links to other websites, and published copies of pages (the '
      + 'drafts are what is read).',
  ].join('\n');
}

/**
 * What the ticket says, from one reading.
 *   projects — [{ id, name, domain, broken: [link] }]  read fine
 *              [{ id, name, domain, error: '...' }]    could not be read
 *   lastGood — { at, count, section } kept from the last reading that worked
 * Returns { body, fingerprint, assign, count, lastGood } — the same shape
 * lib/unappliedSql.js renderSqlTicket returns, so the writer is one routine.
 */
function renderBrokenLinksTicket({ projects = [], now = Date.now(), node = '', lastGood = null } = {}) {
  const when = mountainTime(now);
  const read = projects.filter((p) => !p.error);
  const failed = projects.filter((p) => p.error);
  const withBroken = read.filter((p) => (p.broken || []).length);
  const count = withBroken.reduce((sum, p) => sum + p.broken.length, 0);
  const checked = `Last checked ${when}${node ? ` from ${node}` : ''}: ${read.length} project${read.length === 1 ? '' : 's'} read`
    + `${failed.length ? `, ${failed.length} could not be checked` : ''}.`;

  const couldNot = failed.length
    ? ['## Could not check', '', ...failed.map((p) => `- **could not check: ${projectTitle(p)}** — ${p.error}`), '',
      '_These are not clean. A broken link on them would not appear above until they can be read._', '']
    : [];

  if (!read.length) {
    const head = [
      '# ⚠️ CANNOT TELL — no project could be read',
      '',
      '**This is not "no broken links".** Until projects can be read again, a broken link would not appear here.',
      `Tried ${when}${node ? ` from ${node}` : ''}.`,
      '',
    ];
    const kept = lastGood && lastGood.section
      ? [`## The last good list, from ${mountainTime(Date.parse(lastGood.at))}`, '', lastGood.section, '']
      : ['No earlier reading is kept on this machine, so there is no list to show.', ''];
    return {
      body: [...head, ...couldNot, ...kept, footer()].join('\n'),
      fingerprint: ['CANNOT TELL', ...failed.map((p) => `${p.id}:${p.error}`), lastGood ? lastGood.section : ''].join('\n'),
      assign: lastGood ? lastGood.count > 0 : null,
      count: lastGood ? lastGood.count : null,
      lastGood,
    };
  }

  let section;
  if (!count) {
    section = '# No broken links found on any site';
  } else {
    const blocks = withBroken.map((p) => [
      `## ${projectTitle(p)} — ${p.broken.length} broken link${p.broken.length === 1 ? '' : 's'}`,
      '',
      ...p.broken.map((link) => `- ${describeLink(link)} — ${link.reason}`),
    ].join('\n'));
    section = [
      `# ${count} broken link${count === 1 ? '' : 's'} on ${withBroken.length} site${withBroken.length === 1 ? '' : 's'}`,
      '',
      'Each line says where the link is (page or shared section › module › menu item) and what is wrong with it.',
      '',
      blocks.join('\n\n'),
    ].join('\n');
  }
  return {
    body: [section, '', checked, '', ...couldNot, footer()].join('\n'),
    fingerprint: [section, ...failed.map((p) => `${p.id}:${p.error}`)].join('\n'),
    // Assigned for what HE can fix: a broken link. "Could not check" is the
    // check's own problem, named on the ticket but not put in his inbox.
    assign: count > 0,
    count,
    lastGood: { at: new Date(now).toISOString(), count, section },
  };
}

module.exports = {
  TASK_NAME,
  CHECK_EVERY_MS,
  checkDue,
  renderBrokenLinksTicket,
  assigneeChange,
};
