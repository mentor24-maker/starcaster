'use strict';

/**
 * Substack Notes 5/7 (task 86bcet77n) — how many Notes the scheduled pass may
 * draft from Dane's topics right now, which topics, and why it drafts none.
 * Pure: the settings, the account's items and the clock are all passed in, so
 * the tests can stand on any day and say exactly what the pass would do.
 *
 * The pass itself is lib/substackNotesRunDue.js. It only ever writes DRAFTS:
 * Dane approves every Note (his decision, 2026-10-07). The timer only saves him
 * clicking "Use this topic" and then "Write a draft".
 *
 * THE RULES
 *
 *   - Off unless the account's switch "Draft Notes from my topics on their
 *     own" is on. No topics saved means no topic drafts.
 *   - NEVER MORE WAITING FOR APPROVAL THAN THE DAILY LIMIT. Everything on the
 *     Approvals tab counts — Notes, replies, restacks, likes, whatever wrote
 *     them — against maxActionsPerDay.
 *   - EVERYTHING ELSE COMES FIRST. A Note idea not yet drafted (one Dane
 *     jotted, one from his new content, a topic he picked by hand) holds its
 *     slot too, so a topic draft only fills a slot nothing else is using.
 *   - At his daily pace: no more topic drafts in one calendar day (the
 *     account's own) than the daily limit, so approving a batch at 9am does
 *     not open the door to another batch at 9:30.
 *   - Topics rotate, least recently drafted first. With two or more topics the
 *     same one is never drafted twice in a row, and one drafted in the last 7
 *     days waits while another has not been.
 *
 * Every reason is a sentence Dane can read on the Ideas tab (CLAUDE.md
 * landmine 17: an unexplained "nothing happened" reads as a broken timer).
 */

/** How often Vercel Cron runs the pass (vercel.json). The screen's "next" time is the next one. */
const PASS_EVERY_MINUTES = 30;

/** Kinds that carry words; the others wait for approval as bare ideas. Mirrors the store. */
const TEXT_KINDS = new Set(['note', 'reply']);

