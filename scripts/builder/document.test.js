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

function serializeTableSettings(settings) {
  const serialized = serializeBuilderDocument({
    layoutSections: [{
      id: 'section_1',
      layout: 'single',
      modules: [{
        id: 'module_table',
        type: 'table',
        column: 'main',
        name: 'Table',
        settings: { columnsCount: '3', rowsCount: '2', tableContents: '[]', ...settings },
      }],
    }],
  });
  return serialized.sections[0].modules[0].settings;
}

test('serializeBuilderDocument keeps a borderless table borderless', () => {
  // The requirement this has always protected: 0 is an answer, not an absence,
  // and must not be coerced back to the 1px default.
  const settings = serializeTableSettings({ borderWidth: '0' });
  assert.equal(settings.borderWidth, '0');
  assert.equal(settings.borderThickness, '0');
});

test('serializeBuilderDocument takes the table border width the editor wrote', () => {
  // Until 2026-08-11 this asserted the opposite — that `borderThickness` won
  // over `borderWidth`. That precedence WAS the bug the operator reported
  // ("the border color setting works, but not the size"): the editor writes
  // borderWidth, so making the mirror authoritative meant every size change
  // was reverted on the next load. The old fixture's split state
  // (borderThickness 0, borderWidth 1) is not one the app can produce — no
  // table path seeds borderThickness, and normalization writes both keys to
  // the same value — so it was testing the mechanism, not a real requirement.
  const settings = serializeTableSettings({ borderThickness: '1', borderWidth: '4' });
  assert.equal(settings.borderWidth, '4');
  assert.equal(settings.borderThickness, '4');
});

