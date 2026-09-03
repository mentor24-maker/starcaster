'use strict';

/**
 * Turn the accounts an adapter just produced into stored connections, and settle
 * which one actually posts. Connections 5 of 7 (86bbpz1gk).
 *
 * ── Why this is its own file ───────────────────────────────────────────────
 *
 * It was inside `routes/connections.js`, which was right while exactly one
 * caller existed. Instagram adds a second: a redirect provider comes back
 * through Meta's callback in `routes/engage.js`, and the OAuth code Meta issues
 * can be exchanged ONCE — so the callback has to finish the connection itself
 * rather than bouncing the browser back to the panel to POST the code a second
 * time.
 *
 * Two copies of this logic is the failure to avoid, not the duplication as
 * such. What lives here is a sequence with three separate ways to be subtly
 * wrong (see below), and a second copy is how one of them gets a fix while the
 * other keeps the bug — the exact shape of the two-vocabulary incident that
 * sent slice 2 back twice. This is a MOVE: `routes/connections.js` now calls it
 * and behaves identically.
 */

const contract = require('./contract');
const projectConnectionsStore = require('../projectConnectionsStore');

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

/**
 * Make one account the one that will actually post, and PROVE it rather than
 * assume it.
 *
 * The resolver takes the first live row `listConnections` returns, which is
 * ordered `updated_at DESC, created_at DESC` — so touching a row is how it is
 * chosen (lib/connections/resolveCredentials.js). That works until two rows
 * carry the SAME instant, which is not hypothetical: finishing one Meta grant
 * saves every Page or Instagram account it covers inside a single request, and
 * several millisecond-resolution timestamps land identical. The order between
 * them is then whatever the database feels like, so a card reporting "posting
 * to account A" while the publisher picks B is a client's post appearing on the
 * wrong account with every gate green.
 *
 * So this touches, reads back through the store's OWN ordering, and touches
 * again if the clock has not moved on yet. What it returns is what the
 * publisher will pick, measured — never what the caller intended.
 *
 * The wait is deliberately tiny and bounded. If it still cannot separate them
 * the caller is told, because reporting an active account we have not confirmed
 * is precisely the failure this exists to prevent.
 */
async function makeActive(provider, accountId, scope, attempts = 4) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const touched = await projectConnectionsStore.updateConnectionStatus(
      { provider, accountId, status: 'connected', lastError: '' },
      scope
    );
    if (!touched.ok) return touched;
    last = touched;

    const listed = await projectConnectionsStore.listConnections(200, scope);
    if (!listed.ok) return listed;
    const first = (Array.isArray(listed.data) ? listed.data : [])
      .find((row) => safeText(row?.provider).toLowerCase() === provider);
    if (first && safeText(first.accountId) === safeText(accountId)) {
      return { ok: true, status: 200, data: first };
    }
    // The stored timestamps are identical to the millisecond. Let the clock
    // move and stamp it again, rather than reporting a choice that did not take.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return {
    ok: false,
    status: 409,
    error: 'Two of these accounts were stored at the same instant and cannot be told apart. '
      + 'Disconnect this platform and connect it again to choose one.',
    data: last?.data || null,
  };
}

/**
 * Store every account a completed grant covers, and report which one posts.
 *
 * Every account, not only the active one: that is what the client authorised —
 * one consent screen, all their accounts — and it is the only way an account
 * picker can work without a second table to park unchosen tokens in for the
 * minute between finishing and choosing.
 *
 * They are saved OLDEST-LAST on purpose: `saveConnection` stamps updated_at,
 * `listConnections` orders by it, and the resolver takes the first live row —
 * so the last one written is the active one, and the caller is TOLD which that
 * is rather than inferring it.
 *
 * Returns the route-shaped envelope every caller here already speaks, with a
 * `code` on failures so a caller can answer differently for "the provider gave
 * us nothing" and "the vault refused the write".
 */
async function storeAccounts({ provider, displayName, accounts, scope }) {
  const key = safeText(provider);
  const label = safeText(displayName) || key;
  const list = Array.isArray(accounts) ? accounts : [];

  if (!list.length) {
    // The provider said yes and named nobody. Storing nothing and reporting
    // success would leave a card that says connected with no account behind
    // it — the exact shape of a connection that silently posts as us.
    return { ok: false, status: 502, error: `${label} accepted the sign-in but returned no account`, code: 'NO_ACCOUNTS' };
  }

  const saved = [];
  for (const account of list) {
    const problems = contract.accountProblems(account, `${key} account`);
    if (problems.length) {
      return {
        ok: false,
        status: 502,
        error: `${label} returned an account we cannot store: ${problems.join('; ')}`,
        code: 'BAD_ACCOUNT',
      };
    }
    const write = await projectConnectionsStore.saveConnection({
      ...contract.storableAccount(account),
      provider: key,
      status: 'connected',
      connectedByUserId: scope.userId,
      lastVerifiedAt: new Date().toISOString(),
      lastError: '',
    }, scope);
    if (!write.ok) {
      return {
        ok: false,
        status: write.status || 500,
        error: write.error || 'Could not store the connection',
        code: 'SAVE_FAILED',
      };
    }
    saved.push(write.data);
  }

  // Which one posts is READ BACK, never inferred from the write order — see
  // makeActive. With one account this is a formality; with several it is the
  // difference between a card that agrees with the publisher and one that
  // merely looks like it does.
  const intended = safeText(saved[saved.length - 1]?.accountId);
  const active = await makeActive(key, intended, scope);
  if (!active.ok) {
    return {
      ok: false,
      status: active.status || 500,
      error: active.error || 'Could not settle which account posts',
      code: 'ACTIVE_ACCOUNT_UNSETTLED',
    };
  }

  return {
    ok: true,
    status: 200,
    data: {
      saved,
      activeAccountId: safeText(active.data?.accountId),
      needsAccountChoice: saved.length > 1,
    },
  };
}

module.exports = {
  makeActive,
  storeAccounts,
};
