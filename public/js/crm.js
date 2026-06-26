/**
 * public/js/crm.js
 * CRM module — per-project contact tables, lead-capture forms, and field config.
 */

window.App = window.App || {};
App.crm = (function () {
  const { api, notify, setActivePage } = App;

  // ── Shared state ────────────────────────────────────────────────────────────
  let currentConfig = null;   // the active CRM config for this project
  let currentContacts = [];
  let currentForms = [];
  let editingContactId = null;
  let editingFormId = null;
  let configFieldRows = [];
  let setupFieldRows = [];
  let fieldConfigDragIndex = null;
  let formEditorFieldRows = [];
  let formEditorDragIndex = null;
  let savedEditorForm = null;
  let activeCrmTab = 'contacts';
  let loadPageGeneration = 0;

  const CRM_META_KEY = '__crm_meta__';

  let formEditorThemePalette = null;
  let formEditorThemeTypography = null;

  const THEME_COLOR_TOKENS = {
    'theme:primary': '--crm-theme-primary',
    'theme:secondary': '--crm-theme-secondary',
    'theme:accent': '--crm-theme-accent',
    'theme:background': '--crm-theme-background',
    'theme:text': '--bx-text',
    'theme:heading': '--bx-heading',
    'theme:link': '--bx-link',
  };

  const THEME_COLOR_FALLBACKS = {
    'theme:primary': '#18324a',
    'theme:secondary': '#475569',
    'theme:accent': '#1DC3FF',
    'theme:background': '#ffffff',
    'theme:text': '#214c71',
    'theme:heading': '#18324a',
    'theme:link': '#0b82d4',
  };

  const DEFAULT_FORM_STYLES = {
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
  };

  const FORM_STYLE_EDITOR_IDS = [
    'crmFormEditorHeading',
    'crmFormEditorSubmitLabel',
    'crmFormEditorHeadingColor',
    'crmFormEditorHeadingColorOpacity',
    'crmFormEditorButtonBgColor',
    'crmFormEditorButtonBgColorOpacity',
    'crmFormEditorButtonTextColor',
    'crmFormEditorButtonTextColorOpacity',
    'crmFormEditorButtonTextSize',
    'crmFormEditorButtonTextWeight',
    'crmFormEditorButtonAlign',
    'crmFormEditorButtonWidth',
    'crmFormEditorLabelAlign',
    'crmFormEditorFieldAlign',
    'crmFormEditorFieldWidth',
    'crmFormEditorBackgroundColor',
    'crmFormEditorBackgroundColorOpacity',
    'crmFormEditorBorderColor',
    'crmFormEditorBorderColorOpacity',
    'crmFormEditorBorderSize',
    'crmFormEditorBorderRadius',
    'crmFormEditorPadding',
    'crmFormEditorMargin',
  ];

  const FORM_COLOR_CONTROL_IDS = [
    'crmFormEditorHeadingColor',
    'crmFormEditorButtonBgColor',
    'crmFormEditorButtonTextColor',
    'crmFormEditorBackgroundColor',
    'crmFormEditorBorderColor',
  ];

  function isThemeColorToken(value) {
    return Object.prototype.hasOwnProperty.call(THEME_COLOR_TOKENS, safeText(value).toLowerCase());
  }

  function normalizeHexColor(value, fallback) {
    const text = safeText(value);
    return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text) ? text : fallback;
  }

  function clampOpacity(value, fallback = '100') {
    const num = Number.parseInt(String(value ?? fallback), 10);
    if (!Number.isFinite(num)) return fallback;
    return String(Math.min(100, Math.max(0, num)));
  }

  function normalizeFormColor(value, fallback) {
    const text = safeText(value).toLowerCase();
    if (text === 'none') return 'none';
    if (isThemeColorToken(text)) return text;
    return normalizeHexColor(value, fallback);
  }

  function hexToRgb(color) {
    const normalized = normalizeHexColor(color, '#000000').replace('#', '');
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

  function buildFormThemePaletteVars(palette, typography) {
    const vars = {};
    const source = palette && typeof palette === 'object' ? palette : {};
    if (safeText(source.primaryColor)) vars['--crm-theme-primary'] = safeText(source.primaryColor);
    if (safeText(source.secondaryColor)) vars['--crm-theme-secondary'] = safeText(source.secondaryColor);
    if (safeText(source.accentColor)) vars['--crm-theme-accent'] = safeText(source.accentColor);
    if (safeText(source.backgroundColor)) vars['--crm-theme-background'] = safeText(source.backgroundColor);
    const colors = typography?.colors && typeof typography.colors === 'object' ? typography.colors : {};
    if (safeText(colors.text)) vars['--bx-text'] = safeText(colors.text);
    if (safeText(colors.heading)) vars['--bx-heading'] = safeText(colors.heading);
    if (safeText(colors.link)) vars['--bx-link'] = safeText(colors.link);
    return vars;
  }

  function buildFormThemeColorSwatches(palette, typography) {
    const colors = typography?.colors && typeof typography.colors === 'object' ? typography.colors : {};
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

  function pickFormEditorReferencePage(pages) {
    const list = Array.isArray(pages) ? pages : [];
    const home = list.find((page) => {
      const slug = safeText(page?.slug).toLowerCase();
      return !slug || slug === 'home';
    });
    if (home) return home;
    const withTheme = list.find((page) => safeText(page?.themeId || page?.theme_id));
    return withTheme || list[0] || null;
  }

  function mergePageThemePalette(page, themeRecord) {
    const fromPage = {
      primaryColor: safeText(page?.primaryColor || page?.primary_color),
      secondaryColor: safeText(page?.secondaryColor || page?.secondary_color),
      backgroundColor: safeText(page?.backgroundColor || page?.background_color),
      accentColor: safeText(page?.accentColor || page?.accent_color),
    };
    const fromTheme = themeRecord
      ? {
        primaryColor: safeText(themeRecord.primaryColor),
        secondaryColor: safeText(themeRecord.secondaryColor),
        backgroundColor: safeText(themeRecord.backgroundColor),
        accentColor: safeText(themeRecord.accentColor),
      }
      : {};
    return {
      primaryColor: fromPage.primaryColor || fromTheme.primaryColor,
      secondaryColor: fromPage.secondaryColor || fromTheme.secondaryColor,
      backgroundColor: fromPage.backgroundColor || fromTheme.backgroundColor,
      accentColor: fromPage.accentColor || fromTheme.accentColor,
    };
  }

  function hasThemePaletteColors(palette) {
    if (!palette || typeof palette !== 'object') return false;
    return Boolean(
      palette.primaryColor ||
      palette.secondaryColor ||
      palette.backgroundColor ||
      palette.accentColor
    );
  }

  async function loadFormEditorTheme() {
    try {
      const [themesRes, pagesRes] = await Promise.all([
        api('/api/builder/themes'),
        api('/api/builder/landing-pages'),
      ]);
      const themes = Array.isArray(themesRes?.themes)
        ? themesRes.themes
        : (Array.isArray(themesRes?.data) ? themesRes.data : []);
      const pages = Array.isArray(pagesRes?.pages)
        ? pagesRes.pages
        : (Array.isArray(pagesRes?.data) ? pagesRes.data : []);
      const page = pickFormEditorReferencePage(pages);
      const themeId = safeText(page?.themeId || page?.theme_id);
      const themeRecord = themeId
        ? themes.find((theme) => safeText(theme?.id) === themeId) || null
        : null;
      const palette = mergePageThemePalette(page, themeRecord);
      formEditorThemePalette = hasThemePaletteColors(palette) ? palette : null;
      const pageTheme = page?.theme && typeof page.theme === 'object' ? page.theme : null;
      formEditorThemeTypography = pageTheme?.typography || themeRecord?.typography || null;
    } catch {
      formEditorThemePalette = null;
      formEditorThemeTypography = null;
    }
    renderFormThemeSwatches();
  }

  function renderFormThemeSwatches() {
    const swatches = buildFormThemeColorSwatches(formEditorThemePalette, formEditorThemeTypography);
    document.querySelectorAll('[data-crm-theme-swatches]').forEach((container) => {
      container.innerHTML = swatches.map((entry) =>
        `<button type="button" class="crm-form-color-swatch" data-color="${escHtml(entry.token)}" title="${escHtml(entry.label)}" aria-label="${escHtml(entry.label)}" style="background-color:${escHtml(entry.hex)};"></button>`
      ).join('');
    });
    document.querySelectorAll('.crm-form-color-control').forEach((control) => {
      delete control.dataset.crmColorBound;
    });
    bindFormColorPickers();
    syncAllFormColorPickers();
  }

  function applyFormEditorPreviewThemeVars() {
    const preview = el('crmFormEditorPreview');
    if (!preview) return;
    const vars = buildFormThemePaletteVars(formEditorThemePalette, formEditorThemeTypography);
    preview.style.cssText = Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(';');
  }

  function normalizeFormStyles(input, legacyAccentColor) {
    const source = input && typeof input === 'object' ? input : {};
    const legacyButtonBg = safeText(legacyAccentColor);
    const align = (value, fallback) => {
      const next = safeText(value).toLowerCase();
      return next === 'center' || next === 'right' ? next : (fallback || 'left');
    };
    const cssSize = (value, fallback) => {
      const text = safeText(value);
      if (!text) return fallback;
      if (/^\d+(\.\d+)?(px|rem|em|%)$/.test(text)) return text;
      if (/^\d+(\.\d+)?$/.test(text)) return `${text}px`;
      return fallback;
    };
    const hex = (value, fallback) => normalizeHexColor(value, fallback);
    const weight = (value) => {
      const num = Number.parseInt(String(value || DEFAULT_FORM_STYLES.buttonTextWeight), 10);
      if (!Number.isFinite(num)) return DEFAULT_FORM_STYLES.buttonTextWeight;
      return String(Math.min(10, Math.max(1, num)));
    };
    const buttonWidth = (value) => {
      const text = safeText(value);
      const match = text.match(/^(\d+(?:\.\d+)?)%$/);
      const raw = match ? Number.parseFloat(match[1]) : Number.parseInt(text, 10);
      if (!Number.isFinite(raw)) return DEFAULT_FORM_STYLES.buttonWidth;
      return `${Math.min(100, Math.max(50, Math.round(raw)))}%`;
    };
    return {
      headingColor: normalizeFormColor(source.headingColor || source.heading_color, DEFAULT_FORM_STYLES.headingColor),
      headingColorOpacity: clampOpacity(source.headingColorOpacity || source.heading_color_opacity),
      buttonBackgroundColor: normalizeFormColor(
        source.buttonBackgroundColor || source.button_background_color || legacyButtonBg,
        legacyButtonBg || DEFAULT_FORM_STYLES.buttonBackgroundColor
      ),
      buttonBackgroundColorOpacity: clampOpacity(
        source.buttonBackgroundColorOpacity || source.button_background_color_opacity
      ),
      buttonTextColor: normalizeFormColor(source.buttonTextColor || source.button_text_color, DEFAULT_FORM_STYLES.buttonTextColor),
      buttonTextColorOpacity: clampOpacity(source.buttonTextColorOpacity || source.button_text_color_opacity),
      buttonTextSize: cssSize(source.buttonTextSize || source.button_text_size, DEFAULT_FORM_STYLES.buttonTextSize),
      buttonTextWeight: weight(source.buttonTextWeight || source.button_text_weight),
      buttonAlign: align(source.buttonAlign || source.button_align, DEFAULT_FORM_STYLES.buttonAlign),
      buttonWidth: buttonWidth(source.buttonWidth || source.button_width),
      labelAlign: align(source.labelAlign || source.label_align, DEFAULT_FORM_STYLES.labelAlign),
      fieldAlign: align(source.fieldAlign || source.field_align, DEFAULT_FORM_STYLES.fieldAlign),
      fieldWidth: cssSize(source.fieldWidth || source.field_width, DEFAULT_FORM_STYLES.fieldWidth),
      backgroundColor: normalizeFormColor(source.backgroundColor || source.background_color, DEFAULT_FORM_STYLES.backgroundColor),
      backgroundColorOpacity: clampOpacity(source.backgroundColorOpacity || source.background_color_opacity),
      borderSize: cssSize(source.borderSize || source.border_size, DEFAULT_FORM_STYLES.borderSize),
      borderColor: normalizeFormColor(source.borderColor || source.border_color, DEFAULT_FORM_STYLES.borderColor),
      borderColorOpacity: clampOpacity(source.borderColorOpacity || source.border_color_opacity),
      borderRadius: cssSize(source.borderRadius || source.border_radius, DEFAULT_FORM_STYLES.borderRadius),
      padding: cssSize(source.padding, DEFAULT_FORM_STYLES.padding),
      margin: cssSize(source.margin, DEFAULT_FORM_STYLES.margin),
    };
  }

  function formAlignToJustify(align) {
    if (align === 'center') return 'center';
    if (align === 'right') return 'end';
    return 'start';
  }

  function formWeightToCss(weight) {
    const num = Number.parseInt(String(weight || DEFAULT_FORM_STYLES.buttonTextWeight), 10);
    const clamped = Math.min(10, Math.max(1, Number.isFinite(num) ? num : 7));
    return String(clamped * 100);
  }

  function formStylesToCssProperties(styles) {
    const normalized = normalizeFormStyles(styles);
    return {
      '--crm-form-width': normalized.fieldWidth,
      '--crm-form-heading-color': resolveFormColor(
        normalized.headingColor,
        normalized.headingColorOpacity,
        DEFAULT_FORM_STYLES.headingColor
      ),
      '--crm-form-label-align': normalized.labelAlign,
      '--crm-form-label-justify': formAlignToJustify(normalized.labelAlign),
      '--crm-form-field-justify': formAlignToJustify(normalized.fieldAlign),
      '--crm-form-button-bg': resolveFormColor(
        normalized.buttonBackgroundColor,
        normalized.buttonBackgroundColorOpacity,
        DEFAULT_FORM_STYLES.buttonBackgroundColor
      ),
      '--crm-form-button-color': resolveFormColor(
        normalized.buttonTextColor,
        normalized.buttonTextColorOpacity,
        DEFAULT_FORM_STYLES.buttonTextColor
      ),
      '--crm-form-button-size': normalized.buttonTextSize,
      '--crm-form-button-weight': formWeightToCss(normalized.buttonTextWeight),
      '--crm-form-button-justify': formAlignToJustify(normalized.buttonAlign),
      '--crm-form-button-width': normalized.buttonWidth,
      '--crm-form-background': resolveFormColor(
        normalized.backgroundColor,
        normalized.backgroundColorOpacity,
        DEFAULT_FORM_STYLES.backgroundColor
      ),
      '--crm-form-border-size': normalized.borderSize,
      '--crm-form-border-color': resolveFormColor(
        normalized.borderColor,
        normalized.borderColorOpacity,
        DEFAULT_FORM_STYLES.borderColor
      ),
      '--crm-form-border-radius': normalized.borderRadius,
      '--crm-form-padding': normalized.padding,
      '--crm-form-margin': normalized.margin,
    };
  }

  function formStyleAttr(styles) {
    return Object.entries(formStylesToCssProperties(styles))
      .map(([key, value]) => `${key}:${value}`)
      .join(';');
  }

  function formSubmitInlineStyle(styles) {
    const normalized = normalizeFormStyles(styles);
    const background = resolveFormColor(
      normalized.buttonBackgroundColor,
      normalized.buttonBackgroundColorOpacity,
      DEFAULT_FORM_STYLES.buttonBackgroundColor
    );
    return [
      `background:${background}`,
      `border-color:${background}`,
      `color:${resolveFormColor(
        normalized.buttonTextColor,
        normalized.buttonTextColorOpacity,
        DEFAULT_FORM_STYLES.buttonTextColor
      )}`,
      `font-size:${normalized.buttonTextSize}`,
      `font-weight:${formWeightToCss(normalized.buttonTextWeight)}`,
    ].join(';');
  }

  function legacyAccentFromStyles(styles) {
    const buttonColor = normalizeFormColor(styles.buttonBackgroundColor, DEFAULT_FORM_STYLES.buttonBackgroundColor);
    if (buttonColor === 'none' || isThemeColorToken(buttonColor)) {
      return THEME_COLOR_FALLBACKS['theme:accent'];
    }
    return buttonColor;
  }

  function readFormStylesFromEditor() {
    return normalizeFormStyles({
      headingColor: el('crmFormEditorHeadingColor')?.value,
      headingColorOpacity: el('crmFormEditorHeadingColorOpacity')?.value,
      buttonBackgroundColor: el('crmFormEditorButtonBgColor')?.value,
      buttonBackgroundColorOpacity: el('crmFormEditorButtonBgColorOpacity')?.value,
      buttonTextColor: el('crmFormEditorButtonTextColor')?.value,
      buttonTextColorOpacity: el('crmFormEditorButtonTextColorOpacity')?.value,
      buttonTextSize: el('crmFormEditorButtonTextSize')?.value,
      buttonTextWeight: el('crmFormEditorButtonTextWeight')?.value,
      buttonAlign: el('crmFormEditorButtonAlign')?.value,
      buttonWidth: el('crmFormEditorButtonWidth')?.value ? `${el('crmFormEditorButtonWidth').value}%` : undefined,
      labelAlign: el('crmFormEditorLabelAlign')?.value,
      fieldAlign: el('crmFormEditorFieldAlign')?.value,
      fieldWidth: el('crmFormEditorFieldWidth')?.value,
      backgroundColor: el('crmFormEditorBackgroundColor')?.value,
      backgroundColorOpacity: el('crmFormEditorBackgroundColorOpacity')?.value,
      borderColor: el('crmFormEditorBorderColor')?.value,
      borderColorOpacity: el('crmFormEditorBorderColorOpacity')?.value,
      borderSize: el('crmFormEditorBorderSize')?.value,
      borderRadius: el('crmFormEditorBorderRadius')?.value,
      padding: el('crmFormEditorPadding')?.value,
      margin: el('crmFormEditorMargin')?.value,
    });
  }

  function populateFormStylesEditor(form) {
    const styles = normalizeFormStyles(form?.styles, form?.accentColor);
    if (el('crmFormEditorHeadingColor')) el('crmFormEditorHeadingColor').value = styles.headingColor;
    if (el('crmFormEditorHeadingColorOpacity')) el('crmFormEditorHeadingColorOpacity').value = styles.headingColorOpacity;
    if (el('crmFormEditorButtonBgColor')) el('crmFormEditorButtonBgColor').value = styles.buttonBackgroundColor;
    if (el('crmFormEditorButtonBgColorOpacity')) el('crmFormEditorButtonBgColorOpacity').value = styles.buttonBackgroundColorOpacity;
    if (el('crmFormEditorButtonTextColor')) el('crmFormEditorButtonTextColor').value = styles.buttonTextColor;
    if (el('crmFormEditorButtonTextColorOpacity')) el('crmFormEditorButtonTextColorOpacity').value = styles.buttonTextColorOpacity;
    if (el('crmFormEditorButtonTextSize')) el('crmFormEditorButtonTextSize').value = styles.buttonTextSize;
    if (el('crmFormEditorButtonTextWeight')) el('crmFormEditorButtonTextWeight').value = styles.buttonTextWeight;
    if (el('crmFormEditorButtonAlign')) el('crmFormEditorButtonAlign').value = styles.buttonAlign;
    if (el('crmFormEditorButtonWidth')) {
      const widthMatch = String(styles.buttonWidth || '').match(/^(\d+)/);
      el('crmFormEditorButtonWidth').value = widthMatch ? widthMatch[1] : '100';
      syncFormButtonWidthUI('crmFormEditorButtonWidth');
    }
    if (el('crmFormEditorLabelAlign')) el('crmFormEditorLabelAlign').value = styles.labelAlign;
    if (el('crmFormEditorFieldAlign')) el('crmFormEditorFieldAlign').value = styles.fieldAlign;
    if (el('crmFormEditorFieldWidth')) el('crmFormEditorFieldWidth').value = styles.fieldWidth;
    if (el('crmFormEditorBackgroundColor')) el('crmFormEditorBackgroundColor').value = styles.backgroundColor;
    if (el('crmFormEditorBackgroundColorOpacity')) el('crmFormEditorBackgroundColorOpacity').value = styles.backgroundColorOpacity;
    if (el('crmFormEditorBorderColor')) el('crmFormEditorBorderColor').value = styles.borderColor;
    if (el('crmFormEditorBorderColorOpacity')) el('crmFormEditorBorderColorOpacity').value = styles.borderColorOpacity;
    if (el('crmFormEditorBorderSize')) el('crmFormEditorBorderSize').value = styles.borderSize;
    if (el('crmFormEditorBorderRadius')) el('crmFormEditorBorderRadius').value = styles.borderRadius;
    if (el('crmFormEditorPadding')) el('crmFormEditorPadding').value = styles.padding;
    if (el('crmFormEditorMargin')) el('crmFormEditorMargin').value = styles.margin;
    syncAllFormColorPickers();
  }

  function syncFormColorOpacityUI(opacityInputId) {
    const input = el(opacityInputId);
    const display = document.querySelector(`[data-crm-opacity-display="${opacityInputId}"]`);
    if (!input || !display) return;
    display.textContent = `${clampOpacity(input.value)}%`;
  }

  function syncFormButtonWidthUI(widthInputId) {
    const input = el(widthInputId);
    const display = document.querySelector(`[data-crm-width-display="${widthInputId}"]`);
    if (!input || !display) return;
    const num = Number.parseInt(String(input.value || '100'), 10);
    const clamped = Number.isFinite(num) ? Math.min(100, Math.max(50, num)) : 100;
    display.textContent = `${clamped}%`;
  }

  function syncFormColorPickerUI(inputId) {
    const input = el(inputId);
    const group = document.querySelector(`[data-crm-color-input="${inputId}"] .crm-form-color-options`);
    if (!input || !group) return;
    const value = safeText(input.value).toLowerCase();
    group.querySelectorAll('.crm-form-color-swatch').forEach((btn) => {
      btn.classList.toggle('is-selected', safeText(btn.dataset.color).toLowerCase() === value);
    });
    const control = document.querySelector(`[data-crm-color-input="${inputId}"]`);
    const opacityInputId = control?.dataset.crmColorOpacityInput;
    if (opacityInputId) syncFormColorOpacityUI(opacityInputId);
  }

  function syncAllFormColorPickers() {
    FORM_COLOR_CONTROL_IDS.forEach(syncFormColorPickerUI);
  }

  function bindFormColorPickers() {
    document.querySelectorAll('.crm-form-color-control').forEach((control) => {
      if (control.dataset.crmColorBound === '1') return;
      control.dataset.crmColorBound = '1';
      const inputId = control.dataset.crmColorInput;
      const opacityInputId = control.dataset.crmColorOpacityInput;
      control.querySelectorAll('.crm-form-color-swatch').forEach((btn) => {
        btn.addEventListener('click', () => {
          const input = el(inputId);
          if (!input) return;
          input.value = btn.dataset.color || '';
          syncFormColorPickerUI(inputId);
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
      const opacityInput = opacityInputId ? el(opacityInputId) : null;
      if (opacityInput && opacityInput.dataset.crmOpacityBound !== '1') {
        opacityInput.dataset.crmOpacityBound = '1';
        opacityInput.addEventListener('input', () => {
          syncFormColorOpacityUI(opacityInputId);
        });
      }
    });
  }

  const EMAIL_FIELD_ROW = {
    key: 'email',
    label: 'Email Address',
    type: 'email',
    required: true,
    options: [],
    format: '',
    enabled: true,
    isCustom: false,
    locked: true,
  };

  const FIELD_TYPE_OPTIONS = [
    { value: 'text', label: 'Text Field' },
    { value: 'email', label: 'Email' },
    { value: 'tel', label: 'Phone' },
    { value: 'url', label: 'URL' },
    { value: 'number', label: 'Number' },
    { value: 'textarea', label: 'Textarea' },
    { value: 'select', label: 'Dropdown List' },
    { value: 'boolean', label: 'Binary' },
    { value: 'date', label: 'Date' },
  ];

  function stripMetaCustomFields(customFields) {
    return (Array.isArray(customFields) ? customFields : [])
      .filter((f) => safeText(f?.key) && safeText(f.key) !== CRM_META_KEY);
  }

  function getFieldOrderMeta(config) {
    const meta = (Array.isArray(config?.customFields) ? config.customFields : [])
      .find((f) => safeText(f?.key) === CRM_META_KEY);
    return Array.isArray(meta?.order) ? meta.order.map((key) => safeText(key)).filter(Boolean) : [];
  }

  function fieldRowFromStandard(def, overrides = {}) {
    return {
      key: def.key,
      label: def.label,
      type: def.type,
      required: false,
      options: [],
      format: '',
      enabled: false,
      isCustom: false,
      locked: false,
      ...overrides,
    };
  }

  function enrichFieldRow(row) {
    if (!row) return null;
    const std = STANDARD_FIELDS.find((s) => s.key === row.key);
    const next = { ...row };
    if (std && !next.isCustom) {
      next.label = next.label || std.label;
      if (!next.type) next.type = std.type;
    }
    if (next.key === 'email') {
      next.locked = true;
      next.enabled = true;
      next.type = 'email';
      next.required = true;
      next.isCustom = false;
    }
    return next;
  }

  function buildFieldCatalogRows(config, defaultEnabledStd) {
    const overrides = new Map(
      stripMetaCustomFields(config?.customFields).map((f) => [f.key, enrichFieldRow({ ...f, isCustom: !STANDARD_FIELDS.some((s) => s.key === f.key) && f.key !== 'email' })])
    );
    const enabledStd = new Set(
      Array.isArray(config?.standardFields)
        ? config.standardFields
        : (defaultEnabledStd || ['first_name', 'last_name', 'phone'])
    );
    const byKey = new Map();

    byKey.set('email', enrichFieldRow({ ...EMAIL_FIELD_ROW }));

    STANDARD_FIELDS.forEach((std) => {
      const override = overrides.get(std.key) || {};
      byKey.set(std.key, enrichFieldRow(fieldRowFromStandard(std, {
        enabled: enabledStd.has(std.key),
        ...override,
        isCustom: false,
      })));
    });

    stripMetaCustomFields(config?.customFields).forEach((custom) => {
      if (byKey.has(custom.key)) {
        const existing = byKey.get(custom.key);
        byKey.set(custom.key, enrichFieldRow({ ...existing, ...custom, isCustom: existing.isCustom }));
        return;
      }
      byKey.set(custom.key, enrichFieldRow({
        ...custom,
        enabled: true,
        isCustom: true,
        locked: false,
      }));
    });

    const savedOrder = getFieldOrderMeta(config);
    const rows = [];
    const used = new Set();

    savedOrder.forEach((key) => {
      if (!byKey.has(key) || used.has(key)) return;
      rows.push(byKey.get(key));
      used.add(key);
    });

    ['email', ...STANDARD_FIELDS.map((s) => s.key)].forEach((key) => {
      if (used.has(key) || !byKey.has(key)) return;
      rows.push(byKey.get(key));
      used.add(key);
    });

    byKey.forEach((row, key) => {
      if (used.has(key)) return;
      rows.push(row);
    });

    return rows;
  }

  function serializeFieldRows(rows) {
    const order = rows.map((row) => row.key);
    const standardFields = [];
    const customFields = [];

    rows.forEach((row) => {
      if (!row.enabled || row.key === 'email') return;
      if (row.isCustom) {
        customFields.push({
          key: row.key,
          label: row.label,
          type: row.type,
          required: Boolean(row.required),
          options: Array.isArray(row.options) ? row.options : [],
          format: safeText(row.format),
        });
        return;
      }
      standardFields.push(row.key);
      const std = STANDARD_FIELDS.find((s) => s.key === row.key);
      const hasOverride = std && (
        row.type !== std.type
        || row.required
        || row.format
        || (row.options && row.options.length)
      );
      if (hasOverride) {
        customFields.push({
          key: row.key,
          label: row.label,
          type: row.type,
          required: Boolean(row.required),
          options: Array.isArray(row.options) ? row.options : [],
          format: safeText(row.format),
        });
      }
    });

    customFields.push({ key: CRM_META_KEY, order });
    return { standardFields, customFields };
  }

  function safeText(value) {
    return String(value || '').trim();
  }

  // All fields the config has enabled (standard + custom), ordered
  function allConfigFields(config) {
    if (!config) return [];
    return buildFieldCatalogRows(config)
      .filter((f) => f.enabled)
      .map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: Boolean(f.required),
        options: f.options || [],
        format: f.format || '',
      }));
  }

  // ── Standard field definitions ──────────────────────────────────────────────
  const STANDARD_FIELDS = [
    { key: 'first_name',  label: 'First Name',       type: 'text'     },
    { key: 'last_name',   label: 'Last Name',        type: 'text'     },
    { key: 'phone',       label: 'Phone Number',     type: 'tel'      },
    { key: 'company',     label: 'Company',          type: 'text'     },
    { key: 'job_title',   label: 'Job Title',        type: 'text'     },
    { key: 'city',        label: 'City',             type: 'text'     },
    { key: 'state',       label: 'State / Province', type: 'text'     },
    { key: 'zip',         label: 'Zip / Postal Code',type: 'text'     },
    { key: 'country',     label: 'Country',          type: 'text'     },
    { key: 'website',     label: 'Website',          type: 'url'      },
    { key: 'notes',       label: 'Notes',            type: 'textarea' },
    { key: 'source',      label: 'Source',           type: 'text'     },
    { key: 'tags',        label: 'Tags',             type: 'text'     },
  ];

  // ── DOM helpers ─────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function showPanel(panelId) {
    ['crmContactsPanel', 'crmFormsPanel', 'crmFieldsPanel'].forEach((id) => {
      const p = el(id);
      if (p) p.classList.toggle('hidden', id !== panelId);
    });
    document.querySelectorAll('.crm-tab-btn').forEach((btn) => {
      const tab = btn.dataset.crmTab;
      const isActive = (
        (tab === 'contacts' && panelId === 'crmContactsPanel') ||
        (tab === 'forms'    && panelId === 'crmFormsPanel')    ||
        (tab === 'fields'   && panelId === 'crmFieldsPanel')
      );
      btn.classList.toggle('active', isActive);
    });
  }

  function fieldTypeOptionsMarkup(selectedType) {
    return FIELD_TYPE_OPTIONS.map((opt) => (
      `<option value="${opt.value}"${opt.value === selectedType ? ' selected' : ''}>${opt.label}</option>`
    )).join('');
  }

  function fieldDetailsMarkup(row, index) {
    const parts = [];
    if (row.isCustom) {
      parts.push(`
        <label class="crm-field-detail-item crm-field-detail-grow">
          <span class="meta">Label</span>
          <input type="text" data-field-label="${index}" value="${escHtml(row.label)}" />
        </label>
        <span class="meta">${escHtml(row.key)}</span>
      `);
    }
    if (row.key !== 'email') {
      parts.push(`
        <label class="crm-field-detail-item">
          <input type="checkbox" data-field-required="${index}" ${row.required ? 'checked' : ''} />
          Required
        </label>
      `);
    }
    if (row.type === 'select') {
      parts.push(`
        <label class="crm-field-detail-item crm-field-detail-grow">
          <span class="meta">Options</span>
          <input type="text" data-field-options="${index}" value="${escHtml((row.options || []).join(', '))}" placeholder="Option one, Option two" />
        </label>
      `);
    }
    if (row.type === 'tel' || row.type === 'text' || row.type === 'number') {
      parts.push(`
        <label class="crm-field-detail-item crm-field-detail-grow">
          <span class="meta">Format Hint</span>
          <input type="text" data-field-format="${index}" value="${escHtml(row.format || '')}" placeholder="${row.type === 'tel' ? 'e.g. (555) 555-5555' : 'Optional display hint'}" />
        </label>
      `);
    }
    if (row.isCustom) {
      parts.push(`<button type="button" class="btn crm-field-remove-btn" data-field-remove="${index}">Remove</button>`);
    }
    return `<div class="crm-field-config-details">${parts.join('')}</div>`;
  }

  function fieldConfigRowMarkup(row, index) {
    const locked = Boolean(row.locked);
    const fieldCol = locked
      ? `<div class="crm-field-config-name"><strong>${escHtml(row.label)}</strong><span class="meta">Always captured</span></div>`
      : `<div class="crm-field-config-col-field"><input type="checkbox" id="crmFieldEnabled_${index}" data-field-enabled="${index}" ${row.enabled ? 'checked' : ''} /><label class="crm-field-label-text" for="crmFieldEnabled_${index}">${escHtml(row.label)}</label></div>`;
    const handle = locked
      ? `<span class="crm-field-drag-handle is-locked" aria-hidden="true">::</span>`
      : `<div class="crm-field-drag-handle" data-field-drag="${index}" draggable="true" aria-label="Reorder field">::</div>`;
    return `
      <div class="crm-field-config-row${row.enabled ? '' : ' is-disabled'}" data-field-index="${index}">
        ${handle}
        ${locked ? `<div class="crm-field-config-col-field">${fieldCol}</div>` : fieldCol}
        <div class="crm-field-config-col-type">
          <select data-field-type="${index}"${locked ? ' disabled' : ''}>${fieldTypeOptionsMarkup(row.type)}</select>
        </div>
        ${fieldDetailsMarkup(row, index)}
      </div>
    `;
  }

  function syncFieldRowsFromDom(rows, list) {
    const scope = list || document;
    rows.forEach((row, index) => {
      const enabledInput = scope.querySelector(`[data-field-enabled="${index}"]`);
      const typeInput = scope.querySelector(`[data-field-type="${index}"]`);
      const requiredInput = scope.querySelector(`[data-field-required="${index}"]`);
      const optionsInput = scope.querySelector(`[data-field-options="${index}"]`);
      const formatInput = scope.querySelector(`[data-field-format="${index}"]`);
      const labelInput = scope.querySelector(`[data-field-label="${index}"]`);
      if (enabledInput && row.key !== 'email') row.enabled = enabledInput.checked;
      if (typeInput && row.key !== 'email') row.type = typeInput.value || row.type;
      if (requiredInput && row.key !== 'email') row.required = requiredInput.checked;
      if (optionsInput) row.options = optionsInput.value.split(',').map((part) => part.trim()).filter(Boolean);
      if (formatInput) row.format = formatInput.value.trim();
      if (labelInput) row.label = labelInput.value.trim() || row.label;
    });
    return rows;
  }

  function renderFieldConfigTable(listId, rows, onChange) {
    const list = el(listId);
    if (!list) return;
    list.innerHTML = rows.map((row, index) => fieldConfigRowMarkup(row, index)).join('');
    bindFieldConfigTable(list, rows, onChange);
  }

  function bindFieldConfigTable(list, rows, onChange) {
    if (!list) return;

    list.querySelectorAll('[data-field-enabled], [data-field-type]').forEach((input) => {
      input.addEventListener('change', () => {
        syncFieldRowsFromDom(rows, list);
        onChange(rows);
      });
    });
    list.querySelectorAll('[data-field-required], [data-field-options], [data-field-format], [data-field-label]').forEach((input) => {
      input.addEventListener('input', () => syncFieldRowsFromDom(rows, list));
      input.addEventListener('change', () => syncFieldRowsFromDom(rows, list));
    });
    list.querySelectorAll('[data-field-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncFieldRowsFromDom(rows, list);
        rows.splice(Number(btn.dataset.fieldRemove), 1);
        onChange(rows);
      });
    });

    list.querySelectorAll('[data-field-drag]').forEach((handle) => {
      handle.addEventListener('dragstart', (event) => {
        const index = Number(handle.dataset.fieldDrag);
        fieldConfigDragIndex = index;
        handle.closest('.crm-field-config-row')?.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(index));
        }
        event.stopPropagation();
      });
      handle.addEventListener('dragend', () => {
        fieldConfigDragIndex = null;
        list.querySelectorAll('.crm-field-config-row').forEach((node) => {
          node.classList.remove('is-drag-over', 'is-dragging');
        });
      });
    });

    list.querySelectorAll('.crm-field-config-row').forEach((rowEl) => {
      rowEl.addEventListener('dragover', (event) => {
        event.preventDefault();
        const index = Number(rowEl.dataset.fieldIndex);
        if (fieldConfigDragIndex === null || fieldConfigDragIndex === index) return;
        rowEl.classList.add('is-drag-over');
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      rowEl.addEventListener('dragleave', () => rowEl.classList.remove('is-drag-over'));
      rowEl.addEventListener('drop', (event) => {
        event.preventDefault();
        rowEl.classList.remove('is-drag-over');
        const index = Number(rowEl.dataset.fieldIndex);
        if (fieldConfigDragIndex === null || fieldConfigDragIndex === index) return;
        syncFieldRowsFromDom(rows, list);
        const [moved] = rows.splice(fieldConfigDragIndex, 1);
        const insertIndex = fieldConfigDragIndex < index ? index - 1 : index;
        rows.splice(insertIndex, 0, moved);
        fieldConfigDragIndex = null;
        onChange(rows);
      });
    });
  }

  function addCustomFieldRow(rows) {
    rows.push({
      key: `custom_${Date.now().toString(36)}`,
      label: 'Custom Field',
      type: 'text',
      required: false,
      options: [],
      format: '',
      enabled: true,
      isCustom: true,
      locked: false,
    });
  }

  function sanitizeCustomFieldKey(label, existingKeys) {
    let key = safeText(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'custom_field';
    if (key === 'email') key = 'custom_email';
    let candidate = key;
    let suffix = 2;
    while (existingKeys.has(candidate)) {
      candidate = `${key}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function rerenderConfigFieldRows(rows) {
    configFieldRows = rows;
    renderFieldConfigTable('crmFieldConfigRows', configFieldRows, rerenderConfigFieldRows);
  }

  function rerenderSetupFieldRows(rows) {
    setupFieldRows = rows;
    renderFieldConfigTable('crmSetupFieldRows', setupFieldRows, rerenderSetupFieldRows);
  }

  // ── Load / render ────────────────────────────────────────────────────────────
  async function loadPage() {
    const generation = ++loadPageGeneration;
    try {
      const res = await api('/api/crm/configs');
      const configs = App.normalizeApiArray(res, 'configs');
      currentConfig = configs.length ? configs[0] : null;
    } catch (err) {
      notify(`CRM load failed: ${err.message}`, true);
      currentConfig = null;
    }
    if (generation !== loadPageGeneration) return;
    renderPage();
  }

  function openActiveCrmTab() {
    if (activeCrmTab === 'forms') openFormsView();
    else if (activeCrmTab === 'fields') openFieldsView();
    else openContactsView();
  }

  function renderPage() {
    const emptyState = el('crmEmptyState');
    const activeState = el('crmActiveState');
    if (!emptyState || !activeState) return;

    if (!currentConfig) {
      emptyState.classList.remove('hidden');
      activeState.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    activeState.classList.remove('hidden');

    const title = el('crmActiveTitle');
    if (title) title.textContent = currentConfig.name || 'CRM';

    const actions = el('crmActiveActions');
    if (actions) {
      actions.innerHTML = `
        <button type="button" class="btn" id="crmSettingsBtn">Settings</button>
      `;
      el('crmSettingsBtn')?.addEventListener('click', openFieldsView);
    }

    // Wire tab buttons
    document.querySelectorAll('.crm-tab-btn').forEach((btn) => {
      btn.onclick = () => {
        const tab = btn.dataset.crmTab;
        if (tab === 'contacts') {
          activeCrmTab = 'contacts';
          openContactsView();
        } else if (tab === 'forms') {
          activeCrmTab = 'forms';
          openFormsView();
        } else if (tab === 'fields') {
          activeCrmTab = 'fields';
          openFieldsView();
        }
      };
    });

    openActiveCrmTab();
  }

  // ── Contacts view ───────────────────────────────────────────────────────────
  async function openContactsView() {
    activeCrmTab = 'contacts';
    showPanel('crmContactsPanel');

    const btn = el('crmAddContactBtn');
    if (btn) btn.onclick = () => openAddEditContact(null);

    if (!currentConfig) return;

    try {
      const res = await api(`/api/crm/contacts?configId=${encodeURIComponent(currentConfig.id)}`);
      currentContacts = App.normalizeApiArray(res, 'contacts');
    } catch (err) {
      notify(`Failed to load contacts: ${err.message}`, true);
      currentContacts = [];
    }

    renderContactsTable();
  }

  function renderContactsTable() {
    const head = el('crmContactsTableHead');
    const body = el('crmContactsTableBody');
    if (!head || !body) return;

    const fields = allConfigFields(currentConfig);

    head.innerHTML = `<tr>
      ${fields.slice(0, 6).map((f) => `<th>${f.label}</th>`).join('')}
      <th>Source</th>
      <th>Added</th>
      <th>Actions</th>
    </tr>`;

    if (!currentContacts.length) {
      body.innerHTML = `<tr><td colspan="${fields.slice(0,6).length + 3}" style="text-align:center; padding:2rem; color:var(--text-secondary);">No contacts yet. Add one or set up a form to start capturing leads.</td></tr>`;
      return;
    }

    body.innerHTML = currentContacts.map((c) => {
      const cols = fields.slice(0, 6).map((f) => {
        const val = f.key === 'email' ? (c.email || '') : (c.data?.[f.key] || '');
        return `<td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(String(val))}</td>`;
      }).join('');
      const added = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—';
      return `<tr>
        ${cols}
        <td>${escHtml(c.source || '')}</td>
        <td>${added}</td>
        <td>
          <button class="btn" data-edit-contact="${c.id}" style="padding:0.2rem 0.5rem; font-size:0.8rem; margin-right:0.25rem;">Edit</button>
          <button class="btn" data-delete-contact="${c.id}" style="padding:0.2rem 0.5rem; font-size:0.8rem;">Delete</button>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-edit-contact]').forEach((btn) => {
      btn.onclick = () => {
        const contact = currentContacts.find((c) => c.id === btn.dataset.editContact);
        if (contact) openAddEditContact(contact);
      };
    });
    body.querySelectorAll('[data-delete-contact]').forEach((btn) => {
      btn.onclick = () => deleteContact(btn.dataset.deleteContact);
    });
  }

  function openAddEditContact(contact) {
    editingContactId = contact ? contact.id : null;
    const titleEl = el('crmContactPageTitle');
    if (titleEl) {
      titleEl.innerHTML = `<a href="#" class="page-heading-back-link" onclick="App.crm.openPage(); return false;">CRM</a>: ${contact ? 'Edit' : 'Add'} Contact`;
    }

    const fields = allConfigFields(currentConfig);
    const fieldsContainer = el('crmContactFormFields');
    if (fieldsContainer) {
      fieldsContainer.innerHTML = fields.map((f) => {
        const val = f.key === 'email'
          ? escHtml(contact?.email || '')
          : escHtml(String(contact?.data?.[f.key] || ''));
        const inputHtml = f.type === 'textarea'
          ? `<textarea id="crmCtField_${f.key}" name="${f.key}" rows="3">${val}</textarea>`
          : `<input id="crmCtField_${f.key}" name="${f.key}" type="${f.type}" value="${val}" />`;
        return `<label>${f.label}</label>${inputHtml}`;
      }).join('');
    }

    const cancelBtn = el('crmContactCancelBtn');
    if (cancelBtn) cancelBtn.onclick = () => { openPage(); };

    const form = el('crmContactForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await saveContact(fields);
      };
    }

    setActivePage('crmAddEditContactPage');
  }

  async function saveContact(fields) {
    const email = el('crmCtField_email')?.value.trim().toLowerCase() || null;
    const data = {};
    fields.forEach((f) => {
      if (f.key === 'email') return;
      const input = el(`crmCtField_${f.key}`);
      if (input) data[f.key] = input.value.trim();
    });

    try {
      if (editingContactId) {
        await api(`/api/crm/contacts/${encodeURIComponent(editingContactId)}`, {
          method: 'PUT',
          body: JSON.stringify({ email, data }),
        });
        notify('Contact updated.');
      } else {
        await api('/api/crm/contacts', {
          method: 'POST',
          body: JSON.stringify({ crmConfigId: currentConfig.id, email, data, source: 'manual' }),
        });
        notify('Contact added.');
      }
      openPage();
    } catch (err) {
      notify(err.message || 'Failed to save contact.', true);
    }
  }

  async function deleteContact(id) {
    if (!confirm('Delete this contact? This cannot be undone.')) return;
    try {
      await api(`/api/crm/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('Contact deleted.');
      await openContactsView();
    } catch (err) {
      notify(err.message || 'Failed to delete contact.', true);
    }
  }

  // ── Forms view ──────────────────────────────────────────────────────────────
  async function openFormsView() {
    activeCrmTab = 'forms';
    showPanel('crmFormsPanel');

    const btn = el('crmCreateFormBtn');
    if (btn) btn.onclick = () => openFormEditor(null);

    if (!currentConfig) return;

    try {
      const res = await api(`/api/crm/forms?configId=${encodeURIComponent(currentConfig.id)}`);
      currentForms = App.normalizeApiArray(res, 'forms');
    } catch (err) {
      notify(`Failed to load forms: ${err.message}`, true);
      currentForms = [];
    }

    renderFormsList();
  }

  function renderFormsList() {
    const container = el('crmFormsList');
    if (!container) return;

    if (!currentForms.length) {
      container.innerHTML = `<p class="meta" style="margin-top:1rem;">No forms yet. Create one to generate an embed code for any page.</p>`;
      return;
    }

    container.innerHTML = currentForms.map((f) => `
      <div class="card" style="padding:1rem 1.25rem; margin-bottom:0.75rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap;">
          <div>
            <strong style="font-size:1.05rem;">${escHtml(f.name)}</strong>
            ${f.heading ? `<span class="meta" style="margin-left:0.5rem;">— ${escHtml(f.heading)}</span>` : ''}
            <div class="meta" style="margin-top:0.2rem;">${f.fields.length} field${f.fields.length !== 1 ? 's' : ''} · Submit: "${escHtml(f.submitLabel)}"</div>
          </div>
          <div style="display:flex; gap:0.5rem; flex-shrink:0;">
            <button class="btn" data-view-embed="${f.id}" style="padding:0.25rem 0.6rem; font-size:0.8rem;">Embed Code</button>
            <button class="btn" data-edit-form="${f.id}" style="padding:0.25rem 0.6rem; font-size:0.8rem;">Edit</button>
            <button class="btn" data-delete-form="${f.id}" style="padding:0.25rem 0.6rem; font-size:0.8rem;">Delete</button>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-view-embed]').forEach((btn) => {
      btn.onclick = () => {
        const form = currentForms.find((f) => f.id === btn.dataset.viewEmbed);
        if (form) openFormEmbedModal(form);
      };
    });
    container.querySelectorAll('[data-edit-form]').forEach((btn) => {
      const form = currentForms.find((f) => f.id === btn.dataset.editForm);
      if (form) btn.onclick = () => openFormEditor(form);
    });
    container.querySelectorAll('[data-delete-form]').forEach((btn) => {
      btn.onclick = () => deleteForm(btn.dataset.deleteForm);
    });
  }

  function buildFormEditorFieldRows(allFields, form) {
    if (!form) {
      return allFields.map((f) => ({ ...f, selected: true }));
    }
    const byKey = new Map(allFields.map((f) => [f.key, f]));
    const ordered = [];
    (form.fields || []).forEach((ff) => {
      const field = byKey.get(ff.key);
      if (field) ordered.push({ ...field, selected: true });
    });
    allFields.forEach((f) => {
      if (!ordered.some((row) => row.key === f.key)) {
        ordered.push({ ...f, selected: false });
      }
    });
    return ordered;
  }

  function syncFormEditorFieldRowsFromDom(list) {
    const scope = list || el('crmFormEditorFields');
    if (!scope) return formEditorFieldRows;
    formEditorFieldRows.forEach((row, index) => {
      const enabledInput = scope.querySelector(`[data-form-field-enabled="${index}"]`);
      if (enabledInput) row.selected = enabledInput.checked;
    });
    return formEditorFieldRows;
  }

  function formEditorFieldRowMarkup(row, index) {
    return `
      <div class="crm-form-editor-field-row${row.selected ? '' : ' is-unchecked'}" data-form-field-index="${index}">
        <div class="crm-field-drag-handle" data-form-field-drag="${index}" draggable="true" aria-label="Reorder field">::</div>
        <input type="checkbox" id="crmFormField_${index}" data-form-field-enabled="${index}" ${row.selected ? 'checked' : ''} />
        <label class="crm-form-editor-field-label" for="crmFormField_${index}">${escHtml(row.label)}</label>
      </div>
    `;
  }

  function renderFormEditorFieldList() {
    const list = el('crmFormEditorFields');
    if (!list) return;
    list.innerHTML = formEditorFieldRows.map((row, index) => formEditorFieldRowMarkup(row, index)).join('');
    bindFormEditorFieldList(list);
  }

  function bindFormEditorFieldList(list) {
    if (!list) return;

    list.querySelectorAll('[data-form-field-enabled]').forEach((input) => {
      input.addEventListener('change', () => {
        syncFormEditorFieldRowsFromDom(list);
        renderFormEditorFieldList();
        renderFormEditorPreview();
      });
    });

    list.querySelectorAll('[data-form-field-drag]').forEach((handle) => {
      handle.addEventListener('dragstart', (event) => {
        formEditorDragIndex = Number(handle.dataset.formFieldDrag);
        handle.closest('.crm-form-editor-field-row')?.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(formEditorDragIndex));
        }
        event.stopPropagation();
      });
      handle.addEventListener('dragend', () => {
        formEditorDragIndex = null;
        list.querySelectorAll('.crm-form-editor-field-row').forEach((node) => {
          node.classList.remove('is-drag-over', 'is-dragging');
        });
      });
    });

    list.querySelectorAll('.crm-form-editor-field-row').forEach((rowEl) => {
      rowEl.addEventListener('dragover', (event) => {
        event.preventDefault();
        const index = Number(rowEl.dataset.formFieldIndex);
        if (formEditorDragIndex === null || formEditorDragIndex === index) return;
        rowEl.classList.add('is-drag-over');
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      rowEl.addEventListener('dragleave', () => rowEl.classList.remove('is-drag-over'));
      rowEl.addEventListener('drop', (event) => {
        event.preventDefault();
        rowEl.classList.remove('is-drag-over');
        const index = Number(rowEl.dataset.formFieldIndex);
        if (formEditorDragIndex === null || formEditorDragIndex === index) return;
        syncFormEditorFieldRowsFromDom(list);
        const [moved] = formEditorFieldRows.splice(formEditorDragIndex, 1);
        const insertIndex = formEditorDragIndex < index ? index - 1 : index;
        formEditorFieldRows.splice(insertIndex, 0, moved);
        formEditorDragIndex = null;
        renderFormEditorFieldList();
        renderFormEditorPreview();
      });
    });
  }

  function previewFieldInputMarkup(field) {
    if (field.type === 'textarea') {
      return `<textarea readonly tabindex="-1"></textarea>`;
    }
    if (field.type === 'select') {
      const options = (field.options || []).length
        ? field.options.map((opt) => `<option>${escHtml(opt)}</option>`).join('')
        : '<option>Option one</option><option>Option two</option>';
      return `<select disabled tabindex="-1">${options}</select>`;
    }
    const inputType = field.type === 'boolean' ? 'checkbox' : (field.type || 'text');
    if (inputType === 'checkbox') {
      return `<input type="checkbox" disabled tabindex="-1" />`;
    }
    return `<input type="${escHtml(inputType)}" readonly tabindex="-1" />`;
  }

  function renderFormEditorPreview() {
    const preview = el('crmFormEditorPreview');
    if (!preview) return;

    applyFormEditorPreviewThemeVars();
    syncFormEditorFieldRowsFromDom();
    const heading = el('crmFormEditorHeading')?.value.trim() || '';
    const submitLabel = el('crmFormEditorSubmitLabel')?.value.trim() || 'Submit';
    const styles = readFormStylesFromEditor();
    const selectedFields = formEditorFieldRows.filter((row) => row.selected);

    if (!selectedFields.length) {
      preview.innerHTML = '<p class="crm-form-preview-empty">Select at least one field to preview the form.</p>';
      return;
    }

    preview.innerHTML = `
      <div class="crm-form-preview-shell" style="${formStyleAttr(styles)}">
        <div class="crm-form-preview-form" style="width:${escHtml(styles.fieldWidth)};max-width:100%;">
          ${heading ? `<div class="crm-form-preview-heading">${escHtml(heading)}</div>` : ''}
          ${selectedFields.map((field) => `
            <span class="crm-form-preview-label">${escHtml(field.label)}</span>
            ${previewFieldInputMarkup(field)}
          `).join('')}
          <button type="button" class="crm-form-preview-submit" style="${formSubmitInlineStyle(styles)}">${escHtml(submitLabel)}</button>
        </div>
      </div>
    `;
  }

  function wireFormEditorPreviewUpdates() {
    FORM_STYLE_EDITOR_IDS.forEach((id) => {
      const node = el(id);
      if (!node || node.dataset.crmPreviewBound === '1') return;
      node.dataset.crmPreviewBound = '1';
      node.addEventListener('input', renderFormEditorPreview);
      node.addEventListener('change', renderFormEditorPreview);
    });
    const buttonWidth = el('crmFormEditorButtonWidth');
    if (buttonWidth && buttonWidth.dataset.crmWidthBound !== '1') {
      buttonWidth.dataset.crmWidthBound = '1';
      buttonWidth.addEventListener('input', () => {
        syncFormButtonWidthUI('crmFormEditorButtonWidth');
      });
    }
  }

  function getSavedEditorFormRecord() {
    if (!editingFormId) return null;
    if (savedEditorForm?.id === editingFormId) return savedEditorForm;
    return currentForms.find((f) => f.id === editingFormId) || null;
  }

  function openFormEmbedModal(form) {
    if (!App.components || typeof App.components.Modal !== 'function') {
      notify('Modal component unavailable.', true);
      return;
    }
    if (!form?.id) {
      notify('Save the form first to generate embed code.', true);
      return;
    }

    const body = document.createElement('div');
    const idRow = document.createElement('div');
    idRow.className = 'crm-embed-modal-id-row';
    const idCode = document.createElement('code');
    idCode.textContent = form.id;
    const copyIdBtn = document.createElement('button');
    copyIdBtn.type = 'button';
    copyIdBtn.className = 'btn';
    copyIdBtn.textContent = 'Copy ID';
    copyIdBtn.onclick = () => {
      navigator.clipboard?.writeText(form.id).catch(() => {});
      notify('Form ID copied.');
    };
    idRow.appendChild(idCode);
    idRow.appendChild(copyIdBtn);

    const idHelp = document.createElement('p');
    idHelp.className = 'meta';
    idHelp.style.marginBottom = '0.75rem';
    idHelp.innerHTML = 'Paste this Form ID into a <strong>CRM module</strong> in the Builder.';

    const codeLabel = document.createElement('h4');
    codeLabel.textContent = 'Embed Code';
    codeLabel.style.margin = '0 0 0.35rem';

    const textarea = document.createElement('textarea');
    textarea.className = 'crm-embed-modal-code';
    textarea.readOnly = true;
    textarea.value = buildEmbedCode(form);

    body.appendChild(idHelp);
    body.appendChild(idRow);
    body.appendChild(codeLabel);
    body.appendChild(textarea);

    const modal = App.components.Modal({
      title: 'Embed Code',
      body,
      dialogClass: 'crm-embed-modal',
      actions: [
        {
          label: 'Copy Embed Code',
          onClick: () => {
            textarea.select();
            navigator.clipboard?.writeText(textarea.value).catch(() => {
              document.execCommand('copy');
            });
            notify('Embed code copied.');
          },
        },
        { label: 'Close', primary: true, onClick: () => modal.close() },
      ],
    });
    modal.open();
  }

  function buildEmbedCode(form) {
    if (!form?.id) return '';
    const origin = window.location.origin;
    const configId = currentConfig?.id || '';
    const projectId = (typeof App.projectContext?.getSessionProjectId === 'function')
      ? App.projectContext.getSessionProjectId()
      : (App.state?.currentProjectId || '');
    const styles = normalizeFormStyles(form.styles, form.accentColor);
    const fields = Array.isArray(form.fields) ? form.fields : [];
    const labelJustify = formAlignToJustify(styles.labelAlign);
    const fieldJustify = formAlignToJustify(styles.fieldAlign);
    const buttonJustify = formAlignToJustify(styles.buttonAlign);
    const headingColor = resolveFormColor(styles.headingColor, styles.headingColorOpacity, DEFAULT_FORM_STYLES.headingColor);
    const backgroundColor = resolveFormColor(styles.backgroundColor, styles.backgroundColorOpacity, DEFAULT_FORM_STYLES.backgroundColor);
    const borderColor = resolveFormColor(styles.borderColor, styles.borderColorOpacity, DEFAULT_FORM_STYLES.borderColor);
    const buttonBackgroundColor = resolveFormColor(
      styles.buttonBackgroundColor,
      styles.buttonBackgroundColorOpacity,
      DEFAULT_FORM_STYLES.buttonBackgroundColor
    );
    const buttonTextColor = resolveFormColor(
      styles.buttonTextColor,
      styles.buttonTextColorOpacity,
      DEFAULT_FORM_STYLES.buttonTextColor
    );
    const themeVars = buildFormThemePaletteVars(formEditorThemePalette, formEditorThemeTypography);
    const themeVarCss = Object.entries(themeVars).map(([key, value]) => `${key}:${value}`).join(';');
    const fieldHtml = fields.map((f) => {
      const inputEl = f.type === 'textarea'
        ? `<textarea name="${f.key}" id="crmf_${f.key}"${f.required ? ' required' : ''}></textarea>`
        : f.type === 'select'
          ? `<select name="${f.key}" id="crmf_${f.key}"${f.required ? ' required' : ''}><option value="">Select…</option></select>`
          : `<input type="${f.type === 'boolean' ? 'checkbox' : escHtml(f.type || 'text')}" name="${f.key}" id="crmf_${f.key}"${f.required ? ' required' : ''} />`;
      return `  <label class="crm-embed-field" for="crmf_${f.key}"><span>${escHtml(f.label)}</span>${inputEl}</label>`;
    }).join('\n');

    return `<!-- CRM Form: ${escHtml(form.name)} -->
<style>
.crm-embed-shell{width:100%;max-width:100%;font-family:sans-serif;text-align:left;margin:${escHtml(styles.margin)};${themeVarCss}}
.crm-embed-heading,.crm-embed-form{width:${escHtml(styles.fieldWidth)};max-width:100%;text-align:${escHtml(styles.labelAlign)}}
.crm-embed-heading{margin:0 0 0.85rem;padding:0;font-size:1.35rem;font-weight:800;color:${escHtml(headingColor)}}
.crm-embed-form{display:grid;grid-template-columns:minmax(120px,38%) minmax(0,1fr);column-gap:8px;row-gap:12px;background:${escHtml(backgroundColor)};border:${escHtml(styles.borderSize)} solid ${escHtml(borderColor)};padding:${escHtml(styles.padding)};border-radius:${escHtml(styles.borderRadius)};box-sizing:border-box}
.crm-embed-field{display:contents;color:#18324a;font-weight:700}
.crm-embed-field>span{grid-column:1;justify-self:${labelJustify};align-self:start;text-align:${escHtml(styles.labelAlign)}}
.crm-embed-field input,.crm-embed-field textarea,.crm-embed-field select{grid-column:2;justify-self:${fieldJustify};width:100%;min-height:42px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box;font:inherit}
.crm-embed-submit{grid-column:2;justify-self:${buttonJustify};width:${escHtml(styles.buttonWidth)};max-width:100%;white-space:nowrap;padding:0.6rem 1.5rem;border:none;border-radius:8px;background:${escHtml(buttonBackgroundColor)};color:${escHtml(buttonTextColor)};font-size:${escHtml(styles.buttonTextSize)};font-weight:${formWeightToCss(styles.buttonTextWeight)};cursor:pointer}
</style>
<div class="crm-embed-shell">
${form.heading ? `  <div class="crm-embed-heading">${escHtml(form.heading)}</div>\n` : ''}
<form id="crmForm_${form.id}" class="crm-embed-form">
  <input type="hidden" name="crmConfigId" value="${configId}" />
  <input type="hidden" name="projectId" value="${projectId}" />
  <input type="hidden" name="_trap" value="" aria-hidden="true" style="display:none;" />
${fieldHtml}
  <button type="submit" class="crm-embed-submit">${escHtml(form.submitLabel || 'Submit')}</button>
  <p id="crmMsg_${form.id}" style="grid-column:1/-1;margin:0.5rem 0 0;"></p>
</form>
</div>
<script>
(function(){
  var form=document.getElementById('crmForm_${form.id}');
  var msg=document.getElementById('crmMsg_${form.id}');
  if(!form)return;
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var data={};
    new FormData(form).forEach(function(v,k){data[k]=v;});
    fetch('${origin}/api/crm/contact-submit',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({crmConfigId:data.crmConfigId,projectId:data.projectId,_trap:data._trap||'',email:data.email||'',data:data,source:'form'})
    }).then(function(r){return r.json();}).then(function(){
      if(msg)msg.textContent='${escHtml(form.successMessage || 'Thank you!')}';
      form.reset();
    }).catch(function(){if(msg)msg.textContent='${escHtml(form.errorMessage || 'Something went wrong.')}';});
  });
})();
<\/script>`;
  }

  async function openFormEditor(form) {
    editingFormId = form ? form.id : null;
    savedEditorForm = form ? { ...form } : null;
    const titleEl = el('crmFormEditorTitle');
    if (titleEl) {
      titleEl.innerHTML = `<a href="#" class="page-heading-back-link" onclick="App.crm.openPage(); return false;">CRM</a>: ${form ? 'Edit' : 'Create'} Form`;
    }

    if (el('crmFormEditorName'))        el('crmFormEditorName').value       = form?.name || '';
    if (el('crmFormEditorHeading'))     el('crmFormEditorHeading').value    = form?.heading || '';
    if (el('crmFormEditorSubmitLabel')) el('crmFormEditorSubmitLabel').value = form?.submitLabel || 'Submit';
    if (el('crmFormEditorSuccessMsg'))  el('crmFormEditorSuccessMsg').value  = form?.successMessage || 'Thank you! Your information has been saved.';
    if (el('crmFormEditorErrorMsg'))    el('crmFormEditorErrorMsg').value    = form?.errorMessage || 'Something went wrong. Please try again.';
    await loadFormEditorTheme();
    populateFormStylesEditor(form);
    bindFormColorPickers();

    const allFields = allConfigFields(currentConfig);
    formEditorFieldRows = buildFormEditorFieldRows(allFields, form);
    renderFormEditorFieldList();
    wireFormEditorPreviewUpdates();
    renderFormEditorPreview();

    const cancelBtn = el('crmFormEditorCancelBtn');
    if (cancelBtn) cancelBtn.onclick = () => openPage();

    const embedBtn = el('crmFormEmbedCodeBtn');
    if (embedBtn) {
      embedBtn.onclick = () => {
        const saved = getSavedEditorFormRecord();
        if (!saved) {
          notify('Save the form first to generate embed code.', true);
          return;
        }
        openFormEmbedModal(saved);
      };
    }

    const editorForm = el('crmFormEditorForm');
    if (editorForm) {
      editorForm.onsubmit = async (e) => {
        e.preventDefault();
        await saveForm();
      };
    }

    setActivePage('crmFormEditorPage');
  }

  async function saveForm() {
    const name = el('crmFormEditorName')?.value.trim() || '';
    if (!name) { notify('Form name is required.', true); return; }

    syncFormEditorFieldRowsFromDom();
    const fields = formEditorFieldRows
      .filter((row) => row.selected)
      .map((row) => ({
        key: row.key,
        label: row.label,
        type: row.type,
        required: Boolean(row.required),
      }));

    if (!fields.length) {
      notify('Select at least one field for this form.', true);
      return;
    }

    const styles = readFormStylesFromEditor();
    const payload = {
      crmConfigId: currentConfig.id,
      name,
      heading: el('crmFormEditorHeading')?.value.trim() || '',
      submitLabel: el('crmFormEditorSubmitLabel')?.value.trim() || 'Submit',
      successMessage: el('crmFormEditorSuccessMsg')?.value.trim() || 'Thank you! Your information has been saved.',
      errorMessage: el('crmFormEditorErrorMsg')?.value.trim() || 'Something went wrong. Please try again.',
      accentColor: legacyAccentFromStyles(styles),
      styles,
      fields,
    };

    try {
      let saved;
      if (editingFormId) {
        const res = await api(`/api/crm/forms/${encodeURIComponent(editingFormId)}`, {
          method: 'PUT', body: JSON.stringify(payload),
        });
        saved = res.form || res.data || res;
        notify('Form saved.');
      } else {
        const res = await api('/api/crm/forms', {
          method: 'POST', body: JSON.stringify(payload),
        });
        saved = res.form || res.data || res;
        editingFormId = saved?.id || null;
        notify('Form created.');
      }
      if (saved) {
        savedEditorForm = saved;
        const idx = currentForms.findIndex((f) => f.id === saved.id);
        if (idx >= 0) currentForms[idx] = saved;
        else currentForms.unshift(saved);
      }
    } catch (err) {
      notify(err.message || 'Failed to save form.', true);
    }
  }

  async function deleteForm(id) {
    if (!confirm('Delete this form? This cannot be undone.')) return;
    try {
      await api(`/api/crm/forms/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('Form deleted.');
      await openFormsView();
    } catch (err) {
      notify(err.message || 'Failed to delete form.', true);
    }
  }

  // ── Fields config view ───────────────────────────────────────────────────────
  function openFieldsView() {
    activeCrmTab = 'fields';
    showPanel('crmFieldsPanel');
    configFieldRows = buildFieldCatalogRows(currentConfig);
    renderFieldConfigTable('crmFieldConfigRows', configFieldRows, rerenderConfigFieldRows);

    const addBtn = el('crmAddCustomFieldBtn');
    if (addBtn) {
      addBtn.onclick = () => {
        syncFieldRowsFromDom(configFieldRows, el('crmFieldConfigRows'));
        addCustomFieldRow(configFieldRows);
        rerenderConfigFieldRows(configFieldRows);
      };
    }

    const form = el('crmFieldConfigForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await saveFieldConfig();
      };
    }
  }

  async function saveFieldConfig() {
    syncFieldRowsFromDom(configFieldRows, el('crmFieldConfigRows'));
    configFieldRows.forEach((row) => {
      if (!row.isCustom) return;
      const keys = new Set(configFieldRows.filter((item) => item !== row).map((item) => item.key));
      if (!safeText(row.key) || row.key.startsWith('custom_')) {
        row.key = sanitizeCustomFieldKey(row.label, keys);
      }
    });
    const payload = serializeFieldRows(configFieldRows);
    try {
      const res = await api(`/api/crm/configs/${encodeURIComponent(currentConfig.id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      currentConfig = res.config || res.data || currentConfig;
      notify('Field configuration saved.');
      openContactsView();
    } catch (err) {
      notify(err.message || 'Failed to save field configuration.', true);
    }
  }

  // ── Setup page ───────────────────────────────────────────────────────────────
  function openSetupPage() {
    setupFieldRows = buildFieldCatalogRows(null, ['first_name', 'last_name', 'phone']);
    renderFieldConfigTable('crmSetupFieldRows', setupFieldRows, rerenderSetupFieldRows);

    const addBtn = el('crmSetupAddCustomFieldBtn');
    if (addBtn) {
      addBtn.onclick = () => {
        syncFieldRowsFromDom(setupFieldRows, el('crmSetupFieldRows'));
        addCustomFieldRow(setupFieldRows);
        rerenderSetupFieldRows(setupFieldRows);
      };
    }

    const cancelBtn = el('crmSetupCancelBtn');
    if (cancelBtn) cancelBtn.onclick = () => setActivePage('crmPage');

    const form = el('crmSetupForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await generateCrm();
      };
    }

    setActivePage('crmSetupPage');
  }

  async function generateCrm() {
    const name = el('crmSetupName')?.value.trim() || 'CRM';
    syncFieldRowsFromDom(setupFieldRows, el('crmSetupFieldRows'));
    setupFieldRows.forEach((row) => {
      if (!row.isCustom) return;
      const keys = new Set(setupFieldRows.filter((item) => item !== row).map((item) => item.key));
      if (!safeText(row.key) || row.key.startsWith('custom_')) {
        row.key = sanitizeCustomFieldKey(row.label, keys);
      }
    });
    const payload = serializeFieldRows(setupFieldRows);

    try {
      const res = await api('/api/crm/configs', {
        method: 'POST',
        body: JSON.stringify({ name, ...payload }),
      });
      currentConfig = res.config || res.data || null;
      notify(`CRM "${name}" generated.`);
      setActivePage('crmPage');
      renderPage();
      openContactsView();
    } catch (err) {
      notify(err.message || 'Failed to generate CRM.', true);
    }
  }

  // ── Public navigation helpers ────────────────────────────────────────────────
  function openPage() {
    setActivePage('crmPage');
    loadPage();
  }

  // ── Utility ──────────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    // Wire "Set Up CRM" button
    const setupBtn = el('crmOpenSetupBtn');
    if (setupBtn) setupBtn.onclick = openSetupPage;
    bindFormColorPickers();
  }

  // Run init after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    manifest: {
      id: 'crm',
      label: 'CRM',
      pageId: 'crmPage',
      pagePrefixes: ['crm'],
    },
    onPageActivated(targetPageId) {
      if (targetPageId === 'crmPage') {
        if (!currentConfig) {
          loadPage();
          return;
        }
        renderPage();
      }
    },
    openPage,
    openSetupPage,
    openContactsView: () => { activeCrmTab = 'contacts'; setActivePage('crmPage'); loadPage().then(() => openContactsView()); },
    openFormsView:    () => { activeCrmTab = 'forms'; setActivePage('crmPage'); loadPage().then(() => openFormsView()); },
    openFieldsView:   () => { activeCrmTab = 'fields'; setActivePage('crmPage'); loadPage().then(() => openFieldsView()); },
    init,
  };
})();
