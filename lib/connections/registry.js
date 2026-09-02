'use strict';

/**
 * Which platforms exist, what the wizard says about each, and which adapter
 * runs it. Connections 2 of 7 (86bbpz1e1).
 *
 * Two jobs in one file on purpose. The catalogue (what a client SEES) and the
 * adapter map (what actually runs) were separate in the first draft, and a
 * platform can then be listed with nothing behind it, or built with nothing
 * saying what it is for. Here `ready` means an adapter exists AND conforms, and
 * `coming_soon` means there is deliberately none — checked when this module
 * loads, so a mismatch is a startup error rather than a card that spins.
 *
 * Adding a platform is meant to be one adapter file and one entry here.
 */

const contract = require('./contract');
const facebookPage = require('./adapters/facebookPage');
const bluesky = require('./adapters/bluesky');

/**
 * Every entry: what it is called, what it looks like, what connecting it gets
 * you in one plain sentence, and whether it can be connected today.
 *
 * `blurb` is written for the client, not for us — it is the only text on a
 * not-connected card, and "OAuth 2.0 authorization" answers a question nobody
 * asked. `iconKey` is a name slice 4 maps to an icon; it is not a path, so
 * moving the icons does not mean editing this file.
 */
const CATALOGUE = [
  {
    provider: 'facebook_page',
    displayName: 'Facebook Page',
    iconKey: 'facebook',
    blurb: 'Post updates to your Facebook Page from Starcaster.',
    readiness: 'ready',
    authKind: 'redirect',
    adapter: facebookPage,
  },
  {
    provider: 'bluesky',
    displayName: 'Bluesky',
    iconKey: 'bluesky',
    blurb: 'Post to your Bluesky account. Connect it with an app password from your Bluesky settings.',
    readiness: 'ready',
    authKind: 'app_password',
    adapter: bluesky,
  },
  {
    provider: 'instagram',
    displayName: 'Instagram',
    iconKey: 'instagram',
    blurb: 'Post photos to your Instagram business account.',
    readiness: 'coming_soon',
    authKind: 'redirect',
    adapter: null,
  },
  {
    provider: 'x',
    displayName: 'X',
    iconKey: 'x',
    blurb: 'Post to your X account.',
    readiness: 'coming_soon',
    authKind: 'redirect',
    adapter: null,
  },
];

/**
 * Checked at load, so a bad entry cannot reach a screen.
 *
 * The YouTube and LinkedIn guard is not hypothetical caution: both are obvious
 * things to add, both need a registered business identity Alphire does not
 * have, and a card offering a connection that can never complete is worse than
 * no card at all. A future slice that adds one gets this error immediately
 * rather than a support conversation later.
 */
function validateCatalogue(entries) {
  const seen = new Set();
  for (const entry of entries) {
    const provider = String(entry?.provider || '').trim();
    if (!provider) throw new Error('connections registry: an entry has no provider key');
    if (seen.has(provider)) throw new Error(`connections registry: "${provider}" is registered twice`);
    seen.add(provider);

    if (contract.FORBIDDEN_PROVIDERS.includes(provider)) {
      throw new Error(
        `connections registry: "${provider}" is out of scope for this epic — it needs a registered `
        + 'business identity Alphire does not have. Remove the entry rather than shipping a card that cannot connect.'
      );
    }
    if (!contract.READINESS_FLAGS.includes(entry.readiness)) {
      throw new Error(`connections registry: "${provider}" needs a readiness of ${contract.READINESS_FLAGS.join(' or ')}`);
    }
    if (!contract.AUTH_KINDS.includes(entry.authKind)) {
      throw new Error(`connections registry: "${provider}" needs an authKind of ${contract.AUTH_KINDS.join(' or ')}`);
    }
    for (const field of ['displayName', 'iconKey', 'blurb']) {
      if (!String(entry?.[field] || '').trim()) {
        throw new Error(`connections registry: "${provider}" is missing ${field}`);
      }
    }

    if (entry.readiness === 'ready') {
      if (!entry.adapter) {
        throw new Error(
          `connections registry: "${provider}" is marked ready but has no adapter. `
          + `Mark it coming_soon, or write lib/connections/adapters/${provider}.js.`
        );
      }
      const problems = contract.adapterProblems(entry.adapter, provider);
      if (problems.length) throw new Error(`connections registry: ${problems.join('; ')}`);
      if (entry.adapter.provider !== provider) {
        throw new Error(
          `connections registry: "${provider}" is wired to an adapter that calls itself `
          + `"${entry.adapter.provider}" — one of the two names is wrong`
        );
      }
      if (entry.adapter.authKind !== entry.authKind) {
        throw new Error(
          `connections registry: "${provider}" is listed as ${entry.authKind} but its adapter says `
          + `${entry.adapter.authKind} — slice 4 renders the wrong control for one of them`
        );
      }
    } else if (entry.adapter) {
      throw new Error(
        `connections registry: "${provider}" is marked ${entry.readiness} but has an adapter. `
        + 'A greyed card with working code behind it means one of the two is a lie.'
      );
    }
  }
  return entries;
}

validateCatalogue(CATALOGUE);

const BY_PROVIDER = new Map(CATALOGUE.map((entry) => [entry.provider, entry]));

/** The catalogue WITHOUT the adapters — the shape a screen or an API can have. */
function listCatalogue() {
  return CATALOGUE.map(({ adapter, ...rest }) => ({ ...rest, connectable: Boolean(adapter) }));
}

function getEntry(provider) {
  return BY_PROVIDER.get(String(provider || '').trim()) || null;
}

/** Every adapter that actually exists, for a caller sweeping all of them. */
function listAdapters() {
  return CATALOGUE.filter((entry) => entry.adapter).map((entry) => entry.adapter);
}

/** The adapter, or null. `getAdapter` is the version with a message attached. */
function adapterFor(provider) {
  return getEntry(provider)?.adapter || null;
}

/**
 * The adapter in an envelope, so a route can answer a bad provider key without
 * writing the sentence itself — and so "not a platform we have" and "a platform
 * that is not finished" are different messages, which is the difference between
 * a typo and a roadmap question.
 */
function getAdapter(provider) {
  const key = String(provider || '').trim();
  const entry = getEntry(key);
  if (!entry) {
    return contract.fail(404, `Unknown connection provider "${key}"`, { code: 'UNKNOWN_PROVIDER' });
  }
  if (!entry.adapter) {
    return contract.fail(400, `${entry.displayName} is not connectable yet`, { code: 'COMING_SOON' });
  }
  return contract.ok(200, entry.adapter);
}

module.exports = {
  CATALOGUE,
  validateCatalogue,
  listCatalogue,
  listAdapters,
  getEntry,
  adapterFor,
  getAdapter,
};
