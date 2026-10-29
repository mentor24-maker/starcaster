'use strict';

/**
 * Project-to-project sharing of Builder libraries (task 86bcu6t1c).
 *
 *   GET  /api/projects/:id/shares     what project :id shares, and with whom it MAY
 *   PUT  /api/projects/:id/shares     replace that set — owners of :id only
 *   GET  /api/builder/shared/:type    what other projects share with the ACTIVE one
 *
 * And two writes, into the ACTIVE project only:
 *
 *   POST /api/builder/shared/saved_sections/:id/import   copy one shared section in (86bcu6tzk)
 *   POST /api/builder/shared/themes/:id/import           copy one shared theme in (86bcu6uav)
 *
 * Its own module rather than more lines in projects.js and builder.js
 * (routes/CLAUDE.md: do not grow the monoliths). Registered AHEAD of
 * `projects` in routes/index.js, because projects.js answers 404 to any
 * /api/projects path it does not know, and ahead of `builder` for the same
 * reason the other /api/builder modules are. Anything else falls through.
 *
 * The rule that keeps one client's site names away from another: the only
 * projects anyone can pick, or name in a PUT, are projects the caller belongs
 * to. A target outside that set is refused with 403 and nothing is written —
 * never silently dropped, or a caller could not tell a refusal from a save.
 */

const { sendOk, sendErr, parseJsonBody, normalizeApiPathname } = require('./http');
const projectsStore = require('../lib/projectsStore');
const sharesStore = require('../lib/builderProjectSharesStore');
const sharedImport = require('../lib/builderSharedImport');
const { requestProjectScope } = require('../lib/requestProjectScope');
const { copySharedTheme: defaultCopySharedTheme } = require('../lib/builderSharedThemeImport');

function safeText(value) {
  return String(value || '').trim();
}

function textList(value) {
  return Array.isArray(value) ? value.map(safeText).filter(Boolean) : null;
}

