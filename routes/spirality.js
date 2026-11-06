'use strict';

/**
 * /api/spirality/* — the Spirality Tasks module's calls (tickets 86bczt5kf,
 * 86bczt5t4). StarCaster's server calls the Spirality tracker for the page
 * (lib/spiralityTracker.js); the browser never does.
 *
 * PUBLIC: a visitor on a client site has no StarCaster login, so
 * routes/index.js exempts this prefix. What stands in for a login is the
 * visitor's own Spirality session, which the tracker checks on every call —
 * StarCaster grants nothing by itself. The project comes from the site's host
 * binding (resolvePublicProjectForRequest), never from the page alone, and
 * only names the cookie.
 *
 * The cookie holds the tracker's session token as-is, the way
 * app_admin_session holds ours: HttpOnly so page script cannot read it,
 * Secure on https, SameSite=Lax, Path=/api/spirality so it rides on these
 * calls and nothing else, one per project. It is not encrypted with
 * lib/channelsCipher.js: that would make every sign-in depend on
 * CHANNELS_ENCRYPTION_KEY, and HttpOnly is what keeps it from page script.
 * No answer body ever carries it.
 */

const { sendOk, sendErr, parseJsonBody, parseCookies, getUrlObj } = require('./http');
const { createTrackerClient } = require('../lib/spiralityTracker');
const { resolvePublicProjectForRequest } = require('../lib/publicSiteHostBinding');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const config = require('../lib/config');

const PREFIX = '/api/spirality';
const COOKIE_PATH = PREFIX;
// The tracker's own session lasts 30 days; ours never outlives it.
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TICKET_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

const SIGNED_OUT = 'Your Spirality sign-in has ended. Sign in again.';
const REGISTER_UNAVAILABLE = 'Registering from this page is not available yet.';

function cookieName(projectId) {
  return `sc_spirality_${String(projectId).replace(/[^A-Za-z0-9_-]/g, '')}`;
}

function isSecureRequest(req) {
  const host = String(req.headers.host || '');
  if (host.includes('localhost') || host.includes('127.0.0.1')) return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto.includes('https')) return true;
  return process.env.NODE_ENV === 'production';
}

