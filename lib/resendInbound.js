'use strict';

/**
 * Receive an email Resend tells us about, and forward it (SC-926).
 *
 * Resend receives mail for a domain whose MX record points at it, then calls
 * POST /api/webhooks/resend/inbound with an `email.received` event. That event
 * is METADATA only — who, to whom, subject, attachment names. The body and the
 * attachments are fetched from Resend's Received emails API, and the message
 * is sent on through lib/mailer.js to the inbox the address's route names.
 *
 * The call is signed the Svix way (svix-id, svix-timestamp, svix-signature):
 * HMAC-SHA256 over `${id}.${timestamp}.${raw body}`, keyed with the base64
 * part of RESEND_WEBHOOK_SECRET after `whsec_`. Over the RAW bytes — a parsed
 * and re-serialised body is not what was signed. Nothing is trusted until the
 * signature checks out; with no secret set, nothing is accepted at all.
 *
 * Resend retries a delivery it did not get a 2xx for, with the SAME svix-id.
 * So: a delivery is recorded by svix-id before anything is sent, a repeat of a
 * finished one answers 200 and sends nothing, and a failed one answers non-200
 * on purpose so Resend tries again. Mail is never dropped in silence: a failed
 * forward is written to the delivery row AND posted once to the bus.
 *
 * Everything outside this file comes in through `deps`, so the tests drive the
 * whole path with no network: { secret, apiKey, store, sendEmail, postBus,
 * fetchImpl, now }.
 */

const crypto = require('crypto');

const SECRET_ENV = 'RESEND_WEBHOOK_SECRET';
const API_BASE = 'https://api.resend.com';
/** Svix's own replay window. An older (or future-dated) call is refused. */
const TOLERANCE_SECONDS = 5 * 60;
/**
 * Resend refuses an email over 40MB once attachments are base64-encoded. A
 * little under that leaves room for the message itself. Over it, the message
 * is still forwarded, without its attachments and with a note naming them —
 * losing the attachments loudly beats losing the email.
 */
const MAX_ATTACHMENT_BASE64_BYTES = 38 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;

// ── Signature ───────────────────────────────────────────────────────────────

/**
 * { ok: true } or { ok: false, reason } — the reason says which part failed,
 * for the 401 and the log, and never carries the secret.
 */
function verifySvixSignature({ secret, id, timestamp, signature, body, now = Date.now() }) {
  const svixId = String(id || '').trim();
  const ts = String(timestamp || '').trim();
  const sigHeader = String(signature || '').trim();
  if (!svixId || !ts || !sigHeader) return { ok: false, reason: 'the svix-id, svix-timestamp and svix-signature headers are all required' };
  if (!/^\d+$/.test(ts)) return { ok: false, reason: 'svix-timestamp is not a number of seconds' };
  const ageSeconds = Math.abs(Math.floor(now / 1000) - Number(ts));
  if (ageSeconds > TOLERANCE_SECONDS) return { ok: false, reason: `svix-timestamp is ${ageSeconds}s from now, outside the ${TOLERANCE_SECONDS}s window` };

  const text = String(secret || '').trim();
  const keyPart = text.startsWith('whsec_') ? text.slice('whsec_'.length) : text;
  const key = Buffer.from(keyPart, 'base64');
  if (!key.length) return { ok: false, reason: `${SECRET_ENV} is not a usable signing secret` };

  const expected = crypto.createHmac('sha256', key).update(`${svixId}.${ts}.${String(body ?? '')}`).digest();
  for (const entry of sigHeader.split(/\s+/)) {
    const comma = entry.indexOf(',');
    if (comma === -1 || entry.slice(0, comma) !== 'v1') continue;
    let given;
    try { given = Buffer.from(entry.slice(comma + 1), 'base64'); } catch { continue; }
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: 'no v1 signature in svix-signature matches the body' };
}