function isValidTimeZone(zone) {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day (2026-10-08) at `atMs` in `timeZone`. */
function localDay(atMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(atMs));
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * "12:30 PM MDT" in the account's time zone. The zone is always named: with
 * none set on the account or the project the clock is UTC, and an unlabelled
 * "6:30 PM" at lunchtime in Denver reads as a broken timer.
 */
function clockText(atMs, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(atMs));
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** On the Approvals tab: a drafted Note or reply, or a restack/like not yet decided. Same test as the store. */
function awaitsApproval(item) {
  return TEXT_KINDS.has(item?.kind) ? item.status === 'draft' : item?.status === 'idea';
}

/** A Note idea with no draft yet — it comes before any topic draft. */
function undraftedNoteIdea(item) {
  return item?.kind === 'note' && item.status === 'idea';
}

function createdAt(item) {
  const at = Date.parse(item?.createdAt || '');
  return Number.isFinite(at) ? at : null;
}

function topicKey(text) {
  return String(text || '').trim().toLowerCase();
}

/** The next time the pass runs after `now`: the next half-hour mark. */
function nextPassAt(now, everyMinutes = PASS_EVERY_MINUTES) {
  const step = everyMinutes * 60 * 1000;
  return (Math.floor(now / step) + 1) * step;
}

/**
 * Pick `count` topics in rotation. `history` is the account's topic Notes (any
 * status: a rejected draft was still drafted). Least recently drafted first,
 * never-drafted topics in their Settings order before any of them. That one
 * ordering is the whole rotation rule: with two or more topics the one drafted
 * last always sorts last, so it is never drafted twice in a row, and one drafted
 * in the last 7 days sorts after any that has not been. Returns the topic strings.
 */
function pickTopics(topics, history, count, now) {
  const list = (Array.isArray(topics) ? topics : []).map((t) => String(t || '').trim()).filter(Boolean);
  if (!list.length || count <= 0) return [];
  const lastUsed = new Map();
  for (const item of Array.isArray(history) ? history : []) {
    if (item?.source !== 'topic') continue;
    const at = createdAt(item);
    if (at === null) continue;
    const key = topicKey(item.ideaText);
    if (!lastUsed.has(key) || lastUsed.get(key) < at) lastUsed.set(key, at);
  }

  const picked = [];
  let clock = now;
  for (let i = 0; i < count; i += 1) {
    const candidates = list
      .map((topic, order) => ({ topic, order, at: lastUsed.has(topicKey(topic)) ? lastUsed.get(topicKey(topic)) : null }));
    candidates.sort((a, b) => {
      if (a.at === null && b.at !== null) return -1;
      if (b.at === null && a.at !== null) return 1;
      if (a.at !== b.at) return a.at - b.at;
      return a.order - b.order;
    });
    const choice = candidates[0];
    if (!choice) break;
    picked.push(choice.topic);
    clock += 1;
    lastUsed.set(topicKey(choice.topic), clock);
  }
  return picked;
}

/**
 * The account's topic-draft plan for one pass. Returns
 *   { count, topics, reason, text, nextAt, waiting, undrafted, topicToday, cap }
 * `count` is how many topic drafts to write now and `topics` which ones, in
 * order. `reason` is a short code for tests; `text` is the sentence the Ideas
 * tab shows; `nextAt` is when the next draft could come (ms) or null.
 *
 * `items` is every item on the account, any kind and status.
 */
function planTopicDrafts({ settings, items, now, timeZone }) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const list = Array.isArray(items) ? items : [];
  const topics = (Array.isArray(settings?.topics) ? settings.topics : []).filter((t) => String(t || '').trim());
  const cap = Number(settings?.maxActionsPerDay);
  const waiting = list.filter(awaitsApproval).length;
  const undrafted = list.filter(undraftedNoteIdea).length;
  const today = localDay(now, zone);
  const topicToday = list.filter((item) => {
    const at = createdAt(item);
    return item.source === 'topic' && at !== null && localDay(at, zone) === today;
  }).length;
  const base = { waiting, undrafted, topicToday, cap: Number.isFinite(cap) ? cap : null };
  const none = (reason, text, nextAt = null) => ({ ...base, count: 0, topics: [], reason, text, nextAt });

  if (settings?.autoTopicDrafts !== true) {
    return none('off', 'No topic drafts: switched off in Settings');
  }
  if (!topics.length) {
    return none('no_topics', 'No topic drafts: no topics saved in Settings');
  }
  if (!Number.isFinite(cap) || cap <= 0) {
    return none('no_cap', 'No topic drafts: Most actions per day is 0 in Settings');
  }

  const slots = cap - waiting - undrafted;
  if (slots <= 0) {
    const parts = [];
    if (waiting) parts.push(`${waiting} already waiting for your approval`);
    if (undrafted) parts.push(`${plural(undrafted, 'idea')} of yours not drafted yet`);
    return none('full', `No topic draft for now: ${parts.join(' and ')} (the most per day is ${cap})`);
  }
  const leftToday = cap - topicToday;
  if (leftToday <= 0) {
    return none(
      'daily_done',
      `No more topic drafts today: ${plural(topicToday, 'topic draft')} written today, the most per day is ${cap}`,
      null
    );
  }

  const count = Math.min(slots, leftToday);
  const history = list.filter((item) => item.source === 'topic');
  const picked = pickTopics(topics, history, count, now);
  const at = nextPassAt(now);
  return {
    ...base,
    count: picked.length,
    topics: picked,
    reason: 'due',
    text: `Next topic draft: about ${clockText(at, zone)} ("${picked[0]}")`,
    nextAt: at,
  };
}

module.exports = {
  PASS_EVERY_MINUTES,
  isValidTimeZone,
  localDay,
  awaitsApproval,
  nextPassAt,
  pickTopics,
  planTopicDrafts,
};
