'use strict';

/**
 * Inbound email: which addresses we receive and where each forwards, and one
 * record per webhook delivery Resend made (SC-926).
 *
 * Tables: docs/SQL/inbound_email_setup.sql.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10).
 *
 * TENANCY: both tenant columns are written explicitly, never through
 * scopedInsertRow (landmine 12). Mail arrives with no signed-in person, so a
 * delivery takes its project and owner from the ROUTE it matched — the row
 * that says this address is that project's.
 *
 * THE DATABASE IS THE ONLY STORE. No local-file fallback (landmines 6, 15): a
 * store that "saved" a delivery to a file on Vercel would forget every one,
 * and the dedupe it exists for would quietly stop working.
 */

const { sbQuery, tableConfig } = require('./supabase');

const SQL_FILE = 'docs/SQL/inbound_email_setup.sql';
const OUTCOMES = Object.freeze(['received', 'forwarded', 'no_route', 'refused', 'failed']);
/** Outcomes that are final: a repeat delivery with the same svix-id sends nothing. */
const FINAL_OUTCOMES = Object.freeze(['forwarded', 'no_route', 'refused']);
/**
 * A delivery still marked `received` this long after it was claimed belongs to
 * a pass that died (a frozen serverless function, a crash). Resend's retry may
 * take it over. Shorter than that, another pass is probably still sending it,
 * and taking it over would forward the message twice.
 */
const STALE_CLAIM_MS = 2 * 60 * 1000;
const MAX_ERROR_LENGTH = 1000;
const MAX_TEXT_LENGTH = 500;
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function routesTable() {
  return tableConfig().inboundEmailRoutes || 'inbound_email_routes';
}

function deliveriesTable() {
  return tableConfig().inboundEmailDeliveries || 'inbound_email_deliveries';
}

/** `Ann <ANN@Example.com>` → `ann@example.com`; '' when there is no address. */
function normalizeAddress(value) {
  const text = String(value || '').trim();
  const angled = /<([^<>]+)>/.exec(text);
  const bare = (angled ? angled[1] : text).trim().toLowerCase();
  return EMAIL_RE.test(bare) ? bare : '';
}

function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function missingTable(res) {
  const text = `${res?.error || ''} ${JSON.stringify(res?.data || '')}`;
  return res?.status === 404 || /42P01|does not exist|could not find the table/i.test(text);
}

function fail(res, what) {
  if (missingTable(res)) {
    return { ok: false, status: 503, error: `${what}: the inbound email tables are missing — run ${SQL_FILE}`, code: 'TABLES_MISSING' };
  }
  return { ok: false, status: res?.status || 500, error: `${what}: ${res?.error || `the database answered ${res?.status}`}` };
}

/** Enabled routes for any of these addresses. */
async function findRoutes(addresses) {
  const list = [...new Set((addresses || []).map(normalizeAddress).filter(Boolean))];
  if (!list.length) return { ok: true, status: 200, data: [] };
  // normalizeAddress admits no comma, quote or bracket, so the bare list is
  // unambiguous to PostgREST without quoting each value.
  const inList = list.join(',');
  const res = await sbQuery({
    table: routesTable(),
    query: `select=*&enabled=eq.true&address=in.(${encodeURIComponent(inList)})`,
  });
  if (!res.ok) return fail(res, 'could not read the inbound email routes');
  return { ok: true, status: 200, data: Array.isArray(res.data) ? res.data : [] };
}

/**
 * Add an address to receive. Until SC-928's screen exists this is how a route
 * is made (or with SQL). Refuses a route whose forward_to is itself a received
 * address, because that mail would come straight back and forward again.
 */
async function addRoute({ address, forwardTo, enabled = true } = {}, scope = {}) {
  const projectId = String(scope.projectId || '').trim();
  const userId = String(scope.userId || '').trim();
  if (!projectId || !userId) return { ok: false, status: 400, error: 'a route needs a project and an owner (scope.projectId and scope.userId)' };
  const addr = normalizeAddress(address);
  const to = normalizeAddress(forwardTo);
  if (!addr) return { ok: false, status: 400, error: `"${address}" is not an email address to receive` };
  if (!to) return { ok: false, status: 400, error: `"${forwardTo}" is not an email address to forward to` };
  if (addr === to) return { ok: false, status: 400, error: `${addr} cannot forward to itself` };
  const loop = await findRoutes([to]);
  if (!loop.ok) return loop;
  if (loop.data.length) return { ok: false, status: 400, error: `${to} is itself an address we receive, so forwarding there would loop` };

  const res = await sbQuery({
    method: 'POST',
    table: routesTable(),
    body: { project_id: projectId, owner_user_id: userId, address: addr, forward_to: to, enabled: Boolean(enabled) },
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) {
    if (res.status === 409) return { ok: false, status: 409, error: `${addr} is already received by a project` };
    return fail(res, `could not add the route for ${addr}`);
  }
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row || row.project_id !== projectId || row.owner_user_id !== userId) {
    return { ok: false, status: 500, error: `the route for ${addr} was written but did not read back with its project and owner` };
  }
  return { ok: true, status: 201, data: row };
}

