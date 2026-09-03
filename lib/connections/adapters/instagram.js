'use strict';

/**
 * Instagram, behind the contract. Connections 5 of 7 (86bbpz1gk).
 *
 * Instagram is not a platform with its own sign-in. It is the SAME Meta grant
 * the Facebook Page adapter already collects, asked for two more scopes and
 * read from a different angle — so nearly every line of plumbing below is
 * imported from `./facebookPage` rather than copied. One token exchange, one
 * registered redirect_uri, one place a Meta fix has to land.
 *
 * ── What this file is actually FOR ─────────────────────────────────────────
 *
 * The adapter is the small part. The substance of this slice is two checks,
 * because Instagram's rules are strict and its errors are terrible:
 *
 *   1. The Instagram account must be BUSINESS or CREATOR. A personal account
 *      cannot be posted to by any API — not ours, not Buffer's, not anyone's.
 *   2. It must be LINKED TO A FACEBOOK PAGE the client manages, because every
 *      Instagram post the API can make goes out through a Page.
 *
 * Fail either and Meta's own answer is an `OAuthException` with a subcode, or —
 * worse and far more common — a perfectly successful response that simply does
 * not mention Instagram at all. A client reading either of those has no idea
 * what to change. So this file refuses BEFORE anything is stored, and refuses
 * with a sentence naming what to change and where.
 *
 * ── How the two are told apart ─────────────────────────────────────────────
 *
 * This is the whole trick, and it is one Graph request. A Page exposes its
 * linked Instagram account under two different fields:
 *
 *   instagram_business_account   present ONLY for a Business or Creator account
 *   connected_instagram_account  present for a linked account of ANY type
 *
 * So, per Page:
 *
 *   business present, Page token present → eligible
 *   business present, Page token absent  → the Page permission was not granted
 *   connected present, business absent   → check 1 failed: it is personal
 *   neither present                      → check 2 failed: nothing is linked
 *
 * The Page TOKEN is the fourth line and it is not decoration. Meta returns a
 * Page in `/me/accounts` whether or not the grant covers posting to it, and a
 * Page with no `access_token` cannot be posted through — so an account built
 * from one is a credential-less connection: a green card with nothing behind
 * it. `facebookPage.listManagedPages` has always dropped those; this file did
 * not, which is what round 1 of review found.
 *
 * Asking for only the first field — which is what the documentation leads you
 * to — makes a personal account and an unlinked one look identical, and there
 * is then no honest way to tell the client which of two quite different things
 * to go and do.
 *
 * ── Non-goals, kept deliberately ───────────────────────────────────────────
 *
 * No business verification and no App Review: this ships on Meta's
 * development-mode Tester mechanism, so Dane adds the client as a Tester on the
 * Meta app. No Stories, no reels handling, no scheduling — connect and post.
 */

const facebookPage = require('./facebookPage');
const contract = require('../contract');
const { CODES } = require('../../credentialErrors');
const { buildOAuthState } = require('../../metaOAuthState');

const PROVIDER = 'instagram';

/**
 * The Facebook scopes plus the two Instagram publishing ones.
 *
 * Built from `facebookPage.DEFAULT_SCOPES` rather than written out, so a scope
 * added there for Pages is not silently missing here — the two flows are one
 * consent screen, and a client who has granted one has granted the other.
 *
 * `instagram_basic` is what makes the account readable at all (it is the field
 * the checks below query); `instagram_content_publish` is what allows a post.
 * Asking for publish without basic authorises posting to an account we cannot
 * describe, which is how a card ends up green with nothing behind it.
 */
const DEFAULT_SCOPES = [
  ...facebookPage.DEFAULT_SCOPES.split(','),
  'instagram_basic',
  'instagram_content_publish',
].join(',');

/**
 * Meta's callback, shared with the Facebook Page flow ON PURPOSE.
 *
 * A provider rejects any redirect_uri it was not registered with, and exactly
 * one is registered with this Meta app. Inventing `/api/connections/instagram/
 * callback` here would be a one-line change that fails at Meta's end for every
 * client, with an error naming none of this — and un-inventing it means Dane
 * editing the Meta app dashboard, which is a hand-off, not code.
 *
 * The callback tells the two flows apart from the SIGNED STATE, which carries
 * the provider (lib/metaOAuthState.js). Not from a query parameter: that would
 * let a caller point the callback at whichever adapter it fancied.
 */
const CALLBACK_PATH = facebookPage.callbackPath;

/** The Page fields that answer both checks in one request. See the header. */
const PAGE_FIELDS = [
  'id',
  'name',
  'access_token',
  'instagram_business_account{id,username,name,profile_picture_url}',
  'connected_instagram_account{id,username}',
].join(',');

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

