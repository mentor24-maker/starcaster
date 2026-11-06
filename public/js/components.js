/**
 * public/js/components.js
 * Reusable UI component library for StarCaster by Alphire.
 *
 * ── Components ────────────────────────────────────────────────────────────────
 *
 *   App.components.DataGrid(options)   — sortable, filterable table
 *   App.components.Modal(options)      — dialog with header, body, footer
 *   App.components.Card(options)       — titled card with optional actions
 *   App.components.Toast               — toast notification manager
 *
 * ── Usage pattern ─────────────────────────────────────────────────────────────
 *
 *   All components return a { el, update(), destroy() } object.
 *   el     — the root DOM element; mount it wherever you like
 *   update — re-render with new data/options (efficient: no full DOM rebuild)
 *   destroy — clean up event listeners and remove el from DOM
 *
 * ── Adding a new component ────────────────────────────────────────────────────
 *
 *   1. Add a factory function here following the { el, update, destroy } pattern
 *   2. Register it in the App.components object at the bottom
 *   3. Import components.js in index.html before app.js (it's already there if
 *      you followed the #10 deploy steps)
 */

window.App = window.App || {};
App.components = App.components || {};

// ---------------------------------------------------------------------------
// Utility — create a DOM element with properties
// ---------------------------------------------------------------------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class')           el.className = v;
    else if (k === 'style')      Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else                         el.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

// ---------------------------------------------------------------------------
// 1. DataGrid
// ---------------------------------------------------------------------------

/**
 * Sortable, filterable data grid.
 *
 * @param {object} opts
 * @param {Array<{ key: string, label: string, render?: (val, row) => string|Node }>} opts.columns
 *   Column definitions. `render` is optional — defaults to String(value).
 * @param {Array<object>} opts.rows
 *   Data rows. Each must have properties matching column keys.
 * @param {string} [opts.emptyMessage]
 *   Message shown when no rows match. Default: 'No data to display.'
 * @param {boolean} [opts.filterable]
 *   Show per-column filter inputs. Default: true.
 * @param {boolean} [opts.sortable]
 *   Enable column sort on header click. Default: true.
 * @param {string} [opts.class]
 *   Extra CSS class on the wrapper div.
 * @param {(row: object) => void} [opts.onRowClick]
 *   Optional row click handler.
 *
 * @returns {{ el: HTMLElement, update: (newOpts) => void, destroy: () => void }}
 */
