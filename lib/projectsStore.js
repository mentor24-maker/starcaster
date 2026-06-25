'use strict';

const fs = require('fs');
const path = require('path');
const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');
const { isValidIanaTimeZone } = require('./wallTimeUtc');

const PROJECTS_FILE = path.join(__dirname, '..', 'data', 'projects.json');
const PROJECTS_TABLE = String(process.env.SUPABASE_PROJECTS_TABLE || 'app_projects').trim();
const MEMBERSHIPS_TABLE = String(process.env.SUPABASE_PROJECT_MEMBERSHIPS_TABLE || 'app_project_memberships').trim();

function safeText(value) {
  return String(value || '').trim();
}

function slugify(value) {
  return safeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function normalizeDomain(value) {
  return safeText(value).toLowerCase().replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./, '').replace(/:.*$/, '');
}

function isValidDomain(value) {
  const text = normalizeDomain(value);
  if (!text) return true;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(text) && text.length <= 253;
}

const MAX_LOGO_DATA_URL_LENGTH = 2_000_000;

function normalizeProjectUrl(value) {
  const raw = safeText(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw)) return `https://${raw}`;
  return raw;
}

function normalizeLogoDataUrl(value) {
  return safeText(value);
}

function isValidLogoDataUrl(value) {
  const text = normalizeLogoDataUrl(value);
  if (!text) return true;
  if (text.length > MAX_LOGO_DATA_URL_LENGTH) return false;
  if (/^data:image\//i.test(text)) return true;
  if (text.startsWith('/api/assets/')) return true;
  if (/\.public\.blob\.vercel-storage\.com\//i.test(text)) return true;
  if (/^https?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
  return false;
}

function isValidProjectUrl(value) {
  const text = normalizeProjectUrl(value);
  if (!text) return false;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function nextId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function useSupabase() {
  return isSupabaseConfigured();
}

function ensureFile() {
  ensureJsonFile(PROJECTS_FILE, { projects: [], memberships: [] }, { mode: 0o600 });
}

function readFileStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(PROJECTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { projects: [], memberships: [] };
    if (!Array.isArray(parsed.projects)) parsed.projects = [];
    if (!Array.isArray(parsed.memberships)) parsed.memberships = [];
    return parsed;
  } catch {
    return { projects: [], memberships: [] };
  }
}

function writeFileStore(store) {
  ensureFile();
  writeJsonAtomic(PROJECTS_FILE, store, { mode: 0o600 });
}

function projectRowToModel(row) {
  return {
    id: safeText(row?.id),
    name: safeText(row?.name),
    slug: safeText(row?.slug),
    description: safeText(row?.description),
    website: normalizeProjectUrl(row?.website),
    projectUrl: normalizeProjectUrl(row?.project_url || row?.projectUrl),
    siteUrl: safeText(row?.site_url || row?.siteUrl),
    url: safeText(row?.url),
    domain: safeText(row?.domain),
    canonicalUrl: safeText(row?.canonical_url || row?.canonicalUrl),
    timezone: safeText(row?.timezone) || 'UTC',
    logoDataUrl: safeText(row?.logo_data_url || row?.logoDataUrl),
    faviconDataUrl: safeText(row?.favicon_data_url || row?.faviconDataUrl),
    enabledModules: (row?.enabled_modules && typeof row.enabled_modules === 'object') ? row.enabled_modules : { crm: true },
    createdByUserId: safeText(row?.created_by_user_id || row?.createdByUserId),
    createdAt: safeText(row?.created_at || row?.createdAt),
    updatedAt: safeText(row?.updated_at || row?.updatedAt),
  };
}

function membershipRowToModel(row) {
  return {
    projectId: safeText(row?.project_id || row?.projectId),
    userId: safeText(row?.user_id || row?.userId),
    role: safeText(row?.role || 'member') || 'member',
    status: safeText(row?.status || 'active') || 'active',
    createdAt: safeText(row?.created_at || row?.createdAt),
  };
}

function virtualDefaultProject(userIdInput) {
  const userId = safeText(userIdInput);
  const now = new Date().toISOString();
  const projectId = `proj_default_${userId || 'user'}`;
  return {
    id: projectId,
    name: 'Default Project',
    slug: `default-${userId || 'user'}`,
    description: '',
    timezone: 'UTC',
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
    membership: {
      projectId,
      userId,
      role: 'owner',
      status: 'active',
      createdAt: now,
    },
    virtual: true,
  };
}

function missingTableError(result) {
  const text = String(result?.error || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

function missingDomainColumnError(result) {
  const text = String(result?.error || '').toLowerCase();
  return text.includes('domain') && (text.includes('column') || text.includes('schema cache'));
}

function missingFaviconColumnError(result) {
  const text = String(result?.error || '').toLowerCase();
  return text.includes('favicon') && (text.includes('column') || text.includes('schema cache'));
}

const DOMAIN_COLUMN_SETUP_HINT =
  'Run docs/SQL/app_projects_domain.sql in Supabase, then reload the API schema (Dashboard → Project Settings → API → Reload schema).';

const FAVICON_COLUMN_SETUP_HINT =
  'Run docs/SQL/app_projects_favicon.sql in Supabase, then reload the API schema (Dashboard → Project Settings → API → Reload schema).';

async function listProjectsForUser(userIdInput) {
  const userId = safeText(userIdInput);
  if (!userId) return { ok: false, status: 400, error: 'userId is required' };

  if (useSupabase()) {
    const membershipsResult = await sbQuery({
      table: MEMBERSHIPS_TABLE,
      // Do not hard-filter status in SQL. Older membership rows can have NULL
      // status and should still be treated as active by membershipRowToModel().
      query: `select=project_id,user_id,role,status,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc&limit=500`,
    });
    if (!membershipsResult.ok) {
      if (missingTableError(membershipsResult)) {
        return { ok: true, status: 200, data: [virtualDefaultProject(userId)] };
      }
      return membershipsResult;
    }
    const memberships = (Array.isArray(membershipsResult.data) ? membershipsResult.data : [])
      .map(membershipRowToModel)
      .filter((row) => row.projectId && row.status === 'active');

    const projects = [];
    const membershipByProjectId = new Map();
    memberships.forEach((membership) => {
      if (!membership?.projectId) return;
      membershipByProjectId.set(membership.projectId, membership);
    });
    for (const membership of memberships) {
      const projectResult = await sbQuery({
        table: PROJECTS_TABLE,
        query: `select=*&id=eq.${encodeURIComponent(membership.projectId)}&limit=1`,
      });
      if (!projectResult.ok) {
        if (missingTableError(projectResult)) continue;
        return projectResult;
      }
      const projectRow = Array.isArray(projectResult.data) ? projectResult.data[0] : null;
      if (!projectRow) continue;
      projects.push({
        ...projectRowToModel(projectRow),
        membership,
      });
    }

    // Recovery path:
    // If membership rows were dropped/misaligned during migrations, still surface
    // projects owned by this user so scoped data remains accessible.
    const ownedProjectsResult = await sbQuery({
      table: PROJECTS_TABLE,
      query: `select=*&created_by_user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc&limit=500`,
    });
    if (ownedProjectsResult.ok) {
      const ownedProjects = Array.isArray(ownedProjectsResult.data) ? ownedProjectsResult.data : [];
      for (const projectRow of ownedProjects) {
        const projectId = safeText(projectRow?.id);
        if (!projectId) continue;
        if (projects.some((project) => safeText(project?.id) === projectId)) continue;
        projects.push({
          ...projectRowToModel(projectRow),
          membership: membershipByProjectId.get(projectId) || {
            projectId,
            userId,
            role: 'owner',
            status: 'active',
            createdAt: safeText(projectRow?.created_at) || new Date().toISOString(),
          },
        });
      }
    }

    projects.sort((a, b) => {
      const aTs = new Date(safeText(a?.createdAt) || 0).getTime();
      const bTs = new Date(safeText(b?.createdAt) || 0).getTime();
      if (aTs === bTs) return 0;
      return aTs - bTs;
    });
    return { ok: true, status: 200, data: projects };
  }

  const store = readFileStore();
  const memberships = store.memberships
    .map(membershipRowToModel)
    .filter((row) => row.userId === userId && row.status === 'active');
  const projects = memberships
    .map((membership) => {
      const projectRow = store.projects.find((row) => safeText(row.id) === membership.projectId);
      if (!projectRow) return null;
      return { ...projectRowToModel(projectRow), membership };
    })
    .filter(Boolean);
  return { ok: true, status: 200, data: projects };
}

async function createProjectForUser(input, userIdInput) {
  const userId = safeText(userIdInput);
  const name = safeText(input?.name);
  const description = safeText(input?.description);
  const slug = slugify(input?.slug || name);
  const projectUrl = normalizeProjectUrl(input?.projectUrl || input?.project_url || input?.website);
  if (!userId) return { ok: false, status: 400, error: 'userId is required' };
  if (!name) return { ok: false, status: 400, error: 'Project name is required' };
  if (projectUrl && !isValidProjectUrl(projectUrl)) return { ok: false, status: 400, error: 'Default URL must be a valid http(s) URL' };

  const now = new Date().toISOString();
  const timezone = safeText(input?.timezone) || 'UTC';
  const project = {
    id: nextId('proj'),
    name,
    slug: slug || `project-${Date.now()}`,
    description,
    project_url: projectUrl,
    website: projectUrl,
    timezone,
    created_by_user_id: userId,
    created_at: now,
    updated_at: now,
  };
  const membership = {
    project_id: project.id,
    user_id: userId,
    role: 'owner',
    status: 'active',
    created_at: now,
  };

  if (useSupabase()) {
    const existingResult = await sbQuery({
      table: PROJECTS_TABLE,
      query: `select=id&slug=eq.${encodeURIComponent(project.slug)}&limit=1`,
    });
    if (!existingResult.ok) {
      if (!missingTableError(existingResult)) return existingResult;
    } else if (Array.isArray(existingResult.data) && existingResult.data.length) {
      return { ok: false, status: 409, error: 'Project slug already exists' };
    }

    const createProjectResult = await sbQuery({
      method: 'POST',
      table: PROJECTS_TABLE,
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [project],
    });
    if (!createProjectResult.ok) {
      if (missingTableError(createProjectResult)) {
        return { ok: true, status: 201, data: virtualDefaultProject(userId) };
      }
      return createProjectResult;
    }
    const createdProject = Array.isArray(createProjectResult.data) ? createProjectResult.data[0] : project;

    const createMembershipResult = await sbQuery({
      method: 'POST',
      table: MEMBERSHIPS_TABLE,
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [membership],
    });
    if (!createMembershipResult.ok) {
      if (missingTableError(createMembershipResult)) {
        return { ok: true, status: 201, data: virtualDefaultProject(userId) };
      }
      return createMembershipResult;
    }

    return {
      ok: true,
      status: 201,
      data: {
        ...projectRowToModel(createdProject),
        membership: membershipRowToModel(createMembershipResult.data?.[0] || membership),
      },
    };
  }

  const store = readFileStore();
  if (store.projects.some((row) => safeText(row.slug) === project.slug)) {
    return { ok: false, status: 409, error: 'Project slug already exists' };
  }
  store.projects.unshift(project);
  store.memberships.unshift(membership);
  writeFileStore(store);
  return {
    ok: true,
    status: 201,
    data: {
      ...projectRowToModel(project),
      membership: membershipRowToModel(membership),
    },
  };
}

async function resolveCurrentProject(input) {
  const userId = safeText(input?.userId);
  const requestedProjectId = safeText(input?.requestedProjectId);
  const sessionActiveProjectId = safeText(input?.sessionActiveProjectId);
  const autoCreateDefault = input?.autoCreateDefault === true;

  if (!userId) return { ok: false, status: 400, error: 'userId is required' };

  let listResult = await listProjectsForUser(userId);
  if (!listResult.ok) return listResult;
  let projects = Array.isArray(listResult.data) ? listResult.data : [];

  if (!projects.length && autoCreateDefault) {
    const createResult = await createProjectForUser({ name: 'Default Project' }, userId);
    if (createResult.ok) {
      listResult = await listProjectsForUser(userId);
      if (!listResult.ok) return listResult;
      projects = Array.isArray(listResult.data) ? listResult.data : [];
    }
    // If auto-create failed (e.g. slug conflict), continue with no project rather than erroring.
  }

  if (!projects.length) {
    return {
      ok: true,
      status: 200,
      data: {
        project: null,
        projects: [],
        membership: null,
        sessionActiveProjectId: sessionActiveProjectId || '',
        resolvedFrom: null,
      },
    };
  }

  let project = null;
  let resolvedFrom = null;

  if (sessionActiveProjectId) {
    project = projects.find((row) => row.id === sessionActiveProjectId) || null;
    if (project) resolvedFrom = 'session';
  }

  if (!project && requestedProjectId) {
    const sessionProjectMissing = Boolean(
      sessionActiveProjectId && !projects.some((row) => row.id === sessionActiveProjectId)
    );
    const headerAllowed = !sessionActiveProjectId || sessionProjectMissing;
    if (headerAllowed) {
      project = projects.find((row) => row.id === requestedProjectId) || null;
      if (project) resolvedFrom = 'header';
    }
  }

  return {
    ok: true,
    status: 200,
    data: {
      project,
      membership: project?.membership || null,
      projects,
      sessionActiveProjectId: sessionActiveProjectId || '',
      resolvedFrom,
    },
  };
}

async function setActiveProjectForSession(userIdInput, projectIdInput, sessionTokenInput) {
  const userId = safeText(userIdInput);
  const projectId = safeText(projectIdInput);
  const sessionToken = safeText(sessionTokenInput);
  if (!userId) return { ok: false, status: 400, error: 'userId is required' };
  if (!sessionToken) return { ok: false, status: 401, error: 'Session is required' };
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  const listResult = await listProjectsForUser(userId);
  if (!listResult.ok) return listResult;
  const projects = Array.isArray(listResult.data) ? listResult.data : [];
  const project = projects.find((row) => row.id === projectId) || null;
  if (!project) {
    return { ok: false, status: 403, error: 'Project not found or access denied', code: 'PROJECT_ACCESS_DENIED' };
  }

  const { setSessionActiveProject } = require('./authStore');
  const updateResult = await setSessionActiveProject(sessionToken, projectId);
  if (!updateResult.ok) return updateResult;

  return {
    ok: true,
    status: 200,
    data: {
      project,
      membership: project.membership || null,
      projects,
      sessionActiveProjectId: projectId,
      resolvedFrom: 'session',
    },
  };
}

async function getProjectTimezoneForUser(projectIdInput, userIdInput) {
  const projectId = safeText(projectIdInput);
  const userId = safeText(userIdInput);
  if (!projectId || !userId) return 'UTC';
  const listResult = await listProjectsForUser(userId);
  if (!listResult.ok) return 'UTC';
  const projects = Array.isArray(listResult.data) ? listResult.data : [];
  const row = projects.find((p) => safeText(p?.id) === projectId);
  return safeText(row?.timezone) || 'UTC';
}

async function updateProjectForUser(projectIdInput, patch, userIdInput) {
  const userId = safeText(userIdInput);
  const projectId = safeText(projectIdInput);
  if (!userId || !projectId) return { ok: false, status: 400, error: 'project id and user are required' };

  const listResult = await listProjectsForUser(userId);
  if (!listResult.ok) return listResult;
  const projects = Array.isArray(listResult.data) ? listResult.data : [];
  const membership = projects.find((p) => safeText(p?.id) === projectId)?.membership || null;
  if (!membership) return { ok: false, status: 403, error: 'Project not found or access denied' };

  const updates = {};
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'timezone')) {
    const rawTz = safeText(patch.timezone);
    const tz = rawTz || 'UTC';
    if (tz.length > 120) return { ok: false, status: 400, error: 'timezone value is too long' };
    if (!isValidIanaTimeZone(tz)) {
      return { ok: false, status: 400, error: 'Invalid timezone (use an IANA name like America/Los_Angeles or UTC)' };
    }
    updates.timezone = tz;
  }
  if (
    patch
    && (
      Object.prototype.hasOwnProperty.call(patch, 'projectUrl')
      || Object.prototype.hasOwnProperty.call(patch, 'project_url')
      || Object.prototype.hasOwnProperty.call(patch, 'website')
    )
  ) {
    const projectUrl = normalizeProjectUrl(patch.projectUrl || patch.project_url || patch.website);
    if (!projectUrl) return { ok: false, status: 400, error: 'Default URL is required' };
    if (!isValidProjectUrl(projectUrl)) return { ok: false, status: 400, error: 'Default URL must be a valid http(s) URL' };
    updates.project_url = projectUrl;
    updates.website = projectUrl;
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'name')) {
    const name = safeText(patch.name);
    if (!name) return { ok: false, status: 400, error: 'Project name is required' };
    if (name.length > 200) return { ok: false, status: 400, error: 'Project name is too long' };
    updates.name = name;
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'description')) {
    const description = safeText(patch.description);
    if (description.length > 2000) return { ok: false, status: 400, error: 'Description is too long' };
    updates.description = description;
  }
  if (
    patch
    && (
      Object.prototype.hasOwnProperty.call(patch, 'logoDataUrl')
      || Object.prototype.hasOwnProperty.call(patch, 'logo_data_url')
    )
  ) {
    const logoDataUrl = normalizeLogoDataUrl(patch.logoDataUrl ?? patch.logo_data_url);
    if (!isValidLogoDataUrl(logoDataUrl)) {
      return { ok: false, status: 400, error: 'Project logo must be a valid image data URL or http(s) URL' };
    }
    updates.logo_data_url = logoDataUrl;
  }
  if (
    patch
    && (
      Object.prototype.hasOwnProperty.call(patch, 'faviconDataUrl')
      || Object.prototype.hasOwnProperty.call(patch, 'favicon_data_url')
    )
  ) {
    const faviconDataUrl = normalizeLogoDataUrl(patch.faviconDataUrl ?? patch.favicon_data_url);
    if (!isValidLogoDataUrl(faviconDataUrl)) {
      return { ok: false, status: 400, error: 'Project favicon must be a valid image data URL or http(s) URL' };
    }
    updates.favicon_data_url = faviconDataUrl;
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'slug')) {
    const slug = slugify(patch.slug);
    if (!slug) return { ok: false, status: 400, error: 'Project slug is required' };
    const current = projects.find((p) => safeText(p?.id) === projectId);
    const currentSlug = safeText(current?.slug);
    if (slug !== currentSlug) {
      if (useSupabase()) {
        const existingResult = await sbQuery({
          table: PROJECTS_TABLE,
          query: `select=id&slug=eq.${encodeURIComponent(slug)}&id=neq.${encodeURIComponent(projectId)}&limit=1`,
        });
        if (!existingResult.ok && !missingTableError(existingResult)) return existingResult;
        if (Array.isArray(existingResult.data) && existingResult.data.length) {
          return { ok: false, status: 409, error: 'Project slug already exists' };
        }
      } else {
        const store = readFileStore();
        if (store.projects.some((row) => safeText(row.slug) === slug && safeText(row.id) !== projectId)) {
          return { ok: false, status: 409, error: 'Project slug already exists' };
        }
      }
    }
    updates.slug = slug;
  }

  if (patch && Object.prototype.hasOwnProperty.call(patch, 'domain')) {
    const domain = normalizeDomain(patch.domain);
    if (domain && !isValidDomain(domain)) {
      return { ok: false, status: 400, error: 'domain must be a valid hostname (e.g. example.com)' };
    }
    if (domain && useSupabase()) {
      const existingResult = await sbQuery({
        table: PROJECTS_TABLE,
        query: `select=id&domain=eq.${encodeURIComponent(domain)}&id=neq.${encodeURIComponent(projectId)}&limit=1`,
      });
      if (!existingResult.ok) {
        if (missingDomainColumnError(existingResult)) {
          return { ok: false, status: 500, error: `Custom domain is not configured in Supabase. ${DOMAIN_COLUMN_SETUP_HINT}` };
        }
        if (!missingTableError(existingResult)) return existingResult;
      }
      if (Array.isArray(existingResult.data) && existingResult.data.length) {
        return { ok: false, status: 409, error: 'Domain is already mapped to another project' };
      }
    }
    updates.domain = domain;
  }

  if (patch && Object.prototype.hasOwnProperty.call(patch, 'enabledModules')) {
    const raw = patch.enabledModules;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, status: 400, error: 'enabledModules must be an object' };
    }
    const sanitized = {};
    for (const [key, val] of Object.entries(raw)) {
      if (typeof val === 'boolean') sanitized[key] = val;
    }
    updates.enabled_modules = sanitized;
  }

  if (!Object.keys(updates).length) {
    return { ok: false, status: 400, error: 'No supported fields to update' };
  }

  const updatedAt = new Date().toISOString();

  if (useSupabase()) {
    const body = {
      ...updates,
      updated_at: updatedAt,
    };
    const result = await sbQuery({
      method: 'PATCH',
      table: PROJECTS_TABLE,
      query: `id=eq.${encodeURIComponent(projectId)}&select=*`,
      headers: { Prefer: 'return=representation' },
      body,
    });
    if (!result.ok) {
      if (Object.prototype.hasOwnProperty.call(patch, 'domain') && missingDomainColumnError(result)) {
        return { ok: false, status: 500, error: `Custom domain could not be saved. ${DOMAIN_COLUMN_SETUP_HINT}` };
      }
      if (
        (
          Object.prototype.hasOwnProperty.call(patch, 'faviconDataUrl')
          || Object.prototype.hasOwnProperty.call(patch, 'favicon_data_url')
        )
        && missingFaviconColumnError(result)
      ) {
        return { ok: false, status: 500, error: `Project favicon could not be saved. ${FAVICON_COLUMN_SETUP_HINT}` };
      }
      return result;
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) return { ok: false, status: 404, error: 'Project not found' };
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'domain')) {
      const wantedDomain = normalizeDomain(patch.domain);
      const savedDomain = normalizeDomain(row?.domain);
      if (wantedDomain !== savedDomain) {
        return {
          ok: false,
          status: 500,
          error: wantedDomain
            ? `Custom domain did not save (expected "${wantedDomain}"). ${DOMAIN_COLUMN_SETUP_HINT}`
            : `Custom domain could not be cleared. ${DOMAIN_COLUMN_SETUP_HINT}`,
        };
      }
    }
    return { ok: true, status: 200, data: { ...projectRowToModel(row), membership } };
  }

  const store = readFileStore();
  const idx = store.projects.findIndex((row) => safeText(row.id) === projectId);
  if (idx < 0) return { ok: false, status: 404, error: 'Project not found' };
  const merged = { ...store.projects[idx], ...updates, updated_at: updatedAt };
  store.projects[idx] = merged;
  writeFileStore(store);
  return { ok: true, status: 200, data: { ...projectRowToModel(merged), membership } };
}

