'use strict';

const THEME_COLOR_TOKENS = Object.freeze({
  'theme:primary': '--crm-theme-primary',
  'theme:secondary': '--crm-theme-secondary',
  'theme:accent': '--crm-theme-accent',
  'theme:background': '--crm-theme-background',
  'theme:text': '--bx-text',
  'theme:heading': '--bx-heading',
  'theme:link': '--bx-link',
});

const THEME_COLOR_FALLBACKS = Object.freeze({
  'theme:primary': '#18324a',
  'theme:secondary': '#475569',
  'theme:accent': '#1DC3FF',
  'theme:background': '#ffffff',
  'theme:text': '#214c71',
  'theme:heading': '#18324a',
  'theme:link': '#0b82d4',
});

const CRM_FORM_STYLES_META_KEY = '__crm_form_styles__';

const DEFAULT_CRM_FORM_STYLES = Object.freeze({
  headingColor: 'theme:heading',
  headingColorOpacity: '100',
  buttonBackgroundColor: 'theme:accent',
  buttonBackgroundColorOpacity: '100',
  buttonTextColor: 'theme:background',
  buttonTextColorOpacity: '100',
  buttonTextSize: '1.05rem',
  buttonTextWeight: '7',
  buttonAlign: 'left',
  buttonWidth: '100%',
  labelAlign: 'left',
  fieldAlign: 'left',
  fieldWidth: '75%',
  backgroundColor: 'theme:background',
  backgroundColorOpacity: '100',
  borderSize: '0',
  borderColor: 'theme:primary',
  borderColorOpacity: '100',
  borderRadius: '10px',
  padding: '18px',
  margin: '0',
});

const ALIGN_VALUES = new Set(['left', 'center', 'right']);

function safeText(value) {
  return String(value || '').trim();
}

function clampWeight(value) {
  const num = Number.parseInt(String(value || '7'), 10);
  if (!Number.isFinite(num)) return DEFAULT_CRM_FORM_STYLES.buttonTextWeight;
  return String(Math.min(10, Math.max(1, num)));
}

function clampOpacity(value, fallback = '100') {
  const num = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(num)) return fallback;
  return String(Math.min(100, Math.max(0, num)));
}

function normalizeAlign(value, fallback = 'left') {
  const align = safeText(value).toLowerCase();
  return ALIGN_VALUES.has(align) ? align : fallback;
}

function normalizeCssSize(value, fallback) {
  const text = safeText(value);
  if (!text) return fallback;
  if (/^\d+(\.\d+)?(px|rem|em|%)$/.test(text)) return text;
  if (/^\d+(\.\d+)?$/.test(text)) return `${text}px`;
  return fallback;
}

function clampButtonWidthPercent(value, fallback = DEFAULT_CRM_FORM_STYLES.buttonWidth) {
  const text = safeText(value);
  const match = text.match(/^(\d+(?:\.\d+)?)%$/);
  const raw = match ? Number.parseFloat(match[1]) : Number.parseInt(text, 10);
  if (!Number.isFinite(raw)) return fallback;
  return `${Math.min(100, Math.max(50, Math.round(raw)))}%`;
}

function normalizeHexColor(value, fallback) {
  const text = safeText(value);
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text)) return text;
  return fallback;
}

function isThemeColorToken(value) {
  return Object.prototype.hasOwnProperty.call(THEME_COLOR_TOKENS, safeText(value).toLowerCase());
}