function sessionCookie(req, projectId, value) {
  const parts = [
    `${cookieName(projectId)}=${value ? encodeURIComponent(value) : ''}`,
    `Path=${COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${value ? COOKIE_MAX_AGE_SECONDS : 0}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** The parts of a tracker person a page may see: never an email, role or token. */
const personOf = (actor) => ({ id: actor.id, name: actor.name });

/** One comment, as the module shows it: who wrote it, and whether a machine did. */
function commentOf(c) {
  return {
    id: c.id,
    parent: c.parent ?? null,
    author: c.author ? { name: c.author.name, machine: c.author.kind === 'machine' } : null,
    machine: Boolean(c.machine),
    body: c.body,
    createdAt: c.createdAt,
  };
}

function threadOf(t) {
  return {
    id: t.id,
    name: t.name,
    description: t.description || '',
    project: t.project,
    projectName: t.projectName || t.project,
    createdAt: t.createdAt,
    comments: Array.isArray(t.comments) ? t.comments.map(commentOf) : [],
  };
}

/**
 * The routes, with what they depend on handed in, so the tests can fake the
 * tracker and the host binding. `trackerUrl` / `siteToken` are read on every
 * request by default, so a changed setting needs no restart locally.
 */
function createSpiralityRoutes({
  trackerUrl = () => config.get('spiralityTrackerUrl'),
  siteToken = () => config.get('spiralitySiteToken'),
  fetchImpl = (...args) => globalThis.fetch(...args),
  resolveProject = resolvePublicProjectForRequest,
  limit = checkEndpointLimit,
} = {}) {
  async function handle(req, res, pathname, method) {
    if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;
    const rest = pathname.slice(PREFIX.length).split('/').filter(Boolean);
    const isAccount = method === 'POST' && rest.length === 1
      && ['signin', 'register', 'forgot', 'link', 'set-password'].includes(rest[0]);

    if (limit(req, res, isAccount ? 'spirality.account' : 'spirality')) return true;

    const claimed = req.headers['x-project-id'] || getUrlObj(req).searchParams.get('projectId');
    const bound = await resolveProject(req, claimed);
    if (!bound.ok) {
      sendErr(res, bound.status || 400, bound.error || 'This page is not on a known site.', { code: bound.code });
      return true;
    }
    const projectId = bound.projectId;
    const tracker = createTrackerClient({ baseUrl: trackerUrl(), siteToken: siteToken(), fetchImpl });
    const session = String(parseCookies(req.headers.cookie || '')[cookieName(projectId)] || '').trim();

    const fail = (r) => sendErr(res, r.status, r.message, { code: r.code });

    /** A call made as the signed-in person; a session the tracker no longer knows clears ours. */
    async function asPerson(m, path, body) {
      if (!session) {
        sendErr(res, 401, SIGNED_OUT, { code: 'SIGNED_OUT' });
        return null;
      }
      const r = await tracker.call(m, path, { session, body });
      if (!r.ok && r.status === 401) {
        res.setHeader('Set-Cookie', sessionCookie(req, projectId, ''));
        sendErr(res, 401, SIGNED_OUT, { code: 'SIGNED_OUT' });
        return null;
      }
      if (!r.ok) {
        fail(r);
        return null;
      }
      return r.data;
    }

    /** Sign in and keep the session in our cookie; the token is never in the body. */
    async function signIn(email, password) {
      const r = await tracker.call('POST', '/signin', { body: { email, password } });
      if (!r.ok) return fail(r);
      if (!r.session) {
        return sendErr(res, 502, 'Spirality signed you in but sent no session. Try again in a few minutes.', { code: 'NO_SESSION' });
      }
      res.setHeader('Set-Cookie', sessionCookie(req, projectId, r.session));
      return sendOk(res, 200, { signedIn: true, person: personOf(r.data) });
    }

    try {
      // ── Signed out ──────────────────────────────────────────────────────
      if (rest[0] === 'signin' && isAccount) {
        const body = await parseJsonBody(req);
        await signIn(text(body.email), typeof body.password === 'string' ? body.password : '');
        return true;
      }

      if (rest[0] === 'signout' && rest.length === 1 && method === 'POST') {
        if (session) await tracker.call('POST', '/signout', { session, body: {} });
        res.setHeader('Set-Cookie', sessionCookie(req, projectId, ''));
        sendOk(res, 200, { signedIn: false });
        return true;
      }

      if (rest[0] === 'me' && rest.length === 1 && method === 'GET') {
        if (!session) {
          sendOk(res, 200, { signedIn: false });
          return true;
        }
        const r = await tracker.call('GET', '/me', { session });
        if (!r.ok && r.status === 401) {
          res.setHeader('Set-Cookie', sessionCookie(req, projectId, ''));
          sendOk(res, 200, { signedIn: false });
          return true;
        }
        if (!r.ok) {
          fail(r);
          return true;
        }
        sendOk(res, 200, { signedIn: true, person: personOf(r.data) });
        return true;
      }

      if (rest[0] === 'register' && isAccount) {
        // SP-151: POST /account/register {email,name}, the site token as a bearer.
        // Without the token there is nothing to send it with; a tracker
        // without the call (SP-151 not built) answers 404 no-such-call.
        if (!tracker.hasSiteToken && tracker.configured) {
          sendErr(res, 501, REGISTER_UNAVAILABLE, { code: 'REGISTER_UNAVAILABLE' });
          return true;
        }
        const body = await parseJsonBody(req);
        const r = await tracker.call('POST', '/account/register', {
          site: true, body: { email: text(body.email), name: text(body.name) },
        });
        if (!r.ok && r.code === 'no-such-call') {
          sendErr(res, 501, REGISTER_UNAVAILABLE, { code: 'REGISTER_UNAVAILABLE' });
        } else if (!r.ok) {
          fail(r);
        } else {
          sendOk(res, 200, { sent: r.data.sent || 'Check your email for a link to set your password.' });
        }
        return true;
      }

      if (rest[0] === 'forgot' && isAccount) {
        const body = await parseJsonBody(req);
        const r = await tracker.call('POST', '/account/forgot', { site: true, body: { email: text(body.email) } });
        if (!r.ok) fail(r);
        else sendOk(res, 200, { sent: r.data.sent });
        return true;
      }

      if (rest[0] === 'link' && isAccount) {
        const body = await parseJsonBody(req);
        const r = await tracker.call('POST', '/account/link', { body: { link: text(body.link) } });
        if (!r.ok) fail(r);
        else sendOk(res, 200, { purpose: r.data.purpose, email: r.data.email, expiresAt: r.data.expiresAt });
        return true;
      }

      if (rest[0] === 'set-password' && isAccount) {
        const body = await parseJsonBody(req);
        const password = typeof body.password === 'string' ? body.password : '';
        const payload = { link: text(body.link), password };
        if (text(body.name)) payload.name = text(body.name);
        const r = await tracker.call('POST', '/account/set-password', { body: payload });
        if (!r.ok) {
          fail(r);
          return true;
        }
        // The link proved the email is theirs; sign them straight in with it.
        await signIn(r.data.email, password);
        return true;
      }

      // ── Signed in ───────────────────────────────────────────────────────
      if (rest[0] === 'projects' && rest.length === 1 && method === 'GET') {
        const data = await asPerson('GET', '/projects');
        if (data) {
          const projects = (Array.isArray(data.projects) ? data.projects : [])
            .map((p) => ({ slug: p.slug, name: p.name, open: p.open }));
          sendOk(res, 200, { projects, default: data.default ?? null });
        }
        return true;
      }

      if (rest[0] === 'projects' && rest.length === 3 && rest[2] === 'tasks') {
        const slug = rest[1];
        if (!SLUG.test(slug)) {
          sendErr(res, 400, `"${slug}" is not a project name Spirality uses.`, { code: 'BAD_PROJECT' });
          return true;
        }
        if (method === 'GET') {
          // The board, not /tickets: it groups by status in the tracker's own
          // order and names each status as the tracker does, so no copy of
          // that list lives here to drift.
          const data = await asPerson('GET', `/projects/${encodeURIComponent(slug)}/board`);
          if (data) {
            sendOk(res, 200, {
              project: data.project,
              projectName: data.projectName,
              columns: (data.columns || []).map((c) => ({
                status: c.status,
                tasks: (c.tickets || []).map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt })),
              })),
            });
          }
          return true;
        }
        if (method === 'POST') {
          const body = await parseJsonBody(req);
          const name = text(body.name);
          if (!name) {
            sendErr(res, 400, 'Give the task a name.', { code: 'MISSING_NAME' });
            return true;
          }
          const filed = await asPerson('POST', `/projects/${encodeURIComponent(slug)}/tickets`, {
            name, description: text(body.description), status: 'Requested',
          });
          if (filed) {
            const thread = await asPerson('GET', `/tickets/${encodeURIComponent(filed.id)}/thread`);
            if (thread) sendOk(res, 201, threadOf(thread));
          }
          return true;
        }
      }

      if (rest[0] === 'tasks' && (rest.length === 2 || (rest.length === 3 && rest[2] === 'comments'))) {
        const id = rest[1];
        if (!TICKET_ID.test(id)) {
          sendErr(res, 400, `"${id}" is not a Spirality task id.`, { code: 'BAD_TASK' });
          return true;
        }
        const threadPath = `/tickets/${encodeURIComponent(id)}/thread`;
        if (rest.length === 2 && method === 'GET') {
          const thread = await asPerson('GET', threadPath);
          if (thread) sendOk(res, 200, threadOf(thread));
          return true;
        }
        if (rest.length === 3 && method === 'POST') {
          const body = await parseJsonBody(req);
          const reply = text(body.body);
          if (!reply) {
            sendErr(res, 400, 'Type a reply first.', { code: 'MISSING_BODY' });
            return true;
          }
          const posted = await asPerson('POST', `/tickets/${encodeURIComponent(id)}/comments`, { body: reply });
          if (posted) {
            const thread = await asPerson('GET', threadPath);
            if (thread) sendOk(res, 201, threadOf(thread));
          }
          return true;
        }
      }

      sendErr(res, 404, 'Not found', { code: 'NOT_FOUND' });
      return true;
    } catch (err) {
      sendErr(res, 400, err && err.message === 'Invalid JSON body' ? 'That request was not readable.' : 'Something went wrong talking to Spirality.', { code: 'SPIRALITY_ERROR' });
      return true;
    }
  }

  return { handle };
}

const { handle } = createSpiralityRoutes();

const manifest = {
  id: 'spirality',
  label: 'Spirality',
  prefixes: [PREFIX],
};

module.exports = { handle, manifest, createSpiralityRoutes, cookieName };