async function listProjectMembers(projectIdInput, requestingUserIdInput) {
  const projectId = safeText(projectIdInput);
  const requestingUserId = safeText(requestingUserIdInput);
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };
  if (!requestingUserId) return { ok: false, status: 401, error: 'Not authenticated' };

  // Verify requesting user has access to this project
  const accessResult = await listProjectsForUser(requestingUserId);
  if (!accessResult.ok) return accessResult;
  const hasAccess = (Array.isArray(accessResult.data) ? accessResult.data : []).some(
    (p) => safeText(p?.id) === projectId
  );
  if (!hasAccess) return { ok: false, status: 403, error: 'Project not found or access denied' };

  if (useSupabase()) {
    const { AUTH_USERS_TABLE } = require('./authStore');
    const membershipsResult = await sbQuery({
      table: MEMBERSHIPS_TABLE,
      query: `select=project_id,user_id,role,status,created_at&project_id=eq.${encodeURIComponent(projectId)}&status=neq.inactive&order=created_at.asc&limit=200`,
    });
    if (!membershipsResult.ok) {
      if (missingTableError(membershipsResult)) return { ok: true, status: 200, data: [] };
      return membershipsResult;
    }
    const rows = Array.isArray(membershipsResult.data) ? membershipsResult.data : [];
    const members = [];
    for (const row of rows) {
      const m = membershipRowToModel(row);
      if (!m.userId) continue;
      const userResult = await sbQuery({
        table: AUTH_USERS_TABLE,
        query: `select=id,email,name&id=eq.${encodeURIComponent(m.userId)}&limit=1`,
      });
      const userRow = userResult.ok && Array.isArray(userResult.data) ? userResult.data[0] : null;
      members.push({
        ...m,
        email: safeText(userRow?.email),
        name: safeText(userRow?.name),
      });
    }
    return { ok: true, status: 200, data: members };
  }

  // File-based fallback: no user lookup
  const store = readFileStore();
  const members = store.memberships
    .filter((m) => safeText(m.project_id) === projectId)
    .map(membershipRowToModel);
  return { ok: true, status: 200, data: members };
}