function createHandler(deps = {}) {
  const listProjectsForUser = deps.listProjectsForUser || projectsStore.listProjectsForUser;
  const getProjectById = deps.getProjectById || projectsStore.getPublicProjectById;
  const store = deps.sharesStore || sharesStore;
  const copySharedSavedSection = deps.copySharedSavedSection || sharedImport.copySharedSavedSection;
  const copySharedTheme = deps.copySharedTheme || defaultCopySharedTheme;

  async function callerProjects(res, userId) {
    const result = await listProjectsForUser(userId);
    if (!result.ok) {
      sendErr(res, result.status || 500, result.error || 'Could not read your projects');
      return null;
    }
    return Array.isArray(result.data) ? result.data : [];
  }

  async function handleSettings(req, res, projectId, method) {
    const userId = safeText(req?.authUser?.id);
    if (!userId) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;

    const projects = await callerProjects(res, userId);
    if (!projects) return true;
    const project = projects.find((p) => safeText(p?.id) === projectId);
    if (!project) return sendErr(res, 403, 'Project not found or access denied', { code: 'FORBIDDEN' }), true;

    const choices = projects
      .filter((p) => safeText(p?.id) && safeText(p.id) !== projectId)
      .map((p) => ({ id: safeText(p.id), name: safeText(p.name) }));
    // Sent with every answer so the settings panel can lock itself for a
    // member and say why, from the same rule the PUT enforces below.
    const canEdit = safeText(project?.membership?.role) === 'owner';

    if (method === 'PUT') {
      if (!canEdit) {
        return sendErr(res, 403, 'Only project owners can change what this project shares', { code: 'FORBIDDEN' }), true;
      }
      const body = await parseJsonBody(req);
      const types = textList(body?.types);
      const targetProjectIds = textList(body?.targetProjectIds);
      if (!types || !targetProjectIds) {
        return sendErr(res, 400, 'Send { types: [...], targetProjectIds: [...] } — an empty list shares nothing', { code: 'VALIDATION_ERROR' }), true;
      }
      const unknownTypes = types.filter((t) => !store.isShareObjectType(t));
      if (unknownTypes.length) {
        return sendErr(res, 400, `Unknown share type "${unknownTypes[0]}". Allowed: ${store.SHARE_OBJECT_TYPES.join(', ')}`, { code: 'VALIDATION_ERROR' }), true;
      }
      const allowed = new Set(choices.map((c) => c.id));
      const foreign = targetProjectIds.filter((id) => !allowed.has(id));
      if (foreign.length) {
        return sendErr(res, 403, `You can only share with projects you belong to (not: ${foreign.join(', ')})`, { code: 'FORBIDDEN' }), true;
      }
      const saved = await store.replaceSharesFrom(projectId, {
        types,
        targetProjectIds,
        ownerUserId: userId,
        createdByUserId: userId,
      });
      if (!saved.ok) return sendErr(res, saved.status || 500, saved.error || 'Could not save shares'), true;
      const summary = { ...store.summarizeShares(saved.data), projects: choices, canEdit };
      return sendOk(res, 200, summary, summary), true;
    }

    const current = await store.listSharesFrom(5000, projectId);
    if (!current.ok) return sendErr(res, current.status || 500, current.error || 'Could not read shares'), true;
    const summary = { ...store.summarizeShares(current.data), projects: choices, canEdit };
    return sendOk(res, 200, summary, summary), true;
  }

  async function handleSharedRead(req, res, objectType) {
    if (!store.isShareObjectType(objectType)) {
      return sendErr(res, 400, `Unknown share type "${objectType}". Allowed: ${store.SHARE_OBJECT_TYPES.join(', ')}`, { code: 'VALIDATION_ERROR' }), true;
    }
    const { projectId } = requestProjectScope(req);
    if (!projectId) return sendErr(res, 400, 'An active project is required', { code: 'PROJECT_REQUIRED' }), true;

    const sources = await store.listSourcesSharingWith(projectId, objectType);
    if (!sources.ok) return sendErr(res, sources.status || 500, sources.error), true;
    const projectNames = {};
    for (const sourceId of sources.data) {
      const found = await getProjectById(sourceId);
      // A share row naming a project that has since been deleted still lists
      // that project's items by id rather than failing the whole read.
      if (found?.ok && found.data) projectNames[sourceId] = safeText(found.data.name);
    }
    const result = await store.listSharedItems(projectId, objectType, { projectNames });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const items = result.data;
    return sendOk(res, 200, items, { items, type: objectType }, { total: items.length }), true;
  }

  // Writes ONE new row into the active project and nothing anywhere else. The
  // helper re-checks the share itself, so a stale Import button on a list the
  // source has since unshared is refused rather than copied from.
  async function handleImport(req, res, sectionId) {
    const { projectId, userId } = requestProjectScope(req);
    if (!userId) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
    if (!projectId) return sendErr(res, 400, 'An active project is required', { code: 'PROJECT_REQUIRED' }), true;
    const result = await copySharedSavedSection({ targetProjectId: projectId, ownerUserId: userId, sectionId });
    if (!result.ok) {
      const code = result.status === 404 ? 'NOT_SHARED' : undefined;
      return sendErr(res, result.status || 500, result.error || 'Could not import the section', code ? { code } : undefined), true;
    }
    return sendOk(res, 201, result.data, { savedSection: result.data }), true;
  }

  // Writes ONE new theme into the active project and nothing anywhere else.
  // The helper re-checks the share and never marks the copy as the default,
  // so importing cannot change how the live site looks.
  async function handleThemeImport(req, res, themeId) {
    const { projectId, userId } = requestProjectScope(req);
    if (!userId) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
    if (!projectId) return sendErr(res, 400, 'An active project is required', { code: 'PROJECT_REQUIRED' }), true;
    const result = await copySharedTheme({ targetProjectId: projectId, ownerUserId: userId, themeId });
    if (!result.ok) {
      const code = result.status === 404 ? 'NOT_SHARED' : undefined;
      return sendErr(res, result.status || 500, result.error || 'Could not import the theme', code ? { code } : undefined), true;
    }
    return sendOk(res, 201, result.data, { theme: result.data }), true;
  }

  return async function handle(req, res, pathname, method) {
    const requestMethod = String(method || '').toUpperCase();
    const path = normalizeApiPathname(pathname);

    const settingsMatch = path.match(/^\/api\/projects\/([^/]+)\/shares\/?$/);
    if (settingsMatch && (requestMethod === 'GET' || requestMethod === 'PUT')) {
      const projectId = decodeURIComponent(settingsMatch[1] || '').trim();
      if (!projectId || projectId === 'current' || projectId === 'active') {
        return sendErr(res, 400, 'Valid project id is required', { code: 'VALIDATION_ERROR' }), true;
      }
      return handleSettings(req, res, projectId, requestMethod);
    }

    const importMatch = path.match(/^\/api\/builder\/shared\/saved_sections\/([^/]+)\/import\/?$/);
    if (importMatch && requestMethod === 'POST') {
      return handleImport(req, res, decodeURIComponent(importMatch[1] || '').trim());
    }

    const sharedMatch = path.match(/^\/api\/builder\/shared\/([^/]+)\/?$/);
    if (sharedMatch && requestMethod === 'GET') {
      return handleSharedRead(req, res, decodeURIComponent(sharedMatch[1] || '').trim());
    }

    const themeImportMatch = path.match(/^\/api\/builder\/shared\/themes\/([^/]+)\/import\/?$/);
    if (themeImportMatch && requestMethod === 'POST') {
      return handleThemeImport(req, res, decodeURIComponent(themeImportMatch[1] || '').trim());
    }

    return false;
  };
}

const manifest = {
  id: 'project-shares',
  label: 'Project sharing (Builder libraries)',
  prefixes: ['/api/projects', '/api/builder/shared'],
};

module.exports = { handle: createHandler(), createHandler, manifest };
