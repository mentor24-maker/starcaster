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

async function assertProjectIdAllowedOnHost(req, projectIdInput) {
  const tenant = await resolveTenantProjectFromHost(req);
  if (!tenant.ok) return tenant;
  if (tenant.systemHost) return { ok: true };

  const projectId = String(projectIdInput || '').trim();
  if (!projectId) {
    return {
      ok: false,
      status: 400,
      error: 'projectId is required',
      code: 'VALIDATION_ERROR',
    };
  }
  if (projectId !== tenant.projectId) {
    return {
      ok: false,
      status: 403,
      error: 'Project not available on this domain',
      code: 'PROJECT_HOST_MISMATCH',
    };
  }
  return { ok: true, projectId: tenant.projectId };
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
};
