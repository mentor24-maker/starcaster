'use strict';

/**
 * Bind public-site API requests on custom domains to the project mapped to Host.
 * System hosts (starcaster.pro, localhost, …) skip binding for Builder preview/dev.
 *
 * See docs/CUSTOM_DOMAIN_PUBLIC_SITES.md §10
 */

const { getClientHost } = require('../routes/http');
const { isSystemHost, normalizePublicSiteHost } = require('./publicSiteHosts');

async function resolveTenantProjectFromHost(req) {
  const host = normalizePublicSiteHost(getClientHost(req));
  if (isSystemHost(host)) {
    return { ok: true, systemHost: true, host, projectId: '', project: null };
  }
  if (!host) {
    return {
      ok: false,
      status: 403,
      error: 'Could not resolve host for this request',
      code: 'HOST_REQUIRED',
    };
  }

  const { findProjectByDomain } = require('./projectsStore');
  const result = await findProjectByDomain(host);
  if (!result.ok) {
    return {
      ok: false,
      status: 403,
      error: 'No published site for this domain',
      code: 'DOMAIN_NOT_MAPPED',
    };
  }

  return {
    ok: true,
    systemHost: false,
    host,
    projectId: result.data.id,
    project: result.data,
  };
}

/**
 * READ-ONLY host check. On a tenant domain it pins the request to that domain's
 * project; on a system host it waves the request through with NO projectId, so
 * the caller's claim is never verified.
 *
 * That is fine for reading data that is public anyway (a published page, a
 * favicon) and wrong for anything that writes — use
 * resolvePublicProjectForRequest for those. scripts/builder/publicHostBinding.test.js
 * pins the list of files allowed to call this, so a new write call site fails.
 */
async function assertProjectIdAllowedOnHost(req, projectIdInput) {
  const tenant = await resolveTenantProjectFromHost(req);
  if (!tenant.ok) return tenant;
  if (tenant.systemHost) return { ok: true };

  const projectId = String(projectIdInput || '').trim();
  if (!projectId) {
    return { ok: true, projectId: String(tenant.projectId) };
  }
  if (projectId !== String(tenant.projectId)) {
    return {
      ok: false,
      status: 403,
      error: 'Project not available on this domain',
      code: 'PROJECT_HOST_MISMATCH',
    };
  }
  return { ok: true, projectId: String(tenant.projectId) };
}

/**
 * Resolve the project a PUBLIC, unauthenticated request is allowed to act on.
 *
 * Use this — not assertProjectIdAllowedOnHost — for anything that WRITES or has
 * a side effect (stores a row, sends mail, changes a password). The difference
 * is the system-host path:
 *
 *   Tenant domain (brandonmarinoff.com): the host names exactly one project, so
 *   that project wins. A body naming a different one is refused. Unchanged.
 *
 *   System host (starcaster.pro, localhost, every Vercel preview): the host
 *   names NO project, so assertProjectIdAllowedOnHost answers `{ ok: true }`
 *   with no projectId and every call site falls through to `bind.projectId ||
 *   projectId` — the caller's unverified claim. Any string became a tenant, so
 *   a public POST could write rows under a project id that does not exist.
 *   Here the claim is checked against real projects first.
 *
 * POLICY, stated deliberately (Loop Queue 86bbjj6qb): on a system host a
 * VERIFIED, real projectId is ACCEPTED, not refused. Refusing would buy no
 * security — every one of these endpoints is already reachable, unauthenticated,
 * on the tenant's own public domain, so a system host grants an attacker nothing
 * new — while it would break the two places that legitimately serve tenant pages
 * from a system host: `npm run dev` on localhost, and the Builder's own preview.
 * The hole being closed is the UNVERIFIED claim: rows landing under a made-up
 * tenant, which nobody can trace, scope or clean up.
 *
 * Always returns a concrete `projectId` when ok, so call sites never need the
 * `bind.projectId || projectId` fallback that was the bug in the first place.
 */
async function resolvePublicProjectForRequest(req, projectIdInput) {
  const tenant = await resolveTenantProjectFromHost(req);
  if (!tenant.ok) return tenant;

  const claimedId = String(projectIdInput || '').trim();

  if (!tenant.systemHost) {
    if (claimedId && claimedId !== String(tenant.projectId)) {
      return {
        ok: false,
        status: 403,
        error: 'Project not available on this domain',
        code: 'PROJECT_HOST_MISMATCH',
      };
    }
    return {
      ok: true,
      systemHost: false,
      projectId: String(tenant.projectId),
      project: tenant.project,
    };
  }

  if (!claimedId) {
    return {
      ok: false,
      status: 400,
      error: 'projectId is required',
      code: 'PROJECT_ID_REQUIRED',
    };
  }

  const { getPublicProjectById } = require('./projectsStore');
  const found = await getPublicProjectById(claimedId);
  if (!found.ok || !found.data) {
    return {
      ok: false,
      status: 404,
      error: 'Unknown project',
      code: 'PROJECT_NOT_FOUND',
    };
  }

  return {
    ok: true,
    systemHost: true,
    projectId: String(found.data.id),
    project: found.data,
  };
}

async function assertDomainQueryAllowedOnHost(req, domainInput) {
  const tenant = await resolveTenantProjectFromHost(req);
  if (!tenant.ok) return tenant;
  if (tenant.systemHost) return { ok: true, systemHost: true };

  const domain = String(domainInput || '').trim().toLowerCase().replace(/^www\./, '');
  if (domain && domain !== tenant.host) {
    return {
      ok: false,
      status: 403,
      error: 'Domain does not match this host',
      code: 'DOMAIN_HOST_MISMATCH',
    };
  }
  return {
    ok: true,
    systemHost: false,
    projectId: tenant.projectId,
    project: tenant.project,
  };
}

module.exports = {
  resolveTenantProjectFromHost,
  assertProjectIdAllowedOnHost,
  assertDomainQueryAllowedOnHost,
  resolvePublicProjectForRequest,
};