async function removeMemberFromProject(projectIdInput, targetUserIdInput, requestingUserIdInput) {
  const projectId = safeText(projectIdInput);
  const targetUserId = safeText(targetUserIdInput);
  const requestingUserId = safeText(requestingUserIdInput);
  if (!projectId || !targetUserId) return { ok: false, status: 400, error: 'projectId and userId are required' };
  if (!requestingUserId) return { ok: false, status: 401, error: 'Not authenticated' };

  // Only the project owner may remove members
  const accessResult = await listProjectsForUser(requestingUserId);
  if (!accessResult.ok) return accessResult;
  const userProject = (Array.isArray(accessResult.data) ? accessResult.data : []).find(
    (p) => safeText(p?.id) === projectId
  );
  if (!userProject) return { ok: false, status: 403, error: 'Project not found or access denied' };
  if (safeText(userProject?.membership?.role) !== 'owner') {
    return { ok: false, status: 403, error: 'Only project owners can remove members' };
  }
  if (targetUserId === requestingUserId) {
    return { ok: false, status: 400, error: 'Cannot remove yourself from your own project' };
  }

  if (useSupabase()) {
    const result = await sbQuery({
      method: 'PATCH',
      table: MEMBERSHIPS_TABLE,
      query: `project_id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(targetUserId)}`,
      headers: { Prefer: 'return=minimal' },
      body: { status: 'inactive' },
    });
    if (!result.ok && !missingTableError(result)) return result;
    return { ok: true, status: 200, data: { removed: true } };
  }

  const store = readFileStore();
  const idx = store.memberships.findIndex(
    (m) => safeText(m.project_id) === projectId && safeText(m.user_id) === targetUserId
  );
  if (idx >= 0) {
    store.memberships[idx].status = 'inactive';
    writeFileStore(store);
  }
  return { ok: true, status: 200, data: { removed: true } };
}

