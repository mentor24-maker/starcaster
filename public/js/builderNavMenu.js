window.App = window.App || {};

/**
 * WordPress-style website navigation menus for Builder / Module Studio.
 * Items: label, url, parentId (submenus), target (_self | _blank).
 */
App.builderNavMenu = (function () {
  const MENU_LOCATIONS = [
    { value: 'primary', label: 'Primary Menu (Header)' },
    { value: 'footer', label: 'Footer Menu' },
    { value: 'social', label: 'Social Links' },
  ];

  function safeText(value, max = 5000) {
    return String(value == null ? '' : value).trim().slice(0, max);
  }

  function escapeHtml(value) {
    return safeText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function createNavMenuItemId(seed) {
    return `nav-${Date.now()}-${seed}`;
  }

  function defaultNavMenuItems() {
    return [
      { id: 'nav-home', label: 'Home', href: '/', parentId: '', target: '_self' },
      { id: 'nav-about', label: 'About', href: '/about', parentId: '', target: '_self' },
      { id: 'nav-blog', label: 'Blog', href: '/blog', parentId: '', target: '_self' },
    ];
  }

  function normalizeNavMenuItem(raw, index) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const width = safeText(item.width, 20);
    return {
      id: safeText(item.id, 120) || createNavMenuItemId(index + 1),
      label: safeText(item.label, 200),
      href: safeText(item.href || item.url, 2000) || '#',
      parentId: safeText(item.parentId || item.parent_id, 120),
      target: safeText(item.target) === '_blank' ? '_blank' : '_self',
      ...(width ? { width } : {}),
    };
  }

  function parseNavMenuItems(value) {
    if (Array.isArray(value)) {
      return value.map((item, index) => normalizeNavMenuItem(item, index));
    }
    const text = safeText(value, 500000);
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item, index) => normalizeNavMenuItem(item, index));
    } catch {
      return [];
    }
  }

  function serializeNavMenuItems(items) {
    return JSON.stringify(
      (Array.isArray(items) ? items : []).map((item, index) => normalizeNavMenuItem(item, index))
    );
  }

  function defaultNavMenuItemsJson() {
    return serializeNavMenuItems(defaultNavMenuItems());
  }

  function buildNavMenuTree(items) {
    const map = new Map();
    const roots = [];
    items.forEach((item) => {
      map.set(item.id, { ...item, children: [] });
    });
    map.forEach((node) => {
      const parentId = safeText(node.parentId);
      if (parentId && parentId !== node.id && map.has(parentId)) {
        map.get(parentId).children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  function getNavMenuSummary(value) {
    const items = parseNavMenuItems(value);
    if (!items.length) return 'No menu items';
    const topLevel = items.filter((item) => !safeText(item.parentId)).length;
    const nested = items.length - topLevel;
    const base = `${items.length} item${items.length === 1 ? '' : 's'} · ${topLevel} top-level`;
    return nested ? `${base} · ${nested} nested` : base;
  }

  function renderNavMenuBranch(nodes, settings, depth, itemSizing) {
    const direction = safeText(settings?.navDirection || settings?.variant) === 'vertical' ? 'vertical' : 'horizontal';
    const showSubmenu = settings?.showSubmenuIndicator !== false;
    const isRoot = depth === 0;
    const listTag = isRoot ? 'div' : 'ul';
    const itemTag = isRoot ? 'div' : 'li';
    const listClass = isRoot
      ? `site-nav-menu site-nav-menu--${direction}`
      : 'site-nav-submenu';
    const rawAlignment = safeText(settings?.navAlignment) || 'center';
    const justify = rawAlignment === 'left' ? 'flex-start' : rawAlignment === 'right' ? 'flex-end' : 'center';
    const listStyle = isRoot && itemSizing !== 'equal' ? ` style="justify-content:${justify}"` : '';

    const itemsHtml = nodes.map((node) => {
      const href = safeText(node.href || node.url) || '#';
      const targetAttr = node.target === '_blank' ? ' target="_blank" rel="noopener noreferrer"' : '';
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const childMarkup = hasChildren ? renderNavMenuBranch(node.children, settings, depth + 1, itemSizing) : '';
      const indicator = hasChildren && showSubmenu
        ? '<span class="site-nav-submenu-indicator" aria-hidden="true">▾</span>'
        : '';
      const widthStyle = isRoot && itemSizing === 'custom' && safeText(node.width)
        ? ` style="flex:0 0 ${escapeHtml(safeText(node.width))};width:${escapeHtml(safeText(node.width))}"`
        : '';
      return `<${itemTag} class="site-nav-item${hasChildren ? ' site-nav-item--has-children' : ''}"${widthStyle}>`
        + `<a class="site-nav-link" href="${escapeHtml(href)}"${targetAttr}>${escapeHtml(node.label || 'Link')}${indicator}</a>`
        + childMarkup
        + `</${itemTag}>`;
    }).join('');

    return `<${listTag} class="${listClass}" role="${isRoot ? 'menubar' : 'menu'}"${listStyle}>${itemsHtml}</${listTag}>`;
  }

  function buildNavigationModuleMarkup(settings = {}, options = {}) {
    const resolved = settings && typeof settings === 'object' ? settings : {};
    const items = parseNavMenuItems(resolved.navItems);
    const menuName = safeText(resolved.menuName) || 'Menu';
    const location = safeText(resolved.menuLocation) || 'primary';
    const direction = safeText(resolved.navDirection || resolved.variant) === 'vertical' ? 'vertical' : 'horizontal';

    const itemSizing = ['auto', 'equal', 'custom'].includes(safeText(resolved.navItemSizing))
      ? safeText(resolved.navItemSizing)
      : 'auto';
    const fontSize = Number(resolved.navFontSize) > 0 ? `${Number(resolved.navFontSize)}px` : '';
    const fontWeight = resolved.navBold ? '700' : '';
    const linkPadding = safeText(resolved.navPadding) || '8px 12px';
    const linkRadius = Number(resolved.navBorderRadius) >= 0
      ? `${Number(resolved.navBorderRadius)}px`
      : '0px';
    const color = safeText(resolved.navColor) || '#173c61';
    const hoverColor = safeText(resolved.navHoverColor) || '#0b82d4';
    const hoverBg = safeText(resolved.navHoverBackground) || '#e8f4ff';
    const marginV = Number(resolved.navMarginV) >= 0 ? `${Number(resolved.navMarginV)}px` : '';

    const styleParts = [
      `--site-nav-link-color:${color}`,
      `--site-nav-link-hover-color:${hoverColor}`,
      `--site-nav-link-hover-bg:${hoverBg}`,
      `--site-nav-link-padding:${linkPadding}`,
      `--site-nav-link-radius:${linkRadius}`,
    ];
    if (fontSize) styleParts.push(`font-size:${fontSize}`);
    if (fontWeight) styleParts.push(`font-weight:${fontWeight}`);
    if (marginV) styleParts.push(`margin-top:${marginV}`, `margin-bottom:${marginV}`);

    const navLevels = Number.parseInt(resolved.navLevels, 10) || 2;
    const tree = buildNavMenuTree(items);
    const limitedTree = navLevels >= 2 ? tree : tree.map((node) => ({ ...node, children: [] }));
    const menuMarkup = items.length
      ? renderNavMenuBranch(limitedTree, resolved, 0, itemSizing)
      : '<p class="site-nav-empty">No menu items yet. Add links in the menu editor.</p>';

    const dataAttrs = options.includeDataAttrs === false
      ? ''
      : ` data-menu-location="${escapeHtml(location)}" data-menu-name="${escapeHtml(menuName)}"`;

    return `<nav class="site-nav site-nav--${direction} site-nav--sizing-${itemSizing}" aria-label="${escapeHtml(menuName)}"${dataAttrs} style="${escapeHtml(styleParts.join(';'))}">${menuMarkup}</nav>`;
  }

  function applyNestedModalPresentation(modal, options = {}) {
    if (!modal?.el) return modal;
    const anchor = safeText(options.anchor) || 'upper-right';
    const transparentBackdrop = options.transparentBackdrop !== false;
    modal.el.classList.add('builder-nested-modal-backdrop');
    if (transparentBackdrop) {
      modal.el.classList.add('builder-nested-modal-backdrop--transparent');
    }
    if (anchor === 'upper-right') {
      modal.el.classList.add('builder-nested-modal-backdrop--upper-right');
    }
    const dialog = modal.el.querySelector('.c-modal__dialog');
    if (dialog) {
      dialog.classList.add('builder-nested-modal-dialog');
      if (anchor === 'upper-right') {
        dialog.classList.add('builder-nested-modal-dialog--upper-right');
      }
    }
    return modal;
  }

  function mountModalAboveOpenDialog(modal) {
    if (!modal?.el) return;
    const openDialog = document.querySelector('dialog[open], .builder-module-editor-modal');
    if (openDialog && modal.el.parentNode !== openDialog) {
      openDialog.appendChild(modal.el);
    }
  }

  function openNavMenuEditor(options = {}) {
    if (!App.components || typeof App.components.Modal !== 'function') return false;

    const getValue = typeof options.getValue === 'function' ? options.getValue : (() => '[]');
    const setValue = typeof options.setValue === 'function' ? options.setValue : (() => {});
    const afterChange = typeof options.afterChange === 'function' ? options.afterChange : (() => {});
    const title = safeText(options.title) || 'Edit Menu';

    let items = parseNavMenuItems(getValue());
    const body = document.createElement('div');
    body.className = 'builder-nav-menu-editor';

    const intro = document.createElement('p');
    intro.className = 'meta builder-nav-menu-editor-intro';
    intro.textContent = 'Add links, set parents for submenus, and reorder items. Modeled after WordPress menus.';
    body.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'builder-nav-menu-editor-list';
    body.appendChild(list);

    const addRow = document.createElement('div');
    addRow.className = 'builder-nav-menu-editor-actions';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-ghost';
    addBtn.textContent = 'Add Menu Item';
    addRow.appendChild(addBtn);
    body.appendChild(addRow);

    function parentOptionsFor(itemId) {
      const options = [{ value: '', label: '— Top Level —' }];
      items.forEach((item) => {
        if (item.id === itemId) return;
        options.push({ value: item.id, label: item.label || item.id });
      });
      return options;
    }

    function persist(nextItems) {
      items = nextItems.map((item, index) => normalizeNavMenuItem(item, index));
      setValue(serializeNavMenuItems(items));
      afterChange(items);
      renderList();
    }

    function moveItem(id, direction) {
      const index = items.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= items.length) return;
      const next = [...items];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      persist(next);
    }

    function renderList() {
      list.textContent = '';
      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'meta';
        empty.textContent = 'No menu items yet.';
        list.appendChild(empty);
        return;
      }

      items.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'builder-nav-menu-item-card';

        const header = document.createElement('div');
        header.className = 'builder-nav-menu-item-header';
        const titleEl = document.createElement('strong');
        titleEl.textContent = item.label || `Menu Item ${index + 1}`;
        const actions = document.createElement('div');
        actions.className = 'builder-nav-menu-item-actions';

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'btn tiny-btn';
        upBtn.setAttribute('aria-label', 'Move Up');
        upBtn.textContent = '↑';
        upBtn.addEventListener('click', () => moveItem(item.id, -1));

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'btn tiny-btn';
        downBtn.setAttribute('aria-label', 'Move Down');
        downBtn.textContent = '↓';
        downBtn.addEventListener('click', () => moveItem(item.id, 1));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn tiny-btn btn-danger';
        removeBtn.setAttribute('aria-label', 'Delete');
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
          const next = items.filter((row) => row.id !== item.id).map((row) => (
            row.parentId === item.id ? { ...row, parentId: '' } : row
          ));
          persist(next);
        });

        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(removeBtn);
        header.appendChild(titleEl);
        header.appendChild(actions);
        card.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'builder-nav-menu-item-grid standard-form-grid';

        const makeField = (labelText, control) => {
          const labelEl = document.createElement('label');
          labelEl.textContent = labelText;
          if (control.id) labelEl.htmlFor = control.id;
          grid.appendChild(labelEl);
          grid.appendChild(control);
        };

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.id = `nav-label-${item.id}`;
        labelInput.value = item.label;
        labelInput.placeholder = 'Navigation Label';
        labelInput.addEventListener('input', () => {
          item.label = labelInput.value;
          titleEl.textContent = safeText(item.label) || `Menu Item ${index + 1}`;
          persist(items);
        });
        makeField('Navigation Label', labelInput);

        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.id = `nav-url-${item.id}`;
        urlInput.value = item.href;
        urlInput.placeholder = '/path-or-url';
        urlInput.addEventListener('input', () => {
          item.href = urlInput.value;
          persist(items);
        });
        makeField('URL', urlInput);

        const widthInput = document.createElement('input');
        widthInput.type = 'text';
        widthInput.id = `nav-width-${item.id}`;
        widthInput.value = item.width || '';
        widthInput.placeholder = 'e.g. 140px (top-level only)';
        widthInput.disabled = Boolean(safeText(item.parentId));
        widthInput.addEventListener('input', () => {
          item.width = widthInput.value;
          persist(items);
        });
        makeField('Width (Custom sizing)', widthInput);

        const parentSelect = document.createElement('select');
        parentSelect.id = `nav-parent-${item.id}`;
        parentOptionsFor(item.id).forEach((optionData) => {
          const option = document.createElement('option');
          option.value = optionData.value;
          option.textContent = optionData.label;
          parentSelect.appendChild(option);
        });
        parentSelect.value = safeText(item.parentId);
        parentSelect.addEventListener('change', () => {
          item.parentId = parentSelect.value;
          persist(items);
        });
        makeField('Parent Item', parentSelect);

        const targetInput = document.createElement('input');
        targetInput.type = 'checkbox';
        targetInput.id = `nav-target-${item.id}`;
        targetInput.className = 'standard-form-checkbox';
        targetInput.checked = item.target === '_blank';
        targetInput.addEventListener('change', () => {
          item.target = targetInput.checked ? '_blank' : '_self';
          persist(items);
        });
        makeField('Open In New Tab', targetInput);

        card.appendChild(grid);
        list.appendChild(card);
      });
    }

    addBtn.addEventListener('click', () => {
      persist([
        ...items,
        {
          id: createNavMenuItemId(items.length + 1),
          label: '',
          href: '',
          parentId: '',
          target: '_self',
        },
      ]);
    });

    renderList();

    const modal = new App.components.Modal({
      title,
      body,
      dialogClass: 'builder-nav-menu-editor-modal',
      actions: [
        {
          label: 'Done',
          className: 'btn btn-primary',
          onClick: () => modal.close(),
        },
      ],
    });
    applyNestedModalPresentation(modal, {
      anchor: 'upper-right',
      transparentBackdrop: true,
    });
    modal.open();
    mountModalAboveOpenDialog(modal);
    return true;
  }

  return {
    MENU_LOCATIONS,
    parseNavMenuItems,
    serializeNavMenuItems,
    buildNavMenuTree,
    getNavMenuSummary,
    buildNavigationModuleMarkup,
    openNavMenuEditor,
    defaultNavMenuItemsJson,
  };
})();