/** The headers Resend would send for `body`, signed with `secret`. Tests and the curl helper use it. */
function signForTest({ secret, id, timestamp, body }) {
  const keyPart = String(secret).startsWith('whsec_') ? String(secret).slice(6) : String(secret);
  const sig = crypto.createHmac('sha256', Buffer.from(keyPart, 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${sig}` };
}

// ── Resend's Received emails API ────────────────────────────────────────────

async function resendGet(path, deps) {
  const fetchImpl = deps.fetchImpl || fetch;
  try {
    const res = await fetchImpl(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${deps.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `Resend answered ${res.status} to GET ${path}: ${json?.message || json?.error?.message || 'no message'}` };
    return { ok: true, json };
  } catch (err) {
    return { ok: false, error: `GET ${path} did not reach Resend: ${err?.message || err}` };
  }
}

async function download(url, deps) {
  const fetchImpl = deps.fetchImpl || fetch;
  try {
    // A signed CDN link: it carries its own permission, so the API key is
    // deliberately NOT sent to it.
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, error: `downloading it answered ${res.status}` };
    return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) };
  } catch (err) {
    return { ok: false, error: `downloading it failed: ${err?.message || err}` };
  }
}

/** The whole message: body plus every attachment, base64. */
async function fetchFullEmail(emailId, deps) {
  const id = encodeURIComponent(emailId);
  // `cid` keeps inline pictures as cid: references matching their attachment,
  // which the forward carries as inline attachments. The default (data: URIs
  // in the HTML) is what Gmail refuses to show.
  const email = await resendGet(`/emails/receiving/${id}?html_format=cid`, deps);
  if (!email.ok) return { ok: false, error: `could not fetch the email: ${email.error}` };

  const listed = [];
  let after = '';
  for (let page = 0; page < 20; page += 1) {
    const q = `limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const res = await resendGet(`/emails/receiving/${id}/attachments?${q}`, deps);
    if (!res.ok) return { ok: false, error: `could not list its attachments: ${res.error}` };
    const data = Array.isArray(res.json?.data) ? res.json.data : [];
    listed.push(...data);
    if (!res.json?.has_more || !data.length) break;
    after = String(data[data.length - 1].id || '');
  }

  const totalBase64 = listed.reduce((sum, a) => sum + Math.ceil((Number(a.size) || 0) / 3) * 4, 0);
  if (totalBase64 > MAX_ATTACHMENT_BASE64_BYTES) {
    return { ok: true, email: email.json, attachments: [], omitted: listed };
  }
  const attachments = [];
  for (const a of listed) {
    const got = await download(String(a.download_url || ''), deps);
    if (!got.ok) return { ok: false, error: `could not fetch attachment "${a.filename || a.id}": ${got.error}` };
    attachments.push({
      filename: String(a.filename || 'attachment'),
      content: got.buffer.toString('base64'),
      contentType: a.content_type || undefined,
      contentId: a.content_disposition === 'inline' && a.content_id ? String(a.content_id) : undefined,
    });
  }
  return { ok: true, email: email.json, attachments, omitted: [] };
}

// ── The forwarded message ───────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function displayName(fromHeader) {
  const m = /^\s*"?([^"<]*?)"?\s*</.exec(String(fromHeader || ''));
  return m ? m[1].trim() : '';
}

function listOf(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value ? [String(value)] : [];
}

