'use strict';

const LEGACY_LAYOUT_MAP = {
  '6': 'single',
  banner: 'single',
  single: 'single',
  '3-3': 'two-column',
  'two-column': 'two-column',
  'feature-grid-2': 'two-column',
  '4-2': 'four-two',
  'hero-form-right': 'four-two',
  '2-4': 'two-four',
  '1-5': 'one-five',
  '5-1': 'five-one',
  '2-2-2': 'three-column',
  '1-4-1': 'one-four-one',
};

const LEGACY_COLUMN_MAP_TWO = {
  col1: 'left',
  col2: 'right',
  left: 'left',
  right: 'right',
};

const LEGACY_COLUMN_MAP_THREE = {
  col1: 'left',
  col2: 'center',
  col3: 'right',
  left: 'left',
  center: 'center',
  right: 'right',
};

const LEGACY_MODULE_TYPE_MAP = {
  eyebrow: 'heading',
  headline: 'heading',
  subheading: 'heading',
  pitch: 'text',
  cta: 'button',
  form: 'contact-form',
  'logo-wide': 'image',
  'logo-square': 'image',
  poll: 'current-poll',
  spacer: 'text',
  text: 'text',
  image: 'image',
  video: 'video',
  button: 'button',
};

function safeText(value, max = 10000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeLegacyBackgroundSettings(value, legacyColor = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const mode = safeText(value.mode, 20).toLowerCase();
    if (mode === 'transparent') {
      return {
        mode: 'color',
        color: 'transparent',
        color2: '#eaf4ff',
        imageUrl: '',
        styleKey: '',
      };
    }
    if (['color', 'gradient', 'image', 'style'].includes(mode)) {
      return {
        mode,
        color: safeText(value.color, 40) || '#ffffff',
        color2: safeText(value.color2, 40) || '#eaf4ff',
        imageUrl: safeText(value.imageUrl, 2000),
        styleKey: safeText(value.styleKey, 80),
      };
    }
  }
  const bgColor = safeText(legacyColor, 40);
  if (bgColor) {
    if (bgColor.toLowerCase() === 'transparent') {
      return {
        mode: 'color',
        color: 'transparent',
        color2: '#eaf4ff',
        imageUrl: '',
        styleKey: '',
      };
    }
    return {
      mode: 'color',
      color: bgColor,
      color2: '#eaf4ff',
      imageUrl: '',
      styleKey: '',
    };
  }
  return {
    mode: 'none',
    color: '#ffffff',
    color2: '#eaf4ff',
    imageUrl: '',
    styleKey: '',
  };
}

function normalizeLegacyOverlayScreen(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      background: {
        mode: 'none',
        color: '#ffffff',
        color2: '#eaf4ff',
        imageUrl: '',
        styleKey: '',
      },
      opacity: 100,
    };
  }
  const opacityRaw = Number(value.opacity);
  const opacity = Number.isFinite(opacityRaw)
    ? Math.min(100, Math.max(0, Math.round(opacityRaw)))
    : 100;
  return {
    background: normalizeLegacyBackgroundSettings(value.background),
    opacity,
  };
}

function resolveLegacyRowBackground(section, rowSettings) {
  const candidates = [
    section?.background,
    rowSettings?.background,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeLegacyBackgroundSettings(candidate, rowSettings?.backgroundColor);
    if (normalized.mode !== 'none') return normalized;
  }
  return normalizeLegacyBackgroundSettings(null, rowSettings?.backgroundColor);
}

function mergeNormieCellFields(section, containerSettings, layout) {
  const migrated = migrateContainerSettingsToCellFields(containerSettings, layout);
  if (!section || typeof section !== 'object') return migrated;
  if (section.cellBackgrounds && typeof section.cellBackgrounds === 'object' && !Array.isArray(section.cellBackgrounds)) {
    migrated.cellBackgrounds = section.cellBackgrounds;
  }
  [
    'cellPadding',
    'cellVerticalMargin',
    'cellBorderWidth',
    'cellBorderColor',
    'cellBorderRadius',
    'cellBorderStyle',
    'cellMobileHidden',
    'cellDesktopHidden',
    'cellShadow',
    'cellOpacity',
    'cellHAlign',
    'cellVAlign',
  ].forEach((key) => {
    if (section[key] && typeof section[key] === 'object' && !Array.isArray(section[key])) {
      migrated[key] = section[key];
    }
  });
  return migrated;
}

function migrateLegacyLayout(layout) {
  const key = safeText(layout, 40).toLowerCase();
  return LEGACY_LAYOUT_MAP[key] || key || 'single';
}

function usesThreeColumnLayout(layout) {
  const normalizedLayout = migrateLegacyLayout(layout);
  return normalizedLayout === 'three-column' || normalizedLayout === 'one-four-one';
}

function migrateLegacyColumn(column, layout) {
  const normalizedLayout = migrateLegacyLayout(layout);
  const col = safeText(column, 40).toLowerCase() || 'main';
  if (usesThreeColumnLayout(layout)) {
    return LEGACY_COLUMN_MAP_THREE[col] || col;
  }
  if (normalizedLayout === 'single') {
    return 'main';
  }
  return LEGACY_COLUMN_MAP_TWO[col] || col;
}

