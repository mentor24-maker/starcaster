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

/**
 * The background fields this migrator TRANSLATES out of the legacy shape, and
 * is therefore the authority on. Everything else a background object carries
 * belongs to whoever sent it.
 *
 * Same reasoning as LEGACY_OWNED_SECTION_FIELDS one level up, and found the
 * same way: the round-1 review of task 86bc0bb73 measured the section's TOP
 * LEVEL only, so it could not see inside `background` — which the section-level
 * blocklist deliberately hands to this function. Measured 2026-09-14 through
 * serializeBuilderDocument, an ordinary Save Page reset a row's gradient angle
 * (120 -> 135), its background opacity (55 -> 100), its image asset id, and
 * both parallax settings (true/1.5 -> false/0.3), silently and every time.
 *
 * A blocklist rather than a list of what to keep, for the same reason: a list
 * of fields to KEEP has to be extended by hand every time BackgroundSettings
 * grows one, and the day somebody forgets is the day a setting starts silently
 * reverting again. Nothing unknown reaches the database either way —
 * template.normalizeBackgroundSettings whitelists the object immediately after.
 */
const LEGACY_OWNED_BACKGROUND_FIELDS = new Set([
  'mode',
  'color',
  'color2',
  'imageUrl',
  'styleKey',
]);
// The five above are the whole legacy background vocabulary. Everything a
// StarCaster background also carries -- the video clip and its poster, speed,
// trim, blur and focal point, the gradient angle, the opacity, the image asset
// id, parallax -- has no legacy counterpart to translate FROM, so this migrator
// was re-defaulting fields it had no opinion about.
//
// That mattered because its coercion is stricter than the normalizer's:
// `typeof value.videoSpeed === 'number' ? value.videoSpeed : 1` throws away a
// numeric STRING that template.normalizeBackgroundSettings would have read
// fine, so a value arriving as "1.5" came back as 1. Leaving them unowned hands
// each one to the normalizer that is actually the authority on it.

/**
 * `background` and `opacity` are what normalizeLegacyOverlayScreen rebuilds;
 * anything else on the overlay (today: `blendMode`) is the sender's.
 */
const LEGACY_OWNED_OVERLAY_FIELDS = new Set(['background', 'opacity']);

/**
 * Copy across every key the migrator did not translate, so migrating an object
 * TRANSLATES its legacy parts instead of DELETING its modern ones.
 *
 * `source` is only read when it is a plain object — the legacy-colour and
 * no-background paths build their result from a scalar or from nothing, so
 * there is no modern object there to carry anything from.
 */
function carryUnownedFields(normalized, source, owned) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return normalized;
  for (const key of Object.keys(source)) {
    if (owned.has(key)) continue;
    const value = source[key];
    if (value === undefined || value === null) continue;
    normalized[key] = value;
  }
  return normalized;
}

