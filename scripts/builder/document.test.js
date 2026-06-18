'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  migrateLegacyLayoutSections,
  migrateLegacyEmailBlocksToDocument,
} = require('../../lib/builder/migrate-from-legacy');
const {
  normalizeBuilderDocument,
  serializeBuilderDocument,
  normalizeStarCasterTemplateKind,
} = require('../../lib/builder/document');
const { normalizeLayout } = require('../../lib/builder/template');

test('normalizeStarCasterTemplateKind preserves fixed and email', () => {
  assert.equal(normalizeStarCasterTemplateKind('fixed'), 'fixed');
  assert.equal(normalizeStarCasterTemplateKind('modular'), 'modular');
  assert.equal(normalizeStarCasterTemplateKind('email'), 'email');
});

test('migrateLegacyLayoutSections maps StarCaster grid codes', () => {
  const migrated = migrateLegacyLayoutSections([{
    id: 'section_1',
    layout: '3-3',
    rowSettings: { backgroundColor: '#eef6ff', padding: '20', margin: '8' },
    containerSettings: {
      col1: { padding: '12', borderColor: '#000000', borderThickness: '2', borderRadius: '8' },
      col2: { padding: '16' },
    },
    modules: [{
      id: 'module_1',
      type: 'headline',
      column: 'col1',
      name: 'Hero',
      text: 'Hello',
      settings: {},
    }],
  }]);

  const document = normalizeBuilderDocument(migrated);
  assert.equal(document.layoutSections.length, 1);
  assert.equal(normalizeLayout(document.layoutSections[0].layout), 'two-column');
  assert.equal(document.layoutSections[0].modules[0].type, 'heading');
  assert.equal(document.layoutSections[0].modules[0].column, 'left');
});

test('serializeBuilderDocument preserves 1-4-1 module column placement', () => {
  const serialized = serializeBuilderDocument({
    layoutSections: [{
      id: 'section_1',
      layout: 'one-four-one',
      rowSettings: { margin: '0', padding: '20' },
      containerSettings: {
        col1: { padding: '12' },
        col2: { padding: '18' },
        col3: { padding: '12' },
      },
      modules: [
        { id: 'module_a', type: 'heading', column: 'col1', name: 'Left', text: 'Left', settings: {} },
        { id: 'module_b', type: 'text', column: 'col2', name: 'Center', text: 'Center', settings: {} },
        { id: 'module_c', type: 'button', column: 'col3', name: 'Right', text: 'Right', settings: { href: '' } },
      ],
    }],
  });

  const columns = serialized.sections[0].modules.map((module) => module.column);
  assert.deepEqual(columns, ['left', 'center', 'right']);

  const roundTrip = normalizeBuilderDocument(serialized);
  assert.deepEqual(
    roundTrip.layoutSections[0].modules.map((module) => module.column),
    ['left', 'center', 'right']
  );
});

test('serializeBuilderDocument preserves table borderThickness zero', () => {
  const serialized = serializeBuilderDocument({
    layoutSections: [{
      id: 'section_1',
      layout: 'single',
      modules: [{
        id: 'module_table',
        type: 'table',
        column: 'main',
        name: 'Table',
        settings: {
          borderThickness: '0',
          borderWidth: '1',
          columnsCount: '3',
          rowsCount: '2',
          tableContents: '[]',
        },
      }],
    }],
  });
  const settings = serialized.sections[0].modules[0].settings;
  assert.equal(settings.borderThickness, '0');
  assert.equal(settings.borderWidth, '0');
});

test('migrateLegacyLayoutSections maps 1-4-1 to one-four-one', () => {
  const migrated = migrateLegacyLayoutSections([{
    id: 'section_1',
    layout: '1-4-1',
    rowSettings: { padding: '20', margin: '0' },
    containerSettings: {
      col1: { padding: '12' },
      col2: { padding: '18' },
      col3: { padding: '12' },
    },
    modules: [],
  }]);

  const document = normalizeBuilderDocument(migrated);
  assert.equal(document.layoutSections.length, 1);
  assert.equal(normalizeLayout(document.layoutSections[0].layout), 'one-four-one');
  assert.notEqual(normalizeLayout(document.layoutSections[0].layout), 'three-column');
});