/** Subject, text, html, reply-to and sender name for the forward. */
function composeForward({ email, event, address, omitted }) {
  const fromHeader = String(email?.headers?.from || email?.from || event.from || '');
  const senderAddress = String(email?.from || event.from || '').replace(/^.*<([^>]+)>.*$/, '$1').trim();
  const name = displayName(fromHeader).replace(/[<>"@]/g, '') || senderAddress.replace('@', ' at ');
  const subject = String(email?.subject ?? event.subject ?? '');
  const date = String(email?.created_at || event.created_at || '');
  const to = listOf(email?.to || event.to).join(', ');
  const cc = listOf(email?.cc || event.cc).join(', ');
  const replyTo = listOf(email?.reply_to).length ? listOf(email.reply_to) : (senderAddress ? [senderAddress] : []);

  const head = [
    '---------- Forwarded message ----------',
    `From: ${fromHeader || senderAddress}`,
    `Date: ${date}`,
    `Subject: ${subject}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Received at: ${address}`,
  ];
  const omittedNote = omitted.length
    ? `Attachments NOT forwarded (too large to send on, ${omitted.length}): ${omitted.map((a) => `${a.filename || a.id} (${a.size} bytes)`).join(', ')}. They are still in Resend under received email ${email?.id || event.email_id}.`
    : '';

  const text = [...head, ...(omittedNote ? ['', omittedNote] : []), '', String(email?.text || '')].join('\n');
  const htmlHead = `<div style="font-family:sans-serif;font-size:13px;color:#555;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:12px">${head.map(escapeHtml).join('<br>')}${omittedNote ? `<br><br><strong>${escapeHtml(omittedNote)}</strong>` : ''}</div>`;
  const body = email?.html ? String(email.html) : `<pre style="white-space:pre-wrap">${escapeHtml(email?.text || '')}</pre>`;

  return { subject, text, html: `${htmlHead}${body}`, replyTo, fromName: `${name} (via ${address})`.trim() };
}

// ── The webhook ─────────────────────────────────────────────────────────────

function answer(status, payload) {
  return { status, payload };
}
function okAnswer(data) {
  return answer(200, { ok: true, data });
}
function errAnswer(status, message, code) {
  return answer(status, { ok: false, error: { message, ...(code ? { code } : {}) } });
}

/**
 * The re-serialised refusal posts at most once per six hours per server copy.
 * Per copy, not shared: a cold Vercel copy can post its own line, which is the
 * right side to err on for an alarm that means "all inbound mail is stopping".
 */
const RESERIALISED_WARN_MS = 6 * 60 * 60 * 1000;
let lastReserialisedWarnAt = 0;
function shouldWarnReserialised(now, deps) {
  const state = deps.warnState || { get: () => lastReserialisedWarnAt, set: (t) => { lastReserialisedWarnAt = t; } };
  const last = Number(state.get()) || 0;
  if (last && now - last < RESERIALISED_WARN_MS) return false;
  state.set(now);
  return true;
}

async function busSay(deps, text) {
  try {
    const out = await deps.postBus(text);
    if (!out?.ok) console.error(`[resendInbound] the bus post did not go through: ${out?.why || 'no reason given'} — the message was: ${text}`);
    return out;
  } catch (err) {
    console.error(`[resendInbound] the bus post threw: ${err?.message || err} — the message was: ${text}`);
    return { ok: false, why: String(err?.message || err) };
  }
}

/**
 * Handle one webhook call. `{ headers, rawBody, rawExact }` in; `{ status,
 * payload }` out — the route only writes it.
 */
async function handleInbound({ headers = {}, rawBody = '', rawExact = true } = {}, deps = {}) {
  const now = deps.now ?? Date.now();
  const store = deps.store;
  const secret = String(deps.secret ?? process.env[SECRET_ENV] ?? '').trim();
  if (!secret) {
    return errAnswer(503, `${SECRET_ENV} is not set, so no inbound email can be accepted (Resend will retry). Set it from the webhook's signing secret in Resend.`, 'SECRET_MISSING');
  }
  const h = (name) => headers[name] ?? headers[name.toLowerCase()];
  const verified = verifySvixSignature({
    secret, id: h('svix-id'), timestamp: h('svix-timestamp'), signature: h('svix-signature'), body: rawBody, now,
  });
  if (!verified.ok) {
    const why = rawExact
      ? verified.reason
      : `${verified.reason} — and the original request bytes were not available (the host had already parsed the body), so the check ran over a re-serialised copy`;
    console.warn(`[resendInbound] refused a webhook call: ${why}`);
    if (!rawExact && shouldWarnReserialised(now, deps)) {
      // This is the "mail silently stops" case: if the host never hands us the
      // signed bytes, EVERY real email is refused here, Resend gives up after
      // its retries, and nothing else would say so. A forged call lands here
      // too, which is why it is limited, never per call.
      await busSay(deps, `Inbound email is being REFUSED (401): the signature check ran over a re-serialised copy of the body because the original bytes were not available, and it did not match. If this is real mail, every email to our received addresses is bouncing back to Resend. Check how the host hands the body to routes/http.js readRawBody. Detail: ${verified.reason}`);
    }
    return errAnswer(401, `Signature check failed: ${why}`, 'BAD_SIGNATURE');
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return errAnswer(400, 'The body is not JSON', 'BAD_JSON'); }
  if (event?.type !== 'email.received') {
    return okAnswer({ outcome: 'ignored', why: `event type "${event?.type}" is not email.received` });
  }
  const data = event.data || {};
  const svixId = String(h('svix-id'));
  const emailId = String(data.email_id || '').trim();
  if (!emailId) return errAnswer(400, 'The email.received event carries no email_id', 'BAD_EVENT');

  const recipients = [...new Set([...listOf(data.received_for), ...listOf(data.to), ...listOf(data.cc)]
    .map(store.normalizeAddress).filter(Boolean))];

  const claim = await store.claimDelivery(svixId, {
    resendEmailId: emailId,
    toAddress: recipients.join(', '),
    fromAddress: String(data.from || ''),
    subject: String(data.subject || ''),
    receivedAt: data.created_at || event.created_at || null,
  }, { now });
  if (!claim.ok) {
    // Could not even record it: say so and make Resend retry.
    await busSay(deps, `Inbound email could not be recorded, so it was not forwarded yet (Resend will retry). From ${data.from || '?'} to ${recipients.join(', ') || '?'}: ${claim.error}`);
    return errAnswer(claim.status === 503 ? 503 : 500, claim.error, claim.code || 'STORE_FAILED');
  }
  if (claim.data.action === 'duplicate') return okAnswer({ outcome: claim.data.row.outcome, duplicate: true });
  if (claim.data.action === 'busy') return errAnswer(409, `Delivery ${svixId} is being handled by another request; try again shortly`, 'IN_PROGRESS');
  const row = claim.data.row;
  const attempt = Number(row.attempts) || 1;

  const finish = async (fields) => {
    const done = await store.finishDelivery(row, fields, { now });
    if (!done.ok) console.error(`[resendInbound] ${done.error}`);
    return done;
  };
  const failed = async (error, { projectId, ownerUserId } = {}) => {
    await finish({ outcome: 'failed', error, projectId, ownerUserId });
    if (attempt === 1) {
      await busSay(deps, `Inbound email NOT forwarded yet — Resend will retry. To ${recipients.join(', ') || '?'}, from ${data.from || '?'}, subject "${data.subject || ''}": ${error}`);
    }
    return errAnswer(502, `Not forwarded (Resend will retry): ${error}`, 'FORWARD_FAILED');
  };

  const routes = await store.findRoutes(recipients);
  if (!routes.ok) return failed(routes.error);
  if (!routes.data.length) {
    // A route that exists but is switched off is a decision, not a gap: say
    // so in the log, under that route's project, so its settings screen can
    // show it (SC-928). No bus post — switching it off was deliberate.
    const any = await store.findRoutes(recipients, { includeDisabled: true });
    if (!any.ok) return failed(any.error);
    const off = any.data.filter((r) => !r.enabled);
    if (off.length) {
      const why = `the route for ${off.map((r) => r.address).join(', ')} is switched off`;
      const done = await finish({ outcome: 'refused', error: why, projectId: off[0].project_id, ownerUserId: off[0].owner_user_id });
      if (!done.ok) return errAnswer(500, done.error, 'STORE_FAILED');
      return okAnswer({ outcome: 'refused', why });
    }
    const done = await finish({ outcome: 'no_route', error: `no enabled route for ${recipients.join(', ') || '(no recipient)'}` });
    if (!done.ok) return errAnswer(500, done.error, 'STORE_FAILED');
    return okAnswer({ outcome: 'no_route' });
  }
  const primary = routes.data[0];
  const tenant = { projectId: primary.project_id, ownerUserId: primary.owner_user_id };
  const forwardTo = [...new Set(routes.data.map((r) => store.normalizeAddress(r.forward_to)).filter(Boolean))];

  const loop = await store.findRoutes(forwardTo);
  if (!loop.ok) return failed(loop.error, tenant);
  if (loop.data.length) {
    const why = `forwarding to ${loop.data.map((r) => r.address).join(', ')} would loop: that is itself an address we receive`;
    await finish({ outcome: 'refused', error: why, ...tenant });
    await busSay(deps, `Inbound email refused — ${why}. From ${data.from || '?'}, subject "${data.subject || ''}". Change the route for ${primary.address}.`);
    return okAnswer({ outcome: 'refused' });
  }

  if (!deps.apiKey) return failed('there is no Resend API key to fetch the email with', tenant);
  const full = await fetchFullEmail(emailId, deps);
  if (!full.ok) return failed(full.error, tenant);

  const message = composeForward({ email: full.email, event: data, address: primary.address, omitted: full.omitted });
  const sent = await deps.sendEmail({
    to: forwardTo,
    subject: message.subject,
    html: message.html,
    text: message.text,
    fromName: message.fromName,
    fromEmail: primary.address,
    replyTo: message.replyTo,
    attachments: full.attachments,
  });
  if (!sent?.ok) return failed(`sending it on to ${forwardTo.join(', ')} failed: ${sent?.error || 'no reason given'}`, tenant);

  const omittedNote = full.omitted.length ? `forwarded without ${full.omitted.length} attachment(s), too large to send on` : '';
  const done = await finish({ outcome: 'forwarded', error: omittedNote, forwardedEmailId: String(sent.data?.id || ''), ...tenant });
  if (omittedNote) {
    await busSay(deps, `Inbound email to ${primary.address} from ${data.from || '?'} was ${omittedNote} (${full.omitted.map((a) => a.filename || a.id).join(', ')}). They are still in Resend under received email ${emailId}.`);
  }
  if (attempt > 1) {
    await busSay(deps, `Inbound email to ${primary.address} from ${data.from || '?'} was forwarded on attempt ${attempt}, after the earlier failure.`);
  }
  if (!done.ok) return okAnswer({ outcome: 'forwarded', recorded: false, why: done.error });
  return okAnswer({ outcome: 'forwarded', to: forwardTo });
}

module.exports = {
  SECRET_ENV,
  TOLERANCE_SECONDS,
  RESERIALISED_WARN_MS,
  MAX_ATTACHMENT_BASE64_BYTES,
  verifySvixSignature,
  signForTest,
  fetchFullEmail,
  composeForward,
  handleInbound,
};
