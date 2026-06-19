
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

App.WEBSITE_PEER_MODELS = [
  'Mega hubs',
  'Industry Hubs and Publications',
  'Comparison Sites',
  'Multinational Corporations',
  'Large Institutions/Organization',
  'Media Giants and Publishers',
  'Thought Leaders/Influencers',
  'Direct Competitors',
  'Academic / Research',
  'Government / Civic',
  'Communities / Forums',
  'Tools / SaaS Platforms',
  'Agencies / Consultancies',
  'Directories / Marketplaces',
  'Nonprofit / Advocacy',
  'Local / Regional Organizations',
];

// ---------------------------------------------------------------------------
// State — single source of truth for all UI data
// ---------------------------------------------------------------------------

App.state = {
  activePage: 'contactsPage',
  assets: [],
  assetCategories: [],
  contactPersonas: [],
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
  directAcquireWebsitePeers: [],
  xAcquireRuns: [],
  xAcquireCurrentRun: null,
  redditAcquireRuns: [],
  redditAcquireCurrentRun: null,
  youtubeAcquireResult: null,
  acquireYoutubeDetails: [],
  acquireYoutubeTopics: [],
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
  availableReferenceOptions: { statuses: [], types: [], sources: [] },
  contactsFilters: {
    first_name: '', last_name: '', company: '', email: '',
    website: '', youtube: '', instagram: ''
  },
  assetsFilters: {
    asset_name: '',
    caption: '',
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
    persona: { mode: 'contains', value: '' },
    content: { mode: 'contains', value: '' },
    engagement_website: { mode: '', value: '' },
    engagement_content: { mode: '', value: '' },
    engagement_email: { mode: '', value: '' },
    engagement_social: { mode: '', value: '' },
    engagement_mobile: { mode: '', value: '' },
    engagement_forms: { mode: '', value: '' },
    engagement_meetings: { mode: '', value: '' },
    website: { mode: 'contains', value: '' },
    youtube: { mode: 'contains', value: '' },
    instagram: { mode: 'contains', value: '' },
    social: { mode: 'contains', value: '' },
    forms: { mode: 'contains', value: '' },
    meetings: { mode: 'contains', value: '' }
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
  viewContactPage: document.getElementById('viewContactPage'),
  editContactPage: document.getElementById('editContactPage'),
  cloneContactPage: document.getElementById('cloneContactPage'),
  segmentsPage: document.getElementById('segmentsPage'),
  campaignsPage: document.getElementById('campaignsPage'),
  assetsPage: document.getElementById('assetsPage'),
  channelsPage: document.getElementById('channelsPage'),
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
  assetMultiUploadAspect: document.getElementById('assetMultiUploadAspect'),
  assetDriveFolderImportForm: document.getElementById('assetDriveFolderImportForm'),
  assetDriveFolderUrl: document.getElementById('assetDriveFolderUrl'),
  assetDriveFolderCategory: document.getElementById('assetDriveFolderCategory'),
  assetFormTitle: document.getElementById('assetFormTitle'),
  assetTypeInput: document.getElementById('assetTypeInput'),
  assetCategoryInput: document.getElementById('assetCategoryInput'),
  assetAspectInput: document.getElementById('assetAspectInput'),
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
  assetsFilterCaption: document.getElementById('assetsFilterCaption'),
  assetsSortCaptionBtn: document.getElementById('assetsSortCaptionBtn'),
  assetCaptionInput: document.getElementById('assetCaptionInput'),
  assetsFilterType: document.getElementById('assetsFilterType'),
  assetsFilterCategory: document.getElementById('assetsFilterCategory'),
  assetsFilterAspect: document.getElementById('assetsFilterAspect'),
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
  viewContactDetails: document.getElementById('viewContactDetails'),
  editViewedContactBtn: document.getElementById('editViewedContactBtn'),
  cloneViewedContactBtn: document.getElementById('cloneViewedContactBtn'),
  backFromViewContactBtn: document.getElementById('backFromViewContactBtn'),
  contactEditForm: document.getElementById('contactEditForm'),
  contactEditId: document.getElementById('contactEditId'),
  cloneEditedContactBtn: document.getElementById('cloneEditedContactBtn'),
  backFromEditContactBtn: document.getElementById('backFromEditContactBtn'),
  contactCloneForm: document.getElementById('contactCloneForm'),
  backFromCloneContactBtn: document.getElementById('backFromCloneContactBtn'),
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
  settingsNewProjectDefaultUrl: document.getElementById('settingsNewProjectDefaultUrl'),
  settingsCreateProjectBtn: document.getElementById('settingsCreateProjectBtn'),
  settingsProjectDetailsEmpty: document.getElementById('settingsProjectDetailsEmpty'),
  settingsProjectDetailsPanel: document.getElementById('settingsProjectDetailsPanel'),
  settingsProjectDetailsName: document.getElementById('settingsProjectDetailsName'),
  settingsProjectDetailsSlug: document.getElementById('settingsProjectDetailsSlug'),
  settingsProjectDetailsDescription: document.getElementById('settingsProjectDetailsDescription'),
  settingsProjectDefaultUrlInput: document.getElementById('settingsProjectDefaultUrlInput'),
  settingsProjectTimezoneSelect: document.getElementById('settingsProjectTimezoneSelect'),
  settingsProjectLogoChooseBtn: document.getElementById('settingsProjectLogoChooseBtn'),
  settingsProjectLogoUploadFile: document.getElementById('settingsProjectLogoUploadFile'),
  settingsProjectLogoClearBtn: document.getElementById('settingsProjectLogoClearBtn'),
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
  xAcquireForm: document.getElementById('xAcquireForm'),
  xAcquireRefreshBtn: document.getElementById('xAcquireRefreshBtn'),
  xAcquireRunsTable: document.getElementById('xAcquireRunsTable'),
  xAcquireItemsTable: document.getElementById('xAcquireItemsTable'),
  xAcquireRawPreview: document.getElementById('xAcquireRawPreview'),
  redditAcquireForm: document.getElementById('redditAcquireForm'),
  redditAcquireRefreshBtn: document.getElementById('redditAcquireRefreshBtn'),
  redditAcquireRunsTable: document.getElementById('redditAcquireRunsTable'),
  redditAcquirePostDetailsBody: document.getElementById('redditAcquirePostDetailsBody'),
  redditAcquireItemsTable: document.getElementById('redditAcquireItemsTable'),
  redditAcquireRawPreview: document.getElementById('redditAcquireRawPreview'),
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

App.PUBLIC_LEGAL_PAGE_IDS = ['privacyPolicyPage', 'termsOfServicePage'];

function isPublicLegalPageId(pageId) {
  const id = String(pageId || '').trim();
  return App.PUBLIC_LEGAL_PAGE_IDS.includes(id);
}

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
  if (bare && !bare.includes('=')) {
    const normalizedBare = normalizeInitialPageId(bare);
    return isValidPageId(normalizedBare) ? normalizedBare : '';
  }

  const match = bare.match(/(?:^|&)page=([^&]+)/);
  if (!match || !match[1]) return '';
  const decoded = normalizeInitialPageId(decodeURIComponent(match[1]));
  return isValidPageId(decoded) ? decoded : '';
}

function normalizeInitialPageId(pageId) {
  const id = String(pageId || '').trim();
  if (!id) return '';
  if (id === 'developLandingPagesPage') return 'developManageLandingPagesPage';
  if (id === 'engageSocialPage') return 'promoteSocialPage';
  if (id === 'engageSocialResponsesPage') return 'promoteSocialResponsesPage';
  return id;
}

function persistActivePage(pageId, skipPushState = false) {
  const id = String(pageId || '').trim();
  if (!isValidPageId(id)) return;
  try { window.localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, id); } catch (_) {}
  try {
    const nextHash = `#page=${encodeURIComponent(id)}`;
    if (window.location.hash !== nextHash) {
      if (!skipPushState) {
         window.history.pushState({ pageId: id }, '', nextHash);
      } else {
         window.history.replaceState({ pageId: id }, '', nextHash);
      }
    }
  } catch (_) {}
}