test('migrateLegacyLayoutSections preserves row background image settings', () => {
  const imageUrl = '/api/assets/drive-file/abc123';
  const migrated = migrateLegacyLayoutSections([{
    id: 'section_1',
    layout: '6',
    rowSettings: {
      margin: '0',
      padding: '20',
      background: {
        mode: 'image',
        imageUrl,
        imageAssetId: 'asset-42',
        color: '#ffffff',
        color2: '#eaf4ff',
        styleKey: '',
      },
    },
    background: {
      mode: 'image',
      imageUrl,
      imageAssetId: 'asset-42',
      color: '#ffffff',
      color2: '#eaf4ff',
      styleKey: '',
    },
    containerSettings: { col1: { padding: '18' } },
    modules: [],
  }]);

  const document = normalizeBuilderDocument(migrated);
  assert.equal(document.layoutSections[0].background.mode, 'image');
  assert.equal(document.layoutSections[0].background.imageUrl, imageUrl);

  const serialized = serializeBuilderDocument({ layoutSections: document.layoutSections });
  const roundTrip = normalizeBuilderDocument(serialized);
  assert.equal(roundTrip.layoutSections[0].background.mode, 'image');
  assert.equal(roundTrip.layoutSections[0].background.imageUrl, imageUrl);
});

test('migrateLegacyLayoutSections preserves textarea module content', () => {
  const html = '<p>Rich text block copy</p>';
  const migrated = migrateLegacyLayoutSections([{
    id: 'section_1',
    layout: '6',
    rowSettings: { margin: '0', padding: '20' },
    containerSettings: { col1: { padding: '18' } },
    modules: [{
      id: 'module_1',
      type: 'textarea',
      column: 'col1',
      name: 'Text Block',
      settings: {
        content: html,
        textAlign: 'left',
        textColor: '#173c61',
        backgroundColor: '#ffffff',
        maxWidth: 'full',
      },
    }],
  }]);

  const document = normalizeBuilderDocument(migrated);
  const module = document.layoutSections[0].modules[0];
  assert.equal(module.type, 'text');
  assert.equal(module.settings.content, html);

  const serialized = serializeBuilderDocument({ layoutSections: document.layoutSections });
  const roundTrip = normalizeBuilderDocument(serialized);
  assert.equal(roundTrip.layoutSections[0].modules[0].settings.content, html);
});

test('normalizeBuilderDocument preserves text block module background settings', () => {
  const imageUrl = '/api/assets/drive-file/text-bg';
  const migrated = migrateLegacyLayoutSections([{
    id: 'section_1',
    layout: '6',
    rowSettings: { margin: '0', padding: '20' },
    containerSettings: { col1: { padding: '18' } },
    modules: [{
      id: 'module_1',
      type: 'textarea',
      column: 'col1',
      name: 'Text Block',
      settings: {
        content: '<p>Styled copy</p>',
        textAlign: 'center',
        background: {
          mode: 'image',
          imageUrl,
          imageAssetId: 'asset-text-bg',
          color: '#ffffff',
          color2: '#eaf4ff',
          styleKey: '',
        },
      },
    }],
  }]);

  const document = normalizeBuilderDocument(migrated);
  const background = document.layoutSections[0].modules[0].settings.background;
  assert.equal(background.mode, 'image');
  assert.equal(background.imageUrl, imageUrl);

  const serialized = serializeBuilderDocument({ layoutSections: document.layoutSections });
  const roundTrip = normalizeBuilderDocument(serialized);
  const roundTripBackground = roundTrip.layoutSections[0].modules[0].settings.background;
  assert.equal(roundTripBackground.mode, 'image');
  assert.equal(roundTripBackground.imageUrl, imageUrl);
});

test('migrateLegacyLayoutSections preserves row overlay screen settings', () => {
  const migrated = migrateLegacyLayoutSections([{
    id: 'section_1',
    layout: '6',
    rowSettings: {
      margin: '0',
      padding: '20',
      background: { mode: 'image', imageUrl: '/api/assets/drive-file/row-bg', imageAssetId: 'asset-row', color: '#ffffff', color2: '#eaf4ff', styleKey: '' },
      overlayScreen: {
        background: { mode: 'color', color: '#071a33', color2: '#eaf4ff', imageUrl: '', imageAssetId: '', styleKey: '' },
        opacity: 45,
      },
    },
    containerSettings: { col1: { padding: '18' } },
    modules: [],
  }]);

  const document = normalizeBuilderDocument(migrated);
  const overlay = document.layoutSections[0].overlayScreen;
  assert.equal(overlay.background.mode, 'color');
  assert.equal(overlay.background.color, '#071a33');
  assert.equal(overlay.opacity, 45);

  const serialized = serializeBuilderDocument({ layoutSections: document.layoutSections });
  const roundTrip = normalizeBuilderDocument(serialized);
  assert.equal(roundTrip.layoutSections[0].overlayScreen.opacity, 45);
  assert.equal(roundTrip.layoutSections[0].overlayScreen.background.color, '#071a33');
});