function migrateLegacyModuleSettings(type, module) {
  const settings = module?.settings && typeof module.settings === 'object' && !Array.isArray(module.settings)
    ? { ...module.settings }
    : {};
  const legacyType = safeText(module?.type, 40).toLowerCase();

  if (legacyType === 'eyebrow') {
    settings.level = settings.level || 'eyebrow';
  }
  if (legacyType === 'headline') {
    settings.level = settings.level || 'h1';
  }
  if (legacyType === 'subheading') {
    settings.level = settings.level || 'h3';
  }
  if (legacyType === 'logo-wide' || legacyType === 'logo-square') {
    settings.variant = legacyType === 'logo-square' ? 'square' : 'wide';
    if (module?.assetId) settings.imageAssetId = safeText(module.assetId);
  }
  if (legacyType === 'pitch' || legacyType === 'cta') {
    if (module?.contentId) settings.contentId = safeText(module.contentId);
  }
  if (legacyType === 'form' && module?.contentId) {
    settings.formId = safeText(module.contentId);
  }
  if (legacyType === 'spacer') {
    settings.minHeight = settings.minHeight || '24';
  }
  if (legacyType === 'image' && module?.assetId) {
    settings.imageAssetId = settings.imageAssetId || safeText(module.assetId);
  }

  return settings;
}

function migrateLegacyModule(module, layout) {
  if (!module || typeof module !== 'object' || Array.isArray(module)) return null;
  const legacyType = safeText(module.type, 40).toLowerCase();
  const type = LEGACY_MODULE_TYPE_MAP[legacyType] || legacyType || 'text';
  return {
    id: safeText(module.id, 120),
    type,
    column: migrateLegacyColumn(module.column, layout),
    name: safeText(module.name, 255),
    text: safeText(module.text, 10000),
    contentId: safeText(module.contentId, 120),
    assetId: safeText(module.assetId, 120),
    sourceModuleId: safeText(module.sourceModuleId, 120),
    settings: migrateLegacyModuleSettings(type, module),
  };
}

function migrateContainerSettingsToCellFields(containerSettings, layout) {
  const normalizedLayout = migrateLegacyLayout(layout);
  const columns = usesThreeColumnLayout(layout)
    ? ['left', 'center', 'right']
    : normalizedLayout === 'single'
      ? ['main']
      : ['left', 'right'];
  const legacyKeys = usesThreeColumnLayout(layout)
    ? ['col1', 'col2', 'col3']
    : normalizedLayout === 'single'
      ? ['col1']
      : ['col1', 'col2'];

  const cellBackgrounds = {};
  const cellPadding = {};
  const cellBorderWidth = {};
  const cellBorderColor = {};
  const cellBorderRadius = {};
  const cellBorderStyle = {};
  const cellVerticalMargin = {};

  columns.forEach((column, index) => {
    const legacyKey = legacyKeys[index] || column;
    const container = containerSettings?.[legacyKey] || containerSettings?.[column] || {};
    cellBackgrounds[column] = normalizeLegacyBackgroundSettings(
      container.background,
      container.backgroundColor
    );
    cellPadding[column] = safeText(container.padding, 10) || '18';
    cellBorderWidth[column] = safeText(container.borderThickness, 10) || '1';
    cellBorderColor[column] = safeText(container.borderColor, 40) || '#d9e4ef';
    cellBorderRadius[column] = safeText(container.borderRadius, 10) || '24';
    cellBorderStyle[column] = 'solid';
    cellVerticalMargin[column] = safeText(container.margin, 10) || '0';
  });

  return {
    cellBackgrounds,
    cellPadding,
    cellBorderWidth,
    cellBorderColor,
    cellBorderRadius,
    cellBorderStyle,
    cellVerticalMargin,
    cellMobileHidden: Object.fromEntries(columns.map((column) => [column, 'false'])),
    cellDesktopHidden: Object.fromEntries(columns.map((column) => [column, 'false'])),
    cellShadow: Object.fromEntries(columns.map((column) => [column, 'none'])),
    cellOpacity: Object.fromEntries(columns.map((column) => [column, '1'])),
    cellHAlign: Object.fromEntries(columns.map((column) => [column, 'left'])),
    cellVAlign: Object.fromEntries(columns.map((column) => [column, 'top'])),
  };
}

function migrateLegacySection(section, index) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
  const layout = migrateLegacyLayout(section.layout);
  const rowSettings = section.rowSettings && typeof section.rowSettings === 'object'
    ? section.rowSettings
    : {};
  const containerSettings = section.containerSettings && typeof section.containerSettings === 'object'
    ? section.containerSettings
    : {};
  const cellFields = mergeNormieCellFields(section, containerSettings, layout);

  return {
    id: safeText(section.id, 120) || `section_${index + 1}`,
    title: safeText(section.title, 255),
    layout,
    alignment: 'left',
    marginTop: safeText(rowSettings.margin, 10) || '0',
    marginBottom: '0',
    mobileHidden: 'false',
    desktopHidden: 'false',
    mobileLayout: 'stack',
    background: resolveLegacyRowBackground(section, rowSettings),
    overlayScreen: normalizeLegacyOverlayScreen(rowSettings.overlayScreen || section.overlayScreen),
    ...cellFields,
    modules: Array.isArray(section.modules)
      ? section.modules
        .map((module) => migrateLegacyModule(module, layout))
        .filter(Boolean)
      : [],
  };
}