App.getInitialPage = function getInitialPage() {
  const fromHash = normalizeInitialPageId(readPageFromHash());
  if (fromHash && isValidPageId(fromHash)) return fromHash;

  let fromStorage = '';
  try { fromStorage = String(window.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY) || ''); } catch (_) {}
  fromStorage = normalizeInitialPageId(fromStorage);
  if (isValidPageId(fromStorage)) return fromStorage;
  return 'contactsPage';
};

App.setActivePage = function setActivePage(pageId, options = {}) {
  const rawPageId = String(pageId || '').trim();
  const normalizedPageId = options.skipNormalize === true ? rawPageId : normalizeInitialPageId(pageId);
  const target = isValidPageId(normalizedPageId) ? String(normalizedPageId) : 'contactsPage';
  const shouldPersist = options.persist !== false;

  state.activePage = target;
  const activePageEl = document.getElementById(target);
  document.querySelectorAll('.app-page').forEach((page) => {
    page.classList.toggle('hidden', page !== activePageEl);
  });
  
  // Inject history controls into the active page's header row
  const historyControls = document.getElementById('globalHistoryControls');
  if (activePageEl && historyControls) {
      const headingRow = activePageEl.querySelector('.page-heading-row');
      if (headingRow) {
         headingRow.style.position = 'relative';
         headingRow.appendChild(historyControls);
         historyControls.style.display = 'flex';
      } else {
         historyControls.style.display = 'none';
      }
  }
  
  // Clean up any YouTube iframes that are now hidden to stop background audio bleed
  document.querySelectorAll('.app-page.hidden iframe[src*="youtube"]').forEach((iframe) => {
    iframe.src = '';
  });

  document.querySelectorAll('.menu-link[data-page]').forEach((link) => {
    link.classList.toggle('active', link.dataset.page === target);
  });

  const manifests = Array.isArray(App.manifests) ? App.manifests : [];
  manifests.forEach((mod) => {
    if (!mod || typeof mod.onPageActivated !== 'function') return;
    const manifest = mod.manifest || {};
    const pageIdMatch = manifest.pageId === target;
    const secondaryMatch = Array.isArray(manifest.secondaryPages) && manifest.secondaryPages.includes(target);
    const pagePrefixes = Array.isArray(manifest.pagePrefixes) ? manifest.pagePrefixes : [];
    const prefixMatch = pagePrefixes.some((prefix) => String(target || '').startsWith(String(prefix || '')));
    if (!pageIdMatch && !secondaryMatch && !prefixMatch) return;
    Promise.resolve()
      .then(() => mod.onPageActivated(target))
      .catch((err) => {
        if (typeof App.notify === 'function') {
          const label = manifest.label || manifest.id || 'Page';
          App.notify(`${label} load failed: ${err.message}`, true);
        }
      });
  });

  if (shouldPersist) persistActivePage(target, options.skipPushState === true);

  const isPublicLegalGuest = (
    Array.isArray(App.PUBLIC_LEGAL_PAGE_IDS)
    && App.PUBLIC_LEGAL_PAGE_IDS.includes(target)
    && !(App.auth && App.auth.user)
  );
  if (!options.skipTracking && !isPublicLegalGuest) {
    App.api('/api/observe/page-views', {
      method: 'POST',
      body: JSON.stringify({ pageId: target }),
    }).catch((err) => console.debug('[Observe] page-view log failed:', err));
  }
};

