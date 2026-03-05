/**
 * public/js/segments.js
 * Saved segment list and campaign segment selector population.
 */

window.App = window.App || {};
App.segments = (function () {
  const { state, els, api, notify } = App;
  const DEFAULT_CONTACT_COLUMNS = ['first_name', 'last_name', 'company', 'email', 'website', 'youtube', 'instagram'];
  let activeViewedSegmentId = '';

  const FIELD_LABELS = {
    first_name: 'First Name',
    last_name: 'Last Name',
    company: 'Company',
    email: 'Email',
    website: 'Website',
    phone: 'Phone',
    city: 'City',
    state: 'State',
    country: 'Country',
    tags: 'Tags',
    youtube: 'Youtube',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    facebook: 'Facebook',
    x: 'X',
    bluesky: 'BlueSky',
    patreon: 'Patreon',
    linkedin: 'LinkedIn',
    substack: 'Substack',
    medium: 'Medium',
  };

  function ruleLabel(rule) {
    const field = FIELD_LABELS[String(rule?.field || '').trim()] || String(rule?.field || '').trim();
    const operator = String(rule?.operator || '').trim().toLowerCase();
    if (operator === 'starts_with') return `${field} Starts With ${String(rule?.value || '').trim()}`.trim();
    if (operator === 'ends_with') return `${field} Ends With ${String(rule?.value || '').trim()}`.trim();
    if (operator === 'is_known') return `${field} Is KNOWN`;
    if (operator === 'is_empty') return `${field} Is EMPTY`;
    if (operator === 'equals') return `${field} Equals ${String(rule?.value || '').trim()}`.trim();
    return `${field} Contains ${String(rule?.value || '').trim()}`.trim();
  }

  function definitionSummary(segment) {
    const clauses = Array.isArray(segment?.definition?.clauses) && segment.definition.clauses.length
      ? segment.definition.clauses.map((clause) => ({
          id: String(clause?.id || '').trim().toUpperCase(),
          label: ruleLabel({ field: clause?.field, operator: clause?.mode, value: clause?.value }),
        }))
      : (Array.isArray(segment?.rules) ? segment.rules : []).map((rule, index) => ({
          id: String.fromCharCode(65 + (index % 26)),
          label: ruleLabel(rule),
        }));
    if (!clauses.length) return 'All contacts';
    const labelById = Object.fromEntries(clauses.map((clause) => [clause.id, clause.label]));
    const fallback = clauses.map((clause) => clause.id).join(
      String(segment?.definition?.logicMode || 'all').toLowerCase() === 'any' ? ' OR ' : ' AND '
    );
    const tokens = Array.isArray(segment?.definition?.logicTokens) && segment.definition.logicTokens.length
      ? segment.definition.logicTokens.map((token) => String(token || '').toUpperCase().trim()).filter(Boolean)
      : String(segment?.definition?.logic || fallback).toUpperCase().replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter(Boolean);
    return tokens.map((token) => {
      if (labelById[token]) return labelById[token];
      if (token === 'AND') return 'and';
      if (token === 'OR') return 'or';
      return token;
    }).join(' ');
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

  function matchesDefinitionFilters(contact, segment) {
    const filters = segment?.definition?.filters;
    if (!filters || typeof filters !== 'object') return null;
    const logicMode = String(segment?.definition?.logicMode || 'all').toLowerCase() === 'any' ? 'any' : 'all';
    const clauses = Array.isArray(segment?.definition?.clauses) && segment.definition.clauses.length
      ? segment.definition.clauses
          .map((clause, index) => ({
            id: String(clause?.id || '').trim().toUpperCase() || String.fromCharCode(65 + (index % 26)),
            field: String(clause?.field || '').trim(),
            mode: String(clause?.mode || 'contains').toLowerCase(),
            value: String(clause?.value || '').trim(),
          }))
          .filter((clause) => clause.field && (clause.mode === 'is_empty' || clause.mode === 'is_known' || clause.value))
      : Object.entries(filters)
          .map(([field, config], index) => {
            const mode = String(config?.mode || 'contains').toLowerCase();
            const value = String(config?.value || '').trim();
            if (mode === 'is_empty' || mode === 'is_known') return { id: String.fromCharCode(65 + (index % 26)), field, mode, value: '' };
            if (!value) return null;
            return { id: String.fromCharCode(65 + (index % 26)), field, mode, value };
          })
          .filter(Boolean);

    if (!clauses.length) return true;

    const clauseResults = {};
    clauses.forEach(({ id, field, mode, value }) => {
      const rawValue = String(App.contacts?.contactValue?.(contact, field) || '').trim();
      const haystack = ['youtube', 'instagram', 'tiktok', 'facebook', 'x', 'bluesky', 'patreon', 'linkedin', 'substack', 'medium']
        .includes(String(field || '').trim().toLowerCase())
        ? socialUsername(rawValue)
        : rawValue.toLowerCase();
      const needle = String(value || '').trim().toLowerCase();

      if (mode === 'is_empty') clauseResults[id] = !rawValue;
      else if (mode === 'is_known') clauseResults[id] = Boolean(rawValue);
      else if (mode === 'starts_with') clauseResults[id] = haystack.startsWith(needle);
      else if (mode === 'ends_with') clauseResults[id] = haystack.endsWith(needle);
      else if (mode === 'equals') clauseResults[id] = haystack === needle;
      else clauseResults[id] = haystack.includes(needle);
    });

    const tokens = Array.isArray(segment?.definition?.logicTokens) && segment.definition.logicTokens.length
      ? segment.definition.logicTokens.map((token) => String(token || '').toUpperCase().trim()).filter(Boolean)
      : (String(segment?.definition?.logic || '').trim()
          || clauses.map((clause) => clause.id).join(logicMode === 'any' ? ' OR ' : ' AND '))
          .toUpperCase().replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;

    const validIds = new Set(clauses.map((clause) => clause.id));
    const precedence = { OR: 1, AND: 2 };
    const output = [];
    const ops = [];
    let expectOperand = true;

    for (const token of tokens) {
      if (validIds.has(token)) {
        if (!expectOperand) return false;
        output.push(token);
        expectOperand = false;
        continue;
      }
      if (token === '(') {
        if (!expectOperand) return false;
        ops.push(token);
        continue;
      }
      if (token === ')') {
        if (expectOperand) return false;
        while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop());
        if (!ops.length) return false;
        ops.pop();
        continue;
      }
      if (token === 'AND' || token === 'OR') {
        if (expectOperand) return false;
        while (ops.length && precedence[ops[ops.length - 1]] >= precedence[token]) output.push(ops.pop());
        ops.push(token);
        expectOperand = true;
        continue;
      }
      return false;
    }
    if (expectOperand) return false;
    while (ops.length) {
      const op = ops.pop();
      if (op === '(') return false;
      output.push(op);
    }

    const stack = [];
    for (const token of output) {
      if (validIds.has(token)) {
        stack.push(Boolean(clauseResults[token]));
        continue;
      }
      const right = stack.pop();
      const left = stack.pop();
      if (left === undefined || right === undefined) return false;
      stack.push(token === 'AND' ? (left && right) : (left || right));
    }

    return stack.length === 1 ? Boolean(stack[0]) : false;
  }

  function segmentMatchesContact(contact, segment) {
    const definitionMatch = matchesDefinitionFilters(contact, segment);
    if (definitionMatch !== null) return definitionMatch;

    const rules = Array.isArray(segment?.rules) ? segment.rules : [];
    if (!rules.length) return true;
    return rules.every((rule) => {
      const field = String(rule?.field || '').trim();
      const operator = String(rule?.operator || '').trim().toLowerCase();
      const needle = String(rule?.value || '').trim().toLowerCase();
      const source = String(App.contacts?.contactValue?.(contact, field) || '').trim();
      const normalized = source.toLowerCase();

      if (operator === 'is_empty') return !source;
      if (operator === 'is_known') return Boolean(source);
      if (operator === 'starts_with') return normalized.startsWith(needle);
      if (operator === 'ends_with') return normalized.endsWith(needle);
      if (operator === 'equals') return normalized === needle;
      return normalized.includes(needle);
    });
  }

  function segmentContactColumns(segment) {
    const sourceClauses = Array.isArray(segment?.definition?.clauses) && segment.definition.clauses.length
      ? segment.definition.clauses
      : (Array.isArray(segment?.rules) ? segment.rules : []);
    const extras = sourceClauses
      .map((rule) => String(rule?.field || '').trim())
      .filter((field) => field && !DEFAULT_CONTACT_COLUMNS.includes(field));
    return [...DEFAULT_CONTACT_COLUMNS, ...Array.from(new Set(extras))];
  }

  function columnLabel(field) {
    return FIELD_LABELS[String(field || '').trim()] || App.titleFromKey(field);
  }

  function renderListHeader() {
    if (!els.segmentsPageTableHead) return;
    els.segmentsPageTableHead.innerHTML = `
      <tr>
        <th>Segment Name</th>
        <th>Definition</th>
        <th>Audience</th>
        <th>Actions</th>
      </tr>
    `;
  }

  function renderSegmentHeader(segment) {
    if (!els.segmentsPageTableHead) return;
    const cols = segmentContactColumns(segment);
    const tr = document.createElement('tr');
    cols.forEach((field) => {
      const th = document.createElement('th');
      th.textContent = columnLabel(field);
      tr.appendChild(th);
    });
    els.segmentsPageTableHead.innerHTML = '';
    els.segmentsPageTableHead.appendChild(tr);
  }

  function renderSegmentsList() {
    activeViewedSegmentId = '';
    if (els.returnToSegmentsBtn) els.returnToSegmentsBtn.classList.add('hidden');
    if (els.activeSegmentName) {
      els.activeSegmentName.textContent = '';
      els.activeSegmentName.classList.add('hidden');
    }
    renderListHeader();

    if (!els.segmentsTableBody) return;
    els.segmentsTableBody.innerHTML = '';
    const items = Array.isArray(state.segments) ? state.segments : [];
    if (!items.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = 'No saved segments yet.';
      tr.appendChild(td);
      els.segmentsTableBody.appendChild(tr);
      return;
    }

    items.forEach((segment) => {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = segment.name || '-';
      tr.appendChild(nameTd);

      const defTd = document.createElement('td');
      defTd.textContent = definitionSummary(segment);
      tr.appendChild(defTd);

      const audienceTd = document.createElement('td');
      audienceTd.textContent = Number(segment.audienceSize || 0);
      tr.appendChild(audienceTd);

      const actionsTd = document.createElement('td');
      const viewBtn = App.makeIconButton('view', 'View Segment Contacts', () => {
        showSegmentContacts(segment.id);
      });
      const editBtn = App.makeIconButton('edit', 'Edit Segment Filters', () => {
        if (typeof App.contacts?.loadExploreSegment === 'function') {
          App.contacts.loadExploreSegment(segment);
        }
      }, { marginLeft: '0.4rem' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Segment', async () => {
        if (!window.confirm(`Delete segment "${segment.name}"?`)) return;
        try {
          await api(`/api/segments/${encodeURIComponent(segment.id)}`, { method: 'DELETE' });
          if (String(activeViewedSegmentId) === String(segment.id)) {
            activeViewedSegmentId = '';
          }
          notify(`Deleted segment: ${segment.name}`);
          await App.refresh();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '0.4rem' });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);

      els.segmentsTableBody.appendChild(tr);
    });
  }

  function showSegmentContacts(segmentId) {
    const segment = (Array.isArray(state.segments) ? state.segments : []).find((item) => String(item.id) === String(segmentId));
    if (!segment || !els.segmentsTableBody) return;

    activeViewedSegmentId = String(segment.id);
    if (els.returnToSegmentsBtn) els.returnToSegmentsBtn.classList.remove('hidden');
    if (els.activeSegmentName) {
      els.activeSegmentName.textContent = segment.name || '';
      els.activeSegmentName.classList.toggle('hidden', !segment.name);
    }
    renderSegmentHeader(segment);
    els.segmentsTableBody.innerHTML = '';

    const rows = (Array.isArray(state.contacts) ? state.contacts : []).filter((contact) => segmentMatchesContact(contact, segment));
    const cols = segmentContactColumns(segment);

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = cols.length || 1;
      td.textContent = 'No contacts match this segment.';
      tr.appendChild(td);
      els.segmentsTableBody.appendChild(tr);
      return;
    }

    rows.forEach((contact) => {
      const tr = document.createElement('tr');
      cols.forEach((field) => {
        const td = document.createElement('td');
        if (typeof App.contacts?.appendContactCell === 'function') {
          App.contacts.appendContactCell(td, field, App.contacts.contactValue(contact, field));
        } else {
          td.textContent = App.contacts?.contactValue?.(contact, field) || '-';
        }
        tr.appendChild(td);
      });
      els.segmentsTableBody.appendChild(tr);
    });
  }

  function openSegment(segmentId) {
    if (!segmentId) return;
    App.setActivePage('segmentsPage');
    showSegmentContacts(segmentId);
  }

  function renderSegments() {
    const campaignSelect = document.getElementById('campaignSegmentSelect') || els.campaignSegment;
    if (campaignSelect) {
      campaignSelect.innerHTML = '<option value="">Segment (optional)</option>';
    }

    (Array.isArray(state.segments) ? state.segments : []).forEach((segment) => {
      if (!campaignSelect) return;
      const option = document.createElement('option');
      option.value = segment.id;
      option.textContent = `${segment.name} (${segment.audienceSize})`;
      campaignSelect.appendChild(option);
    });

    if (activeViewedSegmentId) {
      showSegmentContacts(activeViewedSegmentId);
    } else {
      renderSegmentsList();
    }
  }

  function init() {
    if (els.returnToSegmentsBtn) {
      els.returnToSegmentsBtn.addEventListener('click', () => {
        renderSegmentsList();
      });
    }
  }

  return {
    manifest: { id: 'segments', label: 'Segments', pageId: 'segmentsPage' },
    init,
    renderSegments,
    openSegment,
  };
})();
