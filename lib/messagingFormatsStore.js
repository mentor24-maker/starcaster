'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
} = require('./projectScope');

function t() { return tableConfig(); }

const DEFAULT_MESSAGING_FORMATS = [
  { format: 'Headlines', family: 'Short Form', destination: 'Headlines Editor', page_id: 'messagingHeadlinesPage', enabled: true, sort_order: 10 },
  { format: 'Sub-headings', family: 'Short Form', destination: 'Sub-headings Editor', page_id: 'messagingSubheadingsPage', enabled: true, sort_order: 20 },
  { format: 'Taglines', family: 'Short Form', destination: 'Taglines Editor', page_id: 'messagingTaglinesPage', enabled: true, sort_order: 30 },
  { format: 'Pitches', family: 'Short Form', destination: 'Pitches Editor', page_id: 'messagingPitchesPage', enabled: true, sort_order: 40 },
  { format: 'Emails', family: 'Email', destination: 'Emails Editor', page_id: 'messagingEmailsPage', enabled: true, sort_order: 50 },
  { format: 'Tweets', family: 'Social', destination: 'Tweets Editor', page_id: 'messagingTweetsPage', enabled: true, sort_order: 60 },
  { format: 'Posts', family: 'Social', destination: 'Posts Editor', page_id: 'messagingPostsPage', enabled: true, sort_order: 70 },
  { format: 'Articles', family: 'Long Form', destination: 'Articles Editor', page_id: 'messagingArticlesPage', enabled: true, sort_order: 80 },
  { format: 'Reports', family: 'Long Form', destination: 'Reports Editor', page_id: 'messagingReportsPage', enabled: true, sort_order: 90 },
  { format: 'White Papers', family: 'Long Form', destination: 'White Papers Editor', page_id: 'messagingWhitePapersPage', enabled: true, sort_order: 100 },
  { format: 'eBooks', family: 'Long Form', destination: 'eBooks Editor', page_id: 'messagingEbooksPage', enabled: true, sort_order: 110 },
  { format: 'Descriptions', family: 'Support Copy', destination: 'Descriptions Editor', page_id: 'messagingDescriptionsPage', enabled: true, sort_order: 120 },
  { format: 'Transcripts', family: 'Support Copy', destination: 'Transcripts Editor', page_id: 'messagingTranscriptsPage', enabled: true, sort_order: 130 },
  { format: 'Comments', family: 'Support Copy', destination: 'Comments Editor', page_id: 'messagingCommentsPage', enabled: true, sort_order: 140 },
  { format: 'Keywords', family: 'Short Form', destination: 'Keywords Editor', page_id: 'messagingKeywordsPage', enabled: true, sort_order: 145 },
  { format: 'Hashtags', family: 'Support Copy', destination: 'Hashtags Editor', page_id: 'messagingHashtagsPage', enabled: true, sort_order: 150 },
  { format: 'Tags', family: 'Support Copy', destination: 'Tags Editor', page_id: 'messagingTagsPage', enabled: true, sort_order: 155 },
  { format: 'Calls to Action', family: 'Support Copy', destination: 'Calls to Action Editor', page_id: 'messagingCtasPage', enabled: true, sort_order: 160 },
];

function cleanText(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function normalizeBool(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'on') return true;
  if (value === 0 || value === '0' || value === 'false' || value === 'off') return false;
  return Boolean(fallback);
}