test('serializeBuilderDocument still reads the legacy mirror when it is all there is', () => {
  const settings = serializeTableSettings({ borderThickness: '3' });
  assert.equal(settings.borderWidth, '3');
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

test('migrateLegacyLayoutSections preserves video background mode and videoUrl', () => {
  const migrated = migrateLegacyLayoutSections([{
    id: 'section_video',
    layout: 'single',
    rowSettings: {
      background: {
        mode: 'video',
        videoUrl: '/assets/background.mp4',
        posterUrl: '/assets/poster.jpg',
        videoSpeed: 1,
        videoLoop: true,
      },
    },
    modules: [],
  }]);

  const document = normalizeBuilderDocument(migrated);
  assert.equal(document.layoutSections[0].background.mode, 'video');
  assert.equal(document.layoutSections[0].background.videoUrl, '/assets/background.mp4');
  assert.equal(document.layoutSections[0].background.posterUrl, '/assets/poster.jpg');
});


// ---------------------------------------------------------------------------
// Task 86bc0bb73 — saving a page must not revert a row's modern settings.
//
// public/js/builder.js adds `rowSettings` and `containerSettings` to every
// section it sends on a save (line 5446), which makes isLegacySectionArray
// call an ORDINARY SAVE legacy and route it through the Normie import
// migrator. That migrator rebuilt each section from a fixed field list, so
// every modern row setting came back at its default: a full-width row boxed
// itself back in on every save, with no message to the operator.
//
// The payloads below are the editor's own shape — the legacy trigger fields
// sitting alongside the modern ones, which is exactly what a save sends.
//
// Task 86bc0d1fg — saving a page must not wipe that page's own typography.
//
// public/js/builder.js puts `rowSettings` and `containerSettings` on every
// section it sends on a save (line 5446), which makes isLegacySectionArray
// call an ORDINARY SAVE legacy and route it through the Normie import
// migrator. That migrator rebuilt the DOCUMENT from a two-field list --
// pageBackground and sections -- so the page's `theme` was dropped and the
// normalizer downstream supplied the default. Heading sizes, line heights and
// heading weights all reverted, with nothing said. Measured 2026-09-14:
// 183 stored pages carry a real theme scale and all 183 lost it on a save.
//
// EDITOR_TRIGGER below is the editor's own shape: the two legacy trigger
// fields sitting alongside the modern ones, which is what a save sends.
// ---------------------------------------------------------------------------

const EDITOR_TRIGGER = {
  rowSettings: { margin: '0', padding: '20' },
  containerSettings: { col1: { padding: '18' } },
};

test('serializeBuilderDocument keeps a full-width row full width on an ordinary save', () => {
  const serialized = serializeBuilderDocument({
    layoutSections: [{
      id: 'section_1',
      layout: '3-3',
      title: 'Hero',
      widthMode: 'full-width',
      ...EDITOR_TRIGGER,
      modules: [{ id: 'module_1', type: 'text', column: 'col1', text: '<p>x</p>', settings: {} }],
    }],
  });

  assert.equal(serialized.sections[0].widthMode, 'full-width');
});

test('a full-width row survives saving the page twice with no edits', () => {
  // The operator's actual report: it is the SECOND save that was reported,
  // because the first one is the edit itself. Feed the serializer its own
  // output, which is what re-opening the page and pressing Save again does.
  const first = serializeBuilderDocument({
    layoutSections: [{
      id: 'section_1',
      layout: '3-3',
      widthMode: 'full-width',
      ...EDITOR_TRIGGER,
      modules: [{ id: 'module_1', type: 'text', column: 'col1', text: '<p>x</p>', settings: {} }],
    }],
  });
  const second = serializeBuilderDocument({
    layoutSections: first.sections.map((section) => ({ ...section, ...EDITOR_TRIGGER })),
  });

  assert.equal(first.sections[0].widthMode, 'full-width');
  assert.equal(second.sections[0].widthMode, 'full-width');
});

test('an ordinary save keeps every modern row setting, not just widthMode', () => {
  // widthMode is the one a person notices; it was lost with 34 other fields.
  // Measured 2026-09-14 by diffing one editor-shaped section through
  // serializeBuilderDocument with and without the legacy trigger.
  const section = {
    id: 'section_1',
    layout: '3-3',
    title: 'Hero',
    widthMode: 'full-width',
    widthPercent: '80',
    isPrivate: true,
    alignment: 'center',
    marginTop: '11',
    marginBottom: '12',
    paddingTop: '13',
    paddingBottom: '14',
    paddingLeft: '15',
    paddingRight: '16',
    marginLeft: '17',
    marginRight: '18',
    columnGap: '19',
    minHeight: '400',
    columnWidths: { left: '30', right: '70' },
    equalColumnHeights: 'true',
    horizontalOffset: '5',
    verticalOffset: '6',
    mobileHidden: 'true',
    desktopHidden: 'true',
    mobileLayout: 'reverse-stack',
    cellPaddingTop: { left: '22', right: '22' },
    cellMarginBottom: { left: '27', right: '27' },
    cellIsPrivate: { left: 'true', right: 'true' },
    ...EDITOR_TRIGGER,
    modules: [{ id: 'module_1', type: 'text', column: 'col1', text: '<p>x</p>', settings: {} }],
  };

  const saved = serializeBuilderDocument({ layoutSections: [section] }).sections[0];

  assert.equal(saved.widthMode, 'full-width');
  assert.equal(saved.widthPercent, '80');
  assert.equal(saved.isPrivate, true);
  assert.equal(saved.alignment, 'center');
  assert.equal(saved.marginTop, '11');
  assert.equal(saved.marginBottom, '12');
  assert.equal(saved.paddingTop, '13');
  assert.equal(saved.paddingBottom, '14');
  assert.equal(saved.paddingLeft, '15');
  assert.equal(saved.paddingRight, '16');
  assert.equal(saved.marginLeft, '17');
  assert.equal(saved.marginRight, '18');
  assert.equal(saved.columnGap, '19');
  assert.equal(saved.minHeight, '400');
  assert.deepEqual(saved.columnWidths, { left: '30', right: '70' });
  assert.equal(saved.equalColumnHeights, 'true');
  assert.equal(saved.horizontalOffset, '5');
  assert.equal(saved.verticalOffset, '6');
  assert.equal(saved.mobileHidden, 'true');
  assert.equal(saved.desktopHidden, 'true');
  assert.equal(saved.mobileLayout, 'reverse-stack');
  assert.equal(saved.cellPaddingTop.left, '22');
  assert.equal(saved.cellMarginBottom.left, '27');
  assert.equal(saved.cellIsPrivate.left, 'true');
});

test('a genuine legacy Normie section still migrates, and legacy values still win', () => {
  // The carry-through must not turn the migrator off. A real import carries
  // none of the modern fields, so every value below is still derived from
  // rowSettings/containerSettings and the legacy layout code.
  const saved = serializeBuilderDocument({
    layoutSections: [{
      id: 'section_1',
      layout: '2-2-2',
      title: 'Imported',
      rowSettings: { margin: '8', padding: '20', backgroundColor: '#eef6ff' },
      containerSettings: {
        col1: { padding: '12', borderColor: '#000000', borderThickness: '2', borderRadius: '8' },
        col2: { padding: '16' },
        col3: { padding: '16' },
      },
      modules: [{ id: 'module_1', type: 'headline', column: 'col1', name: 'Hero', text: 'Hello', settings: {} }],
    }],
  }).sections[0];

  assert.equal(normalizeLayout(saved.layout), 'three-column');
  assert.equal(saved.modules[0].type, 'heading');
  assert.equal(saved.modules[0].column, 'left');
  assert.equal(saved.marginTop, '8', 'marginTop still comes from rowSettings.margin');
  assert.equal(saved.cellPadding.left, '12', 'cell padding still comes from containerSettings');
  assert.equal(saved.cellBorderWidth.left, '2');
  assert.equal(saved.cellBorderColor.left, '#000000');
  assert.equal(saved.background.mode, 'color', 'row background still rebuilt from rowSettings');
  assert.equal(saved.widthMode, 'contained', 'an import with no widthMode still defaults');
});

test('an ordinary save keeps a row background\'s own settings', () => {
  // Round-1 review of task 86bc0bb73: the first measurement compared TOP-LEVEL
  // section keys, so it could not see inside `background` -- which the
  // section-level carry deliberately hands to the legacy normalizer. Six
  // settings were still reverting on every save with no message.
  const serialized = serializeBuilderDocument({
    layoutSections: [{
      id: 'section_1',
      layout: '3-3',
      ...EDITOR_TRIGGER,
      background: {
        mode: 'gradient',
        color: '#112233',
        color2: '#445566',
        gradientAngle: 120,
        opacity: 55,
        imageAssetId: 'asset_123',
        parallax: true,
        parallaxSpeed: 0.7,
      },
      overlayScreen: {
        background: { mode: 'color', color: '#010203' },
        opacity: 40,
        blendMode: 'multiply',
      },
      modules: [{ id: 'module_1', type: 'text', column: 'col1', text: '<p>x</p>', settings: {} }],
    }],
  });

  const { background, overlayScreen } = serialized.sections[0];
  assert.equal(background.gradientAngle, 120, 'gradient angle reverted to 135');
  assert.equal(background.opacity, 55, 'background opacity reverted to 100');
  assert.equal(background.imageAssetId, 'asset_123', 'image asset id was blanked');
  assert.equal(background.parallax, true, 'parallax reverted to off');
  assert.equal(background.parallaxSpeed, 0.7, 'parallax speed reverted to the default');
  assert.equal(overlayScreen.blendMode, 'multiply', 'overlay blend mode reverted to normal');
  assert.equal(overlayScreen.opacity, 40);
});

test('a row with no background keeps the colour the operator picked', () => {
  // The Builder's background panel holds the colour, gradient angle and image
  // it last had while the mode sits at "none", so blanking them here meant the
  // chosen colour was gone the moment the operator switched the mode back on.
  const serialized = serializeBuilderDocument({
    layoutSections: [{
      id: 'section_1',
      layout: '3-3',
      ...EDITOR_TRIGGER,
      background: {
        mode: 'none',
        color: '#123456',
        color2: '#654321',
        gradientAngle: 120,
        imageUrl: 'https://example.com/a.png',
        imageAssetId: 'asset_9',
        opacity: 55,
      },
      modules: [{ id: 'module_1', type: 'text', column: 'col1', text: '<p>x</p>', settings: {} }],
    }],
  });

  const { background } = serialized.sections[0];
  assert.equal(background.mode, 'none', 'the row still shows no background');
  assert.equal(background.color, '#123456');
  assert.equal(background.color2, '#654321');
  assert.equal(background.gradientAngle, 120);
  assert.equal(background.imageUrl, 'https://example.com/a.png');
  assert.equal(background.imageAssetId, 'asset_9');
  assert.equal(background.opacity, 55);
});

test('a scalar cellPadding does not clobber the map built from containerSettings', () => {
  // mergeNormieCellFields shape-guards the twelve per-column maps on purpose: a
  // scalar means the sender is not speaking the per-column shape, and taking it
  // replaces a real map with one the normalizer reads as "no columns set".
  // The round-1 carry-through copied anything non-null and undid that guard --
  // a measured step backwards from main in the PR meant to stop settings being
  // lost.
  const serialized = serializeBuilderDocument({
    layoutSections: [{
      id: 'section_1',
      layout: '3-3',
      rowSettings: { margin: '0', padding: '20' },
      containerSettings: { col1: { padding: '40' }, col2: { padding: '40' } },
      cellPadding: '14',
      modules: [{ id: 'module_1', type: 'text', column: 'col1', text: '<p>x</p>', settings: {} }],
    }],
  });

  assert.equal(serialized.sections[0].cellPadding.left, '40', 'containerSettings padding was clobbered by a scalar');
  assert.equal(serialized.sections[0].cellPadding.right, '40');
});

test('an object cellPadding still wins over containerSettings', () => {
  const serialized = serializeBuilderDocument({
    layoutSections: [{
      id: 'section_1',
      layout: '3-3',
      rowSettings: { margin: '0', padding: '20' },
      containerSettings: { col1: { padding: '40' }, col2: { padding: '40' } },
      cellPadding: { left: '7', right: '7' },
      modules: [{ id: 'module_1', type: 'text', column: 'col1', text: '<p>x</p>', settings: {} }],
    }],
  });

  assert.equal(serialized.sections[0].cellPadding.left, '7', 'the modern per-column map must still win');
  assert.equal(serialized.sections[0].cellPadding.right, '7');
});

test('an ordinary save changes NOTHING a save without the legacy trigger would not', () => {
  // The whole-loss guard, and the instrument the ticket asked for turned into a
  // permanent one. A section carrying rowSettings/containerSettings is routed
  // through the legacy migrator; the same section without them goes straight to
  // the normalizer. Comparing the two OUTPUTS -- rather than input against
  // output -- is what separates a real loss from the normalizer's own clamping,
  // which is what made parallaxSpeed 1.5 -> 1 read as a loss when 1 is simply
  // the maximum.
  //
  // It is a deepEqual rather than a field list on purpose: a list has to be
  // extended by hand every time builder-template.ts grows a section setting,
  // and the day somebody forgets is the day a setting starts silently
  // reverting again -- which is exactly how this bug reached a client.
  const modules = [{ id: 'module_1', type: 'text', column: 'left', text: '<p>x</p>', settings: {} }];
  const bare = { id: 'section_1', layout: 'two-column', title: 'Hero', modules };

  // Start from the serializer's own output, so the payload stays in step with
  // the section shape instead of freezing today's field list into the test.
  const populated = {
    ...serializeBuilderDocument({ layoutSections: [bare] }).sections[0],
    modules,
    widthMode: 'full-width',
    alignment: 'center',
    marginTop: '40',
    marginBottom: '60',
    mobileLayout: 'reverse-stack',
    minHeight: '480',
    background: {
      mode: 'gradient',
      color: '#112233',
      color2: '#445566',
      gradientAngle: 120,
      opacity: 55,
      imageAssetId: 'asset_123',
      parallax: true,
      parallaxSpeed: 0.7,
    },
    overlayScreen: {
      background: { mode: 'color', color: '#010203' },
      opacity: 40,
      blendMode: 'multiply',
    },
    // A near-white cell fill is discarded whole by
    // sanitizeCellBackgroundForDrillDown, so this has to be dark to be a test
    // of anything at all.
    cellBackgrounds: {
      left: { mode: 'color', color: '#123456', opacity: 55, gradientAngle: 77 },
      right: { mode: 'color', color: '#654321' },
    },
    cellPadding: { left: '31', right: '32' },
    cellBorderWidth: { left: '3', right: '4' },
  };

  const withoutTrigger = serializeBuilderDocument({ layoutSections: [populated] }).sections[0];
  const withTrigger = serializeBuilderDocument({
    layoutSections: [{ ...populated, ...EDITOR_TRIGGER }],
  }).sections[0];

  // rowSettings/containerSettings are the legacy input itself; the migrator is
  // the authority on what they become, so they are the one thing the two runs
  // are entitled to disagree about.
  assert.deepEqual(
    { ...withTrigger, cellPadding: null, marginTop: null },
    { ...withoutTrigger, cellPadding: null, marginTop: null },
    'an ordinary save lost or changed a setting that a save without the legacy trigger kept'
  );
});

const PAGE_THEME = {
  typography: {
    scale: {
      baseSize: 18,
      ratio: 1.25,
      baseLineHeight: 1.6,
      h1: 36,
      h2: 30,
      h3: 24,
      h1Lh: 1.4,
      h1Fw: 900,
    },
  },
};

function sectionFromEditor(extra = {}) {
  return {
    id: 'section_1',
    layout: '3-3',
    title: 'Hero',
    ...EDITOR_TRIGGER,
    modules: [{ id: 'module_1', type: 'text', column: 'col1', text: '<p>x</p>', settings: {} }],
    ...extra,
  };
}

test('serializeBuilderDocument keeps the page theme on an ordinary save', () => {
  const serialized = serializeBuilderDocument({
    theme: PAGE_THEME,
    layoutSections: [sectionFromEditor()],
  });

  assert.deepEqual(serialized.theme.typography.scale, PAGE_THEME.typography.scale);
});

test('the page theme survives saving the page twice with no edits', () => {
  // The operator sees it on a save that changed nothing, so feed the
  // serializer its own output — which is what re-opening the page and
  // pressing Save Page again does.
  const first = serializeBuilderDocument({
    theme: PAGE_THEME,
    layoutSections: [sectionFromEditor()],
  });
  const second = serializeBuilderDocument({
    theme: first.theme,
    layoutSections: first.sections.map((section) => ({ ...section, ...EDITOR_TRIGGER })),
  });

  assert.equal(first.theme.typography.scale.h1, 36);
  assert.equal(second.theme.typography.scale.h1, 36);
  assert.deepEqual(second.theme.typography.scale, PAGE_THEME.typography.scale);
});

test('a genuine legacy Normie import carries no theme and still gets the default', () => {
  // The control for the fix: an import has no theme of its own, so the
  // carry-through must not invent one, and the default must still arrive.
  const serialized = serializeBuilderDocument({
    layoutSections: [sectionFromEditor()],
  });

  assert.ok(serialized.theme, 'an import still gets a theme object');
  assert.equal(serialized.theme.typography.scale.baseSize, 0);
  assert.equal(serialized.theme.typography.scale.ratio, 0);
  assert.equal(serialized.theme.typography.scale.baseLineHeight, 0);
});

test('migrateLegacyLayoutSections leaves one section list, not two', () => {
  // The carry-through spreads the document, so a payload spelled
  // `layoutSections` would otherwise come back holding BOTH that raw list and
  // the migrated `sections` — and the two readers of this document disagree
  // about which alias wins.
  const migrated = migrateLegacyLayoutSections({
    theme: PAGE_THEME,
    layoutSections: [sectionFromEditor()],
  });

  assert.ok(Array.isArray(migrated.sections));
  assert.equal(migrated.layoutSections, undefined);
  assert.deepEqual(migrated.theme, PAGE_THEME);
});