function normalizeLegacyBackgroundSettings(value, legacyColor = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const mode = safeText(value.mode, 20).toLowerCase();
    if (mode === 'transparent') {
      return carryUnownedFields({
        mode: 'color',
        color: 'transparent',
        color2: '#eaf4ff',
        imageUrl: '',
        styleKey: '',
        videoUrl: '',
        videoAssetId: '',
        posterUrl: '',
        posterAssetId: '',
      }, value, LEGACY_OWNED_BACKGROUND_FIELDS);
    }
    // `none` is on this list because it is a legitimate MODERN mode, not an
    // absent background: the Builder's panel keeps the colour, gradient angle,
    // image and opacity the operator last chose while the mode sits at "none",
    // so rebuilding from defaults here blanked all of them on every save and
    // the chosen colour was gone the moment they switched the mode back on.
    // Reaching the legacy-colour path below now means the mode was genuinely
    // unrecognised, which is what that path was always for.
    if (['none', 'color', 'gradient', 'image', 'style', 'video'].includes(mode)) {
      const recognised = carryUnownedFields({
        mode,
        color: safeText(value.color, 40) || '#ffffff',
        color2: safeText(value.color2, 40) || '#eaf4ff',
        imageUrl: safeText(value.imageUrl, 2000),
        styleKey: safeText(value.styleKey, 80),
        videoUrl: safeText(value.videoUrl, 2000),
        videoAssetId: safeText(value.videoAssetId, 120),
        posterUrl: safeText(value.posterUrl, 2000),
        posterAssetId: safeText(value.posterAssetId, 120),
        videoSpeed: typeof value.videoSpeed === 'number' ? value.videoSpeed : 1,
        videoLoop: value.videoLoop === undefined ? true : value.videoLoop !== false,
        videoLoopFade: typeof value.videoLoopFade === 'number' ? value.videoLoopFade : 0.6,
        videoTrimStart: typeof value.videoTrimStart === 'number' ? value.videoTrimStart : 0,
        videoTrimEnd: typeof value.videoTrimEnd === 'number' ? value.videoTrimEnd : 0,
        videoBlur: typeof value.videoBlur === 'number' ? value.videoBlur : 0,
        videoPlayOnMobile: value.videoPlayOnMobile === true,
        videoFocalX: typeof value.videoFocalX === 'number' ? value.videoFocalX : 50,
        videoFocalY: typeof value.videoFocalY === 'number' ? value.videoFocalY : 50,
      }, value, LEGACY_OWNED_BACKGROUND_FIELDS);
      // A recognised `none` still has to honour a legacy colour sitting beside
      // it, which is what this function did before `none` joined the list
      // above: a genuine Normie import saying {mode:'none', color:X} plus
      // backgroundColor:Y used to show Y, and would otherwise now show
      // nothing. The Builder's own client performs exactly this promotion
      // before it sends (public/js/builder.js, normalizeBackgroundSettings),
      // so doing it here keeps the two ends agreeing rather than leaving the
      // server the only reader that renders that pair blank. The modern
      // fields still ride along, so the save-path fix above is untouched —
      // only `mode` and `color` move.
      const promoted = safeText(legacyColor, 40);
      if (recognised.mode === 'none' && promoted) {
        // `transparent` reaches mode 'color' with the colour 'transparent',
        // which is the spelling the legacy path below already uses and the
        // one normalizeBackgroundSettings downstream recognises.
        return {
          ...recognised,
          mode: 'color',
          color: promoted.toLowerCase() === 'transparent' ? 'transparent' : promoted,
        };
      }
      return recognised;
    }
  }
  const bgColor = safeText(legacyColor, 40);
  if (bgColor) {
    if (bgColor.toLowerCase() === 'transparent') {
      return carryUnownedFields({
        mode: 'color',
        color: 'transparent',
        color2: '#eaf4ff',
        imageUrl: '',
        styleKey: '',
      }, value, LEGACY_OWNED_BACKGROUND_FIELDS);
    }
    return carryUnownedFields({
      mode: 'color',
      color: bgColor,
      color2: '#eaf4ff',
      imageUrl: '',
      styleKey: '',
    }, value, LEGACY_OWNED_BACKGROUND_FIELDS);
  }
  return carryUnownedFields({
    mode: 'none',
    color: '#ffffff',
    color2: '#eaf4ff',
    imageUrl: '',
    styleKey: '',
  }, value, LEGACY_OWNED_BACKGROUND_FIELDS);
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
  return carryUnownedFields({
    background: normalizeLegacyBackgroundSettings(value.background),
    opacity,
  }, value, LEGACY_OWNED_OVERLAY_FIELDS);
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
  // No candidate resolved to a VISIBLE background, so this row shows none. Its
  // other background settings are still the sender's: the Builder's background
  // panel keeps the colour, gradient angle, image and opacity it last held
  // while the mode sits at "none", so resolving from `null` here meant the
  // colour an operator had picked was gone the moment they switched the mode
  // back on — measured 2026-09-14 on task 86bc0bb73, six settings at once.
  // Passing the modern object instead lets carryUnownedFields see it.
  const modern = candidates.find((candidate) => (
    candidate && typeof candidate === 'object' && !Array.isArray(candidate)
  ));
  return normalizeLegacyBackgroundSettings(modern || null, rowSettings?.backgroundColor);
}

/**
 * The per-cell maps mergeNormieCellFields resolves, so the section-level carry
 * can name them in one place instead of listing them twice and drifting.
 *
 * Every one of these is a map keyed by column (`{left: '40', right: '40'}`),
 * translated out of `containerSettings` and then overridden by the section's
 * own value WHEN THAT VALUE IS A PLAIN OBJECT. That shape guard is the whole
 * point: a scalar here means the sender is not speaking the modern per-column
 * shape, and taking it would replace a real map with a value the downstream
 * normalizer reads as "no columns set" and fills with defaults.
 */
const NORMIE_CELL_FIELD_KEYS = [
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
];

