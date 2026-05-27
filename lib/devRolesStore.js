'use strict';

/**
 * lib/devRolesStore.js
 * Project-scoped dev_roles for Team member assignment.
 */

const { sbQuery } = require('./supabase');
const { isStrictProjectScope } = require('./projectScope');

const DEV_ROLES_TABLE = 'dev_roles';

/** Legacy project_id values used before app_projects ids (see docs/SQL/dev_roles_setup.sql). */
const LEGACY_DEV_ROLE_PROJECT_IDS = ['alphire-promo'];

const DEFAULT_DEV_ROLE_TEMPLATES = [
  {
    role_name: 'Project Coordinator',
    description: 'Manages overall project scope, timelines, and communications.',
  },
  {
    role_name: 'Chief Architect',
    description: 'Oversees the technical design and system architecture.',
  },
  {
    role_name: 'Platform Stakeholder',
    description: 'Represents the business interests and product requirements.',
  },
  {
    role_name: 'UX Specialist',
    description: 'Designs the user experience and user interface layouts.',
  },
  {
    role_name: 'Content Developer',
    description: 'Writes and manages copy, messaging, and content strategies.',
  },
];

function sb(opts = {}) {
  const { extraHeaders, headers, ...rest } = opts;
  return sbQuery({
    ...rest,
    headers: { ...(extraHeaders || {}), ...(headers || {}) },
  });
}

function safeText(value) {
  return String(value || '').trim();
}

function roleRowsFromResponse(res) {
  if (!res.ok) return { ok: false, status: res.status || 500, error: res.error || 'Failed to list dev roles' };
  return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
}

async function fetchRolesForProject(projectId) {
  const pid = safeText(projectId);
  if (!pid) return { ok: false, status: 400, error: 'projectId is required' };
  const res = await sb({
    table: DEV_ROLES_TABLE,
    query: `select=id,project_id,role_name,description,created_at&project_id=eq.${encodeURIComponent(pid)}&order=role_name.asc`,
  });
  return roleRowsFromResponse(res);
}

async function seedDefaultDevRoles(projectId) {
  const pid = safeText(projectId);
  if (!pid) return { ok: false, status: 400, error: 'projectId is required' };

  const body = DEFAULT_DEV_ROLE_TEMPLATES.map((t) => ({
    project_id: pid,
    role_name: t.role_name,
    description: t.description,
  }));

  const insertRes = await sb({
    method: 'POST',
    table: DEV_ROLES_TABLE,
    query: 'select=id,project_id,role_name,description,created_at',
    extraHeaders: { Prefer: 'return=representation' },
    body,
  });
  if (!insertRes.ok) {
    const errText = String(insertRes.error || '').toLowerCase();
    if (insertRes.status === 409 || errText.includes('duplicate') || errText.includes('unique')) {
      return fetchRolesForProject(pid);
    }
    return { ok: false, status: insertRes.status || 500, error: insertRes.error || 'Failed to seed dev roles' };
  }
  return {
    ok: true,
    data: Array.isArray(insertRes.data) ? insertRes.data : [],
    seeded: true,
  };
}

async function copyDevRolesToProject(sourceProjectId, targetProjectId) {
  const sourceId = safeText(sourceProjectId);
  const targetId = safeText(targetProjectId);
  if (!sourceId || !targetId || sourceId === targetId) {
    return { ok: false, status: 400, error: 'sourceProjectId and targetProjectId are required' };
  }

  const sourceRes = await fetchRolesForProject(sourceId);
  if (!sourceRes.ok) return sourceRes;
  if (!sourceRes.data.length) {
    return { ok: true, data: [], copied: 0 };
  }

  const body = sourceRes.data.map((row) => ({
    project_id: targetId,
    role_name: safeText(row.role_name),
    description: safeText(row.description),
  })).filter((row) => row.role_name);

  const insertRes = await sb({
    method: 'POST',
    table: DEV_ROLES_TABLE,
    query: 'select=id,project_id,role_name,description,created_at',
    extraHeaders: { Prefer: 'return=representation' },
    body,
  });
  if (!insertRes.ok) {
    const errText = String(insertRes.error || '').toLowerCase();
    if (insertRes.status === 409 || errText.includes('duplicate') || errText.includes('unique')) {
      return fetchRolesForProject(targetId);
    }
    return { ok: false, status: insertRes.status || 500, error: insertRes.error || 'Failed to copy dev roles' };
  }
  return {
    ok: true,
    data: Array.isArray(insertRes.data) ? insertRes.data : [],
    copied: body.length,
  };
}

async function ensureDevRolesForProject(projectId) {
  const pid = safeText(projectId);
  if (!pid) return { ok: false, status: 400, error: 'projectId is required' };

  const current = await fetchRolesForProject(pid);
  if (!current.ok) return current;
  if (current.data.length) return current;

  if (!isStrictProjectScope()) {
    for (const legacyId of LEGACY_DEV_ROLE_PROJECT_IDS) {
      const legacy = await fetchRolesForProject(legacyId);
      if (legacy.ok && legacy.data.length) {
        const copied = await copyDevRolesToProject(legacyId, pid);
        if (copied.ok && copied.data.length) return copied;
      }
    }
  }

  return seedDefaultDevRoles(pid);
}

async function listDevRoles(projectId, { ensure = true } = {}) {
  const pid = safeText(projectId);
  if (!pid) {
    return { ok: false, status: 400, error: 'projectId is required' };
  }
  if (ensure) {
    return ensureDevRolesForProject(pid);
  }
  return fetchRolesForProject(pid);
}

module.exports = {
  listDevRoles,
  ensureDevRolesForProject,
  seedDefaultDevRoles,
  DEFAULT_DEV_ROLE_TEMPLATES,
  LEGACY_DEV_ROLE_PROJECT_IDS,
};