test('serializeBuilderDocument preserves section row border settings', () => {
  const input = {
    layoutSections: [{
      id: 'section-1',
      layout: 'single',
      title: '',
      alignment: 'center',
      marginTop: '0',
      marginBottom: '0',
      rowBorderWidth: '3',
      rowBorderColor: '#ff5500',
      rowBorderStyle: 'dashed',
      rowBorderRadius: '12',
      mobileHidden: 'false',
      desktopHidden: 'false',
      mobileLayout: 'stack',
      background: { mode: 'color', color: '#eef6ff', color2: '#eaf4ff', imageUrl: '', styleKey: '' },
      cellBackgrounds: { main: { mode: 'none', color: '#ffffff', color2: '#eaf4ff', imageUrl: '', styleKey: '' } },
      cellPadding: { main: '18' },
      cellVerticalMargin: { main: '0' },
      cellMobileHidden: { main: 'false' },
      cellDesktopHidden: { main: 'false' },
      cellBorderWidth: { main: '0' },
      cellBorderColor: { main: 'transparent' },
      cellBorderRadius: { main: '24' },
      cellBorderStyle: { main: 'solid' },
      cellShadow: { main: 'none' },
      cellOpacity: { main: '1' },
      cellHAlign: { main: 'left' },
      cellVAlign: { main: 'top' },
      modules: [],
    }],
  };

  const serialized = serializeBuilderDocument(input);
  const section = serialized.sections[0];
  assert.equal(section.rowBorderWidth, '3');
  assert.equal(section.rowBorderColor, '#ff5500');
  assert.equal(section.rowBorderStyle, 'dashed');
  assert.equal(section.rowBorderRadius, '12');

  const roundTrip = normalizeBuilderDocument(serialized);
  const restored = roundTrip.layoutSections[0];
  assert.equal(restored.rowBorderWidth, '3');
  assert.equal(restored.rowBorderColor, '#ff5500');
  assert.equal(restored.rowBorderStyle, 'dashed');
  assert.equal(restored.rowBorderRadius, '12');
  assert.equal(restored.alignment, 'center');
  assert.equal(restored.background.mode, 'color');
  assert.equal(restored.background.color, '#eef6ff');
});

test('serializeBuilderDocument preserves cell border settings', () => {
  const input = {
    layoutSections: [{
      id: 'section-1',
      layout: 'single',
      title: '',
      alignment: 'left',
      marginTop: '0',
      marginBottom: '0',
      rowBorderWidth: '0',
      rowBorderColor: '#000000',
      rowBorderStyle: 'solid',
      rowBorderRadius: '0',
      mobileHidden: 'false',
      desktopHidden: 'false',
      mobileLayout: 'stack',
      background: { mode: 'none', color: '#ffffff', color2: '#eaf4ff', imageUrl: '', styleKey: '' },
      cellBackgrounds: { main: { mode: 'none', color: '#ffffff', color2: '#eaf4ff', imageUrl: '', styleKey: '' } },
      cellPadding: { main: '18' },
      cellVerticalMargin: { main: '0' },
      cellMobileHidden: { main: 'false' },
      cellDesktopHidden: { main: 'false' },
      cellBorderWidth: { main: '4' },
      cellBorderColor: { main: '#336699' },
      cellBorderRadius: { main: '16' },
      cellBorderStyle: { main: 'dashed' },
      cellShadow: { main: 'none' },
      cellOpacity: { main: '1' },
      cellHAlign: { main: 'left' },
      cellVAlign: { main: 'top' },
      modules: [],
    }],
  };

  const stored = serializeBuilderDocument(input);
  const section = stored.sections[0];
  assert.equal(section.cellBorderWidth.main, '4');
  assert.equal(section.cellBorderColor.main, '#336699');
  assert.equal(section.cellBorderRadius.main, '16');
  assert.equal(section.cellBorderStyle.main, 'dashed');

  const loaded = normalizeBuilderDocument(stored);
  const restored = loaded.layoutSections[0];
  assert.equal(restored.cellBorderWidth.main, '4');
  assert.equal(restored.cellBorderColor.main, '#336699');
  assert.equal(restored.cellBorderRadius.main, '16');
});

test('serializeBuilderDocument wraps bare arrays', () => {
  const serialized = serializeBuilderDocument({
    layoutSections: [{
      id: 'section-1',
      layout: 'single',
      title: '',
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
      modules: [],
    }],
  });

  assert.ok(serialized.pageBackground);
  assert.equal(Array.isArray(serialized.sections), true);
  assert.equal(serialized.sections.length, 1);
});

test('migrateLegacyEmailBlocksToDocument creates single-section email doc', () => {
  const document = migrateLegacyEmailBlocksToDocument({
    subject: 'Welcome',
    heading: 'Hello there',
    body: 'Thanks for joining.',
    cta: 'Get Started',
  });
  const normalized = normalizeBuilderDocument(document);
  assert.equal(normalized.layoutSections.length, 1);
  assert.ok(normalized.layoutSections[0].modules.length >= 2);
});