function callbackUrl() {
  return contract.oauthCallbackUrl(CALLBACK_PATH);
}

/** A handle the client will recognise: `@name` when we have one, else ''. */
function handle(username) {
  const name = safeText(username).replace(/^@+/, '');
  return name ? `@${name}` : '';
}

// ---------------------------------------------------------------------------
// The two pre-flight checks.
//
// Separated from every network call so they can be tested as pure functions
// against the exact Graph shapes Meta returns — which is what lets the sentences
// below be pinned by a test rather than read approvingly in review.
// ---------------------------------------------------------------------------

/**
 * The sentences. Written for a client standing in the Instagram app, not for
 * us, and naming the screen to go to — a message that says what is wrong
 * without saying where to fix it is a support conversation with extra steps.
 *
 * They live here as constants rather than inline so the test asserts the same
 * string the client reads, and so a reviewer can check the wording without
 * reading the control flow around it.
 */
const MESSAGES = Object.freeze({
  personal:
    'This Instagram account is a personal account. Instagram only allows posting '
    + 'to Business or Creator accounts. Change it in the Instagram app under '
    + 'Settings, Account type and tools, then try again.',
  notLinked:
    'This Instagram account is not linked to a Facebook Page. Instagram only allows '
    + 'posting through a Page you manage. Link them in the Instagram app under '
    + 'Settings, Account type and tools, Sharing to other apps, then try again.',
  noPages:
    'You do not manage any Facebook Page yet. Instagram posting always goes out '
    + 'through a Facebook Page, so create one — or ask to be given access to an '
    + 'existing one — and link your Instagram account to it, then try again.',
  noPageToken:
    'Your Instagram account is set up correctly, but Starcaster was not given '
    + 'permission to post to the Facebook Page it goes out through. Connect again '
    + 'and leave every Facebook Page permission ticked — or, if the Page belongs to '
    + 'someone else, ask them to make you an admin of it first.',
});

/**
 * What each Page says about Instagram, as one of four verdicts.
 *
 * Returns every Page, not only the failures, because the caller needs both
 * halves: the eligible ones become accounts, and the ineligible ones become the
 * sentence explaining why there are none. Reporting only what went wrong is how
 * a client with one good account and one personal one gets told they have a
 * problem when they do not.
 *
 * `no_page_token` is the fourth, added in round 2 of review. A Page with no
 * `access_token` — or with no id, which is unaddressable in exactly the same
 * way — has nothing to authenticate a post with, so it must never reach
 * `toAccount`: the account it would build carries an empty `accessToken`, which
 * the vault refuses HALF WAY THROUGH a multi-account write, leaving the good
 * account already stored and the client shown the word `accessToken`.
 *
 * It is a verdict rather than a filter one layer out (`listPagesWithInstagram`,
 * where `listManagedPages` does its equivalent) for one reason: a client whose
 * ONLY Page is tokenless would then be told "you do not manage any Facebook
 * Page", which is confidently wrong and unactionable. Kept as a verdict, the
 * Page is still visible to `preflight`, which can say the true thing — the
 * account is fine, the Page permission is missing.
 *
 * Note it applies ONLY where a Business account was found. A tokenless Page
 * with a personal or unlinked account is still reported as personal or
 * unlinked, because that is the problem the client has to fix first; the
 * missing Page permission would not be the blocker even once granted.
 */
function inspectPages(pages) {
  const rows = Array.isArray(pages) ? pages : [];
  return rows.map((page) => {
    const business = page?.instagram_business_account || null;
    const connected = page?.connected_instagram_account || null;
    const pageId = safeText(page?.id);
    const pageName = safeText(page?.name);
    const pageToken = safeText(page?.access_token);

    if (business && safeText(business.id)) {
      return {
        verdict: pageId && pageToken ? 'eligible' : 'no_page_token',
        pageId,
        pageName,
        pageToken,
        igUserId: safeText(business.id),
        igUsername: safeText(business.username) || safeText(business.name),
        igAvatarUrl: safeText(business.profile_picture_url),
      };
    }
    if (connected && safeText(connected.id)) {
      return {
        verdict: 'personal',
        pageId,
        pageName,
        pageToken,
        igUserId: safeText(connected.id),
        igUsername: safeText(connected.username),
        igAvatarUrl: '',
      };
    }
    return { verdict: 'not_linked', pageId, pageName, pageToken, igUserId: '', igUsername: '', igAvatarUrl: '' };
  });
}

