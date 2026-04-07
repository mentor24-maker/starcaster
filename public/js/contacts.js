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

  const EXPLORE_CONTACT_FIELDS = [
    ...CONTACT_DETAIL_FILTER_FIELDS,
    ...SOCIAL_FILTER_FIELDS,
    ...ENGAGEMENT_FILTER_FIELDS,
  ];

  const SOCIAL_FIELD_KEYS = new Set(SOCIAL_FILTER_FIELDS.map((field) => field.key));
  const CONTACT_SETTINGS_KEY = 'alphire:contacts:settings:v1';
  const CONTACTS_DEFAULT_VISIBLE_COLUMNS = ['first_name', 'last_name', 'company', 'email', 'website', 'youtube', 'instagram'];
  const CONTACTS_TABLE_COLUMNS = [
    { key: 'first_name', label: 'First Name', filterPlaceholder: 'First' },
    { key: 'last_name', label: 'Last Name', filterPlaceholder: 'Last' },
    { key: 'company', label: 'Company', filterPlaceholder: 'Company' },
    { key: 'email', label: 'Email', filterPlaceholder: 'Email' },
    { key: 'website', label: 'Website', filterPlaceholder: 'Website' },
    { key: 'youtube', label: 'Youtube', filterPlaceholder: 'Youtube' },
    { key: 'instagram', label: 'Instagram', filterPlaceholder: 'Instagram' },
    { key: 'phone', label: 'Phone', filterPlaceholder: 'Phone' },
    { key: 'city', label: 'City', filterPlaceholder: 'City' },
    { key: 'country', label: 'Country', filterPlaceholder: 'Country' },
    { key: 'tags', label: 'Tags', filterPlaceholder: 'Tags' },
    { key: 'source', label: 'Source', filterPlaceholder: 'Source' },
    { key: 'status', label: 'Status', filterPlaceholder: 'Status' },
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
    'first_name', 'last_name', 'company', 'email', 'phone', 'city', 'country',
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
  let contactsPeerSitesProgressTimer = null;
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
      last_name: 'lastName',
    };
    const payload = { contactType: 'lead' };
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
    App.setActivePage('contactsPage');
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
    const wrap = document.getElementById('contactsPeerSitesAcquireProgressWrap');
    const bar = document.getElementById('contactsPeerSitesAcquireProgressBar');
    const text = document.getElementById('contactsPeerSitesAcquireProgressText');
    const button = document.getElementById('contactsPeerSitesAcquireBtn');
    if (wrap) wrap.classList.remove('hidden');
    if (bar) bar.value = 8;
    if (text) text.textContent = 'Reviewing website content and discovering peer sites...';
    if (button) button.disabled = true;
    if (contactsPeerSitesProgressTimer) clearInterval(contactsPeerSitesProgressTimer);
    contactsPeerSitesProgressTimer = setInterval(function () {
      if (!bar) return;
      const value = Number(bar.value || 0);
      const step = value < 72 ? 5 : (value < 90 ? 2 : 1);
      bar.value = Math.min(value + step, 94);
    }, 320);
  }

  function finishContactsPeerSitesProgress(success, message) {
    const wrap = document.getElementById('contactsPeerSitesAcquireProgressWrap');
    const bar = document.getElementById('contactsPeerSitesAcquireProgressBar');
    const text = document.getElementById('contactsPeerSitesAcquireProgressText');
    const button = document.getElementById('contactsPeerSitesAcquireBtn');
    if (contactsPeerSitesProgressTimer) {
      clearInterval(contactsPeerSitesProgressTimer);
      contactsPeerSitesProgressTimer = null;
    }
    if (bar) bar.value = success ? 100 : 0;
    if (text && message) text.textContent = message;
    if (button) button.disabled = false;
    window.setTimeout(function () {
      if (wrap) wrap.classList.add('hidden');
    }, success ? 900 : 1800);
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
      ['Last Harvested', String(peer?.last_harvested_at || peer?.updated_at || '').trim() || '-'],
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
        ? 'Showing full harvested website details from the linked Acquire: Web run.'
        : 'Showing the persisted website record. Full harvested details are only available when this website has its own direct website harvest.';
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

  function openEditPage(contactOrId) {
    const contact = typeof contactOrId === 'object' ? contactOrId : findContactById(contactOrId);
    if (!contact || !els.contactEditForm) {
      notify('Contact not found', true);
      return;
    }
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
    return App.CONTACT_COLUMN_KEYS.every((key) => {
      const needle = String(filters[key] || '').toLowerCase();
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
    if (els.createSegmentInlineForm) {
      els.createSegmentInlineForm.classList.toggle('hidden', !exploreContactsApplied);
    }
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

    const groups = [
      { heading: 'Contact Details', fields: CONTACT_DETAIL_FILTER_FIELDS },
      { heading: 'Social Accounts', fields: SOCIAL_FILTER_FIELDS },
      { heading: 'Engagement', fields: ENGAGEMENT_FILTER_FIELDS },
    ];

    const grid = document.createElement('div');
    grid.className = 'explore-filters-grid';

    groups.forEach((group) => {
      const column = document.createElement('section');
      column.className = 'explore-filter-column';

      const heading = document.createElement('h4');
      heading.textContent = group.heading;
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
        event.dataTransfer.dropEffect = 'move';
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
          event.dataTransfer.effectAllowed = 'copy';
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
        event.dataTransfer.effectAllowed = 'copy';
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
      next.splice(bounded, 0, token);
      state.segmentContactsLogicSelectedIndex = bounded;
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
        event.dataTransfer.dropEffect = 'move';
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
      event.dataTransfer.dropEffect = 'move';
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
          event.dataTransfer.effectAllowed = 'move';
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
      state.contacts
        .filter((contact) => contactPassesContactFilters(contact, state.contactsFilters))
        .forEach((contact) => {
          const tr = document.createElement('tr');
          tr.appendChild(document.createElement('td'));
          visibleColumns.forEach((column) => {
            const td = document.createElement('td');
            appendContactCell(td, column.key, contactValue(contact, column.key));
            tr.appendChild(td);
          });
          const actionsTd = document.createElement('td');
          actionsTd.className = 'contacts-actions-cell';
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
  }

  function renderContactsTableHead() {
    const thead = document.getElementById('contactsTableHead');
    if (!thead) return;
    const visibleColumns = getVisibleContactsColumns();
    thead.innerHTML = '';

    const filterRow = document.createElement('tr');
    filterRow.className = 'contacts-filter-row';
    const checkTh = document.createElement('th');
    checkTh.className = 'contacts-go-cell';
    const checkAll = document.createElement('input');
    checkAll.id = 'contactsCheckAll';
    checkAll.type = 'checkbox';
    checkAll.title = 'Select all filtered contacts';
    checkTh.appendChild(checkAll);
    filterRow.appendChild(checkTh);

    visibleColumns.forEach((column) => {
      const th = document.createElement('th');
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = column.filterPlaceholder;
      input.value = String(state.contactsFilters[column.key] || '');
      input.addEventListener('input', () => {
        state.contactsFilters[column.key] = String(input.value || '').trim().toLowerCase();
        renderContacts();
      });
      th.appendChild(input);
      filterRow.appendChild(th);
    });

    const goTh = document.createElement('th');
    goTh.className = 'contacts-go-cell';
    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.textContent = 'Go';
    goBtn.addEventListener('click', () => renderContacts());
    goTh.appendChild(goBtn);
    filterRow.appendChild(goTh);
    thead.appendChild(filterRow);

    const headerRow = document.createElement('tr');
    headerRow.appendChild(document.createElement('th'));
    visibleColumns.forEach((column) => {
      const th = document.createElement('th');
      th.textContent = column.label;
      headerRow.appendChild(th);
    });
    const actionsTh = document.createElement('th');
    actionsTh.className = 'contacts-actions-heading';
    actionsTh.textContent = 'Actions';
    headerRow.appendChild(actionsTh);
    thead.appendChild(headerRow);
  }

  async function loadExploreReferenceOptions() {
    try {
      const result = await api('/api/develop/forms');
      const rows = Array.isArray(result.forms) ? result.forms : (Array.isArray(result.data) ? result.data : []);
      exploreFormTemplateOptions = rows
        .map((row) => String(row?.name || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    } catch (_) {
      exploreFormTemplateOptions = [];
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
      let dbStatus = '<span class="status-pill">unknown</span>';
      if (!map.include) {
        dbStatus = '<span class="status-pill status-ok">skipped</span>';
      } else if (!targetKey) {
        dbStatus = '<span class="status-pill status-bad">invalid key</span>';
      } else if (!isStandardLeadColumn(targetKey) && (map.createField || existingCustom.has(targetKey))) {
        dbStatus = '<span class="status-pill status-ok">custom field</span>';
      } else if (map.dbExists === true) {
        dbStatus = '<span class="status-pill status-ok">exists</span>';
      } else if (map.dbExists === false) {
        dbStatus = '<span class="status-pill status-bad">missing in table</span>';
      } else if (map.dbError) {
        dbStatus = '<span class="status-pill status-warn">check failed</span>';
      }

      tr.innerHTML = `
        <td>${map.header}</td>
        <td><input type="checkbox" data-idx="${idx}" data-field="include" ${map.include ? 'checked' : ''} /></td>
        <td><input data-idx="${idx}" data-field="targetKey" value="${map.targetKey}" /></td>
        <td><select data-idx="${idx}" data-field="type">${typeOptions}</select></td>
        <td>${dbStatus}</td>
        <td><input type="checkbox" data-idx="${idx}" data-field="createField" ${map.createField ? 'checked' : ''} /></td>
        <td><input data-idx="${idx}" data-field="optionsText" value="${map.optionsText || ''}" placeholder="A,B,C" /></td>
      `;
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
        App.setActivePage('settingsPage');
      });
      markerBtn.classList.add('section-settings-gear-btn');
      contactsActionRow.appendChild(markerBtn);
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
    renderContactsSettingsPage();

    loadExploreReferenceOptions().then(() => renderContacts()).catch(() => {});

    // Contact form
    els.contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = toContactPayload(els.contactForm);
      try {
        await api('/api/contacts', { method: 'POST', body: JSON.stringify(payload) });
        els.contactForm.reset();
        notify('Contact created');
        await App.refresh();
        openContactsPage();
      } catch (err) { notify(err.message, true); }
    });

    if (els.openAddContactPageBtn) {
      els.openAddContactPageBtn.addEventListener('click', () => {
        App.setActivePage('addContactPage');
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
      els.backFromEditContactBtn.addEventListener('click', () => openContactsPage());
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
            method: 'PATCH',
            body: JSON.stringify(toContactPayload(els.contactEditForm)),
          });
          notify('Contact updated');
          await App.refresh();
          openContactsPage();
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
    if (els.createSegmentInlineForm) {
      els.createSegmentInlineForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rules = activeExploreFilterRules();
        if (!rules.length) {
          notify('Apply at least one Explore Contacts filter before creating a segment', true);
          return;
        }
        const name = String(els.createSegmentInlineName?.value || '').trim();
        if (!name) return;
        try {
          const createdRes = await api('/api/segments', {
            method: 'POST',
            body: JSON.stringify({ name, rules, definition: exploreFilterDefinition() }),
          });
          const createdId = createdRes?.segment?.id || createdRes?.data?.id || '';
          notify(`Segment created: ${name}`);
          if (els.createSegmentInlineForm) els.createSegmentInlineForm.reset();
          lastSuggestedSegmentName = '';
          await App.refresh();
          if (createdId && typeof App.segments?.openSegment === 'function') {
            App.segments.openSegment(createdId);
          } else {
            App.setActivePage('segmentsPage');
          }
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    // Search filters
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
    if (els.contactsFiltersGoBtn) {
      els.contactsFiltersGoBtn.addEventListener('click', () => renderContacts());
    }
  }

  return {
    manifest: { id: 'contacts', label: 'Contacts', pageId: 'contactsPage', pagePrefixes: ['contacts', 'contactsSettingsPage'] },
    init, renderContacts, contactValue, appendContactCell, applyExploreFilters, loadExploreSegment,
    openContactsPage, openPeerSitesPage, openViewPage, openEditPage, openClonePage,
    onPageActivated(targetPageId) {
      if (targetPageId === 'contactsSettingsPage') {
        renderContactsSettingsPage();
      }
      if (String(state.activePage || '') === 'contactsPeerSitesPage') {
        refreshWebsitePeers().catch((err) => notify(err.message, true));
      }
    }
  };
})();
