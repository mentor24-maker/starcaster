'use strict';

/**
 * POST /api/webhooks/resend/inbound — Resend calls this when an email arrives
 * for an address on a domain whose mail it receives for us (SC-926).
 *
 * Public by necessity (Resend has no session), so routes/index.js exempts this
 * ONE exact path from the login check. It grants nothing by itself: every
 * call must carry a valid Svix signature made with RESEND_WEBHOOK_SECRET, over
 * the raw request bytes, within five minutes — lib/resendInbound.js checks
 * that before reading anything else. The work lives there; this file only
 * reads the raw body and writes the answer.
 */

const { sendJson, sendErr, readRawBody } = require('./http');

const PATH = '/api/webhooks/resend/inbound';

const manifest = {
  id: 'inboundEmail',
  label: 'Inbound email (Resend webhook)',
  prefixes: [PATH],
};

function realDeps() {
  const store = require('../lib/inboundEmailStore');
  const { sendEmail, resendApiKey } = require('../lib/mailer');
  const { postBusMessage } = require('../lib/trackerForward');
  return { store, sendEmail, apiKey: resendApiKey(), postBus: postBusMessage };
}

async function handle(req, res, pathname, method, deps) {
  if (pathname !== PATH) return false;
  if (String(method || '').toUpperCase() !== 'POST') {
    return sendErr(res, 405, 'Only POST is accepted here', { code: 'METHOD_NOT_ALLOWED' });
  }
  const body = await readRawBody(req);
  if (!body.ok) return sendErr(res, 413, body.error, { code: 'BODY_UNREADABLE' });
  const { handleInbound } = require('../lib/resendInbound');
  const out = await handleInbound(
    { headers: req.headers || {}, rawBody: body.raw, rawExact: body.exact },
    deps || realDeps(),
  );
  return sendJson(res, out.status, out.payload);
}

module.exports = { handle, manifest, PATH };