/**
 * The refusal for a grant that turned up no postable Instagram account —
 * or null when at least one is postable.
 *
 * Which sentence is chosen by what we ACTUALLY saw, in the order a client would
 * ask it: is there a Page at all, is anything linked to it, is what is linked
 * the right kind. A single "we could not find an Instagram account" covering
 * all three would be true and useless.
 *
 * The failure envelope carries `code: ACCOUNT_INELIGIBLE` — the credentials
 * work, the account cannot do this, and no token will change that
 * (lib/credentialErrors.js). It is deliberately NOT run through
 * `describeCredentialFailure`, whose job is to assemble an OPERATOR's sentence
 * with environment caveats attached; the reader here is the client, and telling
 * them to redeploy because their account is personal is precisely the
 * confidently-wrong cause that file exists to prevent.
 */
function preflight(inspected) {
  const rows = Array.isArray(inspected) ? inspected : [];
  if (rows.some((row) => row.verdict === 'eligible')) return null;

  if (!rows.length) {
    return contract.fail(400, MESSAGES.noPages, { code: CODES.ACCOUNT_INELIGIBLE, check: 'linked_to_page' });
  }

  // Asked BEFORE the other two, because it is the Page the client actually
  // meant: the Instagram account behind it is Business or Creator and would
  // work, and one missing permission is standing in the way. Ranking a personal
  // account above it would send them to change the account type on an account
  // that was never the problem — confidently wrong, at the one moment they are
  // most likely to believe us.
  const untokened = rows.find((row) => row.verdict === 'no_page_token');
  if (untokened) {
    const where = untokened.pageName ? ` The Page we found is "${untokened.pageName}".` : '';
    return contract.fail(400, `${MESSAGES.noPageToken}${where}`, {
      code: CODES.ACCOUNT_INELIGIBLE,
      check: 'page_permission',
    });
  }

  const personal = rows.find((row) => row.verdict === 'personal');
  if (personal) {
    // Name the account and the Page it hangs off, so a client managing several
    // knows which one to go and change. The quoted sentence comes first and
    // unaltered — it is what they act on; the locator is a second sentence.
    const where = [handle(personal.igUsername), personal.pageName ? `on your Page "${personal.pageName}"` : '']
      .filter(Boolean).join(' ');
    return contract.fail(400, where ? `${MESSAGES.personal} The account we found is ${where}.` : MESSAGES.personal, {
      code: CODES.ACCOUNT_INELIGIBLE,
      check: 'business_or_creator',
    });
  }

  const pageNames = rows.map((row) => row.pageName).filter(Boolean);
  const where = pageNames.length
    ? ` We looked at ${pageNames.length === 1 ? 'your Page' : 'your Pages'} ${pageNames.map((n) => `"${n}"`).join(', ')}.`
    : '';
  return contract.fail(400, `${MESSAGES.notLinked}${where}`, {
    code: CODES.ACCOUNT_INELIGIBLE,
    check: 'linked_to_page',
  });
}

/**
 * One eligible Instagram account, in the contract's vocabulary.
 *
 * `accountId` is the INSTAGRAM user id, not the Page id: it is what every
 * Instagram Graph call is addressed to, including `verify` below and the
 * publish call slice 6 will make. `accountLabel` is the HANDLE, because a
 * client recognises `@delraytennis` and does not recognise the Page name the
 * post physically travels through — that is acceptance criterion 1, and it is
 * the one place this adapter deliberately does not echo Meta's own wording.
 *
 * `accessToken` is the PAGE token, which is what Instagram publishing
 * authenticates with. The Page id rides on `raw` so `revoke` can hand the
 * permission back at the right node; `raw` is dropped by
 * `contract.storableAccount` on the way into the vault, which `revoke` handles
 * rather than assumes — see the note there.
 */
function toAccount(row) {
  return contract.account({
    accountId: safeText(row.igUserId),
    accountLabel: handle(row.igUsername) || safeText(row.pageName) || safeText(row.igUserId),
    accountAvatarUrl: safeText(row.igAvatarUrl),
    accessToken: safeText(row.pageToken),
    raw: {
      ig_user_id: safeText(row.igUserId),
      username: safeText(row.igUsername),
      page_id: safeText(row.pageId),
      page_name: safeText(row.pageName),
      access_token: safeText(row.pageToken),
    },
  });
}

/** Every Page this grant covers, WITH its Instagram fields. */
async function listPagesWithInstagram(userAccessToken) {
  const token = safeText(userAccessToken);
  if (!token) {
    return { ok: false, status: 400, error: 'A Facebook user access token is required to find Instagram accounts' };
  }
  const creds = facebookPage.getMetaAppCredentials();
  const params = new URLSearchParams({ fields: PAGE_FIELDS, access_token: token, limit: '100' });
  const res = await facebookPage.fetchJson(`${creds.baseUrl}/me/accounts?${params.toString()}`);
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: Array.isArray(res.data?.data) ? res.data.data : [] };
}

