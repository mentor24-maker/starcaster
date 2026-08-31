'use strict';

/**
 * Kept as an alias, not as an implementation.
 *
 * Every line that used to be here moved to lib/connections/adapters/facebookPage.js
 * in Connections 2 of 7 (86bbpz1e1), which is the port that proves the adapter
 * contract can hold a flow that already worked in production. This file stays
 * because other code requires it by name, and a rename is not worth a broken
 * Facebook connection.
 *
 * One behaviour changed in the move, deliberately: `buildRedirectUri` no longer
 * builds anything from the origin it is handed. The OAuth callback is pinned to
 * the production origin (lib/connections/contract.js, PRODUCTION_ORIGIN),
 * because lib/appOrigin.js falls back to VERCEL_URL and every preview
 * deployment has a different one — a redirect_uri Meta has never been told
 * about and rejects.
 */

const facebookPage = require('./connections/adapters/facebookPage');

/** Accepts an origin and ignores it. See the file header for why. */
function buildRedirectUri(_origin) {
  return facebookPage.callbackUrl();
}

module.exports = {
  DEFAULT_SCOPES: facebookPage.DEFAULT_SCOPES,
  getMetaAppCredentials: facebookPage.getMetaAppCredentials,
  isMetaAppConfigured: facebookPage.isMetaAppConfigured,
  buildRedirectUri,
  buildOAuthStartUrl: facebookPage.buildOAuthStartUrl,
  completeOAuthCodeExchange: facebookPage.completeOAuthCodeExchange,
  listManagedPages: facebookPage.listManagedPages,
};