async function readDelivery(svixId) {
  const res = await sbQuery({ table: deliveriesTable(), query: `select=*&svix_id=eq.${encodeURIComponent(svixId)}&limit=1` });
  if (!res.ok) return fail(res, `could not read delivery ${svixId}`);
  return { ok: true, status: 200, data: Array.isArray(res.data) ? (res.data[0] || null) : null };
}

/**
 * Take a delivery for handling. Answers `data`:
 *   { action: 'handle', row }    first sight, or a retry of a failed/dead one
 *   { action: 'duplicate', row } already finished: send nothing
 *   { action: 'busy', row }      another pass claimed it moments ago
 *
 * The insert is what makes the first sight exclusive (svix_id is unique). A
 * retry is claimed by a PATCH guarded on the outcome AND attempt count it
 * read, so two retries landing together cannot both win.
 */
async function claimDelivery(svixId, meta = {}, { now = Date.now() } = {}) {
  const id = String(svixId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'a delivery needs its svix-id' };
  const stamp = new Date(now).toISOString();
  const body = {
    svix_id: id,
    resend_email_id: clip(meta.resendEmailId, MAX_TEXT_LENGTH),
    to_address: clip(meta.toAddress, MAX_TEXT_LENGTH),
    from_address: clip(meta.fromAddress, MAX_TEXT_LENGTH),
    subject: clip(meta.subject, MAX_TEXT_LENGTH),
    received_at: meta.receivedAt || null,
    outcome: 'received',
    attempts: 1,
    created_at: stamp,
    updated_at: stamp,
  };
  const ins = await sbQuery({ method: 'POST', table: deliveriesTable(), body, headers: { Prefer: 'return=representation' } });
  if (ins.ok) {
    const row = Array.isArray(ins.data) ? ins.data[0] : ins.data;
    if (!row) return { ok: false, status: 500, error: `delivery ${id} was written but did not read back` };
    return { ok: true, status: 200, data: { action: 'handle', row } };
  }
  if (ins.status !== 409) return fail(ins, `could not record delivery ${id}`);

  const existing = await readDelivery(id);
  if (!existing.ok) return existing;
  const row = existing.data;
  if (!row) return { ok: false, status: 500, error: `delivery ${id} conflicted on insert but could not be found` };
  if (FINAL_OUTCOMES.includes(row.outcome)) return { ok: true, status: 200, data: { action: 'duplicate', row } };
  const claimedAt = Date.parse(row.updated_at || row.created_at || '');
  const stale = !Number.isFinite(claimedAt) || now - claimedAt >= STALE_CLAIM_MS;
  if (row.outcome === 'received' && !stale) return { ok: true, status: 200, data: { action: 'busy', row } };

  const attempts = Number(row.attempts) || 1;
  const take = await sbQuery({
    method: 'PATCH',
    table: deliveriesTable(),
    query: `svix_id=eq.${encodeURIComponent(id)}&outcome=eq.${encodeURIComponent(row.outcome)}&attempts=eq.${attempts}`,
    body: { outcome: 'received', attempts: attempts + 1, updated_at: stamp },
    headers: { Prefer: 'return=representation' },
  });
  if (!take.ok) return fail(take, `could not take over delivery ${id}`);
  const taken = Array.isArray(take.data) ? take.data[0] : take.data;
  if (!taken) {
    const now2 = await readDelivery(id);
    return { ok: true, status: 200, data: { action: 'busy', row: now2.ok ? (now2.data || row) : row } };
  }
  return { ok: true, status: 200, data: { action: 'handle', row: taken } };
}

/** Record how a claimed delivery ended. Guarded on the attempt it claimed. */
async function finishDelivery(row, { outcome, error = '', projectId, ownerUserId, toAddress, forwardedEmailId } = {}, { now = Date.now() } = {}) {
  if (!OUTCOMES.includes(outcome) || outcome === 'received') {
    return { ok: false, status: 400, error: `"${outcome}" is not an outcome a delivery can end with` };
  }
  const patch = { outcome, error: clip(error, MAX_ERROR_LENGTH), updated_at: new Date(now).toISOString() };
  if (projectId !== undefined) patch.project_id = projectId || null;
  if (ownerUserId !== undefined) patch.owner_user_id = ownerUserId || null;
  if (toAddress !== undefined) patch.to_address = clip(toAddress, MAX_TEXT_LENGTH);
  if (forwardedEmailId !== undefined) patch.forwarded_email_id = clip(forwardedEmailId, MAX_TEXT_LENGTH);
  const res = await sbQuery({
    method: 'PATCH',
    table: deliveriesTable(),
    query: `svix_id=eq.${encodeURIComponent(row.svix_id)}&attempts=eq.${Number(row.attempts) || 1}`,
    body: patch,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return fail(res, `could not record the outcome of delivery ${row.svix_id}`);
  const back = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!back || back.outcome !== outcome) {
    return { ok: false, status: 500, error: `the outcome "${outcome}" of delivery ${row.svix_id} did not read back` };
  }
  return { ok: true, status: 200, data: back };
}

module.exports = {
  SQL_FILE,
  OUTCOMES,
  FINAL_OUTCOMES,
  STALE_CLAIM_MS,
  normalizeAddress,
  findRoutes,
  addRoute,
  claimDelivery,
  finishDelivery,
  readDelivery,
};