/**
 * The accounts behind a user token, or the pre-flight refusal.
 *
 * Shared by `exchange` and `listAccounts` so the two checks cannot drift apart
 * — the failure mode being that connecting refuses a personal account while
 * slice 6's health sweep quietly accepts it, or the reverse.
 */
async function accountsForUserToken(userAccessToken) {
  const pagesRes = await listPagesWithInstagram(userAccessToken);
  if (!pagesRes.ok) return contract.normalize(pagesRes, 502);

  const inspected = inspectPages(pagesRes.data);
  const refusal = preflight(inspected);
  if (refusal) return refusal;

  // `eligible` only — and that word now carries the Page token, so a tokenless
  // Page can never reach `toAccount`. This filter is what stops a mixed grant
  // (one good Page, one the grant does not cover) half-writing: the bad account
  // is never built, so `storeAccounts` never gets part way through the list.
  const accounts = inspected.filter((row) => row.verdict === 'eligible').map(toAccount);
  return contract.ok(200, { accounts, pages: pagesRes.data, inspected });
}

// ---------------------------------------------------------------------------
// The six.
// ---------------------------------------------------------------------------

function authorizeUrl({ projectId, userId } = {}) {
  const creds = facebookPage.getMetaAppCredentials();
  if (!facebookPage.isMetaAppConfigured(creds)) {
    return contract.fail(400, 'Meta app_id and app_secret are required (Vercel env or Settings > APIs > Meta)');
  }

  // The state says `instagram`, which is the only thing that survives the round
  // trip and tells the shared Meta callback which adapter finishes the job.
  const stateRes = buildOAuthState({ projectId, userId, provider: PROVIDER });
  if (!stateRes.ok) return contract.normalize(stateRes, 400);

  const redirectUri = callbackUrl();
  const params = new URLSearchParams({
    client_id: creds.appId,
    redirect_uri: redirectUri,
    state: stateRes.data,
    scope: DEFAULT_SCOPES,
    response_type: 'code',
  });
  return contract.ok(200, {
    url: `${facebookPage.facebookDialogBase()}?${params.toString()}`,
    redirectUri,
    scopes: DEFAULT_SCOPES,
  });
}

/**
 * The code Meta handed back, turned into Instagram accounts — or refused.
 *
 * Nothing is stored here and nothing is stored by the caller on a refusal:
 * `routes/connections.js` only saves when this envelope is ok, so a personal
 * account leaves no half-written row behind. That is acceptance criterion 2,
 * and it is a property of returning the refusal rather than of remembering to
 * clean up.
 */
async function exchange({ code, redirectUri } = {}) {
  const trimmed = safeText(code);
  if (!trimmed) return contract.fail(400, 'An OAuth code is required to finish connecting Instagram');

  const shortRes = await facebookPage.exchangeCodeForToken(trimmed, safeText(redirectUri) || callbackUrl());
  if (!shortRes.ok) return contract.normalize(shortRes, 502);
  const shortToken = safeText(shortRes.data?.access_token);
  if (!shortToken) {
    return contract.fail(502, 'Meta accepted the sign-in but returned no access token');
  }

  // Same fallback the Facebook flow uses: a failed long-lived exchange is not
  // fatal, it just means the grant expires sooner, and refusing here would turn
  // a degraded connection into no connection at all.
  const longRes = await facebookPage.exchangeForLongLivedUserToken(shortToken);
  const userToken = longRes.ok ? (safeText(longRes.data?.access_token) || shortToken) : shortToken;

  const res = await accountsForUserToken(userToken);
  if (!res.ok) return res;

  return contract.ok(200, {
    ...res.data,
    userTokenExchange: {
      shortLived: Boolean(shortToken),
      longLived: Boolean(longRes.ok && longRes.data?.access_token),
    },
  });
}

/**
 * INHERITED GAP, NAMED RATHER THAN PAPERED OVER.
 *
 * `/me/accounts` wants the USER token, and the accounts above carry the PAGE
 * token — so feeding this adapter its own output makes Meta refuse, exactly as
 * it does for Facebook Pages (see the same note in facebookPage.js, deferred
 * there to slice 6). Nothing outside the adapters calls `listAccounts` today;
 * slice 6 (86bbpz1gv) is where stored connections are swept for health and is
 * where the user token either gets stored alongside the Page token or this
 * function comes to mean something narrower.
 *
 * It is written to take whatever token it is given rather than to assume, so
 * whichever way slice 6 decides, this reads correctly.
 */
