'use strict';

/**
 * Settings › Projects › (a project) › Email: which addresses this project
 * receives and where each forwards (SC-928). The webhook that does the
 * receiving is routes/inboundEmail.js (SC-926); this is the screen's API.
 *
 *   GET    /api/projects/:id/inbound-email               routes, recent deliveries, domains, canEdit
 *   POST   /api/projects/:id/inbound-email/routes        add { address, forwardTo, enabled? }
 *   PATCH  /api/projects/:id/inbound-email/routes/:rid   change { address?, forwardTo?, enabled? }
 *   DELETE /api/projects/:id/inbound-email/routes/:rid   delete
 *
 * Behind the normal login (no exemption in routes/index.js). The tenant rule:
 * the caller must belong to project :id, read from their own project list the
 * same way routes/projectShares.js does, and every store call passes :id as
 * the project, so a route id from another project changes nothing and answers
 * 404. Only an owner or admin of the project may write.
 *
 * Its own module rather than more lines in routes/settings.js (routes/CLAUDE.md:
 * do not grow the monoliths). Registered ahead of `projects`, which answers 404
 * to any /api/projects path it does not know.
 */

const { sendOk, sendErr, parseJsonBody, normalizeApiPathname } = require('./http');

const EDIT_ROLES = Object.freeze(['owner', 'admin']);
const DELIVERIES_PER_ROUTE = 10;

function safeText(value) {
  return String(value || '').trim();
}

/** `https://www.Example.com/x` → `example.com`; '' for anything without a host. */
function hostOf(value) {
  const text = safeText(value).toLowerCase();
  if (!text) return '';
  const host = text.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:.*$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}

/**
 * The domains a project owns, for the "an address must belong to a domain the
 * project owns" rule: its custom domain and the hosts of its site addresses.
 */
function projectDomains(project) {
  const fields = ['domain', 'website', 'projectUrl', 'siteUrl', 'url', 'canonicalUrl', 'defaultUrl'];
  const hosts = fields.map((f) => hostOf(project?.[f])).filter(Boolean);
  return [...new Set(hosts)].filter((h) => !/(^|\.)(vercel\.app|localhost)$/.test(h));
}