async function addMemberToProject(projectIdInput, userIdInput, roleInput = 'member') {
  const projectId = safeText(projectIdInput);
  const userId    = safeText(userIdInput);
  const role      = safeText(roleInput) || 'member';
  if (!projectId || !userId) return { ok: false, status: 400, error: 'projectId and userId are required' };

  const now = new Date().toISOString();
  const membership = { project_id: projectId, user_id: userId, role, status: 'active', created_at: now };

  if (useSupabase()) {
    // Activate existing row if present, otherwise insert
    const existing = await sbQuery({
      table: MEMBERSHIPS_TABLE,
      query: `select=project_id&project_id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    });
    if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
      await sbQuery({
        method: 'PATCH',
        table: MEMBERSHIPS_TABLE,
        query: `project_id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}`,
        headers: { Prefer: 'return=minimal' },
        body: { status: 'active' },
      });
      return { ok: true, status: 200, data: membershipRowToModel(membership) };
    }
    const result = await sbQuery({
      method: 'POST',
      table: MEMBERSHIPS_TABLE,
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [membership],
    });
    if (!result.ok) {
      if (missingTableError(result)) return { ok: true, status: 200, data: membershipRowToModel(membership) };
      return result;
    }
    return { ok: true, status: 201, data: membershipRowToModel(Array.isArray(result.data) ? result.data[0] : result.data) };
  }

  const store = readFileStore();
  const idx = store.memberships.findIndex((m) => m.project_id === projectId && m.user_id === userId);
  if (idx >= 0) {
    store.memberships[idx].status = 'active';
  } else {
    store.memberships.push(membership);
  }
  writeFileStore(store);
  return { ok: true, status: 201, data: membershipRowToModel(membership) };
}

async function findProjectByDomain(domainInput) {
  const domain = normalizeDomain(domainInput);
  if (!domain) return { ok: false, status: 400, error: 'domain is required' };

  if (useSupabase()) {
    const result = await sbQuery({
      table: PROJECTS_TABLE,
      query: `select=*&domain=eq.${encodeURIComponent(domain)}&limit=1`,
    });
    if (!result.ok) return result;
    const row = Array.isArray(result.data) ? result.data[0] : null;
    if (!row) return { ok: false, status: 404, error: 'No project found for this domain' };
    return { ok: true, status: 200, data: projectRowToModel(row) };
  }

  const store = readFileStore();
  const row = store.projects.find((p) => normalizeDomain(p.domain) === domain);
  if (!row) return { ok: false, status: 404, error: 'No project found for this domain' };
  return { ok: true, status: 200, data: projectRowToModel(row) };
}

async function getPublicProjectById(projectIdInput) {
  const projectId = safeText(projectIdInput);
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  if (useSupabase()) {
    const result = await sbQuery({
      table: PROJECTS_TABLE,
      query: `select=id,name,domain,favicon_data_url,logo_data_url&id=eq.${encodeURIComponent(projectId)}&limit=1`,
    });
    if (!result.ok) return result;
    const row = Array.isArray(result.data) ? result.data[0] : null;
    if (!row) return { ok: false, status: 404, error: 'Project not found' };
    return { ok: true, status: 200, data: projectRowToModel(row) };
  }

  const store = readFileStore();
  const row = store.projects.find((p) => safeText(p.id) === projectId);
  if (!row) return { ok: false, status: 404, error: 'Project not found' };
  return { ok: true, status: 200, data: projectRowToModel(row) };
}

module.exports = {
  listProjectsForUser,
  createProjectForUser,
  resolveCurrentProject,
  setActiveProjectForSession,
  getProjectTimezoneForUser,
  updateProjectForUser,
  addMemberToProject,
  listProjectMembers,
  removeMemberFromProject,
  findProjectByDomain,
  getPublicProjectById,
  normalizeDomain,
};
