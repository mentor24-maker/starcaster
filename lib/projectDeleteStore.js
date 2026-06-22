'use strict';

const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { listProjectsForUser } = require('./projectsStore');
const { supportsPeopleTable, deletePersonIfOrphaned } = require('./peopleStore');

const PROJECTS_TABLE = String(process.env.SUPABASE_PROJECTS_TABLE || 'app_projects').trim();

const ASSET_REFERENCE_COLUMNS = [
  { tableKey: 'messagingTweets', column: 'image_asset_id' },
  { tableKey: 'messagingArticles', column: 'thumbnail_asset_id' },
  { tableKey: 'messagingReports', column: 'thumbnail_asset_id' },
  { tableKey: 'messagingWhitePapers', column: 'thumbnail_asset_id' },
  { tableKey: 'messagingEbooks', column: 'thumbnail_asset_id' },
];

function safeText(value) {
  return String(value || '').trim();
}

function missingTableError(result) {
  const text = String(result?.error || '').toLowerCase();
  return (
    text.includes('does not exist')
    || text.includes('relation')
    || text.includes('schema cache')
    || text.includes('could not find')
  );
}

function missingColumnError(result) {
  const text = String(result?.error || '').toLowerCase();
  return text.includes('column') && text.includes('project_id');
}

async function deleteByProjectId(table, projectId) {
  const pid = safeText(projectId);
  if (!pid || !safeText(table)) return { ok: true, skipped: true };
  const result = await sbQuery({
    method: 'DELETE',
    table,
    query: `project_id=eq.${encodeURIComponent(pid)}`,
  });
  if (!result.ok && (missingTableError(result) || missingColumnError(result))) {
    return { ok: true, skipped: true };
  }
  return result;
}

function messagingTablesFromConfig() {
  const t = tableConfig();
  return [
    t.messagingComments,
    t.messagingTranscripts,
    t.messagingDescriptions,
    t.messagingPosts,
    t.messagingEmails,
    t.messagingTweets,
    t.messagingEbooks,
    t.messagingWhitePapers,
    t.messagingReports,
    t.messagingArticles,
    t.messagingPitches,
    t.messagingTaglines,
    t.messagingSubheadings,
    t.messagingHeadlines,
    t.messagingKeywords,
    t.messagingHashtags,
    t.messagingCtas,
    t.messagingTags,
    t.messagingFormats,
    t.messagingTopics,
    t.messagingPrompts,
    'messaging_wyr_questions',
  ].filter(Boolean);
}

function scopedTablesFromConfig() {
  const t = tableConfig();
  return [
    t.campaignEvents,
    t.campaigns,
    t.segments,
    t.channels,
    t.contactPersonas,
    t.promoLeads,
    t.promoLeadFields,
    t.assetCategories,
    t.assetAssociations,
    t.websitePeers,
    t.directAcquireRuns,
    t.xAcquireRuns,
    t.redditAcquireRuns,
    t.engageSocialPosts,
    t.acquireJobMirror,
    t.orchestratorRuns,
    t.acquireYoutubeDetails,
    t.acquireYoutubeTopics,
    t.acquireYoutubeComments,
    t.acquireYoutubeVideos,
    t.engageYoutubeCommentAgents,
    t.builderThemes,
    t.builderModuleClasses,
    t.builderModules,
    t.builderPollSubmissions,
    t.builderForms,
    t.builderEmailTemplates,
    t.builderPages,
    t.builderPageTemplates,
    t.builderExtensions,
    t.builderExtensionsManager,
    t.builderIcons,
    t.rogerChats,
    t.rogerSessions,
    t.assetsVideoCuration,
    t.observeUsageLogs,
    t.influencerPersonas,
    t.personaAcquires,
    t.polls,
    t.pollOptions,
    t.pollResponses,
    'team_invitations',
    'dev_team',
  ].filter(Boolean);
}

async function listProjectAssetIds(projectId) {
  const pid = safeText(projectId);
  const result = await sbQuery({
    table: tableConfig().assets,
    query: `select=id&project_id=eq.${encodeURIComponent(pid)}&limit=2000`,
  });
  if (!result.ok) return result;
  const rows = Array.isArray(result.data) ? result.data : [];
  return {
    ok: true,
    data: rows.map((row) => Number(row?.id || 0)).filter((id) => Number.isFinite(id) && id > 0),
  };
}

async function assetIdsReferencedOutsideProject(projectId, assetIds) {
  const pid = safeText(projectId);
  const ids = Array.isArray(assetIds) ? assetIds.filter((id) => id > 0) : [];
  if (!ids.length) return new Set();

  const referenced = new Set();
  const t = tableConfig();

  for (const { tableKey, column } of ASSET_REFERENCE_COLUMNS) {
    const table = t[tableKey];
    if (!table) continue;
    for (const assetId of ids) {
      const query = [
        `select=id`,
        `${column}=eq.${assetId}`,
        `project_id=neq.${encodeURIComponent(pid)}`,
        'limit=1',
      ].join('&');
      const result = await sbQuery({ table, query });
      if (!result.ok) {
        if (missingTableError(result) || missingColumnError(result)) continue;
        continue;
      }
      if (Array.isArray(result.data) && result.data.length) referenced.add(assetId);
    }
  }

  return referenced;
}