function rowToMessagingFormat(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    format: cleanText(row.format || row.content_type_name, 240),
    family: cleanText(row.family, 120),
    destination: cleanText(row.destination, 240),
    pageId: cleanText(row.page_id, 120),
    enabled: normalizeBool(row.enabled, true),
    sortOrder: Number(row.sort_order || 0) || 0,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

async function ensureSeeded(scope = null) {
  const existingQuery = await scopedListQuery(t().messagingFormats, 'select=id&limit=1', scope);
  const existing = await sbQuery({
    table: t().messagingFormats,
    query: existingQuery,
  });
  if (!existing.ok) return existing;
  if (Array.isArray(existing.data) && existing.data.length) return existing;
  const scopedDefaults = [];
  for (const row of DEFAULT_MESSAGING_FORMATS) {
    scopedDefaults.push(await scopedInsertRow(t().messagingFormats, row, scope));
  }
  return sbQuery({
    method: 'POST',
    table: t().messagingFormats,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: scopedDefaults,
  });
}

async function listMessagingFormats(limit = 5000, scope = null) {
  const seeded = await ensureSeeded(scope);
  if (!seeded.ok) return seeded;
  const query = await scopedListQuery(
    t().messagingFormats,
    `select=*&order=sort_order.asc.nullslast,format.asc&limit=${Number(limit || 5000) || 5000}`,
    scope
  );
  const result = await sbQuery({
    table: t().messagingFormats,
    query,
  });
  if (!result.ok) return result;
  return { ok: true, status: result.status, data: Array.isArray(result.data) ? result.data.map(rowToMessagingFormat).filter(Boolean) : [] };
}

async function createMessagingFormat(input, scope = null) {
  const baseRow = {
    format: cleanText(input?.format || input?.content_type_name, 240),
    family: cleanText(input?.family, 120),
    destination: cleanText(input?.destination, 240),
    page_id: cleanText(input?.pageId || input?.page_id, 120),
    enabled: normalizeBool(input?.enabled, true),
    sort_order: Number(input?.sortOrder || input?.sort_order || 0) || 0,
  };
  if (!baseRow.format) return { ok: false, status: 400, error: 'format is required' };
  if (!baseRow.family) return { ok: false, status: 400, error: 'family is required' };
  const row = await scopedInsertRow(t().messagingFormats, baseRow, scope);
  const existingQuery = await scopedListQuery(
    t().messagingFormats,
    `select=*&format=eq.${encodeURIComponent(row.format)}&limit=1`,
    scope
  );
  const existing = await sbQuery({
    table: t().messagingFormats,
    query: existingQuery,
  });
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    return { ok: false, status: 409, error: 'A messaging format with this name already exists' };
  }
  const result = await sbQuery({
    method: 'POST',
    table: t().messagingFormats,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!result.ok) return result;
  const created = Array.isArray(result.data) ? result.data[0] : result.data;
  return { ok: true, status: result.status, data: rowToMessagingFormat(created) };
}

async function updateMessagingFormat(id, input, scope = null) {
  const formatId = Number(id || 0) || 0;
  if (!formatId) return { ok: false, status: 400, error: 'id is required' };
  const baseRow = {
    format: cleanText(input?.format || input?.content_type_name, 240),
    family: cleanText(input?.family, 120),
    destination: cleanText(input?.destination, 240),
    page_id: cleanText(input?.pageId || input?.page_id, 120),
    enabled: normalizeBool(input?.enabled, true),
    sort_order: Number(input?.sortOrder || input?.sort_order || 0) || 0,
  };
  if (!baseRow.format) return { ok: false, status: 400, error: 'format is required' };
  if (!baseRow.family) return { ok: false, status: 400, error: 'family is required' };
  const row = await scopedPatchRow(t().messagingFormats, baseRow, scope);
  const existingQuery = await scopedListQuery(
    t().messagingFormats,
    `select=*&format=eq.${encodeURIComponent(row.format)}&limit=1`,
    scope
  );
  const existing = await sbQuery({
    table: t().messagingFormats,
    query: existingQuery,
  });
  const existingRow = existing.ok && Array.isArray(existing.data) ? existing.data[0] : null;
  if (existingRow && Number(existingRow.id || 0) !== formatId) {
    return { ok: false, status: 409, error: 'A messaging format with this name already exists' };
  }
  const query = await scopedIdQuery(t().messagingFormats, `id=eq.${formatId}&select=*`, scope);
  const result = await sbQuery({
    method: 'PATCH',
    table: t().messagingFormats,
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!result.ok) return result;
  const updated = Array.isArray(result.data) ? result.data[0] : result.data;
  return { ok: true, status: result.status, data: rowToMessagingFormat(updated) };
}

async function deleteMessagingFormat(id, scope = null) {
  const formatId = Number(id || 0) || 0;
  if (!formatId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(t().messagingFormats, `id=eq.${formatId}&select=*`, scope);
  const result = await sbQuery({
    method: 'DELETE',
    table: t().messagingFormats,
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!result.ok) return result;
  const deleted = Array.isArray(result.data) ? result.data[0] : result.data;
  return { ok: true, status: result.status, data: rowToMessagingFormat(deleted) };
}

async function getMessagingFormatByName(formatName, scope = null) {
  const name = cleanText(formatName, 240);
  if (!name) return { ok: false, status: 400, error: 'format name is required' };

  const seeded = await ensureSeeded(scope);
  if (!seeded.ok) return seeded;

  const query = await scopedListQuery(
    t().messagingFormats,
    `select=*&format=eq.${encodeURIComponent(name)}&limit=1`,
    scope
  );
  let result = await sbQuery({
    table: t().messagingFormats,
    query,
  });
  if (!result.ok) return result;

  let row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) {
    const listRes = await listMessagingFormats(5000, scope);
    if (!listRes.ok) return listRes;
    const match = (listRes.data || []).find(
      (entry) => String(entry.format || '').trim().toLowerCase() === name.toLowerCase()
    );
    row = match ? { id: match.id, format: match.format } : null;
  }

  if (!row) {
    return {
      ok: false,
      status: 404,
      error: `No Content Format found for "${name}". Add it under Messaging → Content Formats first.`,
    };
  }

  return { ok: true, status: 200, data: rowToMessagingFormat(row) };
}

module.exports = {
  rowToMessagingFormat,
  listMessagingFormats,
  getMessagingFormatByName,
  createMessagingFormat,
  updateMessagingFormat,
  deleteMessagingFormat,
};