function isLegacySectionArray(value) {
  if (!Array.isArray(value) || !value.length) return false;
  const first = value[0];
  if (!first || typeof first !== 'object') return false;
  return Boolean(first.rowSettings || first.containerSettings || /^col\d+$/.test(safeText(first.modules?.[0]?.column, 10)));
}

function isLegacyLayoutDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Array.isArray(value.sections)) {
    return isLegacySectionArray(value.sections);
  }
  return false;
}

function migrateLegacyLayoutSections(value) {
  if (!value) return value;
  if (typeof value === 'string') {
    try {
      return migrateLegacyLayoutSections(JSON.parse(value));
    } catch (_) {
      return value;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sections = value.sections ?? value.layoutSections;
    if (isLegacySectionArray(sections) || isLegacyLayoutDocument(value)) {
      return {
        pageBackground: value.pageBackground || {
          mode: 'none',
          color: '#ffffff',
          color2: '#eaf4ff',
          imageUrl: '',
          styleKey: '',
        },
        sections: sections.map((section, index) => migrateLegacySection(section, index)).filter(Boolean),
      };
    }
    return value;
  }
  if (isLegacySectionArray(value)) {
    return {
      pageBackground: {
        mode: 'none',
        color: '#ffffff',
        color2: '#eaf4ff',
        imageUrl: '',
        styleKey: '',
      },
      sections: value.map((section, index) => migrateLegacySection(section, index)).filter(Boolean),
    };
  }
  return value;
}

function migrateLegacyEmailBlocksToDocument(template) {
  const blocks = Array.isArray(template?.blocks) ? template.blocks : [];
  const modules = blocks.map((block, index) => {
    const type = safeText(block?.type, 40).toLowerCase();
    if (type === 'button') {
      return {
        id: safeText(block?.id, 120) || `module_${index + 1}`,
        type: 'button',
        column: 'main',
        name: '',
        text: safeText(block?.text, 500),
        settings: { href: safeText(block?.url, 2000) },
      };
    }
    if (type === 'heading') {
      return {
        id: safeText(block?.id, 120) || `module_${index + 1}`,
        type: 'heading',
        column: 'main',
        name: '',
        text: safeText(block?.text, 5000),
        settings: { level: 'h1' },
      };
    }
    return {
      id: safeText(block?.id, 120) || `module_${index + 1}`,
      type: 'text',
      column: 'main',
      name: '',
      text: safeText(block?.text, 10000),
      settings: {},
    };
  });

  if (!modules.length) {
    const heading = safeText(template?.heading, 500);
    const body = safeText(template?.body, 10000);
    const cta = safeText(template?.cta, 255);
    if (heading) {
      modules.push({ id: 'module_heading', type: 'heading', column: 'main', name: '', text: heading, settings: { level: 'h1' } });
    }
    if (body) {
      modules.push({ id: 'module_body', type: 'text', column: 'main', name: '', text: body, settings: {} });
    }
    if (cta) {
      modules.push({ id: 'module_cta', type: 'button', column: 'main', name: '', text: cta, settings: { href: '' } });
    }
  }

  return {
    pageBackground: {
      mode: 'color',
      color: '#ffffff',
      color2: '#eaf4ff',
      imageUrl: '',
      styleKey: '',
    },
    sections: [{
      id: 'section_email_1',
      title: safeText(template?.subject, 255),
      layout: 'single',
      alignment: 'left',
      marginTop: '0',
      marginBottom: '0',
      mobileHidden: 'false',
      desktopHidden: 'false',
      mobileLayout: 'stack',
      background: { mode: 'none', color: '#ffffff', color2: '#eaf4ff', imageUrl: '', styleKey: '' },
      cellBackgrounds: { main: { mode: 'none', color: '#ffffff', color2: '#eaf4ff', imageUrl: '', styleKey: '' } },
      cellPadding: { main: '18' },
      cellVerticalMargin: { main: '0' },
      cellMobileHidden: { main: 'false' },
      cellDesktopHidden: { main: 'false' },
      cellBorderWidth: { main: '1' },
      cellBorderColor: { main: '#d9e4ef' },
      cellBorderRadius: { main: '24' },
      cellBorderStyle: { main: 'solid' },
      cellShadow: { main: 'none' },
      cellOpacity: { main: '1' },
      cellHAlign: { main: 'left' },
      cellVAlign: { main: 'top' },
      modules,
    }],
  };
}

module.exports = {
  migrateLegacyLayout,
  migrateLegacyColumn,
  migrateLegacyLayoutSections,
  migrateLegacyEmailBlocksToDocument,
  isLegacySectionArray,
};