async function deleteExclusiveAssets(projectId) {
  const listResult = await listProjectAssetIds(projectId);
  if (!listResult.ok) return listResult;
  const assetIds = listResult.data || [];
  if (!assetIds.length) return { ok: true, deleted: 0 };

  const referencedOutside = await assetIdsReferencedOutsideProject(projectId, assetIds);
  const toDelete = assetIds.filter((id) => !referencedOutside.has(id));
  if (!toDelete.length) return { ok: true, deleted: 0, skippedShared: assetIds.length };

  const assetsTable = tableConfig().assets;
  for (const assetId of toDelete) {
    const result = await sbQuery({
      method: 'DELETE',
      table: assetsTable,
      query: `id=eq.${assetId}&project_id=eq.${encodeURIComponent(projectId)}`,
    });
    if (!result.ok && !missingTableError(result)) return result;
  }

  return { ok: true, deleted: toDelete.length, skippedShared: referencedOutside.size };
}

async function collectPersonIdsForProject(projectId) {
  const contactsTable = tableConfig().contacts;
  const result = await sbQuery({
    table: contactsTable,
    query: `select=person_id&project_id=eq.${encodeURIComponent(projectId)}&limit=5000`,
  });
  if (!result.ok) return result;
  const rows = Array.isArray(result.data) ? result.data : [];
  const ids = new Set();
  rows.forEach((row) => {
    const personId = safeText(row?.person_id);
    if (personId) ids.add(personId);
  });
  return { ok: true, data: Array.from(ids) };
}

async function purgeContactsAndOrphanPeople(projectId) {
  const personIdsResult = await collectPersonIdsForProject(projectId);
  if (!personIdsResult.ok) return personIdsResult;
  const personIds = personIdsResult.data || [];

  const contactsResult = await deleteByProjectId(tableConfig().contacts, projectId);
  if (!contactsResult.ok) return contactsResult;

  if (!(await supportsPeopleTable()) || !personIds.length) {
    return { ok: true, peopleDeleted: 0 };
  }

  let peopleDeleted = 0;
  for (const personId of personIds) {
    const removed = await deletePersonIfOrphaned(personId);
    if (removed) peopleDeleted += 1;
  }
  return { ok: true, peopleDeleted };
}

async function purgeProjectAssociatedData(projectId) {
  if (!isSupabaseConfigured()) {
    return { ok: false, status: 501, error: 'Associated data purge requires Supabase' };
  }

  const messagingTables = messagingTablesFromConfig();
  for (const table of messagingTables) {
    const result = await deleteByProjectId(table, projectId);
    if (!result.ok) return result;
  }

  const scopedTables = scopedTablesFromConfig();
  for (const table of scopedTables) {
    const result = await deleteByProjectId(table, projectId);
    if (!result.ok) return result;
  }

  const contactsResult = await purgeContactsAndOrphanPeople(projectId);
  if (!contactsResult.ok) return contactsResult;

  const assetsResult = await deleteExclusiveAssets(projectId);
  if (!assetsResult.ok) return assetsResult;

  return {
    ok: true,
    purge: {
      assetsDeleted: assetsResult.deleted || 0,
      assetsSkippedShared: assetsResult.skippedShared || 0,
      peopleDeleted: contactsResult.peopleDeleted || 0,
    },
  };
}

async function deleteProjectRecord(projectId) {
  return sbQuery({
    method: 'DELETE',
    table: PROJECTS_TABLE,
    query: `id=eq.${encodeURIComponent(projectId)}`,
    headers: { Prefer: 'return=representation' },
  });
}

async function deleteProjectForUser(projectIdInput, userIdInput, options = {}) {
  const projectId = safeText(projectIdInput);
  const userId = safeText(userIdInput);
  const purgeAssociated = Boolean(options?.purgeAssociated);

  if (!userId) return { ok: false, status: 400, error: 'userId is required' };
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };
  if (projectId.startsWith('proj_default_')) {
    return { ok: false, status: 400, error: 'Default project cannot be deleted' };
  }

  const listResult = await listProjectsForUser(userId);
  if (!listResult.ok) return listResult;
  const projects = Array.isArray(listResult.data) ? listResult.data : [];
  const project = projects.find((row) => row.id === projectId) || null;
  if (!project) {
    return { ok: false, status: 403, error: 'Project not found or access denied', code: 'PROJECT_ACCESS_DENIED' };
  }

  const role = safeText(project?.membership?.role).toLowerCase();
  if (role !== 'owner') {
    return { ok: false, status: 403, error: 'Only project owners can delete a project', code: 'PROJECT_OWNER_REQUIRED' };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, status: 501, error: 'Project deletion requires Supabase' };
  }

  let purgeSummary = null;
  if (purgeAssociated) {
    const purgeResult = await purgeProjectAssociatedData(projectId);
    if (!purgeResult.ok) return purgeResult;
    purgeSummary = purgeResult.purge || null;
  }

  const deleteResult = await deleteProjectRecord(projectId);
  if (!deleteResult.ok) return deleteResult;

  return {
    ok: true,
    status: 200,
    data: {
      deletedProjectId: projectId,
      purgeAssociated,
      purge: purgeSummary,
    },
  };
}

module.exports = {
  deleteProjectForUser,
  purgeProjectAssociatedData,
};
