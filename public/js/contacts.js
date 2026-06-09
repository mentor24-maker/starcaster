/**
 * public/js/contacts.js
 * Contact list display, search filters, contact form, and CSV import.
 */

window.App = window.App || {};
App.contacts = (function () {
  const { state, els, api, notify, normalizeKey, isStandardLeadColumn,
          defaultTargetKey, parseTypedValue, parseCsvFile, parseCsv } = App;
  let exploreContactsApplied = false;
  let lastSuggestedSegmentName = '';
  let lastSuggestedLogicExpression = '';
  let activeFilteredContactClass = null;
  let returnPageOnSave = null;
  let pendingAddContactMeta = null;

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function safeText(str, max) {
    if (str == null) return '';
    const s = String(str);
    return max ? s.substring(0, max) : s;
  }

  const CONTACT_DETAIL_FILTER_FIELDS = [
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'company', label: 'Company' },
    { key: 'email', label: 'Email' },
    { key: 'website', label: 'Website' },
    { key: 'phone', label: 'Phone' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'country', label: 'Country' },
    { key: 'tags', label: 'Tags' },
    { key: 'persona', label: 'Persona' },
  ];

  const SOCIAL_FILTER_FIELDS = [
    { key: 'youtube', label: 'Youtube' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'tiktok', label: 'TikTok' },
    { key: 'facebook', label: 'Facebook' },
    { key: 'x', label: 'X' },
    { key: 'bluesky', label: 'BlueSky' },
    { key: 'patreon', label: 'Patreon' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'substack', label: 'Substack' },
    { key: 'medium', label: 'Medium' },
  ];

  const ENGAGEMENT_FILTER_FIELDS = [
    { key: 'engagement_website', label: 'Website', options: ['Visits', 'Conversions'] },
    { key: 'engagement_content', label: 'Content', options: ['Views', 'Conversions'] },
    { key: 'engagement_email', label: 'Email', options: ['Receipts', 'Opens', 'Clicks', 'Conversions', 'Unsubscribes'] },
    { key: 'engagement_social', label: 'Social', options: ['Likes', 'Follows', 'Subscribes', 'Comments', 'Opt-outs'] },
    { key: 'engagement_mobile', label: 'Mobile', options: ['Opens', 'Clicks', 'Replies', 'Opt-outs'] },
    { key: 'engagement_forms', label: 'Forms', options: [] },
    { key: 'engagement_meetings', label: 'Meetings', options: ['Placeholder Meeting'] },
  ];

  const COMMENTS_FILTER_FIELDS = [
    { key: 'comments_campaign', label: 'Campaign' },
    { key: 'comments_topic', label: 'Topic' },
    { key: 'comments_score', label: 'Score' },
  ];

  const EXPLORE_CONTACT_FIELDS = [
    ...CONTACT_DETAIL_FILTER_FIELDS,
    ...SOCIAL_FILTER_FIELDS,
    ...ENGAGEMENT_FILTER_FIELDS,
    ...COMMENTS_FILTER_FIELDS,
  ];

  const SOCIAL_FIELD_KEYS = new Set(SOCIAL_FILTER_FIELDS.map((field) => field.key));
  const CONTACT_SETTINGS_KEY = 'alphire:contacts:settings:v3';
  const CONTACTS_DEFAULT_VISIBLE_COLUMNS = ['first_name', 'last_name', 'company', 'email', 'website', 'youtube', 'instagram'];
  const CONTACTS_TABLE_COLUMNS = [
    { key: 'created_at', label: 'Create Date', filterPlaceholder: 'Create Date' },
    { key: 'updated_at', label: 'Modified Date', filterPlaceholder: 'Modified Date' },
    { key: 'first_name', label: 'First Name', filterPlaceholder: 'First' },
    { key: 'last_name', label: 'Last Name', filterPlaceholder: 'Last' },
    { key: 'company', label: 'Company', filterPlaceholder: 'Company' },
    { key: 'entity_type', label: 'Entity Type', filterPlaceholder: 'Entity Type' },
    { key: 'email', label: 'Email', filterPlaceholder: 'Email' },
    { key: 'website', label: 'Website', filterPlaceholder: 'Website' },
    { key: 'youtube', label: 'Youtube', filterPlaceholder: 'Youtube' },
    { key: 'instagram', label: 'Instagram', filterPlaceholder: 'Instagram' },
    { key: 'phone', label: 'Phone', filterPlaceholder: 'Phone' },
    { key: 'city', label: 'City', filterPlaceholder: 'City' },
    { key: 'country', label: 'Country', filterPlaceholder: 'Country' },
    { key: 'tags', label: 'Tags', filterPlaceholder: 'Tags' },
    { key: 'contact_type', label: 'Contact Type', filterPlaceholder: 'Type' },
    { key: 'source', label: 'Source', filterPlaceholder: 'Source' },
    { key: 'status', label: 'Status', filterPlaceholder: 'Status' },
    { key: 'owner', label: 'Owner', filterPlaceholder: 'Owner' },
    { key: 'comments_campaign', label: 'Campaign', filterPlaceholder: 'Campaign' },
    { key: 'comments_topic', label: 'Topic', filterPlaceholder: 'Topic' },
    { key: 'comments_score', label: 'Score', filterPlaceholder: 'Score' },
    { key: 'comments_text', label: 'Comment', filterPlaceholder: 'Comment excerpt' },
  ];
  const SECTION_SETTINGS_LINKS = [
    { label: 'Acquire Settings', pageId: 'acquireSettingsPage' },
    { label: 'Contacts Settings', pageId: 'contactsSettingsPage' },
    { label: 'Channels Settings', pageId: 'channelsSettingsPage' },
    { label: 'Messaging Settings', pageId: 'messagingSettingsPage' },
    { label: 'Assets Settings', pageId: 'assetsSettingsPage' },
    { label: 'Builder Settings', pageId: 'builderSettingsPage' },
    { label: 'Campaigns Settings', pageId: 'campaignSettingsPage' },
    { label: 'Promote Settings', pageId: 'promoteSettingsPage' },
    { label: 'Engage Settings', pageId: 'engageSettingsPage' },
    { label: 'Observe Settings', pageId: 'observeSettingsPage' },
    { label: 'Training Settings', pageId: 'trainingSettingsPage' },
  ];
  const CONTACT_EDITABLE_FIELDS = [
    'first_name', 'middle_name', 'last_name', 'company', 'entity_type', 'email', 'phone', 'city', 'country',
    'website', 'youtube', 'instagram', 'tiktok', 'facebook', 'x', 'bluesky',
    'patreon', 'linkedin', 'tags', 'notes',
  ];
  const CONTACT_PAYLOAD_FIELDS = new Set(CONTACT_EDITABLE_FIELDS);
  let activeContactId = '';
  let websitePeers = [];
  let activeWebsitePeerId = '';
  let activeWebsitePeerDetail = null;
  let activeWebsitePeerRun = null;
  let websitePeerDiscoveryResults = [];
  let contactsPeerSitesProgressController = null;
  const WEBSITE_PEER_MODELS = Array.isArray(App.WEBSITE_PEER_MODELS) ? App.WEBSITE_PEER_MODELS.slice() : [];

  const EXPLORE_FILTER_MODES = [
    { value: 'contains', label: 'Contains' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'ends_with', label: 'Ends with' },
    { value: 'is_empty', label: 'Is Empty' },
    { value: 'is_known', label: 'Is Known' },
  ];
  const ENGAGEMENT_BUCKET_OPTIONS = ['0', '1', '2-5', '6-10', '10+'];
  let exploreFormTemplateOptions = [];

  function readContactsSettings() {
    try {
      const raw = window.localStorage.getItem(CONTACT_SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const visibleColumns = Array.isArray(parsed?.defaultVisibleColumns) ? parsed.defaultVisibleColumns : CONTACTS_DEFAULT_VISIBLE_COLUMNS;
      return {
        defaultVisibleColumns: visibleColumns.filter((key) => CONTACTS_TABLE_COLUMNS.some((col) => col.key === key)),
      };
    } catch (_) {
      return { defaultVisibleColumns: CONTACTS_DEFAULT_VISIBLE_COLUMNS.slice() };
    }
  }

  function writeContactsSettings(nextSettings) {
    const current = readContactsSettings();
    const settings = Object.assign({}, current, nextSettings || {});
    const validKeys = new Set(CONTACTS_TABLE_COLUMNS.map((col) => col.key));
    settings.defaultVisibleColumns = Array.from(new Set((Array.isArray(settings.defaultVisibleColumns) ? settings.defaultVisibleColumns : [])
      .map((key) => String(key || '').trim())
      .filter((key) => validKeys.has(key))));
    if (!settings.defaultVisibleColumns.length) settings.defaultVisibleColumns = CONTACTS_DEFAULT_VISIBLE_COLUMNS.slice();
    try {
      window.localStorage.setItem(CONTACT_SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) {
    }
    return settings;
  }

  function getVisibleContactsColumns() {
    return CONTACTS_TABLE_COLUMNS.filter((column) => {
      return readContactsSettings().defaultVisibleColumns.includes(column.key);
    });
  }

  function isEngagementField(key) {
    return String(key || '').startsWith('engagement_');
  }

  function isCommentField(key) {
    return String(key || '').startsWith('comments_');
  }

  function slugifyEngagementToken(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  // ---------------------------------------------------------------------------
  // Filter helpers
  // ---------------------------------------------------------------------------

  function ensureExploreFilterState() {
    if (!state.segmentContactsFilters || typeof state.segmentContactsFilters !== 'object') {
      state.segmentContactsFilters = {};
    }
    EXPLORE_CONTACT_FIELDS.forEach(({ key }) => {
      const current = state.segmentContactsFilters[key];
      if (!current || typeof current !== 'object') {
        state.segmentContactsFilters[key] = { mode: isEngagementField(key) ? '' : 'contains', value: '' };
        return;
      }
      state.segmentContactsFilters[key] = {
        mode: String(current.mode || (isEngagementField(key) ? '' : 'contains')),
        value: String(current.value || ''),
      };
    });
    state.segmentContactsLogicMode = state.segmentContactsLogicMode === 'any' ? 'any' : 'all';
    state.segmentContactsLogicTokens = Array.isArray(state.segmentContactsLogicTokens) ? state.segmentContactsLogicTokens.map((token) => String(token || '').toUpperCase()) : [];
    state.segmentContactsLogicExpression = String(state.segmentContactsLogicExpression || '').trim();
  }

  function activeExploreClauses(filters) {
    return EXPLORE_CONTACT_FIELDS
      .map(({ key }) => {
        const config = filters && typeof filters[key] === 'object'
          ? filters[key]
          : { mode: isEngagementField(key) ? '' : 'contains', value: String(filters?.[key] || '') };
        const mode = String(config.mode || (isEngagementField(key) ? '' : 'contains')).toLowerCase();
        const value = String(config.value || '').trim();
        if (isEngagementField(key)) {
          if (!mode || !value) return null;
          return { key, mode, value };
        }
        if (mode === 'is_empty' || mode === 'is_known') return { key, mode, value: '' };
        if (!value) return null;
        return { key, mode, value };
      })
      .filter(Boolean);
  }

  function clauseIdFromIndex(index) {
    let n = Number(index) + 1;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out || 'A';
  }

  function activeExploreClauseDefs(filters = state.segmentContactsFilters) {
    return activeExploreClauses(filters).map((clause, index) => ({
      ...clause,
      id: clauseIdFromIndex(index),
    }));
  }

  function tokenizeLogicExpression(expression) {
    const raw = String(expression || '').toUpperCase().replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim();
    return raw ? raw.split(/\s+/).filter(Boolean) : [];
  }

  function defaultLogicExpression(clauses, logicMode = state.segmentContactsLogicMode) {
    if (!Array.isArray(clauses) || !clauses.length) return '';
    const joiner = String(logicMode || '').toLowerCase() === 'any' ? ' OR ' : ' AND ';
    return clauses.map((clause) => clause.id).join(joiner);
  }

  function defaultLogicTokens(clauses, logicMode = state.segmentContactsLogicMode) {
    if (!Array.isArray(clauses) || !clauses.length) return [];
    const joiner = String(logicMode || '').toLowerCase() === 'any' ? 'OR' : 'AND';
    const tokens = [];
    clauses.forEach((clause, index) => {
      if (index > 0) tokens.push(joiner);
      tokens.push(clause.id);
    });
    return tokens;
  }

  function tokensToExpression(tokens) {
    return (Array.isArray(tokens) ? tokens : [])
      .map((token) => String(token || '').toUpperCase().trim())
      .filter(Boolean)
      .join(' ');
  }

  function normalizeExploreLogicTokens(clauses) {
    const validIds = new Set((Array.isArray(clauses) ? clauses : []).map((clause) => clause.id));
    if (!validIds.size) {
      state.segmentContactsLogicTokens = [];
      state.segmentContactsLogicExpression = '';
      return;
    }
    const current = Array.isArray(state.segmentContactsLogicTokens) ? state.segmentContactsLogicTokens : [];
    const valid = current.length > 0 && current.every((token) => {
      const upper = String(token || '').toUpperCase();
      return validIds.has(upper) || ['AND', 'OR', '(', ')'].includes(upper);
    });
    if (!valid) {
      state.segmentContactsLogicTokens = defaultLogicTokens(clauses, state.segmentContactsLogicMode);
    }
    state.segmentContactsLogicExpression = tokensToExpression(state.segmentContactsLogicTokens);
  }

  function evaluateLogicExpression(expression, clauses, clauseResultMap, logicMode = state.segmentContactsLogicMode) {
    if (!Array.isArray(clauses) || !clauses.length) {
      return { ok: true, result: true, normalizedExpression: '' };
    }

    const validIds = new Set(clauses.map((clause) => clause.id));
    const normalizedExpression = String(expression || '').trim() || defaultLogicExpression(clauses, logicMode);
    const tokens = tokenizeLogicExpression(normalizedExpression);
    if (!tokens.length) {
      return { ok: true, result: true, normalizedExpression };
    }

    const precedence = { OR: 1, AND: 2 };
    const output = [];
    const ops = [];
    let expectOperand = true;

    for (const token of tokens) {
      if (validIds.has(token)) {
        if (!expectOperand) {
          return { ok: false, result: false, normalizedExpression, error: 'Unexpected clause token.' };
        }
        output.push(token);
        expectOperand = false;
        continue;
      }
      if (token === '(') {
        if (!expectOperand) {
          return { ok: false, result: false, normalizedExpression, error: 'Unexpected opening parenthesis.' };
        }
        ops.push(token);
        continue;
      }
      if (token === ')') {
        if (expectOperand) {
          return { ok: false, result: false, normalizedExpression, error: 'Unexpected closing parenthesis.' };
        }
        while (ops.length && ops[ops.length - 1] !== '(') {
          output.push(ops.pop());
        }
        if (!ops.length) {
          return { ok: false, result: false, normalizedExpression, error: 'Unbalanced parentheses.' };
        }
        ops.pop();
        continue;
      }
      if (token === 'AND' || token === 'OR') {
        if (expectOperand) {
          return { ok: false, result: false, normalizedExpression, error: 'Operator cannot appear here.' };
        }
        while (ops.length && precedence[ops[ops.length - 1]] >= precedence[token]) {
          output.push(ops.pop());
        }
        ops.push(token);
        expectOperand = true;
        continue;
      }
      return { ok: false, result: false, normalizedExpression, error: `Invalid token "${token}".` };
    }

    if (expectOperand) {
      return { ok: false, result: false, normalizedExpression, error: 'Expression ends with an operator.' };
    }

    while (ops.length) {
      const op = ops.pop();
      if (op === '(') {
        return { ok: false, result: false, normalizedExpression, error: 'Unbalanced parentheses.' };
      }
      output.push(op);
    }

    const stack = [];
    for (const token of output) {
      if (validIds.has(token)) {
        stack.push(Boolean(clauseResultMap[token]));
        continue;
      }
      const right = stack.pop();
      const left = stack.pop();
      if (left === undefined || right === undefined) {
        return { ok: false, result: false, normalizedExpression, error: 'Invalid expression structure.' };
      }
      stack.push(token === 'AND' ? (left && right) : (left || right));
    }

    if (stack.length !== 1) {
      return { ok: false, result: false, normalizedExpression, error: 'Invalid expression structure.' };
    }

    return { ok: true, result: Boolean(stack[0]), normalizedExpression };
  }

  function clauseMatchesContact(contact, clause) {
    if (isEngagementField(clause.key)) {
      const count = engagementMetricCount(contact, clause.key, clause.mode);
      return countMatchesBucket(count, clause.value);
    }
    const rawValue = String(contactValue(contact, clause.key) || '').trim();
    const haystack = SOCIAL_FIELD_KEYS.has(clause.key)
      ? socialUsername(rawValue)
      : rawValue.toLowerCase();
    const needle = String(clause.value || '').trim().toLowerCase();

    if (clause.mode === 'is_empty') return !rawValue;
    if (clause.mode === 'is_known') return Boolean(rawValue);
    if (clause.mode === 'starts_with') return haystack.startsWith(needle);
    if (clause.mode === 'ends_with') return haystack.endsWith(needle);
    if (clause.mode === 'equals') return haystack === needle;
    return haystack.includes(needle);
  }

  function contactPassesFilter(contact, filters, logicMode = 'all', logicExpression = '') {
    const clauses = activeExploreClauseDefs(filters);
    if (!clauses.length) return true;
    const clauseResultMap = {};
    clauses.forEach((clause) => {
      clauseResultMap[clause.id] = clauseMatchesContact(contact, clause);
    });
    const evaluated = evaluateLogicExpression(logicExpression, clauses, clauseResultMap, logicMode);
    return evaluated.ok ? evaluated.result : false;
  }

  function socialUsername(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) {
      return text.replace(/^@+/, '').toLowerCase();
    }
    try {
      const parsed = new URL(text);
      const host = parsed.hostname.toLowerCase();
      if (host.endsWith('substack.com')) {
        return host.replace(/\.substack\.com$/, '').replace(/^www\./, '').toLowerCase();
      }
      const parts = parsed.pathname.split('/').map((part) => part.trim()).filter(Boolean);
      const last = parts.length ? parts[parts.length - 1] : '';
      return last.replace(/^@+/, '').toLowerCase();
    } catch {
      return text.replace(/^@+/, '').toLowerCase();
    }
  }

  function engagementMetricCount(contact, fieldKey, metricToken) {
    const custom = (
      (contact.customFields && typeof contact.customFields === 'object' && contact.customFields) ||
      (contact.custom_fields && typeof contact.custom_fields === 'object' && contact.custom_fields) ||
      {}
    );
    const base = String(fieldKey || '').replace(/^engagement_/, '');
    const metric = slugifyEngagementToken(metricToken);
    const directKeys = [
      `${base}_${metric}`,
      `engagement_${base}_${metric}`,
    ];
    for (const key of directKeys) {
      const raw = custom[key];
      if (raw != null && raw !== '') {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : 0;
      }
    }
    const nestedDirect = custom?.[base]?.[metric];
    if (nestedDirect != null && nestedDirect !== '') {
      const parsed = Number(nestedDirect);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const nestedEngagement = custom?.engagement?.[base]?.[metric];
    if (nestedEngagement != null && nestedEngagement !== '') {
      const parsed = Number(nestedEngagement);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  function countMatchesBucket(count, bucket) {
    const n = Number(count) || 0;
    switch (String(bucket || '')) {
      case '0': return n === 0;
      case '1': return n === 1;
      case '2-5': return n >= 2 && n <= 5;
      case '6-10': return n >= 6 && n <= 10;
      case '10+': return n > 10;
      default: return false;
    }
  }

  function socialDisplayText(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) {
      return text.replace(/^@+/, '');
    }
    try {
      const parsed = new URL(text);
      const host = parsed.hostname.toLowerCase();
      if (host.endsWith('substack.com')) {
        return host.replace(/^www\./, '').replace(/\.substack\.com$/, '');
      }
      const parts = parsed.pathname.split('/').map((part) => part.trim()).filter(Boolean);
      const last = parts.length ? parts[parts.length - 1] : '';
      return last.replace(/^@+/, '') || text;
    } catch {
      return text.replace(/^@+/, '');
    }
  }

  function socialLinkHref(key, value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text;
    if (/^www\./i.test(text)) return `https://${text}`;

    const handle = text.replace(/^@+/, '').trim();
    if (!handle) return '';

    switch (String(key || '')) {
      case 'youtube':
        return `https://www.youtube.com/@${handle}`;
      case 'instagram':
        return `https://www.instagram.com/${handle}/`;
      case 'tiktok':
        return `https://www.tiktok.com/@${handle}`;
      case 'facebook':
        return `https://www.facebook.com/${handle}`;
      case 'x':
        return `https://x.com/${handle}`;
      case 'bluesky':
        return `https://bsky.app/profile/${handle}`;
      case 'patreon':
        return `https://www.patreon.com/${handle}`;
      case 'linkedin':
        return `https://www.linkedin.com/in/${handle}`;
      case 'substack':
        return `https://${handle}.substack.com`;
      case 'medium':
        return `https://medium.com/@${handle}`;
      default:
        return text;
    }
  }

  function contactValue(contact, key) {
    if (key === 'social') {
      return [
        'youtube', 'instagram', 'tiktok', 'facebook', 'x',
        'bluesky', 'patreon', 'linkedin', 'substack', 'medium',
      ]
        .map((field) => {
          const raw = contactValue(contact, field);
          return raw ? `${field}:${raw}` : '';
        })
        .filter(Boolean)
        .join(' | ');
    }
    if (key === 'forms') {
      const custom = (
        (contact.customFields && typeof contact.customFields === 'object' && contact.customFields) ||
        (contact.custom_fields && typeof contact.custom_fields === 'object' && contact.custom_fields) ||
        {}
      );
      return custom.forms == null ? '' : String(custom.forms);
    }
    if (key === 'content') {
      const custom = (
        (contact.customFields && typeof contact.customFields === 'object' && contact.customFields) ||
        (contact.custom_fields && typeof contact.custom_fields === 'object' && contact.custom_fields) ||
        {}
      );
      return custom.content == null ? '' : String(custom.content);
    }
    if (key === 'meetings') {
      const custom = (
        (contact.customFields && typeof contact.customFields === 'object' && contact.customFields) ||
        (contact.custom_fields && typeof contact.custom_fields === 'object' && contact.custom_fields) ||
        {}
      );
      return custom.meetings == null ? '' : String(custom.meetings);
    }
    const custom = (
      (contact.customFields && typeof contact.customFields === 'object' && contact.customFields) ||
      (contact.custom_fields && typeof contact.custom_fields === 'object' && contact.custom_fields) ||
      {}
    );
    const camel = String(key || '').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const raw = (
      contact[key] !== undefined ? contact[key]
      : contact[camel] !== undefined ? contact[camel]
      : custom[key]
    );
    if (Array.isArray(raw)) return raw.join(', ');
    return raw == null ? '' : String(raw);
  }

  function appendContactCell(td, key, value) {
    if (key === 'created_at' || key === 'updated_at' || String(key).includes('date')) {
      const dt = new Date(value);
      td.textContent = isNaN(dt.getTime()) ? (value || '-') : dt.toLocaleDateString();
      return;
    }
    if (key === 'website') {
      const text = String(value || '').trim();
      const href = text
        ? (/^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, '')}`)
        : '';
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = text;
        td.appendChild(link);
        return;
      }
    }
    if (SOCIAL_FIELD_KEYS.has(key)) {
      const href = socialLinkHref(key, value);
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = socialDisplayText(value) || href;
        td.appendChild(link);
        return;
      }
    }
    td.textContent = value || '-';
  }

  function toContactPayload(form) {
    const keyMap = {
      first_name: 'firstName',
      middle_name: 'middleName',
      last_name: 'lastName',
      entity_type: 'entityType',
    };
    const payload = { 
      contactType: '',
      contactClass: activeFilteredContactClass || 'persona' 
    };
    for (const [key, value] of new FormData(form).entries()) {
      const trimmed = String(value || '').trim();
      if (!trimmed) continue;
      if (!CONTACT_PAYLOAD_FIELDS.has(key)) continue;
      if (key === 'tags') {
        payload.tags = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
        continue;
      }
      payload[keyMap[key] || key] = trimmed;
    }
    return payload;
  }

  function findContactById(id) {
    const wanted = String(id || '').trim();
    if (!wanted) return null;
    return state.contacts.find((contact) => String(contact.id || '').trim() === wanted) || null;
  }

  function fillContactForm(form, contact) {
    if (!form || !contact) return;
    CONTACT_EDITABLE_FIELDS.forEach((key) => {
      const input = form.elements.namedItem(key);
      if (!input) return;
      input.value = key === 'tags'
        ? (Array.isArray(contact.tags) ? contact.tags.join(', ') : contactValue(contact, key))
        : contactValue(contact, key);
    });
  }

  function contactDetailRows(contact) {
    return [
      ['First Name', contactValue(contact, 'first_name')],
      ['Middle Name', contactValue(contact, 'middle_name')],
      ['Last Name', contactValue(contact, 'last_name')],
      ['Company', contactValue(contact, 'company')],
      ['Email', contactValue(contact, 'email')],
      ['Phone', contactValue(contact, 'phone')],
      ['City', contactValue(contact, 'city')],
      ['Country', contactValue(contact, 'country')],
      ['Website', contactValue(contact, 'website')],
      ['Youtube', contactValue(contact, 'youtube')],
      ['Instagram', contactValue(contact, 'instagram')],
      ['TikTok', contactValue(contact, 'tiktok')],
      ['Facebook', contactValue(contact, 'facebook')],
      ['X', contactValue(contact, 'x')],
      ['BlueSky', contactValue(contact, 'bluesky')],
      ['Patreon', contactValue(contact, 'patreon')],
      ['LinkedIn', contactValue(contact, 'linkedin')],
      ['Tags', Array.isArray(contact.tags) ? contact.tags.join(', ') : contactValue(contact, 'tags')],
      ['Notes', contactValue(contact, 'notes')],
    ];
  }

  function renderViewContact(contact) {
    if (!els.viewContactDetails) return;
    els.viewContactDetails.innerHTML = '';
    contactDetailRows(contact).forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'contact-detail-row';
      const labelEl = document.createElement('div');
      labelEl.className = 'contact-detail-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('div');
      valueEl.className = 'contact-detail-value';
      const stringValue = String(value || '').trim();
      if (/^https?:\/\//i.test(stringValue)) {
        const link = document.createElement('a');
        link.href = stringValue;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = stringValue;
        valueEl.appendChild(link);
      } else {
        valueEl.textContent = stringValue || '-';
      }
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      els.viewContactDetails.appendChild(row);
    });
  }

  function openContactsPage() {
    activeFilteredContactClass = null;
    const heading = document.getElementById('contactsPageHeading');
    if (heading) heading.textContent = 'Contacts';
    const subtitle = document.getElementById('contactsPageSubtitle');
    if (subtitle) subtitle.textContent = 'Select a class below to manage audience records and systemic entities.';
    const mashupBtn = document.getElementById('createMashupBtn');
    if (mashupBtn) mashupBtn.classList.add('hidden');

    const overview = document.getElementById('contactsOverviewSection');
    const tableRegion = document.getElementById('contactsTableSection');
    if (overview) overview.classList.remove('hidden');
    if (tableRegion) tableRegion.classList.add('hidden');

    App.setActivePage('contactsPage');
    document.querySelectorAll('.submenu-link[data-subpage]').forEach(el => el.classList.remove('active'));
    renderContacts();
  }

  function openFilteredContactsPage(type) {
    activeFilteredContactClass = type;
    const headerDisplay = type === 'personality' ? 'Personalities' : (type.charAt(0).toUpperCase() + type.slice(1) + (type !== 'personnel' ? 's' : ''));
    
    const heading = document.getElementById('contactsPageHeading');
    if (heading) heading.textContent = `Contacts: ${headerDisplay}`;
    const subtitle = document.getElementById('contactsPageSubtitle');
    if (subtitle) {
      if (type === 'persona') subtitle.textContent = 'Create and manage the theoretical models that define your ideal targets.';
      if (type === 'personality') subtitle.textContent = 'Capture, import, and maintain physical contacts mapped from campaigns and web mining.';
      if (type === 'personnel') subtitle.textContent = 'Manage internal users and administrators of the App environment.';
    }
    
    const mashupBtn = document.getElementById('createMashupBtn');
    if (mashupBtn) mashupBtn.classList.toggle('hidden', type !== 'personality');
    
    const overview = document.getElementById('contactsOverviewSection');
    const tableRegion = document.getElementById('contactsTableSection');
    if (overview) overview.classList.add('hidden');
    if (tableRegion) tableRegion.classList.remove('hidden');

    App.setActivePage('contactsPage');
    document.querySelectorAll('.submenu-link[data-subpage]').forEach(el => el.classList.remove('active'));
    const targetLink = document.querySelector(`.submenu-link[data-subpage="${type}"]`);
    if (targetLink) targetLink.classList.add('active');
    renderContacts();
  }

  function populateWebsitePeerTypeSelect() {
    const select = document.getElementById('contactsPeerSiteType');
    if (!select) return;
    const current = String(select.value || '').trim();
    select.innerHTML = '';
    WEBSITE_PEER_MODELS.forEach((label) => {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      select.appendChild(option);
    });
    if (current && WEBSITE_PEER_MODELS.includes(current)) select.value = current;
    else if (WEBSITE_PEER_MODELS.includes('Direct Competitors')) select.value = 'Direct Competitors';
  }

  function normalizeWebsitePeerUrl(value) {
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

  function deriveWebsitePeerScope(payload, existingPeer) {
    const sourceUrl = normalizeWebsitePeerUrl(payload?.source_url || existingPeer?.source_url || '');
    const siteUrl = normalizeWebsitePeerUrl(payload?.site_url || existingPeer?.site_url || '');
    if (!sourceUrl || !siteUrl) return String(existingPeer?.site_type || 'peer').trim() || 'peer';
    try {
      const source = new URL(sourceUrl);
      const site = new URL(siteUrl);
      const sourceHost = String(source.hostname || '').toLowerCase().replace(/^www\./, '');
      const siteHost = String(site.hostname || '').toLowerCase().replace(/^www\./, '');
      return sourceHost === siteHost ? 'source' : 'peer';
    } catch (_) {
      return String(existingPeer?.site_type || 'peer').trim() || 'peer';
    }
  }

  function resetWebsitePeerForm() {
    activeWebsitePeerId = '';
    const form = document.getElementById('contactsPeerSiteForm');
    if (!form) return;
    form.reset();
    const idInput = document.getElementById('contactsPeerSiteId');
    const sourceUrlInput = document.getElementById('contactsPeerSiteSourceUrl');
    if (idInput) idInput.value = '';
    if (sourceUrlInput && state.directAcquireCurrentRun?.source_url) {
      sourceUrlInput.value = String(state.directAcquireCurrentRun.source_url || '').trim();
    }
    populateWebsitePeerTypeSelect();
  }

  function startContactsPeerSitesProgress() {
    const button = document.getElementById('contactsPeerSitesAcquireBtn');
    if (contactsPeerSitesProgressController) contactsPeerSitesProgressController.stop();
    contactsPeerSitesProgressController = App.estimatedProgress.createController({
      wrap: 'contactsPeerSitesAcquireProgressWrap',
      bar: 'contactsPeerSitesAcquireProgressBar',
      text: 'contactsPeerSitesAcquireProgressText',
      estimate: 'contactsPeerSitesAcquireProgressEstimate',
      estimatedMs: App.estimatedProgress.ESTIMATES.contactsPeerSites,
      onStart: function () { if (button) button.disabled = true; },
      onFinish: function () { if (button) button.disabled = false; },
    });
    contactsPeerSitesProgressController.start('Reviewing website content and discovering peer sites...');
  }

  function finishContactsPeerSitesProgress(success, message) {
    if (!contactsPeerSitesProgressController) return;
    contactsPeerSitesProgressController.finish(success, message);
    contactsPeerSitesProgressController = null;
  }

  function fillWebsitePeerForm(peer) {
    activeWebsitePeerId = String(peer?.id || '').trim();
    const idInput = document.getElementById('contactsPeerSiteId');
    const typeInput = document.getElementById('contactsPeerSiteType');
    const sourceUrlInput = document.getElementById('contactsPeerSiteSourceUrl');
    const siteUrlInput = document.getElementById('contactsPeerSiteUrl');
    const titleInput = document.getElementById('contactsPeerSiteTitle');
    const keywordsInput = document.getElementById('contactsPeerSiteKeywords');
    const snippetInput = document.getElementById('contactsPeerSiteSnippet');
    const notesInput = document.getElementById('contactsPeerSiteNotes');
    if (idInput) idInput.value = activeWebsitePeerId;
    if (typeInput) typeInput.value = String(peer?.website_model || '').trim() || (WEBSITE_PEER_MODELS.includes('Direct Competitors') ? 'Direct Competitors' : (WEBSITE_PEER_MODELS[0] || ''));
    if (sourceUrlInput) sourceUrlInput.value = String(peer?.source_url || '').trim();
    if (siteUrlInput) siteUrlInput.value = String(peer?.site_url || '').trim();
    if (titleInput) titleInput.value = String(peer?.title || '').trim();
    if (keywordsInput) keywordsInput.value = Array.isArray(peer?.matched_keywords) ? peer.matched_keywords.join(', ') : '';
    if (snippetInput) snippetInput.value = String(peer?.snippet || '').trim();
    if (notesInput) notesInput.value = String(peer?.notes || '').trim();
  }

  function renderWebsitePeers() {
    const tbody = document.getElementById('contactsPeerSitesTable');
    const metaEl = document.getElementById('contactsPeerSitesMeta');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!websitePeers.length) {
      if (metaEl) metaEl.textContent = 'No peer sites saved yet.';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No peer sites saved yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    if (metaEl) metaEl.textContent = `${websitePeers.length} peer site record${websitePeers.length === 1 ? '' : 's'} available for this project.`;
    websitePeers.forEach((peer) => {
      const tr = document.createElement('tr');
      const scopeTd = document.createElement('td');
      scopeTd.textContent = String(peer?.site_type || '').trim() === 'source' ? 'Source' : 'Peer';
      tr.appendChild(scopeTd);

      const typeTd = document.createElement('td');
      typeTd.textContent = String(peer?.website_model || '').trim() || '-';
      tr.appendChild(typeTd);

      const domainTd = document.createElement('td');
      domainTd.className = 'direct-acquire-contact-label';
      domainTd.textContent = String(peer?.domain || '').trim() || '-';
      tr.appendChild(domainTd);

      const siteTd = document.createElement('td');
      if (String(peer?.site_url || '').trim()) {
        const link = document.createElement('a');
        link.href = String(peer.site_url).trim();
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(peer?.title || peer?.site_url || '').trim();
        siteTd.appendChild(link);
      } else {
        siteTd.textContent = String(peer?.title || '').trim() || '-';
      }
      tr.appendChild(siteTd);

      const keywordsTd = document.createElement('td');
      keywordsTd.textContent = Array.isArray(peer?.matched_keywords) && peer.matched_keywords.length ? peer.matched_keywords.join(', ') : '-';
      tr.appendChild(keywordsTd);

      const sourceTd = document.createElement('td');
      sourceTd.textContent = String(peer?.source_domain || peer?.source_url || '').trim() || '-';
      tr.appendChild(sourceTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'contacts-actions-cell';

      const viewBtn = App.makeIconButton('view', 'View Peer Site', () => openPeerSiteDetailPage(peer, false));
      actionsTd.appendChild(viewBtn);

      const editBtn = App.makeIconButton('edit', 'Edit Peer Site', () => openPeerSiteDetailPage(peer, true));
      actionsTd.appendChild(editBtn);

      const deleteBtn = App.makeIconButton('delete', 'Delete Peer Site', async () => {
        if (!window.confirm(`Delete ${String(peer?.domain || peer?.site_url || 'this website').trim()}?`)) return;
        try {
          await api(`/api/acquire/website-peers/${encodeURIComponent(peer.id)}`, { method: 'DELETE' });
          websitePeers = websitePeers.filter((item) => String(item?.id || '') !== String(peer.id));
          renderWebsitePeers();
          if (String(activeWebsitePeerId || '') === String(peer.id)) resetWebsitePeerForm();
          notify('Peer site deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      actionsTd.appendChild(deleteBtn);

      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  async function refreshWebsitePeers() {
    const res = await api('/api/acquire/website-peers?limit=500');
    websitePeers = Array.isArray(res?.websitePeers)
      ? res.websitePeers
      : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res)
          ? res
          : [];
    renderWebsitePeers();
  }

  function createWebsitePeerTypeSelect(selectedValue) {
    const select = document.createElement('select');
    WEBSITE_PEER_MODELS.forEach((model) => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      select.appendChild(option);
    });
    const value = String(selectedValue || '').trim();
    if (value && WEBSITE_PEER_MODELS.includes(value)) select.value = value;
    else if (WEBSITE_PEER_MODELS.includes('Direct Competitors')) select.value = 'Direct Competitors';
    else if (WEBSITE_PEER_MODELS.length) select.value = WEBSITE_PEER_MODELS[0];
    return select;
  }

  function renderWebsitePeerDiscoveryResults() {
    const wrap = document.getElementById('contactsPeerSitesDiscoveryWrap');
    const tbody = document.getElementById('contactsPeerSitesDiscoveryTable');
    const metaEl = document.getElementById('contactsPeerSitesDiscoveryMeta');
    const selectAll = document.getElementById('contactsPeerSitesDiscoverySelectAll');
    const saveBtn = document.getElementById('contactsPeerSitesSaveSelectedBtn');
    if (!wrap || !tbody) return;
    tbody.innerHTML = '';
    if (!websitePeerDiscoveryResults.length) {
      wrap.classList.add('hidden');
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      if (saveBtn) saveBtn.disabled = true;
      return;
    }
    wrap.classList.remove('hidden');
    websitePeerDiscoveryResults.forEach((item, index) => {
      const tr = document.createElement('tr');

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.selected !== false;
      checkbox.addEventListener('change', function () {
        websitePeerDiscoveryResults[index].selected = checkbox.checked;
        renderWebsitePeerDiscoveryResults();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      const domainTd = document.createElement('td');
      domainTd.className = 'direct-acquire-contact-label';
      domainTd.textContent = String(item.domain || '').trim() || '-';
      tr.appendChild(domainTd);

      const siteTd = document.createElement('td');
      const url = String(item.url || '').trim();
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(item.title || '').trim() || url;
        siteTd.appendChild(link);
      } else {
        siteTd.textContent = String(item.title || '').trim() || '-';
      }
      tr.appendChild(siteTd);

      const keywordsTd = document.createElement('td');
      keywordsTd.textContent = Array.isArray(item.matched_keywords) && item.matched_keywords.length
        ? item.matched_keywords.join(', ')
        : '-';
      tr.appendChild(keywordsTd);

      const typeTd = document.createElement('td');
      const typeSelect = createWebsitePeerTypeSelect(item.website_model || item.model || '');
      typeSelect.addEventListener('change', function () {
        websitePeerDiscoveryResults[index].website_model = String(typeSelect.value || '').trim();
      });
      typeTd.appendChild(typeSelect);
      tr.appendChild(typeTd);

      const snippetTd = document.createElement('td');
      snippetTd.textContent = String(item.snippet || '').trim() || '-';
      tr.appendChild(snippetTd);

      tbody.appendChild(tr);
    });
    const selectedCount = websitePeerDiscoveryResults.filter((item) => item.selected !== false).length;
    if (metaEl) {
      metaEl.textContent = `${websitePeerDiscoveryResults.length} peer site candidate${websitePeerDiscoveryResults.length === 1 ? '' : 's'} discovered.`;
    }
    if (selectAll) {
      selectAll.checked = !!websitePeerDiscoveryResults.length && selectedCount === websitePeerDiscoveryResults.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < websitePeerDiscoveryResults.length;
    }
    if (saveBtn) saveBtn.disabled = selectedCount === 0;
  }

  async function acquirePeerSiteCandidates() {
    const sourceUrlInput = document.getElementById('contactsPeerSiteSourceUrl');
    const siteUrlInput = document.getElementById('contactsPeerSiteUrl');
    const sourceUrl = normalizeWebsitePeerUrl((sourceUrlInput && sourceUrlInput.value) || (siteUrlInput && siteUrlInput.value) || '');
    if (!sourceUrl) {
      notify('Enter a source website URL or website URL first', true);
      return;
    }
    startContactsPeerSitesProgress();
    try {
      const result = await api('/api/acquire/website-peers/discover', {
        method: 'POST',
        body: JSON.stringify({
          source_url: sourceUrl,
          max_pages: 10,
          peer_sites_limit: 20,
          images_limit: 20,
          body_snippet_chars: 500,
          capture_contact_data: true,
        }),
      });
      const summary = result?.peer_summary || result?.data?.peer_summary || {};
      const peers = Array.isArray(summary?.peers) ? summary.peers : [];
      const normalizedSource = normalizeWebsitePeerUrl(result?.source_url || result?.data?.source_url || sourceUrl);
      let sourceDomain = '';
      try {
        sourceDomain = new URL(normalizedSource).hostname.replace(/^www\./, '').toLowerCase();
      } catch (_) {
        sourceDomain = '';
      }
      const existingKeys = new Set(
        (Array.isArray(websitePeers) ? websitePeers : []).map((peer) => {
          const peerSourceDomain = String(peer?.source_domain || '').trim().toLowerCase();
          const domain = String(peer?.domain || '').trim().toLowerCase();
          return `${peerSourceDomain}::${domain}`;
        })
      );
      websitePeerDiscoveryResults = peers
        .map((peer) => {
          const domain = String(peer?.domain || '').trim().toLowerCase();
          return {
            source_url: normalizedSource,
            url: String(peer?.url || '').trim(),
            domain,
            title: String(peer?.title || '').trim(),
            matched_keywords: Array.isArray(peer?.matched_keywords) ? peer.matched_keywords.slice() : [],
            snippet: String(peer?.snippet || '').trim(),
            website_model: String(peer?.model || '').trim() || (WEBSITE_PEER_MODELS[0] || ''),
            selected: !existingKeys.has(`${sourceDomain}::${domain}`),
          };
        })
        .filter((peer) => peer.url && peer.domain);
      renderWebsitePeerDiscoveryResults();
      const count = websitePeerDiscoveryResults.length;
      finishContactsPeerSitesProgress(true, `Discovered ${count} peer site candidate${count === 1 ? '' : 's'}.`);
      notify(count ? `Discovered ${count} peer site candidate${count === 1 ? '' : 's'}` : 'No peer sites returned', !count);
    } catch (err) {
      websitePeerDiscoveryResults = [];
      renderWebsitePeerDiscoveryResults();
      finishContactsPeerSitesProgress(false, err.message || 'Peer site discovery failed.');
      notify(err.message, true);
    }
  }

  async function saveSelectedWebsitePeerCandidates() {
    const selected = websitePeerDiscoveryResults.filter((item) => item.selected !== false);
    if (!selected.length) {
      notify('Select at least one peer site candidate', true);
      return;
    }
    const existingKeys = new Set(
      (Array.isArray(websitePeers) ? websitePeers : []).map((peer) => {
        const sourceDomain = String(peer?.source_domain || '').trim().toLowerCase();
        const domain = String(peer?.domain || '').trim().toLowerCase();
        return `${sourceDomain}::${domain}`;
      })
    );
    let created = 0;
    let skipped = 0;
    for (const peer of selected) {
      let sourceDomain = '';
      try {
        sourceDomain = new URL(String(peer.source_url || '').trim()).hostname.replace(/^www\./, '').toLowerCase();
      } catch (_) {
        sourceDomain = '';
      }
      const key = `${sourceDomain}::${String(peer.domain || '').trim().toLowerCase()}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      await api('/api/acquire/website-peers', {
        method: 'POST',
        body: JSON.stringify({
          source_url: peer.source_url,
          site_url: peer.url,
          title: peer.title,
          matched_keywords: peer.matched_keywords,
          snippet: peer.snippet,
          website_model: peer.website_model,
          site_type: 'peer',
        }),
      });
      existingKeys.add(key);
      created += 1;
    }
    await refreshWebsitePeers();
    notify(
      created
        ? `Saved ${created} peer site${created === 1 ? '' : 's'}${skipped ? ` (${skipped} already existed)` : ''}`
        : `No new peer sites saved${skipped ? ` (${skipped} already existed)` : ''}`
    );
  }

  function renderPeerSiteSummary(peer, run) {
    const wrap = document.getElementById('contactsPeerSiteSummary');
    const metaEl = document.getElementById('contactsPeerSiteDetailsMeta');
    if (!wrap) return;
    wrap.innerHTML = '';
    const detailMeta = safeObject(peer?.metadata);
    const fields = [
      ['Scope', String(peer?.site_type || '').trim() === 'source' ? 'Source Website' : 'Peer Website'],
      ['Site Type', String(peer?.website_model || '').trim() || '-'],
      ['Domain', String(peer?.domain || '').trim() || '-'],
      ['Website URL', String(peer?.site_url || '').trim() || '-'],
      ['Source Website', String(peer?.source_url || '').trim() || '-'],
      ['Source Domain', String(peer?.source_domain || '').trim() || '-'],
      ['Title', String(peer?.title || '').trim() || '-'],
      ['Matched Keywords', Array.isArray(peer?.matched_keywords) && peer.matched_keywords.length ? peer.matched_keywords.join(', ') : '-'],
      ['Snippet', String(peer?.snippet || '').trim() || '-'],
      ['Notes', String(peer?.notes || '').trim() || '-'],
      ['Last Acquired', String(peer?.last_acquired_at || peer?.updated_at || '').trim() || '-'],
      ['Linked Run ID', String(detailMeta.run_id || '').trim() || '-'],
    ];
    fields.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'view-field-row';
      const labelEl = document.createElement('div');
      labelEl.className = 'view-field-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('div');
      valueEl.className = 'view-field-value';
      if (/^https?:\/\//i.test(String(value || ''))) {
        const link = document.createElement('a');
        link.href = String(value || '');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(value || '');
        valueEl.appendChild(link);
      } else {
        valueEl.textContent = String(value || '');
      }
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      wrap.appendChild(row);
    });
    if (metaEl) {
      metaEl.textContent = run
        ? 'Showing full acquired website details from the linked Acquire: Web run.'
        : 'Showing the persisted website record. Full acquired details are only available when this website has its own direct website acquire.';
    }
  }

  function renderPeerSiteSocial(run, peer) {
    const tbody = document.getElementById('contactsPeerSiteSocialTable');
    const emptyEl = document.getElementById('contactsPeerSiteSocialEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(run?.contact_labels) ? run.contact_labels : [];
    if (!rows.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    rows.forEach(([label, value]) => {
      const tr = document.createElement('tr');
      const labelTd = document.createElement('td');
      labelTd.className = 'direct-acquire-contact-label';
      labelTd.textContent = String(label || '').trim();
      const valueTd = document.createElement('td');
      const text = String(value || '').trim();
      if (/^https?:\/\//i.test(text)) {
        const link = document.createElement('a');
        link.href = text;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = text;
        valueTd.appendChild(link);
      } else {
        valueTd.textContent = text || '-';
      }
      tr.appendChild(labelTd);
      tr.appendChild(valueTd);
      tbody.appendChild(tr);
    });
  }

  function renderPeerSiteKeywords(run, peer) {
    const tbody = document.getElementById('contactsPeerSiteKeywordsTable');
    const emptyEl = document.getElementById('contactsPeerSiteKeywordsEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    const fromRun = Array.isArray(run?.keyword_summary?.top_keywords) ? run.keyword_summary.top_keywords : [];
    const rows = fromRun.length
      ? fromRun.map((item) => ({ keyword: String(item?.keyword || '').trim(), score: Number(item?.score || 0) || 0 }))
      : (Array.isArray(peer?.matched_keywords) ? peer.matched_keywords.map((keyword) => ({ keyword: String(keyword || '').trim(), score: '' })) : []);
    if (!rows.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    rows.forEach((item) => {
      if (!String(item.keyword || '').trim()) return;
      const tr = document.createElement('tr');
      const keywordTd = document.createElement('td');
      keywordTd.className = 'direct-acquire-contact-label';
      keywordTd.textContent = item.keyword;
      const scoreTd = document.createElement('td');
      scoreTd.textContent = item.score === '' ? '-' : Number(item.score || 0).toFixed(1);
      tr.appendChild(keywordTd);
      tr.appendChild(scoreTd);
      tbody.appendChild(tr);
    });
  }

  function renderPeerSiteHashtags(run) {
    const tbody = document.getElementById('contactsPeerSiteHashtagsTable');
    const emptyEl = document.getElementById('contactsPeerSiteHashtagsEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(run?.hashtag_summary?.hashtags) ? run.hashtag_summary.hashtags : [];
    if (!rows.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    rows.forEach((item) => {
      const hashtag = String(item?.hashtag || '').trim();
      if (!hashtag) return;
      const tr = document.createElement('tr');
      const hashtagTd = document.createElement('td');
      hashtagTd.className = 'direct-acquire-contact-label';
      hashtagTd.textContent = hashtag;
      const scoreTd = document.createElement('td');
      scoreTd.textContent = (Number(item?.evidence_score || 0) || 0).toFixed(1);
      const postsTd = document.createElement('td');
      postsTd.textContent = String(Number(item?.posts_count || 0) || 0);
      tr.appendChild(hashtagTd);
      tr.appendChild(scoreTd);
      tr.appendChild(postsTd);
      tbody.appendChild(tr);
    });
  }

  function renderPeerSiteImages(run) {
    const grid = document.getElementById('contactsPeerSiteImagesGrid');
    const emptyEl = document.getElementById('contactsPeerSiteImagesEmpty');
    if (!grid) return;
    grid.innerHTML = '';
    const images = Array.isArray(run?.image_summary?.images) ? run.image_summary.images : [];
    if (!images.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    images.forEach((item, index) => {
      const url = String(item?.url || '').trim();
      if (!url) return;
      const card = document.createElement('div');
      card.className = 'direct-acquire-image-card';
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const image = document.createElement('img');
      image.src = url;
      image.alt = String(item?.name || `Website image ${index + 1}`).trim();
      image.loading = 'lazy';
      link.appendChild(image);
      card.appendChild(link);
      const nameEl = document.createElement('div');
      nameEl.className = 'direct-acquire-image-name';
      nameEl.textContent = String(item?.name || `Website image ${index + 1}`).trim();
      card.appendChild(nameEl);
      grid.appendChild(card);
    });
  }

  function renderPeerSitePages(run) {
    const tbody = document.getElementById('contactsPeerSitePagesTable');
    const emptyEl = document.getElementById('contactsPeerSitePagesEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    const pages = Array.isArray(run?.pages) ? run.pages : [];
    if (!pages.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    pages.forEach((page) => {
      const tr = document.createElement('tr');
      [page.url || '-', page.title || '-', Array.isArray(page.emails) ? page.emails.join(', ') || '-' : '-', Array.isArray(page.phones) ? page.phones.join(', ') || '-' : '-', page.body_snippet || '-']
        .forEach((text, index) => {
          const td = document.createElement('td');
          if (index === 0 && /^https?:\/\//i.test(String(text || ''))) {
            const link = document.createElement('a');
            link.href = String(text || '');
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = String(text || '');
            td.appendChild(link);
          } else {
            td.textContent = String(text || '');
          }
          tr.appendChild(td);
        });
      tbody.appendChild(tr);
    });
  }

  function findLinkedWebsitePeerRunId(peer) {
    const ownRunId = String(peer?.metadata?.run_id || '').trim();
    if (ownRunId && String(peer?.site_type || '').trim() === 'source') {
      return ownRunId;
    }
    const targetUrl = normalizeWebsitePeerUrl(peer?.site_url || '');
    const targetDomain = String(peer?.domain || '').trim().toLowerCase();
    if (!targetUrl && !targetDomain) return '';
    const matchingSource = websitePeers.find((item) => {
      if (String(item?.site_type || '').trim() !== 'source') return false;
      const itemRunId = String(item?.metadata?.run_id || '').trim();
      if (!itemRunId) return false;
      const itemUrl = normalizeWebsitePeerUrl(item?.site_url || item?.source_url || '');
      const itemDomain = String(item?.domain || item?.source_domain || '').trim().toLowerCase();
      return (targetUrl && itemUrl && targetUrl === itemUrl)
        || (targetDomain && itemDomain && targetDomain === itemDomain);
    });
    return String(matchingSource?.metadata?.run_id || '').trim();
  }

  function openPeerSiteEditForm(peerOrId) {
    const peer = typeof peerOrId === 'object'
      ? peerOrId
      : websitePeers.find((item) => String(item?.id || '') === String(peerOrId || '')) || null;
    if (!peer) {
      notify('Peer site not found', true);
      return;
    }
    App.setActivePage('contactsPeerSitesPage');
    fillWebsitePeerForm(peer);
    try {
      const formEl = document.getElementById('contactsPeerSiteForm');
      if (formEl && typeof formEl.scrollIntoView === 'function') {
        formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (_) {
      // no-op
    }
  }

  async function openPeerSiteDetailPage(peerOrId, editMode = false) {
    const peer = typeof peerOrId === 'object'
      ? peerOrId
      : websitePeers.find((item) => String(item?.id || '') === String(peerOrId || '')) || null;
    if (!peer) {
      notify('Peer site not found', true);
      return;
    }
    activeWebsitePeerDetail = peer;
    activeWebsitePeerId = String(peer.id || '').trim();
    let run = null;
    const runId = findLinkedWebsitePeerRunId(peer);
    if (runId) {
      try {
        const res = await api(`/api/acquire/direct-runs/${encodeURIComponent(runId)}`);
        run = res?.run || null;
      } catch (_) {
        run = null;
      }
    }
    activeWebsitePeerRun = run;
    renderPeerSiteSummary(peer, run);
    renderPeerSiteSocial(run, peer);
    renderPeerSiteKeywords(run, peer);
    renderPeerSiteHashtags(run);
    renderPeerSiteImages(run);
    renderPeerSitePages(run);
    App.setActivePage('contactsPeerSiteDetailsPage');
    if (editMode) fillWebsitePeerForm(peer);
  }

  function openPeerSitesPage() {
    App.setActivePage('contactsPeerSitesPage');
    refreshWebsitePeers().catch((err) => notify(err.message, true));
  }

  function openViewPage(contactOrId) {
    const contact = typeof contactOrId === 'object' ? contactOrId : findContactById(contactOrId);
    if (!contact) {
      notify('Contact not found', true);
      return;
    }
    activeContactId = String(contact.id || '');
    renderViewContact(contact);
    App.setActivePage('viewContactPage');
  }

  function armTeamMemberCreate(meta = {}) {
    const ctx = meta && typeof meta === 'object' ? { ...meta } : {};
    pendingAddContactMeta = Object.keys(ctx).length ? ctx : null;
    const returnId = String(ctx.returnPageId || '').trim();
    returnPageOnSave = returnId || null;
    activeContactId = '';
  }

  const fromProjectUi = {
    projectSelect: null,
    searchInput: null,
    listbox: null,
    nativeSelect: null,
    assignBtn: null,
    wired: false,
  };
  const fromProjectState = {
    options: [],
    activeIndex: -1,
    searchTimer: null,
    blurTimer: null,
    projectNames: {},
  };

  const ALL_PROJECTS_OPTION_VALUE = '__all__';

  function parseProjectsApiResponse(res) {
    if (!res || typeof res !== 'object') return [];
    if (Array.isArray(res.projects)) return res.projects;
    if (Array.isArray(res.data)) return res.data;
    if (res.data && typeof res.data === 'object' && Array.isArray(res.data.projects)) {
      return res.data.projects;
    }
    return App.normalizeApiArray(res, 'projects') || App.normalizeApiArray(res) || [];
  }

  function mergeProjectLists(...lists) {
    const byId = new Map();
    lists.flat().forEach((project) => {
      const id = String(project?.id || '').trim();
      if (!id) return;
      byId.set(id, project);
    });
    return [...byId.values()];
  }

  async function loadAccessibleProjects() {
    const cached = Array.isArray(state.projects) ? state.projects : [];
    let projects = [];
    let currentId = String(state.currentProjectId || '').trim();

    try {
      const currentRes = await api('/api/projects/current', { method: 'GET' });
      const fromCurrent = parseProjectsApiResponse(currentRes);
      const project = currentRes?.project || currentRes?.data?.project || null;
      if (project?.id) {
        currentId = String(project.id).trim();
        state.currentProjectId = currentId;
        state.currentProject = project;
        projects = mergeProjectLists(projects, [project], fromCurrent);
      } else if (fromCurrent.length) {
        projects = mergeProjectLists(projects, fromCurrent);
      }
    } catch (_) {
      // Fall through to list endpoint.
    }

    try {
      const listRes = await api('/api/projects', { method: 'GET' });
      projects = mergeProjectLists(projects, parseProjectsApiResponse(listRes));
    } catch (err) {
      if (!projects.length && cached.length) {
        projects = mergeProjectLists(cached);
      } else if (!projects.length) {
        throw err;
      }
    }

    if (!projects.length && cached.length) {
      projects = mergeProjectLists(cached);
    }

    state.projects = projects;
    return { projects, currentId };
  }

  function populateFromProjectSelect(select, projects, currentId) {
    if (!select) return;
    fromProjectState.projectNames = {};
    select.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a project…';
    select.appendChild(placeholder);

    const allOpt = document.createElement('option');
    allOpt.value = ALL_PROJECTS_OPTION_VALUE;
    allOpt.textContent = 'All Projects';
    select.appendChild(allOpt);

    projects.forEach((project) => {
      const id = String(project?.id || '').trim();
      if (!id) return;
      const name = String(project.name || project.slug || id);
      fromProjectState.projectNames[id] = name;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id === currentId ? `${name} (current)` : name;
      select.appendChild(opt);
    });

    if (!projects.length) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.disabled = true;
      empty.textContent = 'No projects on your account';
      select.appendChild(empty);
    }
  }

  function contactPickerLabel(contact, projectLabel) {
    const first = safeText(contact.firstName || contact.first_name);
    const last = safeText(contact.lastName || contact.last_name);
    const name = [first, last].filter(Boolean).join(' ').trim();
    const email = safeText(contact.email);
    const company = safeText(contact.company);
    const core = [name, email, company].filter(Boolean).join(' · ') || safeText(contact.id) || 'Contact';
    return projectLabel ? `${projectLabel}: ${core}` : core;
  }

  function resetAddContactFromProjectPanel() {
    if (fromProjectUi.projectSelect) fromProjectUi.projectSelect.value = '';
    if (fromProjectUi.nativeSelect) fromProjectUi.nativeSelect.innerHTML = '';
    if (fromProjectUi.searchInput) {
      fromProjectUi.searchInput.value = '';
      fromProjectUi.searchInput.disabled = true;
    }
    fromProjectState.options = [];
    fromProjectState.activeIndex = -1;
    renderFromProjectListbox();
    closeFromProjectListbox();
    setFromProjectAssignEnabled();
  }

  function resolveFromProjectSelectEl() {
    const el = document.getElementById('addContactFromProjectSelect');
    if (el) fromProjectUi.projectSelect = el;
    return el;
  }

  async function loadAddContactFromProjectOptions() {
    const select = resolveFromProjectSelectEl();
    if (!select) return;
    try {
      const { projects, currentId } = await loadAccessibleProjects();
      populateFromProjectSelect(select, projects, currentId);
    } catch (err) {
      notify(`Could not load projects: ${err.message}`, true);
      populateFromProjectSelect(select, [], '');
    }
  }

  function setFromProjectAssignEnabled() {
    const projectId = String(fromProjectUi.projectSelect?.value || '').trim();
    const contactId = String(fromProjectUi.nativeSelect?.value || '').trim();
    if (fromProjectUi.assignBtn) fromProjectUi.assignBtn.disabled = !(projectId && contactId);
    if (fromProjectUi.searchInput) fromProjectUi.searchInput.disabled = !projectId;
  }

  function projectLabelForContact(contact) {
    const pid = safeText(contact?.project_id || contact?.projectId);
    if (!pid) return 'Unassigned';
    return fromProjectState.projectNames[pid] || pid;
  }

  function isAllProjectsPickerMode() {
    return String(fromProjectUi.projectSelect?.value || '').trim() === ALL_PROJECTS_OPTION_VALUE;
  }

  function syncFromProjectNativeSelect() {
    const select = fromProjectUi.nativeSelect;
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    select.appendChild(blank);
    fromProjectState.options.forEach((opt) => {
      const row = document.createElement('option');
      row.value = opt.value;
      row.textContent = opt.label;
      select.appendChild(row);
    });
    if (previous && fromProjectState.options.some((opt) => opt.value === previous)) {
      select.value = previous;
    }
    setFromProjectAssignEnabled();
  }

  function visibleFromProjectMatches() {
    const term = safeText(fromProjectUi.searchInput?.value || '').toLowerCase();
    if (!term) return fromProjectState.options.slice(0, 50);
    return fromProjectState.options
      .filter((opt) => opt.searchText.includes(term) || opt.label.toLowerCase().includes(term))
      .slice(0, 50);
  }

  function renderFromProjectListbox() {
    const listbox = fromProjectUi.listbox;
    if (!listbox) return;
    const matches = visibleFromProjectMatches();
    listbox.innerHTML = '';
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'campaign-combobox-empty';
      const picker = String(fromProjectUi.projectSelect?.value || '').trim();
      if (!picker) empty.textContent = 'Select a project first';
      else if (picker === ALL_PROJECTS_OPTION_VALUE) {
        empty.textContent = 'No matching contacts in your other projects';
      } else empty.textContent = 'No matching contacts in this project';
      listbox.appendChild(empty);
      return;
    }
    matches.forEach((opt, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'campaign-combobox-option';
      row.dataset.comboboxValue = opt.value;
      row.setAttribute('role', 'option');
      if (index === fromProjectState.activeIndex) row.classList.add('is-active');
      row.textContent = opt.label;
      listbox.appendChild(row);
    });
  }

  function openFromProjectListbox() {
    if (fromProjectUi.listbox) fromProjectUi.listbox.hidden = false;
  }

  function closeFromProjectListbox() {
    if (fromProjectUi.listbox) fromProjectUi.listbox.hidden = true;
  }

  function setFromProjectSelection(contactId) {
    const select = fromProjectUi.nativeSelect;
    const search = fromProjectUi.searchInput;
    if (!select || !search) return;
    select.value = String(contactId || '');
    const match = fromProjectState.options.find((opt) => opt.value === select.value);
    search.value = match ? match.label : '';
    setFromProjectAssignEnabled();
  }

  function scheduleFromProjectSearch() {
    window.clearTimeout(fromProjectState.searchTimer);
    fromProjectState.searchTimer = window.setTimeout(() => {
      fetchFromProjectContacts(fromProjectUi.searchInput?.value || '').catch((err) => notify(err.message, true));
    }, 280);
  }

  async function fetchFromProjectContacts(query) {
    const projectId = String(fromProjectUi.projectSelect?.value || '').trim();
    if (!projectId) {
      fromProjectState.options = [];
      syncFromProjectNativeSelect();
      renderFromProjectListbox();
      return;
    }
    const q = encodeURIComponent(String(query || '').trim());
    const res = await api(`/api/contacts/search-in-project?projectId=${encodeURIComponent(projectId)}&q=${q}`);
    const contacts = App.normalizeApiArray(res, 'contacts')
      || App.normalizeApiArray(res, 'data')
      || App.normalizeApiArray(res)
      || [];
    const showProject = isAllProjectsPickerMode();
    fromProjectState.options = contacts.map((contact) => {
      const rowProjectId = safeText(contact.project_id || contact.projectId);
      const sourceProjectId = rowProjectId
        || (projectId === ALL_PROJECTS_OPTION_VALUE ? '__legacy__' : projectId);
      const projectLabel = showProject ? projectLabelForContact(contact) : '';
      return {
        value: String(contact.id || ''),
        sourceProjectId,
        label: contactPickerLabel(contact, projectLabel),
        searchText: [
          contact.firstName,
          contact.lastName,
          contact.first_name,
          contact.last_name,
          contact.email,
          contact.company,
          projectLabel,
        ].filter(Boolean).join(' ').toLowerCase(),
      };
    }).filter((opt) => opt.value);
    fromProjectState.activeIndex = -1;
    syncFromProjectNativeSelect();
    renderFromProjectListbox();
    openFromProjectListbox();
  }

  function wireAddContactFromProjectPanel() {
    if (fromProjectUi.wired) return;
    resolveFromProjectSelectEl();
    fromProjectUi.searchInput = document.getElementById('addContactFromProjectSearch');
    fromProjectUi.listbox = document.getElementById('addContactFromProjectListbox');
    fromProjectUi.nativeSelect = document.getElementById('addContactFromProjectNative');
    fromProjectUi.assignBtn = document.getElementById('addContactAssignFromProjectBtn');
    const projectSelect = fromProjectUi.projectSelect;
    const searchInput = document.getElementById('addContactFromProjectSearch');
    const listbox = document.getElementById('addContactFromProjectListbox');
    const nativeSelect = document.getElementById('addContactFromProjectNative');
    const assignBtn = document.getElementById('addContactAssignFromProjectBtn');
    fromProjectUi.searchInput = searchInput;
    fromProjectUi.listbox = listbox;
    fromProjectUi.nativeSelect = nativeSelect;
    fromProjectUi.assignBtn = assignBtn;
    if (!projectSelect || !searchInput || !listbox || !nativeSelect || !assignBtn) return;

    projectSelect.addEventListener('change', () => {
      nativeSelect.value = '';
      searchInput.value = '';
      fromProjectState.activeIndex = -1;
      setFromProjectAssignEnabled();
      if (projectSelect.value) {
        searchInput.disabled = false;
        searchInput.focus();
        fetchFromProjectContacts('').catch((err) => notify(err.message, true));
      } else {
        searchInput.disabled = true;
        fromProjectState.options = [];
        renderFromProjectListbox();
      }
    });

    searchInput.addEventListener('input', () => {
      const selected = fromProjectState.options.find((opt) => opt.value === nativeSelect.value);
      if (selected && safeText(searchInput.value) !== selected.label) {
        nativeSelect.value = '';
      }
      fromProjectState.activeIndex = -1;
      setFromProjectAssignEnabled();
      scheduleFromProjectSearch();
      openFromProjectListbox();
    });

    searchInput.addEventListener('focus', () => {
      openFromProjectListbox();
      renderFromProjectListbox();
    });

    searchInput.addEventListener('blur', () => {
      window.clearTimeout(fromProjectState.blurTimer);
      fromProjectState.blurTimer = window.setTimeout(() => {
        closeFromProjectListbox();
        const match = fromProjectState.options.find((opt) => opt.value === nativeSelect.value);
        if (match && !safeText(searchInput.value)) searchInput.value = match.label;
      }, 160);
    });

    listbox.addEventListener('mousedown', (event) => {
      const row = event.target.closest('[data-combobox-value]');
      if (!row) return;
      event.preventDefault();
      setFromProjectSelection(row.dataset.comboboxValue || '');
      closeFromProjectListbox();
    });

    assignBtn.addEventListener('click', () => {
      submitAssignFromProject().catch((err) => notify(err.message, true));
    });

    fromProjectUi.wired = true;
  }

  async function finishContactCreatedFlow(created, savedReturnPage) {
    pendingAddContactMeta = null;
    if (App.devAgent) App.devAgent.teamAddContext = null;
    await App.refresh();
    if (savedReturnPage === 'devTeamPage' && created?.id && typeof App.devAgent?.afterTeamContactCreated === 'function') {
      returnPageOnSave = null;
      await App.devAgent.afterTeamContactCreated(created);
    } else if (savedReturnPage) {
      App.setActivePage(savedReturnPage);
      returnPageOnSave = null;
      if (savedReturnPage === 'devTeamPage' && typeof App.devAgent?.showTeamBrowser === 'function') {
        App.devAgent.showTeamBrowser();
      }
    } else {
      openContactsPage();
    }
  }

  async function submitAssignFromProject() {
    const sourceContactId = String(fromProjectUi.nativeSelect?.value || '').trim();
    const selected = fromProjectState.options.find((opt) => opt.value === sourceContactId);
    const pickerProjectId = String(fromProjectUi.projectSelect?.value || '').trim();
    const sourceProjectId = safeText(selected?.sourceProjectId)
      || (pickerProjectId === ALL_PROJECTS_OPTION_VALUE ? '' : pickerProjectId);
    if (!pickerProjectId || !sourceContactId || !sourceProjectId) {
      notify('Select a project and contact', true);
      return;
    }
    if (!pendingAddContactMeta && App.devAgent?.teamAddContext) {
      pendingAddContactMeta = { ...App.devAgent.teamAddContext };
    }
    if (!returnPageOnSave && pendingAddContactMeta?.returnPageId) {
      returnPageOnSave = pendingAddContactMeta.returnPageId;
    }
    const savedReturnPage = returnPageOnSave;
    const addMeta = pendingAddContactMeta;
    const body = { sourceProjectId, sourceContactId };
    if (addMeta?.contactType) body.contactType = addMeta.contactType;
    if (addMeta?.contactClass) body.contactClass = addMeta.contactClass;
    try {
      const res = await api('/api/contacts/assign-from-project', { method: 'POST', body: JSON.stringify(body) });
      const created = res?.contact || res?.data || null;
      resetAddContactFromProjectPanel();
      notify('Contact added to this project');
      await finishContactCreatedFlow(created, savedReturnPage);
    } catch (err) {
      pendingAddContactMeta = addMeta;
      notify(err.message, true);
    }
  }

  async function initAddContactFromProjectPanel() {
    if (!fromProjectUi.wired) wireAddContactFromProjectPanel();
    resetAddContactFromProjectPanel();
    await loadAddContactFromProjectOptions();
  }

  async function openAddPage(returnPageId = null, meta = {}) {
    const ctx = meta && typeof meta === 'object' ? { ...meta } : {};
    if (returnPageId) ctx.returnPageId = returnPageId;
    armTeamMemberCreate(ctx);
    if (els.contactForm) els.contactForm.reset();
    try {
      await initAddContactFromProjectPanel();
    } catch (err) {
      notify(err.message, true);
    }
    const go = App._baseSetActivePage || App.setActivePage;
    go.call(App, 'addContactPage');
  }

  async function openEditPage(contactOrId, returnPageId = null) {
    const wantedId = typeof contactOrId === 'object'
      ? String(contactOrId?.id || '').trim()
      : String(contactOrId || '').trim();
    if (!wantedId) {
      const meta = returnPageId === 'devTeamPage'
        ? { contactType: 'team-admin', contactClass: 'personnel' }
        : {};
      openAddPage(returnPageId || null, meta);
      return;
    }
    let contact = typeof contactOrId === 'object' ? contactOrId : findContactById(contactOrId);
    if (!contact && wantedId) {
      try {
        const res = await api(`/api/contacts/${encodeURIComponent(wantedId)}`);
        contact = res?.contact || res?.data || null;
      } catch (_) {
        contact = null;
      }
    }
    if (!contact || !els.contactEditForm) {
      notify('Contact not found', true);
      return;
    }
    returnPageOnSave = returnPageId;
    activeContactId = String(contact.id || '');
    if (els.contactEditId) els.contactEditId.value = activeContactId;
    fillContactForm(els.contactEditForm, contact);
    App.setActivePage('editContactPage');
  }

  function openClonePage(contactOrId) {
    const contact = typeof contactOrId === 'object' ? contactOrId : findContactById(contactOrId);
    if (!contact || !els.contactCloneForm) {
      notify('Contact not found', true);
      return;
    }
    activeContactId = String(contact.id || '');
    fillContactForm(els.contactCloneForm, contact);
    App.setActivePage('cloneContactPage');
  }

  async function deleteContactRecord(contactOrId) {
    const contact = typeof contactOrId === 'object' ? contactOrId : findContactById(contactOrId);
    const id = String(contact?.id || '').trim();
    if (!id) {
      notify('Contact not found', true);
      return;
    }
    if (!window.confirm(`Delete contact ${contactValue(contact, 'email') || contactValue(contact, 'first_name') || id}?`)) return;
    try {
      await api(`/api/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('Contact deleted');
      await App.refresh();
      openContactsPage();
    } catch (err) {
      notify(err.message, true);
    }
  }

  function contactPassesContactFilters(contact, filters) {
    return Object.keys(filters).every((key) => {
      const filterVal = filters[key];
      if (typeof filterVal === 'boolean') {
        const cv = contactValue(contact, key);
        return filterVal ? Boolean(cv && String(cv).trim()) : true;
      }
      if (filterVal && typeof filterVal === 'object' && !Array.isArray(filterVal)) {
        const cv = contactValue(contact, key);
        if (!cv) return false;
        const cvTime = new Date(cv).getTime();
        if (isNaN(cvTime)) return false;
        if (filterVal.from) {
          const start = new Date(filterVal.from);
          start.setHours(0, 0, 0, 0);
          if (cvTime < start.getTime()) return false;
        }
        if (filterVal.to) {
          const end = new Date(filterVal.to);
          end.setHours(23, 59, 59, 999);
          if (cvTime > end.getTime()) return false;
        }
        return true;
      }
      if (Array.isArray(filterVal)) {
        if (!filterVal.length) return true;
        const cv = contactValue(contact, key).toLowerCase();
        return filterVal.some(n => cv.includes(String(n).toLowerCase()));
      }
      const needle = String(filterVal || '').toLowerCase();
      if (!needle) return true;
      return contactValue(contact, key).toLowerCase().includes(needle);
    });
  }

  function activeExploreFilterRules() {
    ensureExploreFilterState();
    return activeExploreClauses(state.segmentContactsFilters).map((clause) => ({
      field: clause.key,
      operator: clause.mode,
      value: clause.value,
    }));
  }

  function exploreFilterDefinition() {
    ensureExploreFilterState();
    const clauses = activeExploreClauseDefs();
    normalizeExploreLogicTokens(clauses);
    const filters = {};
    EXPLORE_CONTACT_FIELDS.forEach(({ key }) => {
      const current = state.segmentContactsFilters[key] || { mode: 'contains', value: '' };
      filters[key] = {
        mode: String(current.mode || 'contains'),
        value: String(current.value || ''),
      };
    });
    return {
      filters,
      logicMode: state.segmentContactsLogicMode === 'any' ? 'any' : 'all',
      logic: state.segmentContactsLogicExpression || defaultLogicExpression(clauses),
      logicTokens: [...state.segmentContactsLogicTokens],
      clauses: clauses.map((clause) => ({
        id: clause.id,
        field: clause.key,
        mode: clause.mode,
        value: clause.value,
      })),
    };
  }

  function ruleDetailForName(rule) {
    const operator = String(rule?.operator || '').toLowerCase();
    if (operator === 'is_known') return 'KNOWN';
    if (operator === 'is_empty') return 'EMPTY';
    return `'${String(rule?.value || '').trim()}'`;
  }

  function ruleDetailForTray(rule) {
    const operator = String(rule?.operator || '').toLowerCase();
    if (operator === 'is_known') return 'KNOWN';
    if (operator === 'is_empty') return 'EMPTY';
    return `'${String(rule?.value || '').trim()}'`;
  }

  function operatorLabelForName(rule) {
    const operator = String(rule?.operator || '').toLowerCase();
    if (operator === 'starts_with') return 'Starts With';
    if (operator === 'ends_with') return 'Ends With';
    if (operator === 'is_known') return 'Is';
    if (operator === 'is_empty') return 'Is';
    if (operator === 'equals') return 'Equals';
    return 'Contains';
  }

  function buildExploreSegmentName() {
    const clauses = activeExploreClauseDefs();
    if (!clauses.length) return '';
    normalizeExploreLogicTokens(clauses);
    const labelById = Object.fromEntries(clauses.map((clause) => [
      clause.id,
      `${columnLabel(clause.key)} ${operatorLabelForName({ operator: clause.mode })} ${ruleDetailForName({ operator: clause.mode, value: clause.value })}`.trim(),
    ]));
    const evaluated = evaluateLogicExpression(state.segmentContactsLogicExpression, clauses, Object.fromEntries(clauses.map((clause) => [clause.id, true])), state.segmentContactsLogicMode);
    if (!evaluated.ok) {
      const joiner = state.segmentContactsLogicMode === 'any' ? ' or ' : ' and ';
      return Object.values(labelById).join(joiner);
    }
    return tokenizeLogicExpression(evaluated.normalizedExpression)
      .map((token) => {
        if (labelById[token]) return labelById[token];
        if (token === 'AND') return 'AND';
        if (token === 'OR') return 'OR';
        return token;
      })
      .join(' ');
  }

  function syncSuggestedSegmentName() {
    if (!els.createSegmentInlineName) return;
    const nextSuggestion = buildExploreSegmentName();
    const currentValue = String(els.createSegmentInlineName.value || '').trim();
    if (!currentValue || currentValue === lastSuggestedSegmentName) {
      els.createSegmentInlineName.value = nextSuggestion;
    }
    lastSuggestedSegmentName = nextSuggestion;
  }

  function syncSuggestedLogicExpression() {
    const clauses = activeExploreClauseDefs();
    const nextSuggestion = defaultLogicExpression(clauses, state.segmentContactsLogicMode);
    const currentValue = String(state.segmentContactsLogicExpression || '').trim();
    if (!currentValue || currentValue === lastSuggestedLogicExpression) {
      state.segmentContactsLogicExpression = nextSuggestion;
      state.segmentContactsLogicTokens = defaultLogicTokens(clauses, state.segmentContactsLogicMode);
    }
    lastSuggestedLogicExpression = nextSuggestion;
  }

  function isExploreFilterSpecified(key) {
    ensureExploreFilterState();
    const config = state.segmentContactsFilters[key] || { mode: 'contains', value: '' };
    const mode = String(config.mode || 'contains');
    const value = String(config.value || '').trim();
    if (mode === 'is_empty' || mode === 'is_known') return true;
    return Boolean(value);
  }

  function exploreResultColumns() {
    const defaults = ['first_name', 'last_name', 'company', 'email', 'website', 'youtube', 'instagram'];
    const extras = EXPLORE_CONTACT_FIELDS
      .map((field) => field.key)
      .filter((key) => !defaults.includes(key) && isExploreFilterSpecified(key));
    return [...defaults, ...extras];
  }

  function columnLabel(key) {
    const hit = EXPLORE_CONTACT_FIELDS.find((field) => field.key === key);
    return hit ? hit.label : key;
  }

  function renderExploreContactsResults() {
    const tbody = els.segmentsLeadsBody || els.segmentsContactsTable;
    const thead = els.segmentsLeadsHead || (tbody?.closest('table') ? tbody.closest('table').querySelector('thead') : null);
    if (!tbody || !thead) return;

    const cols = exploreResultColumns();

    thead.innerHTML = '';
    const tr = document.createElement('tr');
    cols.forEach((key) => {
      const th = document.createElement('th');
      th.textContent = columnLabel(key);
      tr.appendChild(th);
    });
    thead.appendChild(tr);

    tbody.innerHTML = '';
    tbody.innerHTML = '';
    if (els.exploreContactsCount) {
      els.exploreContactsCount.textContent = 'Record Count: 0';
    }
    if (exploreContactsApplied) {
      syncSuggestedSegmentName();
    }
    if (!exploreContactsApplied) return;

    const matches = state.contacts
      .filter((contact) => contactPassesFilter(contact, state.segmentContactsFilters, state.segmentContactsLogicMode, state.segmentContactsLogicExpression));

    if (els.exploreContactsCount) {
      els.exploreContactsCount.textContent = `Record Count: ${matches.length}`;
    }

    matches.forEach((contact) => {
        const tr = document.createElement('tr');
        cols.forEach((key) => {
          const td = document.createElement('td');
          appendContactCell(td, key, contactValue(contact, key));
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
  }

  function renderExploreContactFilters() {
    ensureExploreFilterState();
    if (!els.exploreContactsFilters) return;
    els.exploreContactsFilters.innerHTML = '';

    const columnsData = [
      [{ heading: 'Contact Details', fields: CONTACT_DETAIL_FILTER_FIELDS }],
      [{ heading: 'Social Accounts', fields: SOCIAL_FILTER_FIELDS }],
      [
        { heading: 'Engagement', fields: ENGAGEMENT_FILTER_FIELDS },
        { heading: 'Comments', fields: COMMENTS_FILTER_FIELDS }
      ]
    ];

    const grid = document.createElement('div');
    grid.className = 'explore-filters-grid';

    columnsData.forEach((colGroups) => {
      const column = document.createElement('section');
      column.className = 'explore-filter-column';

      colGroups.forEach((group) => {
        const heading = document.createElement('h4');
        heading.textContent = group.heading;
        if (group.heading === 'Comments') {
          heading.style.marginTop = '1.5rem';
        }
        column.appendChild(heading);

        group.fields.forEach(({ key, label }) => {
          const row = document.createElement('div');
          row.className = 'form-row';
          row.style.display = 'grid';
          row.style.gridTemplateColumns = '160px minmax(0, 1fr)';
          row.style.alignItems = 'center';
          row.style.columnGap = '0.75rem';

          const labelEl = document.createElement('label');
          labelEl.textContent = label;
          labelEl.style.fontWeight = '700';
          labelEl.style.margin = '0';
          row.appendChild(labelEl);

          const controls = document.createElement('div');
          controls.className = 'grid-form';
          controls.style.gridTemplateColumns = 'minmax(180px, 220px) minmax(0, 1fr)';

          if (isEngagementField(key)) {
            const fieldConfig = ENGAGEMENT_FILTER_FIELDS.find((field) => field.key === key) || { options: [] };
            const metricSelect = document.createElement('select');
            const metricPlaceholder = document.createElement('option');
            metricPlaceholder.value = '';
            metricPlaceholder.textContent = key === 'engagement_forms' ? 'Select Form' : (key === 'engagement_meetings' ? 'Select Meeting' : 'Select Metric');
            metricSelect.appendChild(metricPlaceholder);
            const metricOptions = key === 'engagement_forms'
              ? (exploreFormTemplateOptions.length ? exploreFormTemplateOptions : ['No Saved Forms'])
              : fieldConfig.options;
            metricOptions.forEach((metric) => {
              const option = document.createElement('option');
              option.value = String(metric || '').trim();
              option.textContent = String(metric || '').trim();
              metricSelect.appendChild(option);
            });
            metricSelect.value = state.segmentContactsFilters[key].mode;
            controls.appendChild(metricSelect);

            const bucketSelect = document.createElement('select');
            const bucketPlaceholder = document.createElement('option');
            bucketPlaceholder.value = '';
            bucketPlaceholder.textContent = 'Select Bucket';
            bucketSelect.appendChild(bucketPlaceholder);
            ENGAGEMENT_BUCKET_OPTIONS.forEach((bucket) => {
              const option = document.createElement('option');
              option.value = bucket;
              option.textContent = bucket;
              bucketSelect.appendChild(option);
            });
            bucketSelect.value = state.segmentContactsFilters[key].value;
            controls.appendChild(bucketSelect);

            metricSelect.addEventListener('change', () => {
              state.segmentContactsFilters[key].mode = String(metricSelect.value || '');
              exploreContactsApplied = false;
              renderContacts();
            });
            bucketSelect.addEventListener('change', () => {
              state.segmentContactsFilters[key].value = String(bucketSelect.value || '');
              exploreContactsApplied = false;
              renderContacts();
            });
          } else if (isCommentField(key)) {
            const select = document.createElement('select');
            let modes = [];
            if (key === 'comments_score') {
              modes = [
                { value: 'equals', label: 'Equals' },
                { value: 'greater_than', label: 'Greater Than' },
                { value: 'less_than', label: 'Less Than' }
              ];
            } else {
              modes = [
                { value: 'equals', label: 'Is Equal To' },
                { value: 'contains', label: 'Contains' },
                { value: 'starts_with', label: 'Starts with' },
                { value: 'ends_with', label: 'Ends with' },
                { value: 'is_empty', label: 'Is Empty' },
                { value: 'is_known', label: 'Is Known' }
              ];
            }
            
            modes.forEach(m => {
              const opt = document.createElement('option');
              opt.value = m.value;
              opt.textContent = m.label;
              select.appendChild(opt);
            });
            
            if (!modes.some(m => m.value === state.segmentContactsFilters[key].mode)) {
              state.segmentContactsFilters[key].mode = modes[0].value;
            }
            select.value = state.segmentContactsFilters[key].mode;
            controls.appendChild(select);
            
            const inputContainer = document.createElement('div');
            controls.appendChild(inputContainer);

            function renderCommentValueInput() {
              inputContainer.innerHTML = '';
              const mode = select.value;
              const needsValue = !['is_empty', 'is_known'].includes(mode);
              if (!needsValue) {
                 state.segmentContactsFilters[key].value = '';
                 return;
              }
              
              if (key === 'comments_score') {
                const valSel = document.createElement('select');
                valSel.style.width = '100%';
                for (let i = 1; i <= 5; i++) {
                  const opt = document.createElement('option');
                  opt.value = String(i);
                  opt.textContent = String(i);
                  valSel.appendChild(opt);
                }
                if (!state.segmentContactsFilters[key].value) state.segmentContactsFilters[key].value = '1';
                valSel.value = state.segmentContactsFilters[key].value;
                valSel.addEventListener('change', () => {
                  state.segmentContactsFilters[key].value = valSel.value;
                  exploreContactsApplied = false;
                  renderContacts();
                });
                inputContainer.appendChild(valSel);
              } else if (mode === 'equals' && key === 'comments_campaign') {
                 const valSel = document.createElement('select');
                 valSel.style.width = '100%';
                 const loadOpt = document.createElement('option');
                 loadOpt.value = state.segmentContactsFilters[key].value || '';
                 loadOpt.textContent = 'Loading campaigns...';
                 valSel.appendChild(loadOpt);
                 
                 api('/api/campaigns').then(res => {
                    valSel.innerHTML = '';
                    const emptyOpt = document.createElement('option');
                    emptyOpt.value = '';
                    emptyOpt.textContent = '-- Select Campaign --';
                    valSel.appendChild(emptyOpt);
                    const camps = Array.isArray(res?.campaigns) ? res.campaigns : [];
                    camps.forEach(c => {
                      const opt = document.createElement('option');
                      opt.value = c.id;
                      opt.textContent = c.name || c.id;
                      valSel.appendChild(opt);
                    });
                    valSel.value = state.segmentContactsFilters[key].value;
                 }).catch(() => { valSel.textContent = ''; valSel.appendChild(new Option('Error compiling choices', '')); });
                 
                 valSel.addEventListener('change', () => {
                   state.segmentContactsFilters[key].value = valSel.value;
                   exploreContactsApplied = false;
                   renderContacts();
                 });
                 inputContainer.appendChild(valSel);
              } else if (mode === 'equals' && key === 'comments_topic') {
                 const valSel = document.createElement('select');
                 valSel.style.width = '100%';
                 const loadOpt = document.createElement('option');
                 loadOpt.value = state.segmentContactsFilters[key].value || '';
                 loadOpt.textContent = 'Loading topics...';
                 valSel.appendChild(loadOpt);
                 
                 api('/api/acquire/youtube-topics').then(res => {
                    valSel.innerHTML = '';
                    const emptyOpt = document.createElement('option');
                    emptyOpt.value = '';
                    emptyOpt.textContent = '-- Select Topic --';
                    valSel.appendChild(emptyOpt);
                    const tps = Array.isArray(res?.topics) ? res.topics : [];
                    tps.forEach(t => {
                      const opt = document.createElement('option');
                      opt.value = t.topic;
                      opt.textContent = t.topic || t.id;
                      valSel.appendChild(opt);
                    });
                    valSel.value = state.segmentContactsFilters[key].value;
                 }).catch(() => { valSel.textContent = ''; valSel.appendChild(new Option('Error compiling choices', '')); });
                 
                 valSel.addEventListener('change', () => {
                   state.segmentContactsFilters[key].value = valSel.value;
                   exploreContactsApplied = false;
                   renderContacts();
                 });
                 inputContainer.appendChild(valSel);
              } else {
                 const input = document.createElement('input');
                 input.type = 'text';
                 input.placeholder = label + ' filter';
                 input.value = state.segmentContactsFilters[key].value;
                 input.addEventListener('input', () => {
                   state.segmentContactsFilters[key].value = input.value;
                   exploreContactsApplied = false;
                   renderContacts();
                 });
                 inputContainer.appendChild(input);
              }
            }
            
            renderCommentValueInput();
            
            select.addEventListener('change', () => {
              state.segmentContactsFilters[key].mode = select.value;
              state.segmentContactsFilters[key].value = '';
              renderCommentValueInput();
              exploreContactsApplied = false;
              renderContacts();
            });
          } else {
        const select = document.createElement('select');
        EXPLORE_FILTER_MODES.forEach((mode) => {
          const option = document.createElement('option');
          option.value = mode.value;
          option.textContent = mode.label;
          select.appendChild(option);
        });
        select.value = state.segmentContactsFilters[key].mode;
        controls.appendChild(select);

        const personaField = key === 'persona';
        const input = personaField ? document.createElement('select') : document.createElement('input');
        if (personaField) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'Select Persona';
        input.appendChild(emptyOption);
        const personas = Array.isArray(state.contactPersonas) ? state.contactPersonas : [];
        personas
          .slice()
          .sort((a, b) => String(a.persona || '').localeCompare(String(b.persona || '')))
          .forEach((persona) => {
            const option = document.createElement('option');
            option.value = String(persona.persona || '').trim();
            option.textContent = String(persona.persona || '').trim();
            input.appendChild(option);
          });
        } else {
          input.type = 'text';
          input.placeholder = SOCIAL_FIELD_KEYS.has(key) ? `${label} user name` : `${label} filter`;
        }
        input.value = state.segmentContactsFilters[key].value;
        const modeNeedsText = !['is_empty', 'is_known'].includes(select.value);
        input.disabled = !modeNeedsText;
        input.classList.toggle('hidden', !modeNeedsText);
        controls.appendChild(input);

        select.addEventListener('change', () => {
          state.segmentContactsFilters[key].mode = String(select.value || 'contains');
          const needsText = !['is_empty', 'is_known'].includes(select.value);
          input.disabled = !needsText;
          input.classList.toggle('hidden', !needsText);
          if (!needsText) {
            state.segmentContactsFilters[key].value = '';
            input.value = '';
          }
          exploreContactsApplied = false;
          renderContacts();
        });

        input.addEventListener('input', () => {
          state.segmentContactsFilters[key].value = String(input.value || '');
          exploreContactsApplied = false;
          renderContacts();
        });
          }

          row.appendChild(controls);
          column.appendChild(row);
        });
      });

      grid.appendChild(column);
    });

    syncSuggestedLogicExpression();
    const clauses = activeExploreClauseDefs();
    normalizeExploreLogicTokens(clauses);
    if (!Number.isInteger(state.segmentContactsLogicSelectedIndex)) {
      state.segmentContactsLogicSelectedIndex = -1;
    }

    const logicSection = document.createElement('section');
    logicSection.className = 'explore-filter-column';
    logicSection.style.gridColumn = '1 / -1';

    const logicHeading = document.createElement('h4');
    logicHeading.textContent = 'Logic';
    logicHeading.style.fontSize = '1.35rem';
    logicSection.appendChild(logicHeading);

    const logicHelp = document.createElement('div');
    logicHelp.textContent = 'Click a filter or operator to add it to the Expression Builder';
    logicHelp.style.fontSize = '1rem';
    logicHelp.style.margin = '0 0 0.75rem 0';
    logicSection.appendChild(logicHelp);

    const sourceRow = document.createElement('div');
    sourceRow.style.display = 'inline-flex';
    sourceRow.style.columnGap = '0.75rem';
    sourceRow.style.gap = '0.75rem';
    sourceRow.style.flexWrap = 'wrap';
    sourceRow.style.alignItems = 'start';
    sourceRow.style.marginBottom = '0.75rem';

    function makeSourceTray(title, withDivider = false) {
      const tray = document.createElement('div');
      tray.style.minHeight = '84px';
      tray.style.padding = '0.75rem';
      tray.style.borderRadius = '8px';
      tray.style.background = '#f6f8fb';
      tray.style.border = '1px solid #d6dde8';
      tray.style.width = 'fit-content';
      tray.style.maxWidth = '100%';
      if (withDivider) tray.style.borderLeft = '2px solid #9aa9bf';

      const trayTitle = document.createElement('div');
      trayTitle.textContent = title;
      trayTitle.style.fontWeight = '700';
      trayTitle.style.marginBottom = '0.5rem';
      trayTitle.style.fontSize = '1.05rem';
      tray.appendChild(trayTitle);

      const trayBody = document.createElement('div');
      trayBody.style.display = 'flex';
      trayBody.style.flexWrap = 'wrap';
      trayBody.style.gap = '0.5rem';
      trayBody.style.fontSize = '1rem';
      tray.appendChild(trayBody);

      tray.addEventListener('dragenter', (event) => {
        event.preventDefault();
      });
      tray.addEventListener('dragover', (event) => {
        event.preventDefault();
      });
      tray.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const payload = readDraggedToken(event);
        if (payload?.source !== 'expression') return;
        const idx = Number(payload.index);
        if (!Number.isInteger(idx) || idx < 0) return;
        const next = [...state.segmentContactsLogicTokens];
        next.splice(idx, 1);
        state.segmentContactsLogicSelectedIndex = -1;
        commitLogicTokens(next);
      });

      return { tray, trayBody };
    }

    const logicTray = makeSourceTray('Filters');
    if (clauses.length) {
      clauses.forEach((clause) => {
        const pill = document.createElement('div');
        pill.draggable = true;
        pill.className = 'status-pill';
        pill.style.cursor = 'grab';
        pill.style.userSelect = 'none';
        pill.style.fontSize = '1rem';
        pill.style.padding = '0.45rem 0.8rem';
        pill.textContent = `${clause.id}: ${columnLabel(clause.key)} ${operatorLabelForName({ operator: clause.mode })} ${ruleDetailForTray({ operator: clause.mode, value: clause.value })}`.trim();
        pill.addEventListener('dragstart', (event) => {
          event.dataTransfer.setData('text/plain', JSON.stringify({ source: 'clause', token: clause.id }));
          event.dataTransfer.effectAllowed = 'all';
        });
        pill.addEventListener('click', () => {
          appendLogicToken(clause.id);
        });
        logicTray.trayBody.appendChild(pill);
      });
    } else {
      const empty = document.createElement('div');
      empty.textContent = 'Add at least one active filter.';
      logicTray.trayBody.appendChild(empty);
    }
    sourceRow.appendChild(logicTray.tray);

    const operatorsTray = makeSourceTray('Operators', true);
    ['AND', 'OR', '(', ')'].forEach((token) => {
      const pill = document.createElement('div');
      pill.className = 'status-pill';
      pill.draggable = true;
      pill.style.cursor = 'grab';
      pill.style.userSelect = 'none';
      pill.style.fontSize = '1rem';
      pill.style.padding = '0.45rem 0.8rem';
      pill.textContent = token;
      pill.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', JSON.stringify({ source: 'operator', token }));
        event.dataTransfer.effectAllowed = 'all';
      });
      pill.addEventListener('click', () => {
        appendLogicToken(token);
      });
      operatorsTray.trayBody.appendChild(pill);
    });
    sourceRow.appendChild(operatorsTray.tray);

    logicSection.appendChild(sourceRow);

    function commitLogicTokens(nextTokens) {
      state.segmentContactsLogicTokens = nextTokens.map((token) => String(token || '').toUpperCase());
      state.segmentContactsLogicExpression = tokensToExpression(state.segmentContactsLogicTokens);
      if (state.segmentContactsLogicSelectedIndex >= state.segmentContactsLogicTokens.length) {
        state.segmentContactsLogicSelectedIndex = state.segmentContactsLogicTokens.length - 1;
      }
      lastSuggestedLogicExpression = '';
      renderContacts();
    }

    function insertLogicTokenAt(token, insertIndex, sourceIndex = null) {
      const next = [...state.segmentContactsLogicTokens];
      if (sourceIndex != null && sourceIndex >= 0 && sourceIndex < next.length) {
        next.splice(sourceIndex, 1);
        if (sourceIndex < insertIndex) insertIndex -= 1;
      }
      const bounded = Math.max(0, Math.min(insertIndex, next.length));
      
      let tokensToInsert = [token];
      const validIds = new Set(clauses.map((clause) => String(clause.id).toUpperCase()));
      if (validIds.has(token)) {
        if (bounded > 0 && (validIds.has(next[bounded - 1]) || next[bounded - 1] === ')')) {
          tokensToInsert = ['AND', token];
        } else if (bounded < next.length && (validIds.has(next[bounded]) || next[bounded] === '(')) {
          tokensToInsert = [token, 'AND'];
        }
      } else if (token === '(' && bounded > 0 && validIds.has(next[bounded - 1])) {
        tokensToInsert = ['AND', '('];
      } else if (token === ')' && bounded < next.length && validIds.has(next[bounded])) {
        tokensToInsert = [')', 'AND'];
      }
      
      next.splice(bounded, 0, ...tokensToInsert);
      state.segmentContactsLogicSelectedIndex = bounded + tokensToInsert.length - 1;
      commitLogicTokens(next);
    }

    function appendLogicToken(token) {
      insertLogicTokenAt(String(token || '').toUpperCase(), state.segmentContactsLogicTokens.length, null);
    }

    function readDraggedToken(event) {
      try {
        return JSON.parse(event.dataTransfer.getData('text/plain') || '{}');
      } catch {
        return null;
      }
    }

    function buildDropSlot(insertIndex) {
      const slot = document.createElement('div');
      slot.style.width = '32px';
      slot.style.minWidth = '32px';
      slot.style.minHeight = '52px';
      slot.style.borderRadius = '6px';
      slot.style.border = '1px dashed #b8c6d8';
      slot.style.background = '#eef3f9';
      slot.style.boxSizing = 'border-box';
      slot.style.alignSelf = 'center';

      slot.addEventListener('dragenter', (event) => {
        event.preventDefault();
        slot.style.borderColor = '#2b6cb0';
        slot.style.background = '#dbeafe';
      });
      slot.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        slot.style.borderColor = '#2b6cb0';
        slot.style.background = '#dbeafe';
      });
      slot.addEventListener('dragleave', () => {
        slot.style.borderColor = '#b8c6d8';
        slot.style.background = '#eef3f9';
      });
      slot.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        slot.style.borderColor = '#b8c6d8';
        slot.style.background = '#eef3f9';
        const payload = readDraggedToken(event);
        if (!payload?.token) return;
        insertLogicTokenAt(
          String(payload.token).toUpperCase(),
          insertIndex,
          payload.source === 'expression' ? Number(payload.index) : null
        );
      });

      return slot;
    }

    const expressionWrap = document.createElement('div');
    expressionWrap.style.marginTop = '0.25rem';

    const expressionLabel = document.createElement('div');
    expressionLabel.style.fontWeight = '700';
    expressionLabel.style.marginBottom = '0.5rem';
    expressionLabel.style.fontSize = '1.1rem';
    expressionLabel.textContent = 'Expression Builder';
    expressionWrap.appendChild(expressionLabel);

    const expressionHelp = document.createElement('div');
    expressionHelp.textContent = 'Drag logic and operators and drop them onto the tiles to adjust placement.';
    expressionHelp.style.fontSize = '1rem';
    expressionHelp.style.marginBottom = '0.5rem';
    expressionWrap.appendChild(expressionHelp);

    const expressionRow = document.createElement('div');
    expressionRow.style.display = 'flex';
    expressionRow.style.flexWrap = 'wrap';
    expressionRow.style.gap = '0.25rem';
    expressionRow.style.minHeight = '48px';
    expressionRow.style.padding = '1rem';
    expressionRow.style.border = '1px dashed #7a8aa0';
    expressionRow.style.borderRadius = '8px';
    expressionRow.style.background = '#f6f8fb';
    expressionRow.style.fontSize = '1rem';

    expressionRow.addEventListener('dragenter', (event) => {
      event.preventDefault();
    });
    expressionRow.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    expressionRow.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const payload = readDraggedToken(event);
      if (!payload?.token) return;
      insertLogicTokenAt(String(payload.token).toUpperCase(), state.segmentContactsLogicTokens.length, payload.source === 'expression' ? Number(payload.index) : null);
    });

    if (state.segmentContactsLogicTokens.length) {
      state.segmentContactsLogicTokens.forEach((token, index) => {
        expressionRow.appendChild(buildDropSlot(index));
        const chip = document.createElement('div');
        chip.className = 'status-pill';
        chip.draggable = true;
        chip.style.cursor = 'grab';
        chip.style.userSelect = 'none';
        chip.style.fontSize = '1rem';
        chip.style.padding = '0.45rem 0.8rem';
        chip.textContent = token;
        chip.addEventListener('dragstart', (event) => {
          event.dataTransfer.setData('text/plain', JSON.stringify({ source: 'expression', token, index }));
          event.dataTransfer.effectAllowed = 'all';
        });
        expressionRow.appendChild(chip);
      });
      expressionRow.appendChild(buildDropSlot(state.segmentContactsLogicTokens.length));
    } else {
      const empty = document.createElement('div');
      empty.textContent = 'Drag clauses and logic tokens here.';
      empty.style.color = '#666';
      empty.style.pointerEvents = 'none';
      empty.style.fontSize = '1rem';
      expressionRow.appendChild(empty);
    }

    expressionWrap.appendChild(expressionRow);
    logicSection.appendChild(expressionWrap);

    const logicPreview = document.createElement('div');
    const previewEval = evaluateLogicExpression(state.segmentContactsLogicExpression, clauses, Object.fromEntries(clauses.map((clause) => [clause.id, true])), state.segmentContactsLogicMode);
    logicPreview.style.marginTop = '0.75rem';
    logicPreview.style.fontSize = '1rem';
    logicPreview.style.color = previewEval.ok ? 'inherit' : '#b00020';
    logicPreview.textContent = previewEval.ok
      ? `Expression: ${previewEval.normalizedExpression || '(none)' }`
      : `Expression error: ${previewEval.error}`;
    logicSection.appendChild(logicPreview);

    const applyBtnWrap = document.createElement('div');
    applyBtnWrap.className = 'form-submit-row';
    applyBtnWrap.style.marginTop = '1rem';
    
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.textContent = 'Apply Filters & Preview Segment';
    applyBtn.addEventListener('click', applyExploreFilters);
    applyBtnWrap.appendChild(applyBtn);

    logicSection.appendChild(applyBtnWrap);

    grid.appendChild(logicSection);

    els.exploreContactsFilters.appendChild(grid);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function renderContacts() {
    renderContactsTableHead();
    if (els.contactsTable) {
      els.contactsTable.innerHTML = '';
      const visibleColumns = getVisibleContactsColumns();
      let filteredContacts = state.contacts.filter((contact) => contactPassesContactFilters(contact, state.contactsFilters));

      if (activeFilteredContactClass) {
        filteredContacts = filteredContacts.filter(c => {
           let val = c.contact_class || c.contactClass;
           return String(val).toLowerCase().trim() === String(activeFilteredContactClass).toLowerCase().trim();
        });
      }

      if (state.contactsSortColumn) {
        filteredContacts.sort((a, b) => {
          let valA = contactValue(a, state.contactsSortColumn);
          let valB = contactValue(b, state.contactsSortColumn);
          valA = valA != null ? String(valA).toLowerCase() : '';
          valB = valB != null ? String(valB).toLowerCase() : '';
          if (valA < valB) return state.contactsSortDirection === 'asc' ? -1 : 1;
          if (valA > valB) return state.contactsSortDirection === 'asc' ? 1 : -1;
          return 0;
        });
      }

      if (!filteredContacts.length) {
        const emptyTr = document.createElement('tr');
        const emptyTd = document.createElement('td');
        emptyTd.colSpan = visibleColumns.length + 2;
        emptyTd.style.textAlign = 'center';
        emptyTd.style.padding = '2rem';
        emptyTd.style.color = '#666';
        emptyTd.style.fontStyle = 'italic';
        const total = state.contacts.length;
        if (!total) {
          emptyTd.textContent = 'No contacts loaded for this project. Confirm the active project under Settings → Projects, then refresh the page.';
        } else if (activeFilteredContactClass) {
          emptyTd.textContent = `No contacts in the “${activeFilteredContactClass}” class (${total} contact${total === 1 ? '' : 's'} in other classes). Open Contacts from the menu or pick another class.`;
        } else {
          emptyTd.textContent = `No contacts match the current filters (${total} loaded). Clear search fields and column filters above the table.`;
        }
        emptyTr.appendChild(emptyTd);
        els.contactsTable.appendChild(emptyTr);
      }

      filteredContacts.forEach((contact) => {
          const tr = document.createElement('tr');
          const checkTd = document.createElement('td');
          const rowCheck = document.createElement('input');
          rowCheck.type = 'checkbox';
          rowCheck.className = 'contact-row-check';
          rowCheck.value = contact.id;
          checkTd.appendChild(rowCheck);
          tr.appendChild(checkTd);
          
          visibleColumns.forEach((column) => {
            const td = document.createElement('td');
            appendContactCell(td, column.key, contactValue(contact, column.key));
            tr.appendChild(td);
          });
          const actionsTd = document.createElement('td');
          actionsTd.className = 'actions-col';
          const viewBtn = App.makeIconButton('view', 'View Contact', () => openViewPage(contact));
          const editBtn = App.makeIconButton('edit', 'Edit Contact', () => openEditPage(contact), { marginLeft: '8px' });
          const cloneBtn = App.makeIconButton('copy', 'Clone Contact', () => openClonePage(contact), { marginLeft: '8px' });
          const deleteBtn = App.makeIconButton('delete', 'Delete Contact', () => deleteContactRecord(contact), { danger: true, marginLeft: '8px' });
          actionsTd.appendChild(viewBtn);
          actionsTd.appendChild(editBtn);
          actionsTd.appendChild(cloneBtn);
          actionsTd.appendChild(deleteBtn);
          tr.appendChild(actionsTd);
          els.contactsTable.appendChild(tr);
        });
    }

    renderExploreContactFilters();
    renderExploreContactsResults();
  }

  function renderContactsSettingsNav(activePageId) {
    const wrap = document.getElementById('contactsSectionSettingsNavList');
    if (!wrap) return;
    wrap.innerHTML = '';
    SECTION_SETTINGS_LINKS.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.className = 'section-settings-nav-btn' + (item.pageId === activePageId ? ' is-active' : '');
      button.disabled = item.pageId === activePageId;
      button.addEventListener('click', function () {
        const target = String(item.pageId || '').trim();
        const page = document.getElementById(target);
        if (page && page.classList.contains('app-page')) {
          App.setActivePage(target);
        } else {
          notify(item.label + ' is not set up yet.');
        }
      });
      wrap.appendChild(button);
    });
  }

  function renderContactsDefaultColumnsSettings() {
    const wrap = document.getElementById('contactsDefaultColumnsGrid');
    if (!wrap) return;
    wrap.innerHTML = '';
    const visible = new Set(readContactsSettings().defaultVisibleColumns);
    CONTACTS_TABLE_COLUMNS.forEach((column) => {
      const label = document.createElement('label');
      label.className = 'checkbox-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = column.key;
      checkbox.checked = visible.has(column.key);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(column.label));
      wrap.appendChild(label);
    });
  }

  function renderContactsSettingsPage() {
    renderContactsDefaultColumnsSettings();
    renderContactsSettingsNav('contactsSettingsPage');
    
    // Auto-load reference options the first time it opens
    const catSelect = document.getElementById('contactsOptionCategorySelect');
    if (catSelect) {
      loadContactReferenceOptions(catSelect.value);
    }
  }

  async function loadContactReferenceOptions(category) {
    try {
      const res = await api(`/api/settings/contacts/${category}?active=false`);
      state.availableReferenceOptions[category] = res.options || [];
      renderContactReferenceOptions(category);
    } catch (err) {
      notify(`Failed to load ${category}: ${err.message}`, true);
    }
  }

  function renderContactReferenceOptions(category) {
    const tbody = document.getElementById('contactsOptionsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const items = state.availableReferenceOptions[category] || [];
    
    // Dynamically update the table headers based on category
    const dynamicHeading = document.getElementById('settingsOptionsDynamicLabelHeading');
    const dynamicTitle = document.getElementById('addContactOptionLabelTitle');
    let titleText = 'Segment Type';
    if (category === 'statuses') titleText = 'Status Name';
    else if (category === 'types') titleText = 'Contact Type Name';
    else if (category === 'sources') titleText = 'Source Name';
    
    if (dynamicHeading) dynamicHeading.textContent = titleText;
    if (dynamicTitle) dynamicTitle.textContent = titleText;

    if (items.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'meta';
      td.style.textAlign = 'center';
      td.textContent = 'No options found.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    items.forEach(item => {
      const tr = document.createElement('tr');
      
      const keyTd = document.createElement('td');
      keyTd.textContent = item.key || item.name || item.id || '';
      
      const labelTd = document.createElement('td');
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = item.label || item.name || item.key || '';
      labelInput.style.width = '100%';
      labelTd.appendChild(labelInput);

      const orderTd = document.createElement('td');
      const orderInput = document.createElement('input');
      orderInput.type = 'number';
      orderInput.value = item.sort_order || 0;
      orderInput.style.width = '60px';
      orderTd.appendChild(orderInput);

      const activeTd = document.createElement('td');
      const activeInput = document.createElement('input');
      activeInput.type = 'checkbox';
      activeInput.checked = !!item.is_active;
      activeTd.appendChild(activeInput);

      const actionTd = document.createElement('td');
      actionTd.className = 'contacts-actions-cell';
      
      const saveChanges = async () => {
        try {
          if (!item.id) return; // Wait until record has a DB ID
          await api(`/api/settings/contacts/${category}/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              label: labelInput.value,
              sort_order: parseInt(orderInput.value, 10),
              is_active: activeInput.checked
            })
          });
          notify('Option autosaved', false, 1500);
          loadContactReferenceOptions(category);
        } catch (err) {
          notify(`Autosave failed: ${err.message}`, true);
        }
      };

      // Auto-save on change
      labelInput.addEventListener('change', saveChanges);
      orderInput.addEventListener('change', saveChanges);
      activeInput.addEventListener('change', saveChanges);
      
      const delBtn = App.makeIconButton('delete', 'Delete Option', async () => {
        if (!confirm('Are you sure you want to delete this option?')) return;
        try {
          if (item.id) {
            await api(`/api/settings/contacts/${category}/${item.id}`, { method: 'DELETE' });
          }
          notify('Option deleted');
          loadContactReferenceOptions(category);
        } catch (err) {
          notify(`Delete failed: ${err.message}`, true);
        }
      }, { danger: true });
      
      actionTd.appendChild(delBtn);

      tr.appendChild(labelTd);
      tr.appendChild(keyTd);
      tr.appendChild(orderTd);
      tr.appendChild(activeTd);
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });
  }

  function getSelectedContactIds() {
    return [...document.querySelectorAll('#contactsTable input.contact-row-check:checked')]
      .map((el) => String(el.value || '').trim())
      .filter(Boolean);
  }

  async function fetchProjectsForMembershipPicker() {
    try {
      const { projects } = await loadAccessibleProjects();
      return projects;
    } catch (err) {
      notify(err.message, true);
      return Array.isArray(state.projects) ? state.projects : [];
    }
  }

  async function openAddContactToProjectsModal() {
    const contactIds = getSelectedContactIds();
    if (!contactIds.length) {
      notify('Select at least one contact in the table', true);
      return;
    }
    if (!App.components?.Modal) {
      notify('Modal component is not available', true);
      return;
    }

    const projects = await fetchProjectsForMembershipPicker();
    if (!projects.length) {
      notify('No projects available', true);
      return;
    }

    const currentId = String(state.currentProjectId || '').trim();
    let memberProjectIds = new Set();
    if (contactIds.length === 1) {
      try {
        const res = await api(`/api/contacts/${encodeURIComponent(contactIds[0])}/project-memberships`);
        const ids = Array.isArray(res?.projectIds)
          ? res.projectIds
          : (Array.isArray(res?.data) ? res.data : []);
        memberProjectIds = new Set(ids.map((id) => String(id).trim()).filter(Boolean));
      } catch (_) {
        // Non-fatal — user can still pick projects.
      }
    }

    const body = document.createElement('div');
    body.className = 'contact-add-projects-modal-body';
    const intro = document.createElement('p');
    intro.className = 'contact-add-projects-modal-intro';
    intro.textContent = contactIds.length === 1
      ? 'Select projects for this contact. Projects where they already appear are checked and cannot be removed here.'
      : `Select projects to add ${contactIds.length} contacts to.`;
    body.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'contact-add-projects-list';

    projects.forEach((project) => {
      const id = String(project?.id || '').trim();
      if (!id) return;
      const name = String(project.name || project.slug || id);
      const label = document.createElement('label');
      label.className = 'contact-add-projects-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = id;
      cb.className = 'standard-form-checkbox';
      if (memberProjectIds.has(id)) {
        cb.checked = true;
        cb.disabled = true;
      }
      const text = document.createElement('span');
      text.textContent = id === currentId ? `${name} (current)` : name;
      label.appendChild(cb);
      label.appendChild(text);
      list.appendChild(label);
    });
    body.appendChild(list);

    const modal = App.components.Modal({
      title: 'Add to Project',
      body,
      dialogClass: 'contact-add-projects-modal',
      actions: [
        {
          label: 'Cancel',
          onClick: () => modal.close(),
        },
        {
          label: 'Add to Projects',
          primary: true,
          onClick: async () => {
            const projectIds = [...list.querySelectorAll('input[type="checkbox"]:not(:disabled):checked')]
              .map((el) => String(el.value || '').trim())
              .filter(Boolean);
            if (!projectIds.length) {
              notify('Select at least one project', true);
              return;
            }
            try {
              const res = await api('/api/contacts/assign-to-projects', {
                method: 'POST',
                body: JSON.stringify({ contactIds, projectIds }),
              });
              const added = Array.isArray(res?.added)
                ? res.added
                : (Array.isArray(res?.data?.added) ? res.data.added : []);
              const skipped = Array.isArray(res?.skipped)
                ? res.skipped
                : (Array.isArray(res?.data?.skipped) ? res.data.skipped : []);
              modal.close();
              if (added.length) {
                notify(`Added to ${added.length} project${added.length === 1 ? '' : 's'}`);
                await App.refresh();
                renderContacts();
              } else if (skipped.length) {
                notify(String(skipped[0]?.error || 'Already in selected project(s)'), true);
              } else {
                notify('No projects were updated', true);
              }
            } catch (err) {
              notify(err.message, true);
            }
          },
        },
      ],
    });
    modal.open();
  }

  function renderContactsTableHead() {
    const thead = document.getElementById('contactsTableHead');
    if (!thead) return;
    const visibleColumns = getVisibleContactsColumns();
    const colsStr = visibleColumns.map(c => c.key).join(',');
    if (thead.dataset.renderedCols === colsStr) return; // Prevent focus-destroying DOM teardowns
    
    thead.dataset.renderedCols = colsStr;
    thead.innerHTML = '';

    const filterRow = document.createElement('tr');
    filterRow.className = 'table-filter-row contacts-filter-row';
    const checkTh = document.createElement('th');
    checkTh.className = 'contacts-go-cell';
    const checkAll = document.createElement('input');
    checkAll.id = 'contactsCheckAll';
    checkAll.type = 'checkbox';
    checkAll.title = 'Select all filtered contacts';
    checkAll.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      const checkboxes = document.querySelectorAll('#contactsTable tbody input.contact-row-check');
      checkboxes.forEach(cb => { cb.checked = isChecked; });
    });
    checkTh.appendChild(checkAll);
    filterRow.appendChild(checkTh);

    visibleColumns.forEach((column) => {
      const th = document.createElement('th');
      const isRefOption = ['status', 'contact_type', 'source'].includes(column.key);
      const isSelectFilter = column.key === 'comments_campaign' || column.key === 'comments_topic' || isRefOption;
      const isSocialFilter = ['youtube', 'instagram', 'tiktok', 'facebook', 'x', 'bluesky', 'patreon', 'linkedin', 'substack', 'medium'].includes(column.key);

      if (isSocialFilter) {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'flex-start';
        container.style.gap = '6px';
        container.style.cursor = 'pointer';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.title = `Has ${column.label}`;
        checkbox.id = `filterCheckbox_${column.key}`;
        checkbox.checked = !!state.contactsFilters[column.key];
        
        const label = document.createElement('label');
        label.textContent = `Has ${column.label}`;
        label.htmlFor = checkbox.id;
        label.style.marginBottom = '0';
        label.style.fontWeight = 'normal';
        label.style.fontSize = '0.85em';
        label.style.cursor = 'pointer';
        label.style.whiteSpace = 'nowrap';
        
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            state.contactsFilters[column.key] = true;
          } else {
            delete state.contactsFilters[column.key];
          }
          renderContacts();
        });
        
        container.appendChild(checkbox);
        container.appendChild(label);
        th.appendChild(container);
      } else if (isSelectFilter) {
        const select = document.createElement('select');
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = column.filterPlaceholder;
        select.appendChild(defaultOption);

        let optionsData = [];
        if (column.key === 'comments_campaign') {
          optionsData = (state.availableCampaigns || []).map((c) => ({ value: c.id, label: c.name }));
        } else if (column.key === 'comments_topic') {
          optionsData = (state.availableTopics || []).map((t) => ({ 
              value: typeof t === 'object' ? (t.topic || t.name || '') : t, 
              label: typeof t === 'object' ? (t.topic || t.name || '') : t 
            }));
        } else if (column.key === 'status') {
          optionsData = (state.availableReferenceOptions.statuses || []).map((opt) => ({ value: opt.key, label: opt.label }));
        } else if (column.key === 'contact_type') {
          optionsData = (state.availableReferenceOptions.types || []).map((opt) => ({ value: opt.key, label: opt.label }));
        } else if (column.key === 'source') {
          optionsData = (state.availableReferenceOptions.sources || []).map((opt) => ({ value: opt.key, label: opt.label }));
        }


        optionsData.forEach(opt => {
          if (!opt.value) return;
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.label;
          const currentFilter = state.contactsFilters[column.key];
          if (String(currentFilter) === String(opt.value)) {
            option.selected = true;
          }
          select.appendChild(option);
        });

        select.addEventListener('change', () => {
          const val = select.value;
          if (!val) {
            delete state.contactsFilters[column.key];
          } else {
            state.contactsFilters[column.key] = val;
          }
          renderContacts();
        });
        th.appendChild(select);
      } else {
        const isDateField = column.key === 'created_at' || column.key === 'updated_at' || column.key.includes('date');
        if (isDateField) {
          const container = document.createElement('div');
          container.style.display = 'flex';
          container.style.flexDirection = 'column';
          container.style.gap = '4px';
          const filterState = state.contactsFilters[column.key] || { from: '', to: '' };
          
          const fromInput = document.createElement('input');
          fromInput.type = 'date';
          fromInput.title = 'From: ' + column.label;
          fromInput.value = filterState.from || '';

          const toInput = document.createElement('input');
          toInput.type = 'date';
          toInput.title = 'To: ' + column.label;
          toInput.value = filterState.to || '';

          const updateDateRange = () => {
            const f = fromInput.value;
            const t = toInput.value;
            if (!f && !t) {
              delete state.contactsFilters[column.key];
            } else {
              state.contactsFilters[column.key] = { from: f, to: t };
            }
            renderContacts();
          };

          fromInput.addEventListener('change', updateDateRange);
          toInput.addEventListener('change', updateDateRange);

          container.appendChild(fromInput);
          container.appendChild(toInput);
          th.appendChild(container);
        } else {
          const input = document.createElement('input');
          input.type = 'text';
          input.placeholder = column.filterPlaceholder;
          const currentVal = state.contactsFilters[column.key];
          input.value = (currentVal && typeof currentVal !== 'object') ? String(currentVal) : '';
          input.addEventListener('input', () => {
            const val = String(input.value || '').trim().toLowerCase();
            if (!val) {
              delete state.contactsFilters[column.key];
            } else {
              state.contactsFilters[column.key] = val;
            }
            renderContacts();
          });
          th.appendChild(input);
        }
      }
      filterRow.appendChild(th);
    });

    const actionsFilterTh = document.createElement('th');
    actionsFilterTh.className = 'contacts-go-cell actions-col';
    const addToProjectBtn = document.createElement('button');
    addToProjectBtn.type = 'button';
    addToProjectBtn.className = 'btn tiny-btn';
    addToProjectBtn.textContent = 'Add to Project';
    addToProjectBtn.addEventListener('click', () => {
      openAddContactToProjectsModal().catch((err) => notify(err.message, true));
    });
    actionsFilterTh.appendChild(addToProjectBtn);
    filterRow.appendChild(actionsFilterTh);
    thead.appendChild(filterRow);

    const headerRow = document.createElement('tr');
    headerRow.appendChild(document.createElement('th'));
    visibleColumns.forEach((column) => {
      const th = document.createElement('th');
      th.textContent = column.label;
      th.style.cursor = 'pointer';
      th.title = `Sort by ${column.label}`;
      
      if (state.contactsSortColumn === column.key) {
        th.textContent += state.contactsSortDirection === 'asc' ? ' ↑' : ' ↓';
      }
      
      th.addEventListener('click', () => {
        if (state.contactsSortColumn === column.key) {
          state.contactsSortDirection = state.contactsSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.contactsSortColumn = column.key;
          state.contactsSortDirection = 'asc';
        }
        renderContacts();
      });
      headerRow.appendChild(th);
    });
    const actionsTh = document.createElement('th');
    actionsTh.className = 'actions-col';
    actionsTh.textContent = 'Actions';
    headerRow.appendChild(actionsTh);
    thead.appendChild(headerRow);
  }

  async function loadExploreReferenceOptions() {
    try {
      const [formsRes, campRes, topicRes, statusesRes, typesRes, sourcesRes] = await Promise.all([
        api('/api/develop/forms').catch(() => ({ forms: [] })),
        api('/api/campaigns').catch(() => ({ campaigns: [] })),
        api('/api/acquire/youtube-topics').catch(() => ({ topics: [] })),
        api('/api/settings/contacts/statuses?active=true').catch(() => ({ options: [] })),
        api('/api/settings/contacts/types?active=true').catch(() => ({ options: [] })),
        api('/api/settings/contacts/sources?active=true').catch(() => ({ options: [] }))
      ]);
      const rows = Array.isArray(formsRes?.forms) ? formsRes.forms : (Array.isArray(formsRes?.data) ? formsRes.data : []);
      exploreFormTemplateOptions = rows
        .map((row) => String(row?.name || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
        
      state.availableCampaigns = Array.isArray(campRes?.campaigns) ? campRes.campaigns : [];
      state.availableTopics = Array.isArray(topicRes?.topics) ? topicRes.topics : [];
      state.availableReferenceOptions.statuses = statusesRes?.options || [];
      state.availableReferenceOptions.types = typesRes?.options || [];
      state.availableReferenceOptions.sources = sourcesRes?.options || [];
    } catch (_) {
      exploreFormTemplateOptions = [];
      state.availableCampaigns = [];
      state.availableTopics = [];
    }
  }

  function applyExploreFilters() {
    exploreContactsApplied = true;
    renderContacts();
  }

  function loadExploreSegment(segment) {
    ensureExploreFilterState();
    state.segmentContactsLogicMode = segment?.definition?.logicMode === 'any' ? 'any' : 'all';
    state.segmentContactsLogicTokens = Array.isArray(segment?.definition?.logicTokens)
      ? segment.definition.logicTokens.map((token) => String(token || '').toUpperCase())
      : tokenizeLogicExpression(segment?.definition?.logic || '');
    state.segmentContactsLogicExpression = String(segment?.definition?.logic || '').trim();
    state.segmentContactsLogicSelectedIndex = -1;
    const filterConfig = segment?.definition?.filters;
    if (filterConfig && typeof filterConfig === 'object') {
      EXPLORE_CONTACT_FIELDS.forEach(({ key }) => {
        const current = filterConfig[key];
        state.segmentContactsFilters[key] = {
          mode: String(current?.mode || 'contains'),
          value: String(current?.value || ''),
        };
      });
    } else {
      EXPLORE_CONTACT_FIELDS.forEach(({ key }) => {
        state.segmentContactsFilters[key] = { mode: 'contains', value: '' };
      });
      (Array.isArray(segment?.rules) ? segment.rules : []).forEach((rule) => {
        const key = String(rule?.field || '').trim();
        if (!key || !state.segmentContactsFilters[key]) return;
        state.segmentContactsFilters[key] = {
          mode: String(rule?.operator || 'contains'),
          value: String(rule?.value || ''),
        };
      });
    }
    lastSuggestedSegmentName = '';
    lastSuggestedLogicExpression = '';
    exploreContactsApplied = true;
    App.setActivePage('contactsExplorePage');
    renderContacts();
  }

  // ---------------------------------------------------------------------------
  // CSV import helpers (shared with promoLeads module)
  // ---------------------------------------------------------------------------

  function generateMissingColumnsSql(columns) {
    if (!columns.length) return '';
    const typeFor = { text: 'text', number: 'double precision', boolean: 'boolean',
                      date: 'date', select: 'text', multi_select: 'text[]' };
    return columns
      .map((m) => `alter table public.promo_leads add column if not exists ${m.targetKey} ${typeFor[m.type] || 'text'};`)
      .join('\n');
  }

  async function updateCsvDbStatuses() {
    const included = state.csvMappings
      .filter((m) => m.include)
      .map((m) => normalizeKey(m.targetKey))
      .filter(Boolean);
    if (!included.length) return;
    try {
      const res = await api('/api/promo-leads/columns/check', {
        method: 'POST',
        body: JSON.stringify({ columns: included })
      });
      const map = new Map((res.columns || []).map((c) => [String(c.column || ''), c]));
      state.csvMappings.forEach((m) => {
        const key = normalizeKey(m.targetKey);
        const hit = map.get(key);
        m.dbExists = hit ? !!hit.exists : null;
        m.dbError  = hit?.error || null;
      });
    } catch (err) {
      state.csvMappings.forEach((m) => { m.dbExists = null; m.dbError = err.message; });
    }
  }

  function renderCsvMappings() {
    els.csvMapperTable.innerHTML = '';
    const existingCustom = new Set(state.promoFields.map((f) => String(f.key || '')));

    state.csvMappings.forEach((map, idx) => {
      const tr = document.createElement('tr');
      const typeOptions = ['text','number','boolean','date','select','multi_select']
        .map((t) => `<option value="${t}" ${map.type === t ? 'selected' : ''}>${t}</option>`)
        .join('');

      const targetKey = normalizeKey(map.targetKey);
      let dbStatusText = 'unknown';
      let dbStatusClass = 'status-pill';
      if (!map.include) {
        dbStatusText = 'skipped';
        dbStatusClass += ' status-ok';
      } else if (!targetKey) {
        dbStatusText = 'invalid key';
        dbStatusClass += ' status-bad';
      } else if (!isStandardLeadColumn(targetKey) && (map.createField || existingCustom.has(targetKey))) {
        dbStatusText = 'custom field';
        dbStatusClass += ' status-ok';
      } else if (map.dbExists === true) {
        dbStatusText = 'exists';
        dbStatusClass += ' status-ok';
      } else if (map.dbExists === false) {
        dbStatusText = 'missing in table';
        dbStatusClass += ' status-bad';
      } else if (map.dbError) {
        dbStatusText = 'check failed';
        dbStatusClass += ' status-warn';
      }

      const tdHeader = document.createElement('td');
      tdHeader.textContent = map.header;
      tr.appendChild(tdHeader);

      const tdInclude = document.createElement('td');
      const cbInclude = document.createElement('input');
      cbInclude.type = 'checkbox';
      cbInclude.dataset.idx = idx;
      cbInclude.dataset.field = 'include';
      cbInclude.checked = !!map.include;
      tdInclude.appendChild(cbInclude);
      tr.appendChild(tdInclude);

      const tdTargetKey = document.createElement('td');
      const inTargetKey = document.createElement('input');
      inTargetKey.dataset.idx = idx;
      inTargetKey.dataset.field = 'targetKey';
      inTargetKey.value = String(map.targetKey || '');
      tdTargetKey.appendChild(inTargetKey);
      tr.appendChild(tdTargetKey);

      const tdType = document.createElement('td');
      const selType = document.createElement('select');
      selType.dataset.idx = idx;
      selType.dataset.field = 'type';
      ['text','number','boolean','date','select','multi_select'].forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (map.type === t) opt.selected = true;
        selType.appendChild(opt);
      });
      tdType.appendChild(selType);
      tr.appendChild(tdType);

      const tdStatus = document.createElement('td');
      const spStatus = document.createElement('span');
      spStatus.className = dbStatusClass;
      spStatus.textContent = dbStatusText;
      tdStatus.appendChild(spStatus);
      tr.appendChild(tdStatus);

      const tdCreate = document.createElement('td');
      const cbCreate = document.createElement('input');
      cbCreate.type = 'checkbox';
      cbCreate.dataset.idx = idx;
      cbCreate.dataset.field = 'createField';
      cbCreate.checked = !!map.createField;
      tdCreate.appendChild(cbCreate);
      tr.appendChild(tdCreate);

      const tdOptions = document.createElement('td');
      const inOptions = document.createElement('input');
      inOptions.dataset.idx = idx;
      inOptions.dataset.field = 'optionsText';
      inOptions.value = String(map.optionsText || '');
      inOptions.placeholder = 'A,B,C';
      tdOptions.appendChild(inOptions);
      tr.appendChild(tdOptions);

      els.csvMapperTable.appendChild(tr);
    });

    els.csvMapperTable.querySelectorAll('input,select').forEach((control) => {
      control.addEventListener('change', () => {
        const idx   = Number(control.dataset.idx);
        const field = control.dataset.field;
        if (!state.csvMappings[idx]) return;
        state.csvMappings[idx][field] = control.type === 'checkbox' ? control.checked : control.value;
        updateCsvDbStatuses().then(() => renderCsvMappings());
      });
    });

    const missingReal = state.csvMappings.filter((m) => {
      const key = normalizeKey(m.targetKey);
      return m.include && key && isStandardLeadColumn(key) && m.dbExists === false;
    });
    const sql = generateMissingColumnsSql(missingReal);
    if (sql) {
      els.csvMissingSql.value = `Run this in Supabase SQL Editor before import:\n\n${sql}`;
      els.csvMissingSql.classList.remove('hidden');
    } else {
      els.csvMissingSql.value = '';
      els.csvMissingSql.classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  function init() {
    ensureExploreFilterState();

    const contactsActionRow = document.querySelector('#contactsPage .page-heading-actions');
    if (contactsActionRow && !contactsActionRow.dataset.markerBound) {
      contactsActionRow.dataset.markerBound = 'true';
      const markerBtn = App.makeIconButton('settings', 'Settings', () => {
        App.setActivePage('contactsSettingsPage');
      });
      markerBtn.className = 'section-settings-gear-btn';
      contactsActionRow.appendChild(markerBtn);
    }

    const createMashupBtn = document.getElementById('createMashupBtn');
    const executeMashupBtn = document.getElementById('executeMashupSynthesisBtn');
    const openTagsModalBtn = document.getElementById('mashupOpenTagsModalBtn');
    const saveTagsBtn = document.getElementById('mashupSaveTagsBtn');
    
    // Lazy loaded tags cache
    let availableSystemTags = null;

    if (createMashupBtn && !createMashupBtn.dataset.bound) {
      createMashupBtn.dataset.bound = 'true';
      createMashupBtn.addEventListener('click', () => {
        const checkedValues = Array.from(document.querySelectorAll('.contact-row-check:checked')).map(el => el.value);
        if (!checkedValues.length) {
           return notify('Please select at least one contact to synthesize natively.', true);
        }
        
        let contactsHtml = '';
        const selectedContacts = (state.contacts || []).filter(c => checkedValues.includes(String(c.id)));
        selectedContacts.forEach(c => {
           let linkHtml = '';
           if (c.youtube) linkHtml = `<a href="${safeText(c.youtube)}" target="_blank" style="margin-left: 0.5rem; font-size: 0.85em; text-decoration: underline;">[YouTube]</a>`;
           else if (c.instagram) linkHtml = `<a href="${safeText(c.instagram)}" target="_blank" style="margin-left: 0.5rem; font-size: 0.85em; text-decoration: underline;">[Instagram]</a>`;
           else if (c.tiktok) linkHtml = `<a href="${safeText(c.tiktok)}" target="_blank" style="margin-left: 0.5rem; font-size: 0.85em; text-decoration: underline;">[TikTok]</a>`;
           else if (c.x) linkHtml = `<a href="${safeText(c.x)}" target="_blank" style="margin-left: 0.5rem; font-size: 0.85em; text-decoration: underline;">[X]</a>`;
           else if (c.linkedin) linkHtml = `<a href="${safeText(c.linkedin)}" target="_blank" style="margin-left: 0.5rem; font-size: 0.85em; text-decoration: underline;">[LinkedIn]</a>`;
           
           const name = ((c.first_name || c.firstName || '') + ' ' + (c.middle_name || c.middleName || '') + ' ' + (c.last_name || c.lastName || '')).replace(/\s+/g, ' ').trim();
           const display = name.trim() ? name.trim() : (c.company || c.email || 'Unknown Contact');
           contactsHtml += `<div style="padding: 0.3rem 0; border-bottom: 1px dotted var(--border-color);">${safeText(display)}${linkHtml}</div>`;
        });
        
        const mashupContainer = document.getElementById('mashupSelectedContacts');
        if (mashupContainer) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(contactsHtml, 'text/html');
          mashupContainer.textContent = '';
          Array.from(doc.body.childNodes).forEach((node) => mashupContainer.appendChild(node.cloneNode(true)));
        }
        document.getElementById('mashupPersonalityName').value = '';
        
        const topicSelect = document.getElementById('mashupTopicFocus');
        topicSelect.textContent = '';
        topicSelect.appendChild(new Option('No Filter (Synthesize holistic voice profile)', ''));
        if (state.availableTopics && state.availableTopics.length) {
            state.availableTopics.forEach(topic => {
                const opt = document.createElement('option');
                const tName = typeof topic === 'object' ? (topic.topic || topic.name || '') : topic;
                opt.value = opt.textContent = tName;
                topicSelect.appendChild(opt);
            });
        }
        
        document.getElementById('mashupSelectedTags').value = '';
        document.getElementById('mashupTagsDisplay').textContent = 'No tags selected';
        
        document.getElementById('mashupPersonalityModal').classList.remove('hidden');
      });
    }

    if (openTagsModalBtn && !openTagsModalBtn.dataset.bound) {
      openTagsModalBtn.dataset.bound = 'true';
      openTagsModalBtn.addEventListener('click', async () => {
         if (!availableSystemTags) {
             try {
                const res = await api('/api/messaging/tags?limit=5000');
                if (Array.isArray(res?.tags)) availableSystemTags = res.tags.map(t => typeof t === 'object' ? (t.tag || t.name || '') : t);
                else availableSystemTags = [];
             } catch (e) {
                console.warn('Failed to load global tags, falling back to empty', e);
                availableSystemTags = [];
             }
         }
         
         const tbody = document.getElementById('mashupTagsModalList');
         tbody.innerHTML = '';
         
         const currentlySelected = (document.getElementById('mashupSelectedTags').value || '').split(',').filter(Boolean);
         
         if (availableSystemTags.length === 0) {
             const emptyRow = document.createElement('tr');
             const emptyTd = document.createElement('td');
             emptyTd.style.padding = '1rem';
             emptyTd.style.color = 'var(--muted)';
             emptyTd.textContent = 'No tags available globally.';
             emptyRow.appendChild(emptyTd);
             tbody.appendChild(emptyRow);
         } else {
             availableSystemTags.forEach(tag => {
                 const tagTitle = (typeof tag === 'string') ? tag : (tag.name || String(tag));
                 const row = document.createElement('tr');
                 
                 const td = document.createElement('td');
                 td.style.padding = '0.5rem';
                 td.style.borderBottom = '1px solid var(--border-color)';
                 td.style.textAlign = 'left';
                 
                 const label = document.createElement('label');
                 label.style.display = 'flex';
                 label.style.alignItems = 'center';
                 label.style.gap = '0.5rem';
                 label.style.cursor = 'pointer';
                 label.style.margin = '0';
                 
                 const checkbox = document.createElement('input');
                 checkbox.type = 'checkbox';
                 checkbox.className = 'mashup-tag-checkbox';
                 checkbox.value = tagTitle;
                 if (currentlySelected.includes(tagTitle)) checkbox.checked = true;
                 
                 label.appendChild(checkbox);
                 label.appendChild(document.createTextNode(' ' + tagTitle));
                 
                 td.appendChild(label);
                 row.appendChild(td);
                 tbody.appendChild(row);
             });
         }
         document.getElementById('mashupTagsModal').classList.remove('hidden');
      });
    }

    if (saveTagsBtn && !saveTagsBtn.dataset.bound) {
       saveTagsBtn.dataset.bound = 'true';
       saveTagsBtn.addEventListener('click', () => {
           const checks = Array.from(document.querySelectorAll('.mashup-tag-checkbox:checked')).map(el => el.value);
           document.getElementById('mashupSelectedTags').value = checks.join(',');
           document.getElementById('mashupTagsDisplay').textContent = checks.length ? checks.join(', ') : 'No tags selected';
           document.getElementById('mashupTagsModal').classList.add('hidden');
       });
    }

    if (executeMashupBtn && !executeMashupBtn.dataset.bound) {
      executeMashupBtn.dataset.bound = 'true';
      executeMashupBtn.addEventListener('click', async () => {
        const checked = Array.from(document.querySelectorAll('.contact-row-check:checked')).map(el => el.value);
        const personaName = document.getElementById('mashupPersonalityName').value.trim();
        const topicFocus = document.getElementById('mashupTopicFocus').value.trim();
        const tagsRaw = document.getElementById('mashupSelectedTags').value.trim();
        const tags = tagsRaw ? tagsRaw.split(',') : [];
        
        if (!personaName) return notify('Please provide a designation for the hybrid personality securely.', true);
        
        const payload = { contactIds: checked, personaName, topicFocus, tags };
        try {
           executeMashupBtn.textContent = 'Synthesizing...';
           executeMashupBtn.disabled = true;
           const result = await api('/api/contact-personas/mashup', { method: 'POST', body: JSON.stringify(payload) });
           notify('Personality synthesized successfully directly into Personalities Matrix!');
           document.getElementById('mashupPersonalityModal').classList.add('hidden');
           
           if (window.App && App.contactPersonas && typeof App.contactPersonas.refresh === 'function') {
               App.contactPersonas.refresh().catch(() => {});
           }
        } catch (err) {
           notify(`Synthesis failed: ${err.message}`, true);
        } finally {
           executeMashupBtn.textContent = 'Generate Personality';
           executeMashupBtn.disabled = false;
        }
      });
    }

    const contactsSettingsBackBtn = document.getElementById('contactsSettingsBackBtn');
    if (contactsSettingsBackBtn && !contactsSettingsBackBtn.dataset.bound) {
      contactsSettingsBackBtn.dataset.bound = 'true';
      contactsSettingsBackBtn.addEventListener('click', () => App.setActivePage('contactsPage'));
    }
    const contactsDefaultColumnsForm = document.getElementById('contactsDefaultColumnsForm');
    if (contactsDefaultColumnsForm && !contactsDefaultColumnsForm.dataset.bound) {
      contactsDefaultColumnsForm.dataset.bound = 'true';
      contactsDefaultColumnsForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const checked = Array.from(document.querySelectorAll('#contactsDefaultColumnsGrid input[type="checkbox"]:checked'))
          .map((input) => String(input.value || '').trim())
          .filter(Boolean);
        writeContactsSettings({ defaultVisibleColumns: checked });
        renderContactsSettingsPage();
        renderContacts();
        notify('Contacts default columns saved');
      });
    }
    
    // Reference Options Select
    const contactsOptionCategorySelect = document.getElementById('contactsOptionCategorySelect');
    if (contactsOptionCategorySelect && !contactsOptionCategorySelect.dataset.bound) {
      contactsOptionCategorySelect.dataset.bound = 'true';
      contactsOptionCategorySelect.addEventListener('change', (e) => {
        loadContactReferenceOptions(e.target.value);
      });
    }

    // Add Reference Option Form
    const addContactOptionForm = document.getElementById('addContactOptionForm');
    if (addContactOptionForm && !addContactOptionForm.dataset.bound) {
      addContactOptionForm.dataset.bound = 'true';
      addContactOptionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const category = contactsOptionCategorySelect ? contactsOptionCategorySelect.value : 'statuses';
        const formData = new FormData(addContactOptionForm);
        const payload = {
          key: formData.get('key'),
          label: formData.get('label'),
          sort_order: parseInt(formData.get('sort_order') || 0, 10),
          is_active: true
        };
        try {
          await api(`/api/settings/contacts/${category}`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          notify('Option added successfully');
          addContactOptionForm.reset();
          loadContactReferenceOptions(category);
        } catch (err) {
          notify(`Add option failed: ${err.message}`, true);
        }
      });
    }

    renderContactsSettingsPage();

    loadExploreReferenceOptions().then(() => renderContacts()).catch(() => {});

    // Contact form
    els.contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!pendingAddContactMeta && App.devAgent?.teamAddContext) {
        pendingAddContactMeta = { ...App.devAgent.teamAddContext };
      }
      if (!returnPageOnSave && pendingAddContactMeta?.returnPageId) {
        returnPageOnSave = pendingAddContactMeta.returnPageId;
      }
      const payload = toContactPayload(els.contactForm);
      if (pendingAddContactMeta?.contactType) {
        payload.contactType = String(pendingAddContactMeta.contactType).trim();
      }
      if (pendingAddContactMeta?.contactClass) {
        payload.contactClass = String(pendingAddContactMeta.contactClass).trim();
      }
      const savedReturnPage = returnPageOnSave;
      const addMeta = pendingAddContactMeta;
      try {
        const res = await api('/api/contacts', { method: 'POST', body: JSON.stringify(payload) });
        const created = res?.contact || res?.data || null;
        els.contactForm.reset();
        notify('Contact created');
        await finishContactCreatedFlow(created, savedReturnPage);
      } catch (err) {
        pendingAddContactMeta = addMeta;
        notify(err.message, true);
      }
    });

    if (els.openAddContactPageBtn) {
      els.openAddContactPageBtn.addEventListener('click', () => {
        openAddPage();
      });
    }
    if (els.backToContactsBtn) {
      els.backToContactsBtn.addEventListener('click', () => {
        openContactsPage();
      });
    }

    if (els.backFromViewContactBtn) {
      els.backFromViewContactBtn.addEventListener('click', () => openContactsPage());
    }
    if (els.backFromEditContactBtn) {
      els.backFromEditContactBtn.addEventListener('click', () => {
        if (returnPageOnSave) {
          App.setActivePage(returnPageOnSave);
          returnPageOnSave = null;
        } else {
          openContactsPage();
        }
      });
    }
    if (els.backFromCloneContactBtn) {
      els.backFromCloneContactBtn.addEventListener('click', () => openContactsPage());
    }
    if (els.editViewedContactBtn) {
      els.editViewedContactBtn.addEventListener('click', () => openEditPage(activeContactId));
    }
    if (els.cloneViewedContactBtn) {
      els.cloneViewedContactBtn.addEventListener('click', () => openClonePage(activeContactId));
    }
    if (els.cloneEditedContactBtn) {
      els.cloneEditedContactBtn.addEventListener('click', () => openClonePage(activeContactId));
    }
    if (els.contactEditForm) {
      els.contactEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = String(els.contactEditId?.value || activeContactId || '').trim();
        if (!id) return notify('Missing contact id', true);
        try {
          await api(`/api/contacts/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(toContactPayload(els.contactEditForm)),
          });
          notify('Contact updated');
          await App.refresh();
          if (returnPageOnSave) {
            App.setActivePage(returnPageOnSave);
            returnPageOnSave = null;
          } else {
            openContactsPage();
          }
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    if (els.contactCloneForm) {
      els.contactCloneForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/api/contacts', {
            method: 'POST',
            body: JSON.stringify(toContactPayload(els.contactCloneForm)),
          });
          els.contactCloneForm.reset();
          notify('Contact cloned');
          await App.refresh();
          openContactsPage();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    // CSV upload
    els.csvUploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = els.csvFileInput.files?.[0];
      if (!file) return notify('Choose a CSV file first', true);
      try {
        const csvText = await parseCsvFile(file);
        const matrix  = parseCsv(csvText);
        if (matrix.length < 2) return notify('CSV needs a header row and at least one data row', true);

        const headers = matrix[0].map((h) => String(h || '').trim());
        const rows    = matrix.slice(1).map((cells) => {
          const row = {};
          headers.forEach((h, i) => { row[h] = cells[i] == null ? '' : String(cells[i]).trim(); });
          return row;
        });

        state.csvHeaders  = headers;
        state.csvRows     = rows;
        state.csvMappings = headers.map((header) => {
          const targetKey = defaultTargetKey(header);
          return { header, include: true, targetKey, type: 'text',
                   createField: !isStandardLeadColumn(targetKey),
                   optionsText: '', dbExists: null, dbError: null };
        });

        await updateCsvDbStatuses();
        renderCsvMappings();
        els.csvMapperWrap.classList.remove('hidden');
        notify(`Analyzed CSV: ${rows.length} rows, ${headers.length} columns`);
      } catch (err) { notify(err.message, true); }
    });

    // CSV import
    els.csvImportBtn.addEventListener('click', async () => {
      if (!state.csvRows.length) return notify('No CSV rows loaded', true);
      try {
        await updateCsvDbStatuses();
        const missingStandard = state.csvMappings.filter((m) => {
          const key = normalizeKey(m.targetKey);
          return m.include && key && isStandardLeadColumn(key) && m.dbExists === false;
        });
        if (missingStandard.length) {
          renderCsvMappings();
          return notify('Import blocked: some mapped standard columns are missing in promo_leads. Run SQL shown above.', true);
        }

        const existingKeys = new Set(state.promoFields.map((f) => String(f.key || '')));
        for (const mapping of state.csvMappings) {
          const targetKey = normalizeKey(mapping.targetKey);
          if (!mapping.include || !targetKey || isStandardLeadColumn(targetKey)) continue;
          if (!mapping.createField || existingKeys.has(targetKey)) continue;
          const payload = {
            key: targetKey, type: mapping.type || 'text',
            label: targetKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            required: false, is_active: true, position: 0,
            options: String(mapping.optionsText || '').split(',').map((s) => s.trim()).filter(Boolean)
          };
          await api('/api/promo-leads/fields', { method: 'POST', body: JSON.stringify(payload) });
          existingKeys.add(targetKey);
        }

        const contacts = state.csvRows.map((row) => {
          const out = {};
          state.csvMappings.forEach((mapping) => {
            if (!mapping.include) return;
            const key = normalizeKey(mapping.targetKey);
            if (!key) return;
            out[key] = parseTypedValue(row[mapping.header], mapping.type);
          });
          return out;
        });

        const result = await api('/api/contacts/import', {
          method: 'POST', body: JSON.stringify({ contacts, contactType: 'lead' })
        });
        notify(`CSV import complete. Imported ${result.imported || 0} contacts`);
        await App.refresh();
      } catch (err) { notify(err.message, true); }
    });

    // Toggle sections
    if (els.importContactsToggleBtn) {
      els.importContactsToggleBtn.addEventListener('click', () => {
        els.csvMapperSection.classList.toggle('hidden');
      });
    }
    if (els.exploreContactsBtn) {
      els.exploreContactsBtn.addEventListener('click', () => {
        App.setActivePage('contactsExplorePage');
        exploreContactsApplied = false;
        renderContacts();
      });
    }
    const contactsPeerSitesBackBtn = document.getElementById('contactsPeerSitesBackBtn');
    if (contactsPeerSitesBackBtn) {
      contactsPeerSitesBackBtn.addEventListener('click', () => openContactsPage());
    }
    const contactsPeerSiteDetailsBackBtn = document.getElementById('contactsPeerSiteDetailsBackBtn');
    if (contactsPeerSiteDetailsBackBtn) {
      contactsPeerSiteDetailsBackBtn.addEventListener('click', () => openPeerSitesPage());
    }
    const contactsPeerSiteDetailsEditBtn = document.getElementById('contactsPeerSiteDetailsEditBtn');
    if (contactsPeerSiteDetailsEditBtn) {
      contactsPeerSiteDetailsEditBtn.addEventListener('click', () => openPeerSiteEditForm(activeWebsitePeerDetail || activeWebsitePeerId));
    }
    const contactsPeerSitesRefreshBtn = document.getElementById('contactsPeerSitesRefreshBtn');
    if (contactsPeerSitesRefreshBtn) {
      contactsPeerSitesRefreshBtn.addEventListener('click', async () => {
        try {
          await refreshWebsitePeers();
          notify('Peer sites refreshed');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    const contactsPeerSiteCancelBtn = document.getElementById('contactsPeerSiteCancelBtn');
    if (contactsPeerSiteCancelBtn) {
      contactsPeerSiteCancelBtn.addEventListener('click', () => resetWebsitePeerForm());
    }
    const contactsPeerSitesAcquireBtn = document.getElementById('contactsPeerSitesAcquireBtn');
    if (contactsPeerSitesAcquireBtn) {
      contactsPeerSitesAcquireBtn.addEventListener('click', function () {
        acquirePeerSiteCandidates().catch(function (err) {
          notify(err.message, true);
        });
      });
    }
    const contactsPeerSitesDiscoverySelectAll = document.getElementById('contactsPeerSitesDiscoverySelectAll');
    if (contactsPeerSitesDiscoverySelectAll) {
      contactsPeerSitesDiscoverySelectAll.addEventListener('change', function () {
        websitePeerDiscoveryResults = websitePeerDiscoveryResults.map((item) => ({
          ...item,
          selected: contactsPeerSitesDiscoverySelectAll.checked,
        }));
        renderWebsitePeerDiscoveryResults();
      });
    }
    const contactsPeerSitesSaveSelectedBtn = document.getElementById('contactsPeerSitesSaveSelectedBtn');
    if (contactsPeerSitesSaveSelectedBtn) {
      contactsPeerSitesSaveSelectedBtn.addEventListener('click', function () {
        saveSelectedWebsitePeerCandidates().catch(function (err) {
          notify(err.message, true);
        });
      });
    }
    const contactsPeerSiteForm = document.getElementById('contactsPeerSiteForm');
    if (contactsPeerSiteForm) {
      populateWebsitePeerTypeSelect();
      resetWebsitePeerForm();
      contactsPeerSiteForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(contactsPeerSiteForm);
        const existingPeer = websitePeers.find((item) => String(item?.id || '') === String(activeWebsitePeerId || '')) || null;
        const payload = {
          source_url: String(formData.get('source_url') || '').trim(),
          site_url: String(formData.get('site_url') || '').trim(),
          title: String(formData.get('title') || '').trim(),
          website_model: String(formData.get('website_model') || '').trim(),
          matched_keywords: String(formData.get('matched_keywords') || '').trim(),
          snippet: String(formData.get('snippet') || '').trim(),
          notes: String(formData.get('notes') || '').trim(),
        };
        if (!payload.site_url) return notify('Website URL is required', true);
        payload.site_type = deriveWebsitePeerScope(payload, existingPeer);
        if (!payload.source_url && state.directAcquireCurrentRun?.source_url) {
          payload.source_url = String(state.directAcquireCurrentRun.source_url || '').trim();
        }
        try {
          if (activeWebsitePeerId) {
            await api(`/api/acquire/website-peers/${encodeURIComponent(activeWebsitePeerId)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
            notify('Peer site updated');
          } else {
            await api('/api/acquire/website-peers', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            notify('Peer site created');
          }
          resetWebsitePeerForm();
          await refreshWebsitePeers();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    if (els.viewSegmentsBtn) {
      els.viewSegmentsBtn.addEventListener('click', () => {
        App.setActivePage('segmentsPage');
      });
    }
    // createSegmentInlineForm logic removed - handled natively by Segment Editor    // Search filters
    const bindFilter = (el, key, bucket) => {
      if (!el) return;
      el.addEventListener('input', () => {
        state[bucket][key] = String(el.value || '').trim().toLowerCase();
        renderContacts();
      });
    };
    bindFilter(els.contactsSearchEmail,     'email',      'contactsFilters');
    bindFilter(els.contactsSearchFirstName, 'first_name', 'contactsFilters');
    bindFilter(els.contactsSearchLastName,  'last_name',  'contactsFilters');
    bindFilter(els.contactsSearchCompany,   'company',    'contactsFilters');
    bindFilter(els.contactsSearchWebsite,   'website',    'contactsFilters');
    bindFilter(els.contactsSearchYoutube,   'youtube',    'contactsFilters');
    bindFilter(els.contactsSearchInstagram, 'instagram',  'contactsFilters');
  }

  return {
    manifest: {
      id: 'contacts',
      label: 'Contacts',
      pageId: 'contactsPage',
      pagePrefixes: ['contacts', 'addContact'],
      secondaryPages: ['addContactPage', 'editContactPage', 'viewContactPage', 'cloneContactPage'],
    },
    init, renderContacts, contactValue, appendContactCell, applyExploreFilters, loadExploreSegment,
    activeExploreFilterRules, exploreFilterDefinition,
    openContactsPage, openFilteredContactsPage, openPeerSitesPage, openViewPage, openAddPage, armTeamMemberCreate, openEditPage, openClonePage,
    onPageActivated(targetPageId) {
      if (targetPageId !== 'contactsPage') {
        document.querySelectorAll('.submenu-link[data-subpage]').forEach(el => el.classList.remove('active'));
      }
      if (
        targetPageId === 'contactsPage'
        || targetPageId === 'contactsExplorePage'
        || targetPageId === 'contactsPeerSitesPage'
      ) {
        if (typeof App.refresh === 'function') {
          App.refresh().catch((err) => notify(err.message, true));
        }
      }
      if (targetPageId === 'contactsSettingsPage') {
        renderContactsSettingsPage();
      }
      if (targetPageId === 'addContactPage') {
        initAddContactFromProjectPanel().catch((err) => notify(err.message, true));
      }
      if (targetPageId === 'contactsExplorePage' && els.exploreContactsFilters && els.segmentsLeadFilters) {
        // Transplant the filter builder back from Segment Editor if it was moved
        els.segmentsLeadFilters.parentNode.insertBefore(els.exploreContactsFilters, els.segmentsLeadFilters);
      }
      if (String(state.activePage || '') === 'contactsPeerSitesPage') {
        refreshWebsitePeers().catch((err) => notify(err.message, true));
      }
    }
  };
})();
