'use strict';

/**
 * The account an adapter posts as, read from the channel's settings row once
 * per pass (Outreach wizard 2/19, task 86bcrmba0). Dane chooses it on Engage ›
 * Outreach; lib/outreachAccounts.js reads and writes it. YouTube and Substack
 * share this; Reddit reads its pace from the same row and does the same thing
 * inline (./adapters/reddit.js).
 *
 * NOTHING POSTS UNTIL ONE IS CHOSEN. A blank name holds every item on the
 * account with CHOOSE_ACCOUNT_REASON, account-wide, because "whoever happens to
 * be signed in" is not an account.
 *
 *   site        'youtube' | 'substack'
 *   projectId   the project the worker posts for
 *   fixedNames  { accountKey: name } — a test seam. When given, the row is
 *               never read and these count as chosen.
 *   readAccount (accountKey) => envelope from readAccountForWorker — a seam.
 */

const CHOOSE_ACCOUNT_REASON_FOR = (label) => `Waiting: choose the account to post as — Engage › Outreach, ${label}, Connect.`;

function createAccountReader({ site, label, projectId, fixedNames = null, readAccount = null }) {
  const read = readAccount
    || ((accountKey) => require('../../lib/outreachAccounts').readAccountForWorker(site, projectId, accountKey));
  let cache = new Map();

  async function row(accountKey) {
    if (cache.has(accountKey)) return cache.get(accountKey);
    const res = await read(accountKey);
    if (!res.ok) throw new Error(`could not read which ${label} account to post as: ${res.error}`);
    cache.set(accountKey, res.data);
    return res.data;
  }

  return {
    reason: CHOOSE_ACCOUNT_REASON_FOR(label),

    /** Forget the last pass's reading. */
    reset() {
      cache = new Map();
    },

    /** The confirmed account for this pass, or '' when none is chosen. */
    async chosen(accountKey) {
      if (fixedNames) return String(fixedNames[accountKey] || '').trim();
      return String((await row(accountKey)).expectedAccount || '').trim();
    },

    /** What the hourly check compares with: the chosen account, or the first-run default. */
    async compareWith(accountKey) {
      if (fixedNames) return String(fixedNames[accountKey] || '').trim();
      const res = await read(accountKey);
      if (!res.ok) throw new Error(res.error);
      return String(res.data.compareWith || '').trim();
    },
  };
}

module.exports = { createAccountReader, CHOOSE_ACCOUNT_REASON_FOR };