App.components.DataGrid = function DataGrid(opts) {
  // ── State ──────────────────────────────────────────────────────────────
  let { columns = [], rows = [], emptyMessage = 'No data to display.',
        filterable = true, sortable = true, onRowClick = null,
        selectable = false, bulkActions = [], rowKey = 'id' } = opts;

  let sortKey = null;
  let sortDir = 'asc';
  let filters = {};
  let selectedIds = new Set();

  // ── Root element ───────────────────────────────────────────────────────
  const wrapper = h('div', { class: 'c-grid' + (opts.class ? ' ' + opts.class : '') });

  // ── Bulk Actions Toolbar ───────────────────────────────────────────────
  const toolbar = h('div', { class: 'c-grid__toolbar hidden', style: { padding: '0.75rem 1rem', background: 'var(--bg-alt)', border: '1px solid var(--border)', borderBottom: 'none', borderRadius: '6px 6px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } });
  const toolbarText = h('span', { class: 'c-grid__toolbar-text', style: { fontWeight: '600' } });
  const toolbarActions = h('div', { class: 'c-grid__toolbar-actions', style: { display: 'flex', gap: '0.5rem' } });
  toolbar.appendChild(toolbarText);
  toolbar.appendChild(toolbarActions);
  wrapper.appendChild(toolbar);

  function updateToolbar() {
    if (!selectable) return;
    if (selectedIds.size > 0) {
      toolbar.classList.remove('hidden');
      toolbarText.textContent = `${selectedIds.size} selected`;
      toolbarActions.innerHTML = '';
      for (const action of bulkActions) {
        toolbarActions.appendChild(h('button', {
          class: 'btn btn-sm' + (action.danger ? ' btn-danger' : (action.save ? ' btn-save' : (action.primary ? ' btn-primary' : ''))),
          onclick: () => action.onClick(Array.from(selectedIds), clearSelection)
        }, action.label));
      }
    } else {
      toolbar.classList.add('hidden');
    }
  }

  function clearSelection() {
    selectedIds.clear();
    updateToolbar();
    renderHeader(); // update check all box
    renderBody();
  }

  // ── Table ──────────────────────────────────────────────────────────────
  const table  = h('table', { class: 'c-grid__table' });
  const thead  = h('thead');
  const tbody  = h('tbody');
  table.appendChild(thead);
  table.appendChild(tbody);
  wrapper.appendChild(table);

  let checkAllCheckbox = null;

  function renderHeader() {
    thead.innerHTML = '';
    
    // 1. Filter Row
    if (filterable) {
      const filterTr = h('tr', { class: 'table-filter-row' });
      if (selectable) filterTr.appendChild(h('th')); // empty corner
      for (const col of columns) {
        const th = h('th');
        let filterControl;
        if (col.filterOptions) {
          filterControl = h('select', {
            class: 'c-grid__filter-select',
            onchange: (e) => { filters[col.key] = e.target.value; renderBody(); }
          });
          for (const opt of col.filterOptions) {
            const isSelected = filters[col.key] === opt.value;
            const optionEl = h('option', { value: opt.value }, opt.label);
            if (isSelected) optionEl.selected = true;
            filterControl.appendChild(optionEl);
          }
        } else {
          filterControl = h('input', {
            class:       'c-grid__filter-input',
            placeholder: col.label || col.key,
            value:       filters[col.key] || '',
            oninput:     (e) => { filters[col.key] = e.target.value; renderBody(); }
          });
        }
        th.appendChild(filterControl);
        filterTr.appendChild(th);
      }
      thead.appendChild(filterTr);
    }

    // 2. Headings Row
    const tr = h('tr');
    
    if (selectable) {
      checkAllCheckbox = h('input', { 
        type: 'checkbox',
        onchange: (e) => {
          const isChecked = e.target.checked;
          const currentData = getFilteredSorted();
          if (isChecked) {
            currentData.forEach(row => selectedIds.add(row[rowKey]));
          } else {
            currentData.forEach(row => selectedIds.delete(row[rowKey]));
          }
          updateToolbar();
          renderBody();
        }
      });
      tr.appendChild(h('th', { class: 'c-grid__th', style: { width: '40px', textAlign: 'center' } }, checkAllCheckbox));
    }

    for (const col of columns) {
      const isSorted = sortKey === col.key;
      const marker   = isSorted ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      const th = h('th', {
        class:   'c-grid__th' + (sortable && col.sortable !== false ? ' c-grid__th--sortable' : ''),
        onclick: sortable && col.sortable !== false ? () => {
          if (sortKey === col.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          else { sortKey = col.key; sortDir = 'asc'; }
          renderHeader();
          renderBody();
        } : null
      }, (col.label || col.key) + marker);
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  }

  function getFilteredSorted() {
    let data = [...rows];

    // Filter
    for (const col of columns) {
      const needle = String(filters[col.key] || '').trim().toLowerCase();
      if (!needle) continue;
      data = data.filter(row => {
        const val = row[col.key];
        return String(val == null ? '' : val).toLowerCase().includes(needle);
      });
    }

    // Sort
    if (sortKey) {
      data.sort((a, b) => {
        const av = String(a[sortKey] == null ? '' : a[sortKey]).toLowerCase();
        const bv = String(b[sortKey] == null ? '' : b[sortKey]).toLowerCase();
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ?  1 : -1;
        return 0;
      });
    }

    return data;
  }

  function renderBody() {
    tbody.innerHTML = '';
    const data = getFilteredSorted();
    
    if (checkAllCheckbox) {
      const allSelected = data.length > 0 && data.every(r => selectedIds.has(r[rowKey]));
      checkAllCheckbox.checked = allSelected;
      checkAllCheckbox.indeterminate = !allSelected && data.some(r => selectedIds.has(r[rowKey]));
    }

    if (!data.length) {
      const tr = h('tr');
      const td = h('td', { class: 'c-grid__empty', colspan: String(columns.length + (selectable ? 1 : 0)) }, emptyMessage);
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const row of data) {
      const tr = h('tr', { class: 'c-grid__row' + (onRowClick ? ' c-grid__row--clickable' : '') });
      
      if (selectable) {
        const isSelected = selectedIds.has(row[rowKey]);
        if (isSelected) tr.classList.add('c-grid__row--selected');
        
        const cb = h('input', {
          type: 'checkbox',
          checked: isSelected,
          onchange: (e) => {
            if (e.target.checked) selectedIds.add(row[rowKey]);
            else selectedIds.delete(row[rowKey]);
            updateToolbar();
            if (checkAllCheckbox) {
              const allSelected = data.length > 0 && data.every(r => selectedIds.has(r[rowKey]));
              checkAllCheckbox.checked = allSelected;
              checkAllCheckbox.indeterminate = !allSelected && data.some(r => selectedIds.has(r[rowKey]));
            }
            if (isSelected !== e.target.checked) {
              if (e.target.checked) tr.classList.add('c-grid__row--selected');
              else tr.classList.remove('c-grid__row--selected');
            }
          }
        });
        
        const td = h('td', { class: 'c-grid__td', style: { width: '40px', textAlign: 'center' } }, cb);
        // Do not trigger row click if clicking checkbox cell
        td.addEventListener('click', (e) => e.stopPropagation());
        tr.appendChild(td);
      }
      
      if (onRowClick) tr.addEventListener('click', () => onRowClick(row));
      for (const col of columns) {
        const raw = row[col.key];
        const td  = h('td', { class: 'c-grid__td' });
        if (col.render) {
          const rendered = col.render(raw, row);
          td.appendChild(typeof rendered === 'string'
            ? document.createTextNode(rendered)
            : rendered);
        } else {
          td.textContent = raw == null ? '' : String(raw);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function render() {
    renderHeader();
    renderBody();
    updateToolbar();
  }

  render();

  // ── Public API ─────────────────────────────────────────────────────────
  function update(newOpts = {}) {
    if (newOpts.columns !== undefined) columns     = newOpts.columns;
    if (newOpts.rows    !== undefined) rows        = newOpts.rows;
    if (newOpts.emptyMessage)         emptyMessage = newOpts.emptyMessage;
    if (newOpts.onRowClick !== undefined) onRowClick = newOpts.onRowClick;
    render();
  }

  function destroy() {
    wrapper.remove();
  }

  return { el: wrapper, update, destroy };
};

// ---------------------------------------------------------------------------
// 2. Modal
// ---------------------------------------------------------------------------

/**
 * Accessible modal dialog.
 *
 * @param {object} opts
 * @param {string}          opts.title    - Modal header title
 * @param {string|Node}     opts.body     - HTML string or DOM node for body content
 * @param {Array<{ label: string, primary?: boolean, save?: boolean, onClick: () => void }>} [opts.actions]
 *   Footer buttons. primary=true styles as the main CTA; save=true is the green
 *   Save button (`.btn-save`) — use it for every action that commits work.
 * @param {() => void}      [opts.onClose] - Called when modal is dismissed
 * @param {boolean}         [opts.closeOnBackdrop] - Click backdrop to close. Default: true.
 *
 * @returns {{ el: HTMLElement, open: () => void, close: () => void,
 *             setBody: (content: string|Node) => void, destroy: () => void }}
 */
App.components.Modal = function Modal(opts) {
  const { title = '', body = '', actions = [], onClose = null,
          closeOnBackdrop = true, dialogClass = '', bodyClass = '', headerTools = null } = opts;

  // ── Build DOM ──────────────────────────────────────────────────────────
  const backdrop = h('div', { class: 'c-modal__backdrop' });
  const dialog   = h('div', { class: 'c-modal__dialog' + (dialogClass ? ' ' + dialogClass : ''), role: 'dialog',
                               'aria-modal': 'true', 'aria-label': title });

  const header = h('div', { class: 'c-modal__header' });
  header.appendChild(h('h2', { class: 'c-modal__title' }, title));
  if (headerTools instanceof Node) {
    header.appendChild(headerTools);
  }
  header.appendChild(h('button', { class: 'c-modal__close', 'aria-label': 'Close', onclick: close }, '×'));

  const bodyEl = h('div', { class: 'c-modal__body' + (bodyClass ? ' ' + bodyClass : '') });
  setBodyContent(body);

  const footer = h('div', { class: 'c-modal__footer' });
  for (const action of actions) {
    footer.appendChild(h('button', {
      class:   'btn' + (action.save ? ' btn-save' : (action.primary ? ' btn-primary' : ' btn-ghost')),
      onclick: () => { action.onClick(); }
    }, action.label));
  }

  dialog.appendChild(header);
  dialog.appendChild(bodyEl);
  if (actions.length) dialog.appendChild(footer);
  backdrop.appendChild(dialog);

  if (closeOnBackdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
  }

  // Trap Escape key
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function setBodyContent(content) {
    bodyEl.innerHTML = '';
    if (typeof content === 'string') {
      bodyEl.innerHTML = content;
    } else if (content instanceof Node) {
      bodyEl.appendChild(content);
    }
  }

  function open() {
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKeydown);
    // Focus first focusable element
    const focusable = dialog.querySelector('button, input, select, textarea, [tabindex]');
    if (focusable) focusable.focus();
  }

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
    if (onClose) onClose();
  }

  function destroy() {
    close();
    backdrop.remove();
  }

  return { el: backdrop, open, close, setBody: setBodyContent, destroy };
};

// ---------------------------------------------------------------------------
// 3. Card
// ---------------------------------------------------------------------------

/**
 * Titled card with optional header actions and body content.
 *
 * @param {object} opts
 * @param {string}          opts.title     - Card header title
 * @param {string|Node}     [opts.body]    - Body content (HTML string or Node)
 * @param {string}          [opts.subtitle] - Subtitle shown under title
 * @param {Array<{ label: string, onClick: () => void, primary?: boolean, save?: boolean }>} [opts.actions]
 *   Buttons shown in the card header (top right). save=true is the green Save button.
 * @param {string}          [opts.class]   - Extra CSS class on the card el
 * @param {string}          [opts.status]  - Status badge text (e.g. 'sent', 'draft')
 * @param {string}          [opts.statusClass] - CSS class for the status badge
 *
 * @returns {{ el: HTMLElement, update: (newOpts) => void, setBody: (content) => void, destroy: () => void }}
 */
App.components.Card = function Card(opts) {
  const card = h('div', { class: 'c-card' + (opts.class ? ' ' + opts.class : '') });

  // ── Header ─────────────────────────────────────────────────────────────
  const headerEl  = h('div', { class: 'c-card__header' });
  const titleWrap = h('div', { class: 'c-card__title-wrap' });
  const titleEl   = h('h3', { class: 'c-card__title' }, opts.title || '');
  titleWrap.appendChild(titleEl);

  if (opts.subtitle) {
    titleWrap.appendChild(h('p', { class: 'c-card__subtitle' }, opts.subtitle));
  }

  headerEl.appendChild(titleWrap);

  const actionsEl = h('div', { class: 'c-card__actions' });
  if (opts.status) {
    actionsEl.appendChild(h('span', {
      class: 'badge ' + (opts.statusClass || 'badge-grey')
    }, opts.status));
  }
  for (const action of (opts.actions || [])) {
    actionsEl.appendChild(h('button', {
      class:   'btn btn-sm ' + (action.save ? 'btn-save' : (action.primary ? 'btn-primary' : 'btn-ghost')),
      onclick: action.onClick
    }, action.label));
  }
  headerEl.appendChild(actionsEl);

  // ── Body ───────────────────────────────────────────────────────────────
  const bodyEl = h('div', { class: 'c-card__body' });
  if (opts.body) setBodyContent(opts.body);

  card.appendChild(headerEl);
  card.appendChild(bodyEl);

  function setBodyContent(content) {
    bodyEl.innerHTML = '';
    if (typeof content === 'string') {
      bodyEl.innerHTML = content;
    } else if (content instanceof Node) {
      bodyEl.appendChild(content);
    }
  }

  function update(newOpts = {}) {
    if (newOpts.title !== undefined)  titleEl.textContent = newOpts.title;
    if (newOpts.body  !== undefined)  setBodyContent(newOpts.body);
  }

  function destroy() { card.remove(); }

  return { el: card, update, setBody: setBodyContent, destroy };
};

// ---------------------------------------------------------------------------
// 4. Toast — the ONE message strip (task 86bcyrqbu)
// ---------------------------------------------------------------------------

/**
 * App.components.Toast.show(message, options)
 *   options.type     — 'success' | 'error' | 'info'  (default: 'info')
 *   options.duration — ms before it closes by itself (default: 4000 for
 *                      success/info; errors stay until dismissed)
 *   A plain string as the second argument is read as the type.
 *
 * App.components.Toast.success(message)
 * App.components.Toast.error(message)
 * App.components.Toast.info(message)
 *
 * Messages land in #appMessageStrip (src/layout.html), which sits in the
 * page's normal flow under the header: it pushes the page down rather than
 * floating over it, so it can never cover a table row or a button. One
 * message at a time — a new one replaces the old. If the strip is scrolled
 * out of view, the page scrolls just far enough to show it.
 * Rules: docs/UI_RULES.md S9.
 */
App.components.Toast = (function () {
  let current = null;
  let timer = null;

  function getStrip() {
    let strip = document.getElementById('appMessageStrip');
    if (!strip) {
      strip = h('div', { id: 'appMessageStrip', class: 'c-message-strip', 'aria-live': 'polite' });
      document.body.insertBefore(strip, document.body.firstChild);
    }
    return strip;
  }

  function show(message, opts) {
    const options = typeof opts === 'string' ? { type: opts } : (opts || {});
    const type = ['success', 'error', 'info'].includes(options.type) ? options.type : 'info';
    const duration = options.duration !== undefined
      ? options.duration
      : (type === 'error' ? 0 : 4000);

    const strip = getStrip();
    if (timer) { clearTimeout(timer); timer = null; }
    strip.textContent = '';

    const item = h('div', {
      class: `c-message-strip__item c-message-strip__item--${type}`,
      role: type === 'error' ? 'alert' : 'status',
    },
      h('span', { class: 'c-message-strip__text' }, String(message)),
      h('button', { type: 'button', class: 'c-message-strip__close', 'aria-label': 'Dismiss',
                    onclick: () => dismiss(item) }, '×')
    );
    strip.appendChild(item);
    current = item;

    const top = strip.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight) {
      strip.scrollIntoView({ block: 'nearest' });
    }

    if (duration > 0) {
      timer = setTimeout(() => dismiss(item), duration);
    }
    return item;
  }

  function dismiss(item) {
    if (!item) return;
    item.remove();
    if (current === item) {
      current = null;
      if (timer) { clearTimeout(timer); timer = null; }
    }
  }

  return {
    show,
    dismiss: () => dismiss(current),
    success: (msg, opts) => show(msg, { ...opts, type: 'success' }),
    error:   (msg, opts) => show(msg, { ...opts, type: 'error' }),
    info:    (msg, opts) => show(msg, { ...opts, type: 'info' }),
  };
}());

// ---------------------------------------------------------------------------
// 5. SavedNotice — "it saved", at the top of the page, gone on its own
// ---------------------------------------------------------------------------

/**
 * App.components.SavedNotice.show(message, options)
 *   options.page     — the `.app-page` section that saved (default: the visible one)
 *   options.duration — ms before it fades (default: 3000)
 *
 * Scrolls back to the top, moves keyboard focus to the page's heading, and shows
 * a confirmation card at the top of the screen that fades by itself — nothing to
 * close (operator, 2026-11-04, task 86bcyjag0). Use it instead of a toast after a
 * form's Save, where the button sits at the bottom of a long form and a corner
 * toast is easy to miss. Errors still go through App.notify.
 */
App.components.SavedNotice = (function () {
  let current = null;

  function scrollPageToTop(page) {
    for (let node = page; node && node !== document.body; node = node.parentElement) {
      if (node.scrollTop > 0) node.scrollTop = 0;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function focusHeading(page) {
    const heading = page && page.querySelector('.page-heading-row h2, h2');
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }

  function show(message, { page = null, duration = 3000 } = {}) {
    const target = page || document.querySelector('.app-page:not(.hidden)');
    scrollPageToTop(target);
    focusHeading(target);

    if (current) current.remove();
    const notice = h('div', { class: 'c-saved-notice', role: 'status', 'aria-live': 'polite' },
      h('span', { class: 'c-saved-notice__icon', 'aria-hidden': 'true' }, '✓'),
      h('span', { class: 'c-saved-notice__message' }, String(message))
    );
    current = notice;
    document.body.appendChild(notice);
    requestAnimationFrame(() => notice.classList.add('c-saved-notice--visible'));

    setTimeout(() => {
      notice.classList.remove('c-saved-notice--visible');
      notice.addEventListener('transitionend', () => {
        notice.remove();
        if (current === notice) current = null;
      }, { once: true });
    }, duration);

    return notice;
  }

  return { show };
}());

// ---------------------------------------------------------------------------
// App.notify → the message strip
// ---------------------------------------------------------------------------
// App.notify used to write the old #message bar AND show a toast, so every
// message appeared twice (task 86bcyrqbu). It now shows exactly one.

App.notify = function notify(text, isError = false) {
  App.components.Toast.show(text, { type: isError ? 'error' : 'success' });
};
