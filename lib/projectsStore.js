'use strict';

const fs = require('fs');
const path = require('path');
const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

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
    website: safeText(row?.website),
    projectUrl: safeText(row?.project_url || row?.projectUrl),
    siteUrl: safeText(row?.site_url || row?.siteUrl),
    url: safeText(row?.url),
    domain: safeText(row?.domain),
    canonicalUrl: safeText(row?.canonical_url || row?.canonicalUrl),
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
  if (!userId) return { ok: false, status: 400, error: 'userId is required' };
  if (!name) return { ok: false, status: 400, error: 'Project name is required' };

  const now = new Date().toISOString();
  const project = {
    id: nextId('proj'),
    name,
    slug: slug || `project-${Date.now()}`,
    description,
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

module.exports = {
  listProjectsForUser,
  createProjectForUser,
  resolveCurrentProject,
};
