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
    { key: 'website', label: 'Website' },
    { key: 'content', label: 'Content' },
    { key: 'email', label: 'Email' },
    { key: 'social', label: 'Social' },
    { key: 'phone', label: 'Mobile' },
    { key: 'forms', label: 'Forms' },
    { key: 'meetings', label: 'Meetings' },
  ];

  const EXPLORE_CONTACT_FIELDS = [
    ...CONTACT_DETAIL_FILTER_FIELDS,
    ...SOCIAL_FILTER_FIELDS,
  ];

  const SOCIAL_FIELD_KEYS = new Set(SOCIAL_FILTER_FIELDS.map((field) => field.key));
  const CONTACT_EDITABLE_FIELDS = [
    'first_name', 'last_name', 'company', 'email', 'phone', 'city', 'country',
    'website', 'youtube', 'instagram', 'tiktok', 'facebook', 'x', 'bluesky',
    'patreon', 'linkedin', 'tags', 'notes',
  ];
  const CONTACT_PAYLOAD_FIELDS = new Set(CONTACT_EDITABLE_FIELDS);
  let activeContactId = '';

  const EXPLORE_FILTER_MODES = [
    { value: 'contains', label: 'Contains' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'ends_with', label: 'Ends with' },
    { value: 'is_empty', label: 'Is Empty' },
    { value: 'is_known', label: 'Is Known' },
  ];

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
        state.segmentContactsFilters[key] = { mode: 'contains', value: '' };
        return;
      }
      state.segmentContactsFilters[key] = {
        mode: String(current.mode || 'contains'),
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
          : { mode: 'contains', value: String(filters?.[key] || '') };
        const mode = String(config.mode || 'contains').toLowerCase();
        const value = String(config.value || '').trim();
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
    if (els.contactsTable) {
      els.contactsTable.innerHTML = '';
      state.contacts
        .filter((contact) => contactPassesContactFilters(contact, state.contactsFilters))
        .forEach((contact) => {
          const tr = document.createElement('tr');
          tr.appendChild(document.createElement('td'));
          ['first_name', 'last_name', 'company', 'email', 'website', 'youtube', 'instagram'].forEach((key) => {
            const td = document.createElement('td');
            appendContactCell(td, key, contactValue(contact, key));
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
    manifest: { id: 'contacts', label: 'Contacts', pageId: 'contactsPage' },
    init, renderContacts, contactValue, appendContactCell, applyExploreFilters, loadExploreSegment,
    openContactsPage, openViewPage, openEditPage, openClonePage
  };
})();