/** True when the address is on one of the domains, or a subdomain of one. */
function addressOnDomains(address, domains) {
  const at = safeText(address).toLowerCase().split('@');
  if (at.length !== 2) return false;
  const host = at[1];
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function routeToModel(row, deliveries) {
  const address = safeText(row?.address);
  return {
    id: safeText(row?.id),
    address,
    forwardTo: safeText(row?.forward_to),
    enabled: row?.enabled === true,
    createdAt: safeText(row?.created_at),
    updatedAt: safeText(row?.updated_at),
    lastArrivalAt: deliveries.length ? safeText(deliveries[0].received_at || deliveries[0].created_at) : '',
    deliveries: deliveries.slice(0, DELIVERIES_PER_ROUTE).map((d) => ({
      id: safeText(d.svix_id),
      receivedAt: safeText(d.received_at || d.created_at),
      from: safeText(d.from_address),
      subject: safeText(d.subject),
      outcome: safeText(d.outcome),
      error: safeText(d.error),
      attempts: Number(d.attempts) || 1,
    })),
  };
}

function createHandler(deps = {}) {
  const listProjectsForUser = deps.listProjectsForUser || require('../lib/projectsStore').listProjectsForUser;
  const store = deps.store || require('../lib/inboundEmailStore');

  function sendStoreErr(res, result, fallback) {
    const extra = result?.code ? { code: result.code } : undefined;
    return sendErr(res, result?.status || 500, result?.error || fallback, extra), true;
  }

  async function summary(res, project, canEdit) {
    const routes = await store.listRoutes(200, project.id);
    if (!routes.ok) return sendStoreErr(res, routes, 'Could not read this project\'s email routes');
    const deliveries = await store.listDeliveries(500, project.id);
    if (!deliveries.ok) return sendStoreErr(res, deliveries, 'Could not read this project\'s email deliveries');
    const models = routes.data.map((row) => {
      const mine = deliveries.data.filter((d) => store.deliveryAddresses(d).includes(safeText(row.address)));
      return routeToModel(row, mine);
    });
    const payload = { routes: models, domains: projectDomains(project), canEdit };
    return sendOk(res, 200, payload, payload), true;
  }

  return async function handle(req, res, pathname, method) {
    const path = normalizeApiPathname(pathname);
    const match = path.match(/^\/api\/projects\/([^/]+)\/inbound-email(?:\/routes(?:\/([^/]+))?)?\/?$/);
    if (!match) return false;
    const projectId = decodeURIComponent(match[1]);
    const isRoutes = /\/inbound-email\/routes/.test(path);
    const routeId = match[2] ? decodeURIComponent(match[2]) : '';
    const verb = String(method || '').toUpperCase();

    const userId = safeText(req?.authUser?.id);
    if (!userId) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
    const projects = await listProjectsForUser(userId);
    if (!projects.ok) return sendStoreErr(res, projects, 'Could not read your projects');
    const project = (Array.isArray(projects.data) ? projects.data : []).find((p) => safeText(p?.id) === projectId);
    if (!project) return sendErr(res, 403, 'Project not found or access denied', { code: 'FORBIDDEN' }), true;
    const canEdit = EDIT_ROLES.includes(safeText(project?.membership?.role));

    if (!isRoutes) {
      if (verb !== 'GET') return sendErr(res, 405, 'Only GET is accepted here', { code: 'METHOD_NOT_ALLOWED' }), true;
      return summary(res, project, canEdit);
    }

    const allowed = routeId ? ['PATCH', 'DELETE'] : ['POST'];
    if (!allowed.includes(verb)) {
      return sendErr(res, 405, `Only ${allowed.join(' or ')} is accepted here`, { code: 'METHOD_NOT_ALLOWED' }), true;
    }
    if (!canEdit) {
      return sendErr(res, 403, 'Only a project owner or admin can change which email this project receives', { code: 'FORBIDDEN' }), true;
    }

    const domains = projectDomains(project);
    const checkDomain = (address) => {
      const addr = store.normalizeAddress(address);
      if (!addr) return `"${safeText(address)}" is not an email address`;
      if (!domains.length) return 'This project has no domain set, so it cannot receive email. Set its Custom Domain above first.';
      if (!addressOnDomains(addr, domains)) return `${addr} is not on this project's domain (${domains.join(', ')})`;
      return '';
    };

    if (verb === 'DELETE') {
      const gone = await store.deleteRoute(routeId, project.id);
      if (!gone.ok) return sendStoreErr(res, gone, 'Could not delete the route');
      return summary(res, project, canEdit);
    }

    const body = (await parseJsonBody(req)) || {};
    if (verb === 'POST') {
      const problem = checkDomain(body.address);
      if (problem) return sendErr(res, 400, problem, { code: 'VALIDATION_ERROR' }), true;
      const added = await store.addRoute(
        { address: body.address, forwardTo: body.forwardTo, enabled: body.enabled === undefined ? true : body.enabled === true },
        { projectId: project.id, userId },
      );
      if (!added.ok) return sendStoreErr(res, added, 'Could not add the route');
      return summary(res, project, canEdit);
    }

    // PATCH
    const patch = {};
    if (body.address !== undefined) {
      const problem = checkDomain(body.address);
      if (problem) return sendErr(res, 400, problem, { code: 'VALIDATION_ERROR' }), true;
      patch.address = body.address;
    }
    if (body.forwardTo !== undefined) patch.forwardTo = body.forwardTo;
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') return sendErr(res, 400, 'enabled must be true or false', { code: 'VALIDATION_ERROR' }), true;
      patch.enabled = body.enabled;
    }
    const changed = await store.updateRoute(routeId, patch, project.id);
    if (!changed.ok) return sendStoreErr(res, changed, 'Could not change the route');
    return summary(res, project, canEdit);
  };
}

const manifest = {
  id: 'inbound-email-settings',
  label: 'Inbound email settings (received addresses)',
  prefixes: ['/api/projects'],
};

module.exports = { handle: createHandler(), createHandler, manifest, projectDomains, addressOnDomains, hostOf };
