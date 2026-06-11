'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { suggestedReferenceRole } = require('./websitePeerTaxonomy');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
} = require('./projectScope');

function table() {
  return tableConfig().websitePeers;
}

function safeText(value, max = 2000) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function safeParagraph(value, max = 8000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return raw;
  }
}

function domainOf(value) {
  const raw = normalizeUrl(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return String(parsed.hostname || '').trim().toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function parseKeywordList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => safeText(item, 240))
      .filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index);
  }
  return String(value || '')
    .split(/\r?\n|,/g)
    .map((item) => safeText(item, 240))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function referenceRoleFromRow(row) {
  const siteType = safeText(row?.site_type || 'peer', 32).toLowerCase() === 'source' ? 'source' : 'peer';
  const metadata = safeObject(row?.metadata);
  const fromMeta = safeText(metadata.reference_role, 32).toLowerCase();
  if (fromMeta === 'peer' || fromMeta === 'model' || fromMeta === 'other' || fromMeta === 'project') return fromMeta;
  return siteType === 'source' ? 'project' : 'peer';
}

function rowToWebsitePeer(row) {
  if (!row) return null;
  const referenceRole = referenceRoleFromRow(row);
  return {
    id: Number(row.id || 0) || 0,
    reference_role: referenceRole,
    site_type: safeText(row.site_type || 'peer', 32).toLowerCase() === 'source' ? 'source' : 'peer',
    source_url: normalizeUrl(row.source_url || ''),
    source_domain: safeText(row.source_domain || domainOf(row.source_url), 255).toLowerCase(),
    site_url: normalizeUrl(row.site_url || row.url || ''),
    domain: safeText(row.domain || domainOf(row.site_url || row.url), 255).toLowerCase(),
    title: safeText(row.title || row.site_title, 240),
    website_model: safeText(row.website_model || row.model, 240),
    matched_keywords: parseKeywordList(row.matched_keywords),
    snippet: safeParagraph(row.snippet || '', 4000),
    notes: safeParagraph(row.notes || '', 4000),
    metadata: safeObject(row.metadata),
    last_acquired_at: String(row.last_acquired_at || row.last_harvested_at || row.updated_at || row.created_at || ''),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

async function listWebsitePeers(limit = 500, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const query = await scopedListQuery(table(), `select=*&order=updated_at.desc&limit=${safeLimit}`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToWebsitePeer) : [],
  };
}

async function getWebsitePeer(id, scope = null) {
  const peerId = Number(id || 0) || 0;
  if (!peerId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `select=*&id=eq.${peerId}&limit=1`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Website peer not found' };
  return { ok: true, status: 200, data: rowToWebsitePeer(row) };
}

async function createWebsitePeer(input, scope = null) {
  const siteUrl = normalizeUrl(input?.site_url || input?.url);
  const siteType = safeText(input?.site_type || 'peer', 32).toLowerCase() === 'source' ? 'source' : 'peer';
  const sourceUrl = normalizeUrl(input?.source_url || siteUrl);
  const referenceRole = safeText(input?.reference_role || safeObject(input?.metadata).reference_role, 32).toLowerCase();
  const metadata = {
    ...safeObject(input?.metadata),
    ...(referenceRole === 'peer' || referenceRole === 'model' || referenceRole === 'other' || referenceRole === 'project'
      ? { reference_role: referenceRole }
      : {}),
  };
  const row = await scopedInsertRow(table(), {
    site_type: siteType,
    source_url: sourceUrl,
    source_domain: safeText(input?.source_domain || domainOf(sourceUrl), 255).toLowerCase(),
    site_url: siteUrl,
    domain: safeText(input?.domain || domainOf(siteUrl), 255).toLowerCase(),
    title: safeText(input?.title || input?.site_title, 240),
    website_model: safeText(input?.website_model || input?.model, 240),
    matched_keywords: parseKeywordList(input?.matched_keywords),
    snippet: safeParagraph(input?.snippet || '', 4000),
    notes: safeParagraph(input?.notes || '', 4000),
    metadata,
    last_acquired_at: String(input?.last_acquired_at || new Date().toISOString()),
  }, scope);
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToWebsitePeer(created) };
}

async function updateWebsitePeer(id, input, scope = null) {
  const peerId = Number(id || 0) || 0;
  if (!peerId) return { ok: false, status: 400, error: 'id is required' };
  const existingRes = await getWebsitePeer(peerId, scope);
  if (!existingRes.ok) return existingRes;
  const existing = existingRes.data;
  const referenceRole = safeText(
    input?.reference_role || safeObject(input?.metadata).reference_role || existing.reference_role,
    32
  ).toLowerCase();
  const metadata = {
    ...safeObject(existing.metadata),
    ...safeObject(input?.metadata),
    ...(referenceRole === 'peer' || referenceRole === 'model' || referenceRole === 'other' || referenceRole === 'project'
      ? { reference_role: referenceRole }
      : {}),
  };
  const patch = await scopedPatchRow(table(), {
    site_type: input?.site_type !== undefined
      ? (safeText(input.site_type, 32).toLowerCase() === 'source' ? 'source' : 'peer')
      : existing.site_type,
    source_url: normalizeUrl(input?.source_url !== undefined ? input.source_url : existing.source_url),
    source_domain: safeText(
      input?.source_domain !== undefined ? input.source_domain : existing.source_domain,
      255
    ).toLowerCase(),
    site_url: normalizeUrl(input?.site_url !== undefined ? input.site_url : (input?.url !== undefined ? input.url : existing.site_url)),
    domain: safeText(
      input?.domain !== undefined ? input.domain : domainOf(input?.site_url || input?.url || existing.site_url),
      255
    ).toLowerCase(),
    title: safeText(input?.title !== undefined ? input.title : existing.title, 240),
    website_model: safeText(
      input?.website_model !== undefined ? input.website_model : (input?.model !== undefined ? input.model : existing.website_model),
      240
    ),
    matched_keywords: input?.matched_keywords !== undefined
      ? parseKeywordList(input.matched_keywords)
      : existing.matched_keywords,
    snippet: input?.snippet !== undefined ? safeParagraph(input.snippet, 4000) : existing.snippet,
    notes: input?.notes !== undefined ? safeParagraph(input.notes, 4000) : existing.notes,
    metadata,
    last_acquired_at: String(input?.last_acquired_at || existing.last_acquired_at || new Date().toISOString()),
  }, scope);
  const query = await scopedIdQuery(table(), `id=eq.${peerId}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Website peer not found' };
  return { ok: true, status: 200, data: rowToWebsitePeer(updated) };
}

async function deleteWebsitePeer(id, scope = null) {
  const peerId = Number(id || 0) || 0;
  if (!peerId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${peerId}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!deleted) return { ok: false, status: 404, error: 'Website peer not found' };
  return { ok: true, status: 200, data: rowToWebsitePeer(deleted) };
}

async function upsertWebsitePeersFromRun(run, scope = null) {
  const sourceUrl = normalizeUrl(run?.source_url || '');
  const sourceDomain = domainOf(sourceUrl);
  if (!sourceUrl || !sourceDomain) {
    return { ok: false, status: 400, error: 'Valid source_url is required' };
  }
  const sourceTitle = Array.isArray(run?.pages)
    ? safeText((run.pages.find((page) => normalizeUrl(page?.url) === sourceUrl) || run.pages[0] || {}).title, 240)
    : '';
  const sourceKeywords = (Array.isArray(run?.keyword_summary?.top_keywords) ? run.keyword_summary.top_keywords : [])
    .map((item) => safeText(item?.keyword, 240))
    .filter(Boolean)
    .slice(0, 20);
  const sourceMetadata = {
    reference_role: 'project',
    run_id: safeText(run?.run_id, 120),
    pages_succeeded: Number(run?.pages_succeeded || 0) || 0,
    pages_failed: Number(run?.pages_failed || 0) || 0,
    contact_summary: safeObject(run?.contact_summary),
    keyword_summary: safeObject(run?.keyword_summary),
    hashtag_summary: safeObject(run?.hashtag_summary),
  };

  const sourceRow = await scopedInsertRow(table(), {
    site_type: 'source',
    source_url: sourceUrl,
    source_domain: sourceDomain,
    site_url: sourceUrl,
    domain: sourceDomain,
    title: sourceTitle,
    website_model: 'Source Website',
    matched_keywords: sourceKeywords,
    snippet: '',
    notes: '',
    metadata: sourceMetadata,
    last_acquired_at: String(run?.finished_at || run?.updated_at || new Date().toISOString()),
  }, scope);

  const peerRows = await Promise.all(
    (Array.isArray(run?.peer_summary?.peers) ? run.peer_summary.peers : []).map(async (peer) => scopedInsertRow(table(), {
      site_type: 'peer',
      source_url: sourceUrl,
      source_domain: sourceDomain,
      site_url: normalizeUrl(peer?.url || ''),
      domain: safeText(peer?.domain || domainOf(peer?.url || ''), 255).toLowerCase(),
      title: safeText(peer?.title, 240),
      website_model: safeText(peer?.model, 240),
      matched_keywords: parseKeywordList(peer?.matched_keywords),
      snippet: safeParagraph(peer?.snippet || '', 4000),
      notes: '',
      metadata: {
        reference_role: 'peer',
        run_id: safeText(run?.run_id, 120),
        hits: Number(peer?.hits || 0) || 0,
        rank: Number(peer?.rank || 0) || 0,
        other_models: parseKeywordList(peer?.other_models),
      },
      last_acquired_at: String(run?.finished_at || run?.updated_at || new Date().toISOString()),
    }, scope))
  );

  const rows = [sourceRow, ...peerRows].filter((row) => safeText(row?.source_domain) && safeText(row?.domain));
  if (!rows.length) return { ok: true, status: 200, data: { count: 0, rows: [] } };

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'on_conflict=project_id,site_type,source_domain,domain&select=*',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: rows,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: {
      count: Array.isArray(res.data) ? res.data.length : 0,
      rows: Array.isArray(res.data) ? res.data.map(rowToWebsitePeer) : [],
    },
  };
}

function isDiscoveryCandidate(peer) {
  return safeObject(peer?.metadata).discovery_candidate === true;
}

function discoveryResultToRow(peer, discovery, sourceUrl, sourceDomain) {
  const websiteModel = safeText(peer?.website_model || peer?.model, 240) || 'Direct Competitors';
  const referenceRole = suggestedReferenceRole(websiteModel);
  return {
    site_type: 'peer',
    source_url: sourceUrl,
    source_domain: sourceDomain,
    site_url: normalizeUrl(peer?.url || ''),
    domain: safeText(peer?.domain || domainOf(peer?.url || ''), 255).toLowerCase(),
    title: safeText(peer?.title, 240),
    website_model: websiteModel,
    matched_keywords: parseKeywordList(peer?.matched_keywords),
    snippet: safeParagraph(peer?.snippet || '', 4000),
    notes: '',
    metadata: {
      reference_role: referenceRole,
      discovery_candidate: true,
      discovery_version: safeText(discovery?.version, 64),
      discovery_run_at: safeText(discovery?.finished_at, 64),
      similarity_score: Number(peer?.similarity_score || 0) || 0,
      reasons: Array.isArray(peer?.reasons) ? peer.reasons.slice(0, 12) : [],
      classification_source: safeText(peer?.classification_source, 32),
      classification_confidence: Number(peer?.classification_confidence || 0) || 0,
      classification_rationale: safeText(peer?.classification_rationale, 500),
      searched_keywords: Array.isArray(discovery?.searched_keywords) ? discovery.searched_keywords.slice(0, 20) : [],
      classification_gemini_used: !!discovery?.classification_gemini_used,
      classification_gemini_count: Number(discovery?.classification_gemini_count || 0) || 0,
    },
    last_acquired_at: String(discovery?.finished_at || new Date().toISOString()),
  };
}

function buildDiscoveryRunSummary(peers, sourceUrl) {
  const first = Array.isArray(peers) && peers.length ? peers[0] : null;
  const meta = safeObject(first?.metadata);
  const classificationNote = meta.classification_gemini_used
    ? ` Classified ${Number(meta.classification_gemini_count || 0) || 0} site(s) with Gemini.`
    : '';
  const searchedKeywords = Array.isArray(meta.searched_keywords) ? meta.searched_keywords : [];
  return {
    source_url: normalizeUrl(sourceUrl || first?.source_url || ''),
    version: safeText(meta.discovery_version, 64),
    finished_at: safeText(meta.discovery_run_at, 64),
    searched_keywords: searchedKeywords,
    keyword_line: searchedKeywords.length
      ? `Search phrases: ${searchedKeywords.join(', ')}.${classificationNote}`
      : classificationNote.trim(),
    classification_gemini_used: !!meta.classification_gemini_used,
    classification_gemini_count: Number(meta.classification_gemini_count || 0) || 0,
  };
}

async function listDiscoveryCandidates(sourceUrl, scope = null) {
  const sourceDomain = domainOf(sourceUrl);
  if (!sourceDomain) {
    return { ok: true, status: 200, data: [], run: buildDiscoveryRunSummary([], sourceUrl) };
  }
  const listed = await listWebsitePeers(2000, scope);
  if (!listed.ok) return listed;
  const data = (Array.isArray(listed.data) ? listed.data : [])
    .filter((peer) => isDiscoveryCandidate(peer) && peer.source_domain === sourceDomain)
    .sort((a, b) => {
      const scoreDiff = (Number(b.metadata?.similarity_score || 0) || 0) - (Number(a.metadata?.similarity_score || 0) || 0);
      if (scoreDiff) return scoreDiff;
      return String(a.domain || '').localeCompare(String(b.domain || ''));
    });
  return {
    ok: true,
    status: 200,
    data,
    run: buildDiscoveryRunSummary(data, sourceUrl),
  };
}

async function clearDiscoveryCandidatesForSource(sourceUrl, scope = null) {
  const listed = await listDiscoveryCandidates(sourceUrl, scope);
  if (!listed.ok) return listed;
  let deleted = 0;
  for (const peer of listed.data) {
    const res = await deleteWebsitePeer(peer.id, scope);
    if (res.ok) deleted += 1;
  }
  return { ok: true, status: 200, data: { deleted } };
}

async function persistDiscoveryResults(discovery, scope = null) {
  const sourceUrl = normalizeUrl(discovery?.source_url || '');
  const sourceDomain = domainOf(sourceUrl);
  if (!sourceUrl || !sourceDomain) {
    return { ok: false, status: 400, error: 'Valid discovery source_url is required' };
  }
  const results = Array.isArray(discovery?.results) ? discovery.results : [];
  const cleared = await clearDiscoveryCandidatesForSource(sourceUrl, scope);
  if (!cleared.ok) return cleared;
  if (!results.length) {
    return { ok: true, status: 200, data: { count: 0, rows: [], cleared: cleared.data?.deleted || 0 } };
  }
  const rows = await Promise.all(
    results
      .filter((peer) => safeText(peer?.domain) && normalizeUrl(peer?.url || ''))
      .map((peer) => scopedInsertRow(
        table(),
        discoveryResultToRow(peer, discovery, sourceUrl, sourceDomain),
        scope
      ))
  );
  const filtered = rows.filter((row) => safeText(row?.source_domain) && safeText(row?.domain));
  if (!filtered.length) {
    return { ok: true, status: 200, data: { count: 0, rows: [], cleared: cleared.data?.deleted || 0 } };
  }
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'on_conflict=project_id,site_type,source_domain,domain&select=*',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: filtered,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: {
      count: Array.isArray(res.data) ? res.data.length : 0,
      rows: Array.isArray(res.data) ? res.data.map(rowToWebsitePeer) : [],
      cleared: cleared.data?.deleted || 0,
    },
  };
}

async function promoteDiscoveryCandidates(ids, scope = null) {
  const idList = (Array.isArray(ids) ? ids : [])
    .map((id) => Number(id || 0) || 0)
    .filter(Boolean);
  if (!idList.length) {
    return { ok: false, status: 400, error: 'At least one candidate id is required' };
  }
  const promoted = [];
  for (const peerId of idList) {
    const existingRes = await getWebsitePeer(peerId, scope);
    if (!existingRes.ok || !isDiscoveryCandidate(existingRes.data)) continue;
    const updatedRes = await updateWebsitePeer(peerId, {
      metadata: {
        ...safeObject(existingRes.data.metadata),
        discovery_candidate: false,
        discovery_promoted_at: new Date().toISOString(),
      },
    }, scope);
    if (updatedRes.ok) promoted.push(updatedRes.data);
  }
  return { ok: true, status: 200, data: { count: promoted.length, rows: promoted } };
}

module.exports = {
  listWebsitePeers,
  getWebsitePeer,
  createWebsitePeer,
  updateWebsitePeer,
  deleteWebsitePeer,
  upsertWebsitePeersFromRun,
  listDiscoveryCandidates,
  persistDiscoveryResults,
  promoteDiscoveryCandidates,
  isDiscoveryCandidate,
};
