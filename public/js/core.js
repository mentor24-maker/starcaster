
/**
 * public/js/core.js
 * Shared state, DOM refs, API client, and utility functions.
 * Must be loaded first. Everything else reads from window.App.
 *
 * #9 — Standardized API Response Envelope:
 *   api() now transparently unwraps { ok, data, meta, ...legacyKeys } responses.
 *   All routes return the standard envelope. Legacy keys are spread alongside
 *   data so existing frontend modules continue to work without changes.
 *   Error responses use { ok: false, error: { message, code, details } }.
 */

window.App = window.App || {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

App.STANDARD_LEAD_COLUMNS = [
  'id', 'email', 'first_name', 'last_name', 'phone', 'company',
  'source', 'status', 'notes', 'tags', 'created_at', 'updated_at'
];

App.CONTACT_COLUMN_KEYS = [
  'first_name', 'last_name', 'company', 'email', 'website',
  'youtube', 'instagram'
];

App.SUGGESTED_CUSTOM_FIELD_KEYS = [
  'website', 'youtube', 'instagram', 'tiktok', 'facebook', 'x',
  'bluesky', 'linkedin', 'substack', 'medium', 'patreon',
  'discord', 'telegram', 'whatsapp'
];

App.SEGMENT_SOCIAL_FIELDS = [
  { key: 'youtube',   label: 'Youtube'   },
  { key: 'x',        label: 'X'         },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook',  label: 'Facebook'  },
  { key: 'bluesky',   label: 'BlueSky'   },
  { key: 'tiktok',    label: 'TikTok'    },
  { key: 'substack',  label: 'Substack'  },
  { key: 'medium',    label: 'Medium'    }
];

App.SEGMENT_EXCLUDED_COLUMNS = new Set([
  'id', 'source', 'status', 'notes', 'created_at', 'updated_at'
]);

// ---------------------------------------------------------------------------
// State — single source of truth for all UI data
// ---------------------------------------------------------------------------

App.state = {
  activePage: 'contactsPage',
  assets: [],
  assetCategories: [],
  channels: [],
  contacts: [],
  segments: [],
  campaigns: [],
  apiSchemas: [],
  apiConfigs: [],
  apiFormValues: {},
  profile: {},
  projects: [],
  currentProjectId: '',
  acquireJobs: [],
  acquireBusyByJob: {},
  directAcquireRuns: [],
  directAcquireCurrentRun: null,
  xHarvestRuns: [],
  xHarvestCurrentRun: null,
  redditHarvestRuns: [],
  redditHarvestCurrentRun: null,
  youtubeAcquireResult: null,
  acquireYoutubeDetails: [],
  acquireYoutubeCategories: [],
  acquireYoutubeComments: [],
  databaseTables: [],
  promoFields: [],
  promoLeads: [],
  leadColumns: [],
  leadSort: { key: 'id', dir: 'desc' },
  leadFilters: {},
  segmentLeadSort: { key: 'id', dir: 'desc' },
  segmentLeadFilters: {},
  segmentSocialPresence: {},
  segmentSocialMode: 'any',
  segmentSocialSearchPlatform: 'youtube',
  segmentSocialSearchQuery: '',
  csvHeaders: [],
  csvRows: [],
  csvMappings: [],
  contactsFilters: {
    first_name: '', last_name: '', company: '', email: '',
    website: '', youtube: '', instagram: ''
  },
  assetsFilters: {
    asset_name: '',
    asset_type: '',
    category: '',
    tags: '',
    size: '',
  },
  segmentContactsLogicMode: 'all',
  segmentContactsLogicTokens: [],
  segmentContactsLogicExpression: '',
  segmentContactsLogicSelectedIndex: -1,
  segmentContactsFilters: {
    first_name: { mode: 'contains', value: '' },
    last_name: { mode: 'contains', value: '' },
    company: { mode: 'contains', value: '' },
    email: { mode: 'contains', value: '' },
    phone: { mode: 'contains', value: '' },
    city: { mode: 'contains', value: '' },
    state: { mode: 'contains', value: '' },
    country: { mode: 'contains', value: '' },
    tags: { mode: 'contains', value: '' },
    website: { mode: 'contains', value: '' },
    youtube: { mode: 'contains', value: '' },
    instagram: { mode: 'contains', value: '' }
  }
};

// Shorthand used throughout — avoids typing App.state everywhere
const state = App.state;
const ACTIVE_PAGE_STORAGE_KEY = 'alphire.activePage';
const CURRENT_PROJECT_ID_STORAGE_KEY = 'alphire.currentProjectId';
App.CURRENT_PROJECT_ID_STORAGE_KEY = CURRENT_PROJECT_ID_STORAGE_KEY;

try {
  const savedProjectId = String(window.localStorage.getItem(CURRENT_PROJECT_ID_STORAGE_KEY) || '').trim();
  if (savedProjectId) state.currentProjectId = savedProjectId;
} catch (_) {}

// ---------------------------------------------------------------------------
// DOM element refs
// ---------------------------------------------------------------------------

App.els = {
  topNav: document.getElementById('topNav'),
  contactsPage: document.getElementById('contactsPage'),
  contactsExplorePage: document.getElementById('contactsExplorePage'),
  addContactPage: document.getElementById('addContactPage'),
  segmentsPage: document.getElementById('segmentsPage'),
  campaignsPage: document.getElementById('campaignsPage'),
  assetsPage: document.getElementById('assetsPage'),
  channelsPage: document.getElementById('channelsPage'),
  addChannelPage: document.getElementById('addChannelPage'),
  editChannelPage: document.getElementById('editChannelPage'),
  addAssetPage: document.getElementById('addAssetPage'),
  assetCategoriesPage: document.getElementById('assetCategoriesPage'),
  createAssetCategoryPage: document.getElementById('createAssetCategoryPage'),
  editAssetCategoryPage: document.getElementById('editAssetCategoryPage'),
  message: document.getElementById('message'),
  assetsTable: document.getElementById('assetsTable'),
  assetUploadPanel: document.getElementById('assetUploadPanel'),
  assetUploadForm: document.getElementById('assetUploadForm'),
  assetUploadFile: document.getElementById('assetUploadFile'),
  assetUploadType: document.getElementById('assetUploadType'),
  assetUploadCategory: document.getElementById('assetUploadCategory'),
  assetUploadName: document.getElementById('assetUploadName'),
  assetUploadTags: document.getElementById('assetUploadTags'),
  assetMultiUploadForm: document.getElementById('assetMultiUploadForm'),
  assetMultiUploadFiles: document.getElementById('assetMultiUploadFiles'),
  assetMultiUploadType: document.getElementById('assetMultiUploadType'),
  assetMultiUploadCategory: document.getElementById('assetMultiUploadCategory'),
  assetFormTitle: document.getElementById('assetFormTitle'),
  assetTypeInput: document.getElementById('assetTypeInput'),
  assetCategoryInput: document.getElementById('assetCategoryInput'),
  assetIdInput: document.getElementById('assetIdInput'),
  assetLocationRow: document.getElementById('assetLocationRow'),
  assetLocationText: document.getElementById('assetLocationText'),
  assetDimensionsRow: document.getElementById('assetDimensionsRow'),
  assetDimensionsText: document.getElementById('assetDimensionsText'),
  assetSizeRow: document.getElementById('assetSizeRow'),
  assetSizeText: document.getElementById('assetSizeText'),
  assetPreviewWrap: document.getElementById('assetPreviewWrap'),
  assetPreviewEmpty: document.getElementById('assetPreviewEmpty'),
  assetPreviewImage: document.getElementById('assetPreviewImage'),
  assetPreviewVideo: document.getElementById('assetPreviewVideo'),
  assetPreviewAudio: document.getElementById('assetPreviewAudio'),
  assetPreviewFrame: document.getElementById('assetPreviewFrame'),
  assetPreviewCopy: document.getElementById('assetPreviewCopy'),
  assetPreviewLinkRow: document.getElementById('assetPreviewLinkRow'),
  assetPreviewLink: document.getElementById('assetPreviewLink'),
  assetFormSubmitBtn: document.getElementById('assetFormSubmitBtn'),
  assetsFilterName: document.getElementById('assetsFilterName'),
  assetsFilterType: document.getElementById('assetsFilterType'),
  assetsFilterCategory: document.getElementById('assetsFilterCategory'),
  assetsFilterTags: document.getElementById('assetsFilterTags'),
  assetsApplyFilterBtn: document.getElementById('assetsApplyFilterBtn'),
  assetsFilterActionRow: document.getElementById('assetsFilterActionRow'),
  assetsBulkActionRow: document.getElementById('assetsBulkActionRow'),
  assetsSelectAllVisible: document.getElementById('assetsSelectAllVisible'),
  assetsBulkEditBtn: document.getElementById('assetsBulkEditBtn'),
  assetsBulkDeleteBtn: document.getElementById('assetsBulkDeleteBtn'),
  assetCategoriesTable: document.getElementById('assetCategoriesTable'),
  openCreateAssetCategoryPageBtn: document.getElementById('openCreateAssetCategoryPageBtn'),
  backToAssetCategoriesBtn: document.getElementById('backToAssetCategoriesBtn'),
  assetCategoryForm: document.getElementById('assetCategoryForm'),
  backFromEditAssetCategoryBtn: document.getElementById('backFromEditAssetCategoryBtn'),
  assetCategoryEditForm: document.getElementById('assetCategoryEditForm'),
  assetCategoryEditId: document.getElementById('assetCategoryEditId'),
  channelsTable: document.getElementById('channelsTable'),
  openAddChannelPageBtn: document.getElementById('openAddChannelPageBtn'),
  backToChannelsBtn: document.getElementById('backToChannelsBtn'),
  channelForm: document.getElementById('channelForm'),
  backFromEditChannelBtn: document.getElementById('backFromEditChannelBtn'),
  channelEditForm: document.getElementById('channelEditForm'),
  channelEditId: document.getElementById('channelEditId'),
  contactsTable: document.getElementById('contactsTable'),
  segmentsContactsTable: document.getElementById('segmentsContactsTable'),
  importContactsToggleBtn: document.getElementById('importContactsToggleBtn'),
  exploreContactsBtn: document.getElementById('exploreContactsBtn'),
  viewSegmentsBtn: document.getElementById('viewSegmentsBtn'),
  exploreContactsFilters: document.getElementById('exploreContactsFilters'),
  exploreContactsCount: document.getElementById('exploreContactsCount'),
  createSegmentInlineForm: document.getElementById('createSegmentInlineForm'),
  createSegmentInlineName: document.getElementById('createSegmentInlineName'),
  csvMapperSection: document.getElementById('csvMapperSection'),
  promoLeadsSection: document.getElementById('promoLeadsSection'),
  contactsSearchFirstName: document.getElementById('contactsSearchFirstName'),
  contactsCheckAll: document.getElementById('contactsCheckAll'),
  contactsSearchLastName: document.getElementById('contactsSearchLastName'),
  contactsSearchCompany: document.getElementById('contactsSearchCompany'),
  contactsSearchEmail: document.getElementById('contactsSearchEmail'),
  contactsSearchWebsite: document.getElementById('contactsSearchWebsite'),
  contactsSearchYoutube: document.getElementById('contactsSearchYoutube'),
  contactsSearchInstagram: document.getElementById('contactsSearchInstagram'),
  contactsFiltersGoBtn: document.getElementById('contactsFiltersGoBtn'),
  contactsCreateSegmentForm: document.getElementById('contactsCreateSegmentForm'),
  contactsCreateSegmentName: document.getElementById('contactsCreateSegmentName'),
  segmentsSearchEmail: document.getElementById('segmentsSearchEmail'),
  segmentsSearchName: document.getElementById('segmentsSearchName'),
  segmentsSearchCity: document.getElementById('segmentsSearchCity'),
  segmentsSearchTags: document.getElementById('segmentsSearchTags'),
  segmentsList: document.getElementById('segmentsList'),
  returnToSegmentsBtn: document.getElementById('returnToSegmentsBtn'),
  activeSegmentName: document.getElementById('activeSegmentName'),
  segmentPreviewSection: document.getElementById('segmentPreviewSection'),
  segmentPreviewTableHead: document.getElementById('segmentPreviewTableHead'),
  segmentPreviewTableBody: document.getElementById('segmentPreviewTableBody'),
  segmentsPageTableHead: document.getElementById('segmentsPageTableHead'),
  segmentsTableBody: document.getElementById('segmentsTableBody'),
  segmentsLeadFilters: document.getElementById('segmentsLeadFilters'),
  segmentsLeadsHead: document.getElementById('segmentsLeadsHead'),
  segmentsLeadsBody: document.getElementById('segmentsLeadsBody'),
  segmentsSocialChecks: document.getElementById('segmentsSocialChecks'),
  segmentsSocialModeAny: document.getElementById('segmentsSocialModeAny'),
  segmentsSocialModeAll: document.getElementById('segmentsSocialModeAll'),
  segmentsSocialSearchPlatform: document.getElementById('segmentsSocialSearchPlatform'),
  segmentsSocialSearchQuery: document.getElementById('segmentsSocialSearchQuery'),
  campaignCards: document.getElementById('campaignCards'),
  campaignSegment: document.getElementById('campaignSegment'),
  assetForm: document.getElementById('assetForm'),
  openAddAssetPageBtn: document.getElementById('openAddAssetPageBtn'),
  uploadAssetsBtn: document.getElementById('uploadAssetsBtn'),
  backToAssetsBtn: document.getElementById('backToAssetsBtn'),
  contactForm: document.getElementById('contactForm'),
  openAddContactPageBtn: document.getElementById('openAddContactPageBtn'),
  backToContactsBtn: document.getElementById('backToContactsBtn'),
  segmentForm: document.getElementById('segmentForm'),
  campaignForm: document.getElementById('campaignForm'),
  promoFieldForm: document.getElementById('promoFieldForm'),
  promoFieldsTable: document.getElementById('promoFieldsTable'),
  csvUploadForm: document.getElementById('csvUploadForm'),
  csvFileInput: document.getElementById('csvFileInput'),
  csvMapperWrap: document.getElementById('csvMapperWrap'),
  csvMapperTable: document.getElementById('csvMapperTable'),
  csvMissingSql: document.getElementById('csvMissingSql'),
  csvImportBtn: document.getElementById('csvImportBtn'),
  refreshLeadsBtn: document.getElementById('refreshLeadsBtn'),
  addLeadRowBtn: document.getElementById('addLeadRowBtn'),
  promoLeadsFilters: document.getElementById('promoLeadsFilters'),
  promoLeadsHead: document.getElementById('promoLeadsHead'),
  promoLeadsBody: document.getElementById('promoLeadsBody'),
  databaseFieldForm: document.getElementById('databaseFieldForm'),
  dbConnectionForm: document.getElementById('dbConnectionForm'),
  dbSupabaseUrl: document.getElementById('dbSupabaseUrl'),
  dbSupabaseServiceRoleKey: document.getElementById('dbSupabaseServiceRoleKey'),
  dbContactsTable: document.getElementById('dbContactsTable'),
  dbPromoLeadsTable: document.getElementById('dbPromoLeadsTable'),
  dbPromoLeadFieldsTable: document.getElementById('dbPromoLeadFieldsTable'),
  dbHarvestYoutubeDetailsTable: document.getElementById('dbHarvestYoutubeDetailsTable'),
  dbHarvestYoutubeCommentsTable: document.getElementById('dbHarvestYoutubeCommentsTable'),
  youtubeCommentsPage: document.getElementById('youtubeCommentsPage'),
  databaseTableSelect: document.getElementById('databaseTableSelect'),
  databaseFieldNameOption: document.getElementById('databaseFieldNameOption'),
  databaseFieldNameInput: document.getElementById('databaseFieldNameInput'),
  databaseFieldLabelInput: document.getElementById('databaseFieldLabelInput'),
  databaseFieldsTable: document.getElementById('databaseFieldsTable'),
  apiSettingsForm: document.getElementById('apiSettingsForm'),
  apiProviderSelect: document.getElementById('apiProviderSelect'),
  apiFieldsContainer: document.getElementById('apiFieldsContainer'),
  apiConfigsTable: document.getElementById('apiConfigsTable'),
  settingsProjectSelector: document.getElementById('settingsProjectSelector'),
  settingsProjectsList: document.getElementById('settingsProjectsList'),
  settingsProfileProjectsList: document.getElementById('settingsProfileProjectsList'),
  settingsNewProjectName: document.getElementById('settingsNewProjectName'),
  settingsNewProjectDescription: document.getElementById('settingsNewProjectDescription'),
  settingsCreateProjectBtn: document.getElementById('settingsCreateProjectBtn'),
  settingsProjectDetailsEmpty: document.getElementById('settingsProjectDetailsEmpty'),
  settingsProjectDetailsPanel: document.getElementById('settingsProjectDetailsPanel'),
  settingsProjectDetailsName: document.getElementById('settingsProjectDetailsName'),
  settingsProjectDetailsSlug: document.getElementById('settingsProjectDetailsSlug'),
  settingsProjectDetailsDescription: document.getElementById('settingsProjectDetailsDescription'),
  settingsProjectDetailsRole: document.getElementById('settingsProjectDetailsRole'),
  settingsProjectDetailsCreatedAt: document.getElementById('settingsProjectDetailsCreatedAt'),
  settingsProjectLogoFile: document.getElementById('settingsProjectLogoFile'),
  settingsProjectLogoPreview: document.getElementById('settingsProjectLogoPreview'),
  settingsProjectLogoPlaceholder: document.getElementById('settingsProjectLogoPlaceholder'),
  settingsProfileForm: document.getElementById('settingsProfileForm'),
  settingsAccountName: document.getElementById('settingsAccountName'),
  settingsAccountEmail: document.getElementById('settingsAccountEmail'),
  settingsContactName: document.getElementById('settingsContactName'),
  settingsProfileEmail: document.getElementById('settingsProfileEmail'),
  settingsProfilePhone: document.getElementById('settingsProfilePhone'),
  settingsProfileWebsite: document.getElementById('settingsProfileWebsite'),
  settingsProfileLogoFile: document.getElementById('settingsProfileLogoFile'),
  settingsProfileLogoDataUrl: document.getElementById('settingsProfileLogoDataUrl'),
  settingsProfileLogoPreviewWrap: document.getElementById('settingsProfileLogoPreviewWrap'),
  settingsProfileLogoLink: document.getElementById('settingsProfileLogoLink'),
  settingsProfileLogoPreview: document.getElementById('settingsProfileLogoPreview'),
  brandProfileButton: document.getElementById('brandProfileButton'),
  brandProfileLogo: document.getElementById('brandProfileLogo'),
  brandProfileLabel: document.getElementById('brandProfileLabel'),
  brandFallback: document.getElementById('brandFallback'),
  developLandingPagesForm: document.getElementById('developLandingPagesForm'),
  developAgentsForm: document.getElementById('developAgentsForm'),
  iconBuilderForm: document.getElementById('iconBuilderForm'),
  developToolsForm: document.getElementById('developToolsForm'),
  agentsRequestPreview: document.getElementById('agentsRequestPreview'),
  agentsResponsePreview: document.getElementById('agentsResponsePreview'),
  iconBuilderRequestPreview: document.getElementById('iconBuilderRequestPreview'),
  iconBuilderResponsePreview: document.getElementById('iconBuilderResponsePreview'),
  iconBuilderResultCard: document.getElementById('iconBuilderResultCard'),
  iconBuilderResultImage: document.getElementById('iconBuilderResultImage'),
  iconBuilderResultTitle: document.getElementById('iconBuilderResultTitle'),
  iconBuilderResultCaption: document.getElementById('iconBuilderResultCaption'),
  toolsRequestPreview: document.getElementById('toolsRequestPreview'),
  toolsResponsePreview: document.getElementById('toolsResponsePreview'),
  acquireForm: document.getElementById('acquireForm'),
  acquireJobIdInput: document.getElementById('acquireJobIdInput'),
  acquireApprovalTokenInput: document.getElementById('acquireApprovalTokenInput'),
  acquireRequestPreview: document.getElementById('acquireRequestPreview'),
  acquireResponsePreview: document.getElementById('acquireResponsePreview'),
  acquireJobsTable: document.getElementById('acquireJobsTable'),
  acquireRefreshJobsBtn: document.getElementById('acquireRefreshJobsBtn'),
  directAcquireForm: document.getElementById('directAcquireForm'),
  directAcquireRefreshBtn: document.getElementById('directAcquireRefreshBtn'),
  directAcquireRunsTable: document.getElementById('directAcquireRunsTable'),
  directAcquirePagesTable: document.getElementById('directAcquirePagesTable'),
  directAcquireErrorsPreview: document.getElementById('directAcquireErrorsPreview'),
  xHarvestForm: document.getElementById('xHarvestForm'),
  xHarvestRefreshBtn: document.getElementById('xHarvestRefreshBtn'),
  xHarvestRunsTable: document.getElementById('xHarvestRunsTable'),
  xHarvestItemsTable: document.getElementById('xHarvestItemsTable'),
  xHarvestRawPreview: document.getElementById('xHarvestRawPreview'),
  redditHarvestForm: document.getElementById('redditHarvestForm'),
  redditHarvestRefreshBtn: document.getElementById('redditHarvestRefreshBtn'),
  redditHarvestRunsTable: document.getElementById('redditHarvestRunsTable'),
  redditHarvestPostDetailsBody: document.getElementById('redditHarvestPostDetailsBody'),
  redditHarvestItemsTable: document.getElementById('redditHarvestItemsTable'),
  redditHarvestRawPreview: document.getElementById('redditHarvestRawPreview'),
  youtubeAcquireForm: document.getElementById('youtubeAcquireForm'),
  youtubeRunsRefreshBtn: document.getElementById('youtubeRunsRefreshBtn'),
  youtubeRunsTable: document.getElementById('youtubeRunsTable'),
  youtubeSummaryTable: document.getElementById('youtubeSummaryTable'),
  youtubeTranscriptPreview: document.getElementById('youtubeTranscriptPreview'),
  youtubeRawPreview: document.getElementById('youtubeRawPreview')
};

const els = App.els;

// ---------------------------------------------------------------------------
// Core UI functions
// ---------------------------------------------------------------------------

App.notify = function notify(text, isError = false) {
  els.message.textContent = text;
  els.message.style.background = isError ? '#f7c6c6' : '#fcebc8';
};

function isValidPageId(pageId) {
  const id = String(pageId || '').trim();
  if (!id) return false;
  const node = document.getElementById(id);
  return Boolean(node && node.classList.contains('app-page'));
}

function readPageFromHash() {
  const raw = String(window.location.hash || '').trim();
  if (!raw) return '';

  const bare = raw.startsWith('#') ? raw.slice(1) : raw;
  if (bare && !bare.includes('=') && isValidPageId(bare)) return bare;

  const match = bare.match(/(?:^|&)page=([^&]+)/);
  if (!match || !match[1]) return '';
  const decoded = decodeURIComponent(match[1]);
  return isValidPageId(decoded) ? decoded : '';
}

function persistActivePage(pageId) {
  const id = String(pageId || '').trim();
  if (!isValidPageId(id)) return;
  try { window.localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, id); } catch (_) {}
  try {
    const nextHash = `#page=${encodeURIComponent(id)}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  } catch (_) {}
}

App.getInitialPage = function getInitialPage() {
  const fromHash = readPageFromHash();
  if (fromHash) return fromHash;

  let fromStorage = '';
  try { fromStorage = String(window.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY) || ''); } catch (_) {}
  if (isValidPageId(fromStorage)) return fromStorage;
  return 'contactsPage';
};

App.setActivePage = function setActivePage(pageId, options = {}) {
  const target = isValidPageId(pageId) ? String(pageId) : 'contactsPage';
  const shouldPersist = options.persist !== false;

  state.activePage = target;
  document.querySelectorAll('.app-page').forEach((page) => {
    page.classList.toggle('hidden', page.id !== target);
  });
  document.querySelectorAll('.menu-link[data-page]').forEach((link) => {
    link.classList.toggle('active', link.dataset.page === target);
  });

  if (shouldPersist) persistActivePage(target);
};

// ---------------------------------------------------------------------------
// API client — envelope-aware
// ---------------------------------------------------------------------------

/**
 * Fetch a JSON API endpoint and return the parsed body.
 *
 * Standard envelope handling (#9):
 *   Success: { ok: true, data, meta, ...legacyKeys }
 *     → returned as-is so legacy keys (contacts, segments, etc.) still work,
 *       AND data / meta are available for new code.
 *
 *   Error:   { ok: false, error: { message, code, details } }
 *     → throws an Error with error.message (or falls back to error string).
 *
 * Non-envelope responses (any JSON without an `ok` field) pass through
 * unchanged so any endpoints not yet migrated continue to work.
 */
App.api = async function api(path, options = {}) {
  const projectId = String(state.currentProjectId || '').trim();
  const baseHeaders = { 'Content-Type': 'application/json' };
  if (projectId) baseHeaders['X-Project-ID'] = projectId;
  const res = await fetch(path, {
    headers: { ...baseHeaders, ...(options.headers || {}) },
    credentials: 'include',
    ...options
  });

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  const raw = await res.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch (_) {
      body = null;
    }
  }

  const nonJsonMessage = (!body && raw)
    ? `Non-JSON response (${res.status}) from ${path}: ${raw.slice(0, 140).replace(/\s+/g, ' ').trim()}`
    : '';

  if (!body) {
    throw new Error(nonJsonMessage || `Invalid API response (${res.status}) from ${path}`);
  }

  if (!res.ok) {
    // New structured error envelope: { ok: false, error: { message, code, details } }
    const err = body?.error;
    const text = (
      (typeof err === 'object' && err !== null ? err.message : null) ||
      (typeof err === 'string' ? err : null) ||
      body?.message ||
      res.statusText ||
      'Request failed'
    );
    if (res.status === 401 && App.auth && typeof App.auth.handleUnauthorized === 'function') {
      App.auth.handleUnauthorized();
    }
    throw new Error(String(text).trim());
  }

  return body;
};

// ---------------------------------------------------------------------------
// Shared utility functions
// ---------------------------------------------------------------------------

App.parseJsonInput = function parseJsonInput(raw, fallback) {
  try { return JSON.parse(raw || ''); } catch { return fallback; }
};

App.prettyJson = function prettyJson(value) {
  return JSON.stringify(value, null, 2);
};

App.setPreview = function setPreview(el, value) {
  if (el) el.textContent = App.prettyJson(value);
};

App.normalizeKey = function normalizeKey(input) {
  return String(input || '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
};

App.isStandardLeadColumn = function isStandardLeadColumn(key) {
  return App.STANDARD_LEAD_COLUMNS.includes(String(key || '').toLowerCase());
};

App.titleFromKey = function titleFromKey(key) {
  return String(key || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

App.truncateDisplay = function truncateDisplay(value, maxLen = 60) {
  const s = String(value == null ? '' : value);
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
};

App.parseCsvFile = function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed reading CSV file'));
    reader.readAsText(file);
  });
};

App.parseCsv = function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', i = 0, inQuotes = false;
  const t = String(text || '');
  while (i < t.length) {
    const ch = t[i], next = t[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r' && next === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 2; continue; }
    if (ch === '\n' || ch === '\r') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  row.push(cell);
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
};

App.parseTypedValue = function parseTypedValue(raw, type) {
  const value = raw == null ? '' : String(raw).trim();
  const t = String(type || 'text').toLowerCase();
  if (t === 'number') { const n = Number(value); return isNaN(n) ? null : n; }
  if (t === 'boolean') return ['1','true','yes','on'].includes(value.toLowerCase());
  return value;
};

App.defaultTargetKey = function defaultTargetKey(header) {
  const normalized = App.normalizeKey(header);
  const aliases = {
    firstname: 'first_name', first: 'first_name', fname: 'first_name',
    lastname: 'last_name', last: 'last_name', lname: 'last_name', surname: 'last_name',
    emailaddress: 'email', mail: 'email',
    phonenumber: 'phone', mobile: 'phone', cell: 'phone', telephone: 'phone',
    organization: 'company', employer: 'company', org: 'company',
    jobtitle: 'title', role: 'title', position: 'title'
  };
  return aliases[normalized] || normalized;
};

App.normalizeSocialPlatform = function normalizeSocialPlatform(url) {
  const s = String(url || '').toLowerCase();
  if (s.includes('youtube.com') || s.includes('youtu.be')) return 'youtube';
  if (s.includes('twitter.com') || s.includes('x.com'))    return 'x';
  if (s.includes('instagram.com'))  return 'instagram';
  if (s.includes('tiktok.com'))     return 'tiktok';
  if (s.includes('facebook.com'))   return 'facebook';
  if (s.includes('linkedin.com'))   return 'linkedin';
  if (s.includes('bluesky.app') || s.includes('bsky.app')) return 'bluesky';
  if (s.includes('substack.com'))   return 'substack';
  if (s.includes('medium.com'))     return 'medium';
  if (s.includes('patreon.com'))    return 'patreon';
  return null;
};

App.setKeyValueRows = function setKeyValueRows(tbodyEl, entries) {
  if (!tbodyEl) return;
  tbodyEl.innerHTML = '';
  entries.forEach(([key, value]) => {
    const tr = document.createElement('tr');
    const ktd = document.createElement('td');
    ktd.textContent = key;
    const vtd = document.createElement('td');
    vtd.textContent = value == null ? '-' : String(value);
    tr.appendChild(ktd);
    tr.appendChild(vtd);
    tbodyEl.appendChild(tr);
  });
};

App.ACTION_ICONS = {
  view: '<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.25" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  edit: '<path d="M3 11.5 11.6 2.9a1.4 1.4 0 0 1 2 2L5 13.5 2.5 14 3 11.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m10.8 3.7 1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  delete: '<path d="M3.5 4.5h9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6 4.5V3.4c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v1.1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 4.5l.6 8c0 .6.5 1 1.1 1h3.6c.6 0 1.1-.4 1.1-1l.6-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  load: '<path d="M8 2.5v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="m5.5 7.5 2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12.5h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  run: '<path d="M5 4.5v7l6-3.5-6-3.5Z" fill="currentColor"/>',
  status: '<circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5.2v3l2 1.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  preview: '<path d="M2.5 3.5h11v9h-11z" fill="none" stroke="currentColor" stroke-width="1.5" rx="1"/><path d="M5 6.2h6M5 8.2h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  approve: '<path d="m4 8.1 2.2 2.2L12 4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  publish: '<path d="M3 8h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="m8 4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  contact: '<circle cx="8" cy="5.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 12.5c.8-2 2.5-3 4.5-3s3.7 1 4.5 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  comments: '<path d="M3 4.2h10v6.3H7.2L4.4 12.8v-2.3H3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.2 6.5h5.6M5.2 8.4h3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  clone: '<path d="M5.2 5.2V3.8c0-.7.5-1.3 1.3-1.3h5.7c.7 0 1.3.5 1.3 1.3v5.7c0 .7-.5 1.3-1.3 1.3h-1.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3.8 5.2h5.7c.7 0 1.3.5 1.3 1.3v5.7c0 .7-.5 1.3-1.3 1.3H3.8c-.7 0-1.3-.5-1.3-1.3V6.5c0-.7.5-1.3 1.3-1.3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  copy: '<rect x="5.5" y="2.5" width="8" height="11" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.6 2.5v-0.7H8.4v0.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2.5 5.5v8a1.5 1.5 0 0 0 1.5 1.5h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};

App.makeIconButton = function makeIconButton(iconKey, label, onClick, options = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `tiny-btn icon-btn${options.primary ? ' icon-btn-primary' : ''}${options.danger ? ' icon-btn-danger' : ''}`;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  if (options.disabled) btn.disabled = true;
  if (options.marginLeft) btn.style.marginLeft = options.marginLeft;
  if (options.marginRight) btn.style.marginRight = options.marginRight;
  if (options.fixedWidth) {
    btn.style.width = options.fixedWidth;
    btn.style.minWidth = options.fixedWidth;
  }

  const iconWrap = document.createElement('span');
  iconWrap.className = 'icon-btn-glyph';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = App.ACTION_ICONS[iconKey] || App.ACTION_ICONS.view;
  iconWrap.appendChild(svg);
  btn.appendChild(iconWrap);

  if (typeof onClick === 'function') btn.addEventListener('click', onClick);
  return btn;
};

App.iconButtonMarkup = function iconButtonMarkup(iconKey, label, className = '') {
  const classes = `tiny-btn icon-btn ${className}`.trim();
  const svg = App.ACTION_ICONS[iconKey] || App.ACTION_ICONS.view;
  return `<button type="button" class="${classes}" title="${label}" aria-label="${label}"><span class="icon-btn-glyph"><svg viewBox="0 0 16 16" aria-hidden="true">${svg}</svg></span></button>`;
};
