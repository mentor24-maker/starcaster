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

function normalizeProjectUrl(value) {
  const raw = safeText(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw)) return `https://${raw}`;
  return raw;
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
  const autoCreateDefault = input?.autoCreateDefault !== false;

  if (!userId) return { ok: false, status: 400, error: 'userId is required' };

  let listResult = await listProjectsForUser(userId);
  if (!listResult.ok) return listResult;
  let projects = Array.isArray(listResult.data) ? listResult.data : [];

  if (!projects.length && autoCreateDefault) {
    const createResult = await createProjectForUser({ name: 'Default Project' }, userId);
    if (!createResult.ok) return createResult;
    listResult = await listProjectsForUser(userId);
    if (!listResult.ok) return listResult;
    projects = Array.isArray(listResult.data) ? listResult.data : [];
  }

  if (!projects.length) {
    return { ok: true, status: 200, data: { project: null, projects: [], membership: null } };
  }

  let project = null;
  if (requestedProjectId) {
    project = projects.find((row) => row.id === requestedProjectId) || null;
  }
  if (!project) {
    // Prefer a non-default project so users don't get stranded in an empty
    // auto-created default project after auth/project switching flows.
    const preferred = projects.find((row) => {
      const name = safeText(row?.name).toLowerCase();
      const slug = safeText(row?.slug).toLowerCase();
      return name !== 'default project' && !slug.startsWith('default-');
    });
    project = preferred || projects[0];
  }

  return {
    ok: true,
    status: 200,
    data: {
      project,
      membership: project?.membership || null,
      projects,
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
    if (!result.ok) return result;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) return { ok: false, status: 404, error: 'Project not found' };
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

module.exports = {
  listProjectsForUser,
  createProjectForUser,
  resolveCurrentProject,
  getProjectTimezoneForUser,
  updateProjectForUser,
};