function normalizeFormColor(value, fallback) {
  const text = safeText(value).toLowerCase();
  if (text === 'none') return 'none';
  if (isThemeColorToken(text)) return text;
  return normalizeHexColor(value, fallback);
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex, '#000000').replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const value = Number.parseInt(expanded, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function themeTokenCssVar(token) {
  const key = safeText(token).toLowerCase();
  const cssVar = THEME_COLOR_TOKENS[key];
  const fallback = THEME_COLOR_FALLBACKS[key] || '#18324a';
  return cssVar ? `var(${cssVar}, ${fallback})` : fallback;
}

function parseCrmFormStylesInput(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function buildCrmFormRenderContext(palette, typography) {
  const source = palette && typeof palette === 'object' ? palette : {};
  const colors = typography?.colors && typeof typography.colors === 'object' ? typography.colors : {};
  return {
    primaryColor: safeText(source.primaryColor) || THEME_COLOR_FALLBACKS['theme:primary'],
    secondaryColor: safeText(source.secondaryColor) || THEME_COLOR_FALLBACKS['theme:secondary'],
    accentColor: safeText(source.accentColor) || THEME_COLOR_FALLBACKS['theme:accent'],
    backgroundColor: safeText(source.backgroundColor) || THEME_COLOR_FALLBACKS['theme:background'],
    textColor: safeText(colors.text) || THEME_COLOR_FALLBACKS['theme:text'],
    headingColor: safeText(colors.heading) || THEME_COLOR_FALLBACKS['theme:heading'],
    linkColor: safeText(colors.link) || THEME_COLOR_FALLBACKS['theme:link'],
  };
}

function themeTokenHex(token, context) {
  const key = safeText(token).toLowerCase();
  const map = {
    'theme:primary': context.primaryColor,
    'theme:secondary': context.secondaryColor,
    'theme:accent': context.accentColor,
    'theme:background': context.backgroundColor,
    'theme:text': context.textColor,
    'theme:heading': context.headingColor,
    'theme:link': context.linkColor,
  };
  const hex = map[key];
  if (!hex) return null;
  return normalizeHexColor(hex, THEME_COLOR_FALLBACKS[key] || '#18324a');
}

function resolveFormColorWithContext(color, opacity, fallback, context) {
  const normalized = normalizeFormColor(color, fallback);
  if (normalized === 'none') return 'transparent';
  if (isThemeColorToken(normalized)) {
    const hex = themeTokenHex(normalized, context) || THEME_COLOR_FALLBACKS[normalized] || fallback;
    return resolveFormColor(hex, opacity, hex);
  }
  return resolveFormColor(normalized, opacity, fallback);
}

function resolveFormColor(color, opacity, fallback) {
  const normalized = normalizeFormColor(color, fallback);
  if (normalized === 'none') return 'transparent';
  const alpha = Number.parseInt(clampOpacity(opacity), 10);
  if (isThemeColorToken(normalized)) {
    const cssColor = themeTokenCssVar(normalized);
    if (alpha >= 100) return cssColor;
    return `color-mix(in srgb, ${cssColor} ${alpha}%, transparent)`;
  }
  if (alpha >= 100) return normalized;
  const { r, g, b } = hexToRgb(normalized);
  return `rgba(${r}, ${g}, ${b}, ${alpha / 100})`;
}

function alignToJustify(align) {
  if (align === 'center') return 'center';
  if (align === 'right') return 'end';
  return 'start';
}

function weightToCss(weight) {
  const num = Number.parseInt(String(weight || '7'), 10);
  const clamped = Math.min(10, Math.max(1, Number.isFinite(num) ? num : 7));
  return String(clamped * 100);
}

function buildCrmThemePaletteVars(palette) {
  const source = palette && typeof palette === 'object' ? palette : {};
  const vars = {};
  if (safeText(source.primaryColor)) vars['--crm-theme-primary'] = safeText(source.primaryColor);
  if (safeText(source.secondaryColor)) vars['--crm-theme-secondary'] = safeText(source.secondaryColor);
  if (safeText(source.accentColor)) vars['--crm-theme-accent'] = safeText(source.accentColor);
  if (safeText(source.backgroundColor)) vars['--crm-theme-background'] = safeText(source.backgroundColor);
  return vars;
}

function buildCrmThemeColorSwatches(palette, typographyColors) {
  const colors = typographyColors && typeof typographyColors === 'object' ? typographyColors : {};
  return [
    { label: 'Primary', token: 'theme:primary', hex: safeText(palette?.primaryColor) },
    { label: 'Secondary', token: 'theme:secondary', hex: safeText(palette?.secondaryColor) },
    { label: 'Accent', token: 'theme:accent', hex: safeText(palette?.accentColor) },
    { label: 'Background', token: 'theme:background', hex: safeText(palette?.backgroundColor) },
    { label: 'Body Text', token: 'theme:text', hex: safeText(colors.text) },
    { label: 'Headings', token: 'theme:heading', hex: safeText(colors.heading) },
    { label: 'Link', token: 'theme:link', hex: safeText(colors.link) },
  ].filter((entry) => Boolean(entry.hex));
}

function legacyAccentHex(styles, legacyAccentColor) {
  const buttonColor = normalizeFormColor(
    styles?.buttonBackgroundColor,
    safeText(legacyAccentColor) || DEFAULT_CRM_FORM_STYLES.buttonBackgroundColor
  );
  if (buttonColor === 'none' || isThemeColorToken(buttonColor)) {
    return safeText(legacyAccentColor) || THEME_COLOR_FALLBACKS['theme:accent'];
  }
  return buttonColor;
}

function isRenderableFormField(field) {
  const key = safeText(field?.key);
  if (!key || key === CRM_FORM_STYLES_META_KEY) return false;
  return safeText(field?.type).toLowerCase() !== 'meta';
}

function findFormStylesMetaField(fields) {
  return (Array.isArray(fields) ? fields : [])
    .find((field) => safeText(field?.key) === CRM_FORM_STYLES_META_KEY) || null;
}

function publicFormFields(fields) {
  return (Array.isArray(fields) ? fields : []).filter(isRenderableFormField);
}

function stylesSignature(styles, legacyAccentColor) {
  return JSON.stringify(normalizeCrmFormStyles(styles, legacyAccentColor));
}

function hasDistinctStoredStyles(styles, legacyAccentColor) {
  const normalized = normalizeCrmFormStyles(styles, legacyAccentColor);
  const defaults = normalizeCrmFormStyles({}, legacyAccentColor);
  return stylesSignature(normalized, legacyAccentColor) !== stylesSignature(defaults, legacyAccentColor);
}

function resolveStoredFormStyles(input, legacyAccentColor) {
  const columnStyles = parseCrmFormStylesInput(input?.styles);
  const metaField = findFormStylesMetaField(input?.fields);
  const metaStyles = parseCrmFormStylesInput(metaField?.styleSettings || metaField?.styles);
  if (hasDistinctStoredStyles(columnStyles, legacyAccentColor)) return columnStyles;
  if (hasDistinctStoredStyles(metaStyles, legacyAccentColor)) return metaStyles;
  return columnStyles;
}

function embedFormStylesMeta(fields, styles, legacyAccentColor) {
  const normalized = normalizeCrmFormStyles(styles, legacyAccentColor);
  const list = publicFormFields(fields).map((field) => ({
    key: safeText(field?.key),
    label: safeText(field?.label),
    type: safeText(field?.type) || 'text',
    required: Boolean(field?.required),
  }));
  list.push({
    key: CRM_FORM_STYLES_META_KEY,
    label: '',
    type: 'meta',
    required: false,
    styleSettings: normalized,
  });
  return list;
}

function normalizeCrmFormStyles(input, legacyAccentColor) {
  const source = parseCrmFormStylesInput(input);
  const legacyButtonBg = safeText(legacyAccentColor);
  return {
    headingColor: normalizeFormColor(source.headingColor || source.heading_color, DEFAULT_CRM_FORM_STYLES.headingColor),
    headingColorOpacity: clampOpacity(source.headingColorOpacity || source.heading_color_opacity),
    buttonBackgroundColor: normalizeFormColor(
      source.buttonBackgroundColor || source.button_background_color || legacyButtonBg,
      legacyButtonBg || DEFAULT_CRM_FORM_STYLES.buttonBackgroundColor
    ),
    buttonBackgroundColorOpacity: clampOpacity(
      source.buttonBackgroundColorOpacity || source.button_background_color_opacity
    ),
    buttonTextColor: normalizeFormColor(source.buttonTextColor || source.button_text_color, DEFAULT_CRM_FORM_STYLES.buttonTextColor),
    buttonTextColorOpacity: clampOpacity(source.buttonTextColorOpacity || source.button_text_color_opacity),
    buttonTextSize: normalizeCssSize(source.buttonTextSize || source.button_text_size, DEFAULT_CRM_FORM_STYLES.buttonTextSize),
    buttonTextWeight: clampWeight(source.buttonTextWeight || source.button_text_weight),
    buttonAlign: normalizeAlign(source.buttonAlign || source.button_align, DEFAULT_CRM_FORM_STYLES.buttonAlign),
    buttonWidth: clampButtonWidthPercent(source.buttonWidth || source.button_width, DEFAULT_CRM_FORM_STYLES.buttonWidth),
    labelAlign: normalizeAlign(source.labelAlign || source.label_align, DEFAULT_CRM_FORM_STYLES.labelAlign),
    fieldAlign: normalizeAlign(source.fieldAlign || source.field_align, DEFAULT_CRM_FORM_STYLES.fieldAlign),
    fieldWidth: normalizeCssSize(source.fieldWidth || source.field_width, DEFAULT_CRM_FORM_STYLES.fieldWidth),
    backgroundColor: normalizeFormColor(source.backgroundColor || source.background_color, DEFAULT_CRM_FORM_STYLES.backgroundColor),
    backgroundColorOpacity: clampOpacity(source.backgroundColorOpacity || source.background_color_opacity),
    borderSize: normalizeCssSize(source.borderSize || source.border_size, DEFAULT_CRM_FORM_STYLES.borderSize),
    borderColor: normalizeFormColor(source.borderColor || source.border_color, DEFAULT_CRM_FORM_STYLES.borderColor),
    borderColorOpacity: clampOpacity(source.borderColorOpacity || source.border_color_opacity),
    borderRadius: normalizeCssSize(source.borderRadius || source.border_radius, DEFAULT_CRM_FORM_STYLES.borderRadius),
    padding: normalizeCssSize(source.padding, DEFAULT_CRM_FORM_STYLES.padding),
    margin: normalizeCssSize(source.margin, DEFAULT_CRM_FORM_STYLES.margin),
  };
}

function crmFormStylesToCssProperties(styles, legacyAccentColor, renderContext) {
  const normalized = normalizeCrmFormStyles(styles, legacyAccentColor);
  const resolveColor = renderContext
    ? (color, opacity, fallback) => resolveFormColorWithContext(color, opacity, fallback, renderContext)
    : (color, opacity, fallback) => resolveFormColor(color, opacity, fallback);
  return {
    '--crm-form-width': normalized.fieldWidth,
    '--crm-form-heading-color': resolveColor(
      normalized.headingColor,
      normalized.headingColorOpacity,
      DEFAULT_CRM_FORM_STYLES.headingColor
    ),
    '--crm-form-label-align': normalized.labelAlign,
    '--crm-form-label-justify': alignToJustify(normalized.labelAlign),
    '--crm-form-field-justify': alignToJustify(normalized.fieldAlign),
    '--crm-form-button-bg': resolveColor(
      normalized.buttonBackgroundColor,
      normalized.buttonBackgroundColorOpacity,
      DEFAULT_CRM_FORM_STYLES.buttonBackgroundColor
    ),
    '--crm-form-button-color': resolveColor(
      normalized.buttonTextColor,
      normalized.buttonTextColorOpacity,
      DEFAULT_CRM_FORM_STYLES.buttonTextColor
    ),
    '--crm-form-button-size': normalized.buttonTextSize,
    '--crm-form-button-weight': weightToCss(normalized.buttonTextWeight),
    '--crm-form-button-justify': alignToJustify(normalized.buttonAlign),
    '--crm-form-button-width': normalized.buttonWidth,
    '--crm-form-background': resolveColor(
      normalized.backgroundColor,
      normalized.backgroundColorOpacity,
      DEFAULT_CRM_FORM_STYLES.backgroundColor
    ),
    '--crm-form-border-size': normalized.borderSize,
    '--crm-form-border-color': resolveColor(
      normalized.borderColor,
      normalized.borderColorOpacity,
      DEFAULT_CRM_FORM_STYLES.borderColor
    ),
    '--crm-form-border-radius': normalized.borderRadius,
    '--crm-form-padding': normalized.padding,
    '--crm-form-margin': normalized.margin,
  };
}

function crmFormStylesToRenderStyles(styles, legacyAccentColor, renderContext) {
  const normalized = normalizeCrmFormStyles(styles, legacyAccentColor);
  const cssVars = crmFormStylesToCssProperties(styles, legacyAccentColor, renderContext);
  const background = cssVars['--crm-form-background'];
  const borderColor = cssVars['--crm-form-border-color'];
  const buttonBackground = cssVars['--crm-form-button-bg'];

  return {
    cssVars,
    normalized,
    shell: {
      ...cssVars,
      width: '100%',
      maxWidth: '100%',
      boxSizing: 'border-box',
      margin: normalized.margin,
    },
    heading: {
      ...cssVars,
      width: normalized.fieldWidth,
      maxWidth: '100%',
      margin: '0 0 0.85rem',
      padding: 0,
      fontSize: 'clamp(1.15rem, 2vw, 1.45rem)',
      fontWeight: 800,
      lineHeight: 1.25,
      color: cssVars['--crm-form-heading-color'],
      textAlign: normalized.labelAlign,
    },
    form: {
      ...cssVars,
      width: normalized.fieldWidth,
      maxWidth: '100%',
      boxSizing: 'border-box',
      display: 'grid',
      gridTemplateColumns: 'minmax(120px, 38%) minmax(0, 1fr)',
      columnGap: '8px',
      rowGap: '12px',
      background,
      borderWidth: normalized.borderSize,
      borderStyle: 'solid',
      borderColor,
      borderRadius: normalized.borderRadius,
      padding: normalized.padding,
    },
    button: {
      gridColumn: 2,
      justifySelf: alignToJustify(normalized.buttonAlign),
      width: normalized.buttonWidth,
      maxWidth: '100%',
      minWidth: 0,
      whiteSpace: 'nowrap',
      background: buttonBackground,
      borderWidth: '2px',
      borderStyle: 'solid',
      borderColor: buttonBackground,
      borderRadius: '10px',
      color: cssVars['--crm-form-button-color'],
      fontSize: cssVars['--crm-form-button-size'],
      fontWeight: cssVars['--crm-form-button-weight'],
      cursor: 'pointer',
      padding: '12px 24px',
      minHeight: '52px',
      font: 'inherit',
    },
  };
}

function crmFormSubmitInlineStyle(styles) {
  const normalized = normalizeCrmFormStyles(styles);
  const background = resolveFormColor(
    normalized.buttonBackgroundColor,
    normalized.buttonBackgroundColorOpacity,
    DEFAULT_CRM_FORM_STYLES.buttonBackgroundColor
  );
  return {
    background,
    borderColor: background,
    color: resolveFormColor(
      normalized.buttonTextColor,
      normalized.buttonTextColorOpacity,
      DEFAULT_CRM_FORM_STYLES.buttonTextColor
    ),
    fontSize: normalized.buttonTextSize,
    fontWeight: weightToCss(normalized.buttonTextWeight),
  };
}

module.exports = {
  CRM_FORM_STYLES_META_KEY,
  DEFAULT_CRM_FORM_STYLES,
  THEME_COLOR_TOKENS,
  THEME_COLOR_FALLBACKS,
  parseCrmFormStylesInput,
  buildCrmFormRenderContext,
  normalizeCrmFormStyles,
  resolveStoredFormStyles,
  embedFormStylesMeta,
  publicFormFields,
  stylesSignature,
  crmFormStylesToCssProperties,
  crmFormStylesToRenderStyles,
  crmFormSubmitInlineStyle,
  resolveFormColor,
  resolveFormColorWithContext,
  buildCrmThemePaletteVars,
  buildCrmThemeColorSwatches,
  legacyAccentHex,
  alignToJustify,
  weightToCss,
};