function mergeNormieCellFields(section, containerSettings, layout) {
  const migrated = migrateContainerSettingsToCellFields(containerSettings, layout);
  if (!section || typeof section !== 'object') return migrated;
  if (section.cellBackgrounds && typeof section.cellBackgrounds === 'object' && !Array.isArray(section.cellBackgrounds)) {
    migrated.cellBackgrounds = section.cellBackgrounds;
  }
  NORMIE_CELL_FIELD_KEYS.forEach((key) => {
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

/**
 * Kept in step with LAYOUT_SPECS in lib/builder-client/builder-template.ts:
 * how many columns each layout carries. A layout missing here falls back to
 * two columns (the historical default for unknown names); a three-or-more
 * column layout missing from this list loses its centre column's modules on
 * migration — they fall through the two-column map and land wherever
 * `center` happens to resolve.
 */
const LAYOUT_COLUMN_COUNTS = {
  single: 1,
  'two-column': 2,
  'two-four': 2,
  'four-two': 2,
  'one-five': 2,
  'five-one': 2,
  'one-three': 2,
  'three-one': 2,
  'two-three': 2,
  'three-two': 2,
  'three-column': 3,
  'one-four-one': 3,
  'one-three-one': 3,
  'one-two-one': 3,
  'two-one-one': 3,
  'one-one-two': 3,
  'three-one-one': 3,
  'one-one-three': 3,
  'four-column': 4,
  'five-column': 5,
  'six-column': 6,
};

// Column keys by count. Past three columns the keys extend the three-column
// set (col4…col6) rather than renaming — same rule as builder-template.ts.
const LAYOUT_COLUMN_KEYS = {
  1: ['main'],
  2: ['left', 'right'],
  3: ['left', 'center', 'right'],
  4: ['left', 'center', 'right', 'col4'],
  5: ['left', 'center', 'right', 'col4', 'col5'],
  6: ['left', 'center', 'right', 'col4', 'col5', 'col6'],
};

function getLayoutColumnCount(layout) {
  const normalized = migrateLegacyLayout(layout);
  if (normalized === 'single') return 1;
  return LAYOUT_COLUMN_COUNTS[normalized] || 2;
}

function migrateLegacyColumn(column, layout) {
  const count = getLayoutColumnCount(layout);
  const col = safeText(column, 40).toLowerCase() || 'main';
  if (count >= 3) {
    // col4…col6 have no legacy spelling to map from; `|| col` keeps them.
    return LEGACY_COLUMN_MAP_THREE[col] || col;
  }
  if (count === 1) {
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

// A section or module that reaches the legacy migrator keeps the handful of
// fields the downstream meta rescue exists to put back.
//
// lib/builder/document.js rebuilds `locked`, `savedSectionId`, `canonical` and
// the `rowBorder*` values (and, one level down, `savedModuleId`, `canonical`,
// `canonicalLocked`) from the PRE-normalization input, because
// normalizeLayoutSections whitelists them away. That rescue reads whatever
// coerceLayoutInput handed it -- so when this migrator runs first and rebuilds
// each section from a fixed field list, the rescue is handed input that has
// already lost them and has nothing left to restore.
//
// That is not hypothetical. The modular page editor in public/js/builder.js
// adds `rowSettings` and `containerSettings` to every section it sends
// (line 5446), which makes isLegacySectionArray call every ordinary save
// legacy -- so clicking Save Page with no edits unlinked every shared block on
// the page, silently, and the page stopped taking updates from the original.
//
// The detector is deliberately NOT the thing being changed. A genuine Normie
// import and a vanilla-builder save have nearly the same shape (both carry the
// `3-3`/`6` layout codes, both carry `col1`/`col2`, both carry `rowSettings`),
// and `col4`/`col5`/`col6` are legitimate MODERN column names
// (lib/builder-client/builder-template.ts:994), so no shape test separates the
// two cleanly. Tightening it would buy a false negative -- a real legacy import
// quietly not migrating -- which is worse than the loss it would prevent.
// Carrying the lineage through costs nothing and cannot misfire.
function carryRescuableSectionMeta(migrated, section) {
  const next = migrated;
  if (section.locked === true) next.locked = true;
  if (typeof section.savedSectionId === 'string' && section.savedSectionId) {
    next.savedSectionId = safeText(section.savedSectionId, 120);
  }
  if (section.canonical === true) next.canonical = true;
  // The lineage stamp from task 86bbwe530 (landed on main while this passthrough
  // was in review). Same reason as savedSectionId: dropped here, every vanilla
  // save discards it and the retry fix silently does nothing on that page.
  if (typeof section.canonicalSourceHash === 'string' && section.canonicalSourceHash) {
    next.canonicalSourceHash = section.canonicalSourceHash;
  }
  for (const key of ['rowBorderWidth', 'rowBorderColor', 'rowBorderStyle', 'rowBorderRadius']) {
    const value = section[key];
    if (typeof value === 'string' && value.length) next[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) next[key] = String(value);
  }
  return next;
}

function carryRescuableModuleMeta(migrated, module) {
  const next = migrated;
  if (typeof module.savedModuleId === 'string' && module.savedModuleId) {
    next.savedModuleId = safeText(module.savedModuleId, 120);
  }
  // Tri-state on purpose: document.js reads an absent `canonical` as "legacy
  // silence", which means FOLLOWING, and reads `false` as an explicit break.
  // Coercing the absent case to false here would turn every following module
  // on a migrated page into an independent one.
  if (typeof module.canonical === 'boolean') next.canonical = module.canonical;
  if (module.canonicalLocked === true) next.canonicalLocked = true;
  return next;
}

function migrateLegacyModule(module, layout) {
  if (!module || typeof module !== 'object' || Array.isArray(module)) return null;
  const legacyType = safeText(module.type, 40).toLowerCase();
  const type = LEGACY_MODULE_TYPE_MAP[legacyType] || legacyType || 'text';
  return carryRescuableModuleMeta({
    id: safeText(module.id, 120),
    type,
    column: migrateLegacyColumn(module.column, layout),
    name: safeText(module.name, 255),
    text: safeText(module.text, 10000),
    contentId: safeText(module.contentId, 120),
    assetId: safeText(module.assetId, 120),
    sourceModuleId: safeText(module.sourceModuleId, 120),
    settings: migrateLegacyModuleSettings(type, module),
  }, module);
}

function migrateContainerSettingsToCellFields(containerSettings, layout) {
  const count = getLayoutColumnCount(layout);
  const columns = LAYOUT_COLUMN_KEYS[count] || LAYOUT_COLUMN_KEYS[2];
  const legacyKeys = columns.map((_, index) => `col${index + 1}`);

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

/**
 * The fields migrateLegacySection is the authority on, because it TRANSLATES
 * them out of the legacy shape: the layout code (`6` -> `three-column`), the
 * row background and overlay (rebuilt from `rowSettings`), the modules (each
 * one migrated), and the id/title (length-capped). Everything else on a
 * section belongs to whoever sent it.
 *
 * `cellBackgrounds` and the twelve NORMIE_CELL_FIELD_KEYS maps are here because
 * mergeNormieCellFields already resolves them one call earlier, with the same
 * "modern value wins" rule PLUS a shape guard this carry cannot reproduce.
 *
 * Leaving them out was a measured step backwards from `main` (round-1 review of
 * task 86bc0bb73): this carry copies anything non-null, so a scalar
 * `section.cellPadding` overwrote the map mergeNormieCellFields had just
 * translated out of `containerSettings` — `{left: '40', right: '40'}` became
 * `{left: '0', right: '0'}` once the normalizer downstream read the scalar as
 * an empty map. Nothing in the app sends a scalar there today, so no page was
 * harmed; it was still a regression in the one PR whose purpose is to stop
 * settings being lost. One function owns cell fields, and it is that one.
 */
const LEGACY_OWNED_SECTION_FIELDS = new Set([
  'id',
  'title',
  'layout',
  'background',
  'overlayScreen',
  'cellBackgrounds',
  'modules',
  'rowSettings',
  'containerSettings',
  ...NORMIE_CELL_FIELD_KEYS,
]);

/**
 * Overlay the section's own fields onto the migrated result, so migrating a
 * section TRANSLATES the legacy parts instead of DELETING the modern ones.
 *
 * migrateLegacySection rebuilds each section from a fixed field list, and
 * anything not on that list is simply gone -- the downstream normalizer then
 * supplies its default. That is correct for a genuine Normie import, which
 * carries none of these fields. It is wrong for an ordinary save.
 *
 * WHICH ordinary save, exactly -- because the two editors reach this code by
 * different arms of isLegacySectionArray, and only one of them can lose
 * anything (measured in the round-2 review, 2026-09-15):
 *
 *   - `public/js/builder.js` adds `rowSettings` and `containerSettings` to
 *     every section it sends (line 5446), which trips the detector's first two
 *     arms on every save. But that editor contains ZERO occurrences of
 *     `widthMode` and emits only id/layout/title/collapsed/rowSettings/
 *     containerSettings/modules plus the lineage flags, so it has nothing for
 *     this carry to rescue. It trips the trap and is not hurt by it.
 *   - The React builder (`lib/builder-client/`, `components/`) is the arm that
 *     sends these fields -- and it has no `rowSettings` or `containerSettings`
 *     anywhere, so it can only arrive through the detector's THIRD arm:
 *     /^col\d+$/ on the first module's column. The modern column ids are
 *     main / left / center / right plus col4 / col5 / col6, which exist on the
 *     four-, five- and six-column layouts only (builder-template.ts:995).
 *
 * So the loss needs a page whose FIRST section's FIRST module sits in
 * `col4`, `col5` or `col6`. Measured 2026-09-15 against LIVE production
 * (read-only), over all 133 section-carrying pages:
 *
 *     first section's first module in col4/col5/col6 :   0
 *     pages using col4/col5/col6 anywhere            :  79
 *     full-width sections stored                     : 359
 *
 * None does today, which is why those 359 full-width sections have stayed
 * full width -- the same answer from the other direction. But 79 pages
 * already use those wide layouts, so the hazard is LATENT rather than absent:
 * move such a section to the top of a page, or drag its first module into
 * col4, and from then on every save of that page quietly resets the settings
 * below. (Two pages DO have a first module in `col1`, which matches the same
 * /^col\d+$/ arm. They are vanilla-editor pages carrying neither
 * `rowSettings` nor `widthMode`, so there is nothing there to lose.)
 *
 * Measured on 2026-09-14 (task 86bc0bb73) by diffing one editor-shaped section
 * through serializeBuilderDocument with and without that trigger: 35 section
 * fields came back at their defaults. `widthMode` is the one a person would
 * notice -- a full-width row boxing itself back in on every save of such a
 * page, with no message -- but it arrived with the row's padding, margins,
 * column widths,
 * minimum height, borders, offsets, per-cell padding and margins, and the
 * mobile/desktop hidden flags.
 *
 * A blocklist rather than a list of the 35, on purpose. A list of fields to
 * KEEP has to be extended by hand every time builder-template.ts grows a
 * section setting, and the day somebody forgets is the day this bug comes back
 * for that one field -- silently, because nothing renders a dropped setting as
 * an error. The blocklist names what this migrator genuinely owns, which
 * changes only when the legacy shape does. Nothing unknown can leak into the
 * database from here either way: template.normalizeLayoutSections whitelists
 * the section down to its own field list immediately afterwards.
 *
 * The detector is deliberately NOT what gets changed. `col4`/`col5`/`col6` are
 * legitimate MODERN column names (lib/builder-client/builder-template.ts:994),
 * so no shape test separates a real Normie import from an ordinary save
 * cleanly, and tightening it would buy a false negative -- a genuine import
 * quietly not migrating -- which is the worse failure.
 */
function carryModernSectionFields(migrated, section) {
  for (const key of Object.keys(section)) {
    if (LEGACY_OWNED_SECTION_FIELDS.has(key)) continue;
    const value = section[key];
    if (value === undefined || value === null) continue;
    migrated[key] = value;
  }
  return migrated;
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

  const migrated = {
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

  // Broad carry first, then the narrow rescue: carryModernSectionFields passes
  // values through RAW, while carryRescuableSectionMeta is the one that coerces
  // (a numeric rowBorderWidth to a string, `locked` only when it is exactly
  // true). Running the rescue last keeps main's exact semantics for the seven
  // fields it names while the blocklist carries everything else.
  return carryRescuableSectionMeta(carryModernSectionFields(migrated, section), section);
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
      // CARRY the document's own fields through and translate only the legacy
      // parts, rather than rebuilding the document from a two-field list.
      //
      // The list used to be exactly `pageBackground` and `sections`, so the
      // page's `theme` -- its heading sizes, line heights and heading weights --
      // was simply dropped, and the normalizer downstream then supplied the
      // default. That is correct for a genuine Normie import, which carries no
      // theme at all. It is wrong for an ordinary save, and ordinary saves land
      // here: public/js/builder.js puts `rowSettings` and `containerSettings` on
      // every section it sends (line 5446), which makes isLegacySectionArray
      // call the page legacy. So pressing Save Page with nothing changed reset
      // the page's typography, silently, on all 183 pages that carry one
      // (task 86bc0d1fg, measured 2026-09-14).
      //
      // Written as a carry rather than a longer field list on purpose: this is
      // the third ticket for the same two-field rebuild (86bc05t5b dropped a
      // section's lineage, 86bc0bb73 its row settings), and a list only ever
      // protects the fields somebody remembered.
      const carried = { ...value };
      // `sections` below holds the migrated list; a leftover `layoutSections`
      // would be the same page in its unmigrated shape, and the two readers of
      // this document disagree about which alias wins.
      delete carried.layoutSections;
      return {
        ...carried,
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