window.addEventListener('popstate', (e) => {
    let target = null;
    if (e.state && e.state.pageId) {
        target = e.state.pageId;
    } else {
        target = readPageFromHash() || 'contactsPage';
    }
    // Set the explicitly captured page view via the DOM back button skipping pushState cyclic behavior.
    if (window.App && typeof App.setActivePage === 'function') {
        App.setActivePage(target, { skipPushState: true });
    }
});

App.openTrainingSection = function openTrainingSection(sectionId) {
  const targetId = String(sectionId || '').trim();
  const pageBySection = {
    youtubeMinerResponseContextBody: 'trainingContextPage',
    youtubeMinerCategoriesBody: 'trainingCategoriesPage',
    youtubeMinerAttributeConfigTable: 'trainingAttributesPage',
    youtubeMinerApproachConfigTable: 'trainingApproachesPage',
    youtubeMinerGuidelinesBody: 'trainingRulesGuidesPage'
  };
  App.setActivePage(pageBySection[targetId] || 'trainingContextPage');
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
const SESSION_TOKEN_STORAGE_KEY = 'app_session';

App.getSessionToken = function getSessionToken() {
  try {
    return String(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
};

App.setSessionToken = function setSessionToken(token) {
  const value = String(token || '').trim();
  try {
    if (value) window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, value);
    else window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  } catch (_) {}
};

App.api = async function api(path, options = {}) {
  const projectId = (
    typeof App.projectContext?.getSessionProjectId === 'function'
      ? App.projectContext.getSessionProjectId()
      : String(state.currentProjectId || '').trim()
  );
  const baseHeaders = { 'Content-Type': 'application/json' };
  if (projectId) baseHeaders['X-Project-ID'] = projectId;

  const sessionToken = App.getSessionToken();
  if (sessionToken && !baseHeaders.Authorization && !(options.headers || {}).Authorization) {
    baseHeaders.Authorization = `Bearer ${sessionToken}`;
  }

  const res = await fetch(path, {
    ...options,
    headers: { ...baseHeaders, ...(options.headers || {}) },
    credentials: 'include',
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
    if (res.status === 401 && App.auth) {
      const errCode = typeof err === 'object' && err !== null ? err.code : '';
      const isAuthRequired = errCode === 'AUTH_REQUIRED' || text === 'Not authenticated';
      const hasSession = Boolean(App.auth.user);
      const bootPending = Boolean(App.auth._sessionCheckPending);

      if (isAuthRequired) {
        if (hasSession && !bootPending && typeof App.auth.handleUnauthorized === 'function') {
          App.notify('Your session has expired. Please sign in again.', true);
          App.auth.handleUnauthorized();
        }
      }
      // Upstream 401s (e.g. X API Unauthorized on publish) must not clear the app session.
    }
    const jsErr = new Error(String(text).trim());
    if (typeof err === 'object' && err !== null && err.details) {
      jsErr.details = err.details;
    }
    throw jsErr;
  }

  return body;
};

/**
 * Read a list from a standard API envelope ({ contacts }, { data }, or nested data).
 */
App.normalizeApiArray = function normalizeApiArray(res, key) {
  if (!res || typeof res !== 'object') return [];
  const listKey = String(key || '').trim();
  if (listKey && Array.isArray(res[listKey])) return res[listKey];
  if (Array.isArray(res.data)) return res.data;
  if (listKey && res.data && typeof res.data === 'object' && Array.isArray(res.data[listKey])) {
    return res.data[listKey];
  }
  return [];
};

// ---------------------------------------------------------------------------
// Shared utility functions
// ---------------------------------------------------------------------------

App.byId = function byId(id) {
  return document.getElementById(String(id || '').trim());
};

App.on = function on(id, eventName, handler) {
  const el = App.byId(id);
  if (el && typeof handler === 'function') {
    el.addEventListener(eventName, handler);
  }
};

App.safeText = function safeText(value) {
  return String(value == null ? '' : value).trim();
};

App.empty = function empty(el) {
  if (el) el.innerHTML = '';
};

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
  view: '<path d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  edit: '<path d="M12 20h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  delete: '<path d="M4 7h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  trash: '<path d="M4 7h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  load: '<path d="M12 3v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 21h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  run: '<path d="M8 5v14l11-7-11-7Z" fill="currentColor"/>',
  status: '<path d="M12 7v5l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  preview: '<path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 9h10M7 13h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  approve: '<path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  publish: '<path d="M5 12h13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m13 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  contact: '<path d="M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  comments: '<path d="M8 10h8M8 14h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 19l-2 2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  clone: '<path d="M9 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5 0l2-2a5 5 0 0 0-7.1-7.1l-1.3 1.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11a5 5 0 0 0-7.5 0l-2 2a5 5 0 0 0 7.1 7.1l1.3-1.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  copy: '<path d="M8 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 6V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  settings: '<path d="M10.3 4.3a2 2 0 0 1 3.4 0l.2.3a2 2 0 0 0 2.1.8l.4-.1a2 2 0 0 1 2.4 2.4l-.1.4a2 2 0 0 0 .8 2.1l.3.2a2 2 0 0 1 0 3.4l-.3.2a2 2 0 0 0-.8 2.1l.1.4a2 2 0 0 1-2.4 2.4l-.4-.1a2 2 0 0 0-2.1.8l-.2.3a2 2 0 0 1-3.4 0l-.2-.3a2 2 0 0 0-2.1-.8l-.4.1a2 2 0 0 1-2.4-2.4l.1-.4a2 2 0 0 0-.8-2.1l-.3-.2a2 2 0 0 1 0-3.4l.3-.2a2 2 0 0 0 .8-2.1l-.1-.4a2 2 0 0 1 2.4-2.4l.4.1a2 2 0 0 0 2.1-.8l.2-.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  archive: '<path d="M4 7h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 7V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  ban: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 16.5 16.5 7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  close: '<path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
};

App.makeInlineIcon = function makeInlineIcon(iconKey, extraClass = '') {
  const wrap = document.createElement('span');
  wrap.className = `icon-btn-glyph${extraClass ? ` ${extraClass}` : ''}`.trim();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = App.ACTION_ICONS[iconKey] || App.ACTION_ICONS.view;
  wrap.appendChild(svg);
  return wrap;
};

App.makeIconButton = function makeIconButton(iconKey, label, onClick, options = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn tiny-btn icon-btn${options.primary ? ' icon-btn-primary' : ''}${options.danger ? ' icon-btn-danger' : ''}`;
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
  iconWrap.appendChild(App.makeInlineIcon(iconKey).querySelector('svg'));
  btn.appendChild(iconWrap);

  if (typeof onClick === 'function') btn.addEventListener('click', onClick);
  return btn;
};

/** Wrap table action icon buttons in a single non-wrapping row inside an actions cell. */
App.appendTableActions = function appendTableActions(cell, buttons) {
  const host = cell && typeof cell.appendChild === 'function' ? cell : null;
  if (!host) return null;
  const list = (Array.isArray(buttons) ? buttons : []).filter(Boolean);
  let row = host.querySelector(':scope > .table-actions-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'table-actions-row';
    row.setAttribute('role', 'group');
    host.appendChild(row);
  }
  list.forEach((btn) => row.appendChild(btn));
  return row;
};

/** Standard actions <td>: adds .actions-col and a monolithic .table-actions-row. */
App.finishTableActionsCell = function finishTableActionsCell(cell, ...buttons) {
  const td = cell && typeof cell.appendChild === 'function' ? cell : null;
  if (!td) return null;
  td.classList.add('actions-col');
  App.appendTableActions(td, buttons.filter(Boolean));
  return td;
};

App.iconButtonMarkup = function iconButtonMarkup(iconKey, label, className = '') {
  const classes = `btn tiny-btn icon-btn ${className}`.trim();
  const svg = App.ACTION_ICONS[iconKey] || App.ACTION_ICONS.view;
  return `<button type="button" class="${classes}" title="${label}" aria-label="${label}"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg></span></button>`;
};

App.ui = App.ui || {};

App.ui.ensureMessagingTopicsLoaded = async function() {
  if (Array.isArray(App.state.cachedTopics) && App.state.cachedTopics.length) {
    return App.state.cachedTopics;
  }
  try {
    const res = await App.api('/api/messaging/topics?limit=5000');
    if (res && res.error) throw new Error(typeof res.error === 'string' ? res.error : res.error.message);
    const topics = Array.isArray(res?.topics) ? res.topics : Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
    const flatTopics = topics
      .map(item => String(item?.topic || item?.category || '').trim())
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b));
    if (flatTopics.length > 0) {
      App.state.cachedTopics = flatTopics;
    }
    return flatTopics;
  } catch (err) {
    console.error('Failed to pre-fetch cached topics:', err);
    return Array.isArray(App.state.cachedTopics) ? App.state.cachedTopics : [];
  }
};

App.ui.populateTopicsDropdown = async function(selectId, defaultLabel = 'Select Topic', defaultOptionValue = '', forceSelectedValue = null) {
  const select = typeof selectId === 'string' ? document.getElementById(selectId) : selectId;
  if (!select) return;
  const currentValue = forceSelectedValue !== null ? forceSelectedValue : String(select.value || '').trim();
  const topics = await App.ui.ensureMessagingTopicsLoaded();
  
  select.options.length = 0;
  if (defaultLabel !== null && defaultLabel !== false) {
    select.add(new Option(defaultLabel, defaultOptionValue));
  }
  
  const displayTopics = Array.isArray(topics) ? topics.slice() : [];
  if (currentValue && currentValue !== defaultOptionValue && !displayTopics.includes(currentValue)) {
     displayTopics.push(currentValue);
     displayTopics.sort((a, b) => a.localeCompare(b));
  }
  
  displayTopics.forEach(topic => {
    select.add(new Option(topic, topic));
  });
  
  if (currentValue && (currentValue === defaultOptionValue || displayTopics.includes(currentValue))) {
    select.value = currentValue;
  } else if (!currentValue && defaultLabel !== null && defaultLabel !== false) {
    select.value = defaultOptionValue;
  }
};