async function listAccounts(input = {}) {
  const token = contract.accountRef(input).accessToken;
  if (!token) return contract.fail(400, 'A Facebook user access token is required to list Instagram accounts');
  return accountsForUserToken(token);
}

/**
 * A Page token issued from a long-lived user token does not expire, and an
 * Instagram grant rides that same token — so there is nothing to refresh. That
 * is a fact about Meta, not a failure, so it answers ok with `refreshed: false`
 * and says why, and a caller sweeping every platform does not need to know
 * which ones have refresh tokens.
 */
async function refresh(input = {}) {
  const token = contract.accountRef(input).accessToken;
  if (!token) return contract.fail(400, 'An Instagram (Facebook Page) access token is required');
  return contract.ok(200, {
    refreshed: false,
    accessToken: token,
    reason: 'Instagram posts through a Facebook Page, and a Page token issued from a long-lived user '
      + 'token does not expire, so there is nothing to refresh. If it stops working, a permission was '
      + 'changed on the account and the connection has to be made again.',
  });
}

/** Does this grant still work RIGHT NOW — asked of the Instagram account itself. */
async function verify(input = {}) {
  const { accountId: igUserId, accessToken: token } = contract.accountRef(input);
  if (!igUserId || !token) {
    return contract.fail(400, 'Instagram verify needs the Instagram account id and its access token');
  }
  const creds = facebookPage.getMetaAppCredentials();
  const params = new URLSearchParams({ fields: 'id,username', access_token: token });
  const res = await facebookPage.fetchJson(`${creds.baseUrl}/${encodeURIComponent(igUserId)}?${params.toString()}`);
  if (!res.ok) return contract.normalize(res, 502);
  return contract.ok(res.status || 200, {
    valid: true,
    accountId: safeText(res.data?.id) || igUserId,
    accountLabel: handle(res.data?.username),
  });
}

/**
 * Hand the permission back at Meta's end. Best effort, and it says which it
 * managed — the same shape the Facebook adapter uses, and for the same reason:
 * Meta answering "this token is already dead" IS a successful revoke from
 * where the client is standing, and deleting the stored row is the caller's
 * job either way.
 *
 * The permission lives on the PAGE, whose id rides on `raw`. `raw` is dropped
 * by `contract.storableAccount`, so an account read back out of the vault will
 * not have it — that is the known two-part-credential gap the contract
 * documents, and it is handled here rather than assumed away: with no Page id
 * this returns ok, `revokedAtProvider: false`, and the one instruction a client
 * can actually follow.
 */
async function revoke(input = {}) {
  const ref = contract.accountRef(input);
  if (!ref.accountId || !ref.accessToken) {
    return contract.fail(400, 'Instagram revoke needs the Instagram account id and its access token');
  }
  const pageId = safeText(ref.raw?.page_id);
  if (!pageId) {
    return contract.ok(200, {
      revokedAtProvider: false,
      reason: 'Starcaster has forgotten this connection, but the permission is granted to the Facebook '
        + 'Page behind the Instagram account and that Page is no longer recorded here. To withdraw it at '
        + "Meta's end, remove Starcaster under Facebook Settings > Business Integrations.",
    });
  }

  const creds = facebookPage.getMetaAppCredentials();
  const params = new URLSearchParams({ access_token: ref.accessToken });
  const res = await facebookPage.fetchJson(
    `${creds.baseUrl}/${encodeURIComponent(pageId)}/permissions?${params.toString()}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    return contract.ok(200, {
      revokedAtProvider: false,
      reason: `Meta did not confirm the revoke (${res.error}). Remove the stored connection anyway, `
        + 'and the client can also remove Starcaster under Facebook Settings > Business Integrations.',
    });
  }
  return contract.ok(res.status || 200, { revokedAtProvider: true });
}

module.exports = {
  provider: PROVIDER,
  authKind: 'redirect',
  callbackPath: CALLBACK_PATH,
  callbackUrl,
  isConfigured: facebookPage.isMetaAppConfigured,

  authorizeUrl,
  exchange,
  listAccounts,
  refresh,
  verify,
  revoke,

  // Exported so the tests can pin the checks and their sentences directly,
  // rather than inferring them from a whole round trip against a stubbed Meta.
  DEFAULT_SCOPES,
  PAGE_FIELDS,
  MESSAGES,
  inspectPages,
  preflight,
  toAccount,
  listPagesWithInstagram,
  accountsForUserToken,
};
