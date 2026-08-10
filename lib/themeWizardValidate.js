'use strict';

/**
 * Theme Wizard — output validation (spec §6.5) and lock enforcement (§6.4).
 *
 * The generator returns JSON written by a model. Nothing it returns is trusted:
 * every value is checked against the BuilderTheme shape before it can reach a
 * candidate row, unknown keys are dropped, and anything malformed fails the
 * candidate rather than corrupting a preview.
 *
 * Scope is deliberately narrow. The wizard generates COLOURS AND TYPOGRAPHY
 * ONLY (spec §2) — the four legacy palette colours, the role palette (§6.7),
 * and type. No radii, margins, logos, or background images. Keys outside that
 * set are dropped even when they are otherwise valid BuilderTheme fields, so a
 * chatty model cannot widen the feature's blast radius by inventing more of
 * the theme than it was asked for.
 */

// Keep in sync with BUILDER_HEADING_FONTS in components/builder/builder-utils.ts
// and HEADING_FONT_KEYS in lib/builder-client/builder-template.ts. A font key
// outside this set renders as "inherit", so an invented family name is not a
// cosmetic miss — it silently produces no font at all.
const FONT_KEYS = new Set([
  '', 'inter', 'poppins', 'montserrat', 'oswald', 'archivo',
  'space-grotesk', 'bebas', 'playfair', 'merriweather', 'lora',
]);

const FONT_ROLES = ['heading', 'body', 'mono'];
const COLOR_ROLES = ['text', 'heading', 'muted', 'link', 'linkHover', 'selection'];
const PALETTE_KEYS = ['primaryColor', 'secondaryColor', 'backgroundColor', 'accentColor'];

/**
 * Role palette (spec §6.7): five background/text pairs that turn one wash of
 * colour into a banded page design. Each pair is contrast-checked — an
 * unreadable pair is a broken design, not a bold one.
 */
const PALETTE_ROLE_KEYS = [
  'surface', 'surfaceText',
  'band', 'bandText',
  'inverse', 'inverseText',
  'header', 'headerText',
  'button', 'buttonText',
];
const PALETTE_ROLE_PAIRS = [
  ['surface', 'surfaceText'],
  ['band', 'bandText'],
  ['inverse', 'inverseText'],
  ['header', 'headerText'],
  ['button', 'buttonText'],
];

// WCAG contrast thresholds. Below MIN the pair is unreadable and the candidate
// fails; between MIN and COMFORT it renders but is recorded as a warning.
const CONTRAST_MIN = 3.0;
const CONTRAST_COMFORT = 4.5;

// Range limits are taste guards as much as safety ones: a 400px base size or a
// 4.0 scale ratio is technically renderable and always wrong.
const SCALE_LIMITS = {
  baseSize: { min: 12, max: 24 },
  ratio: { min: 1.0, max: 1.8 },
  baseLineHeight: { min: 1.0, max: 2.2 },
};

/** '#abc' / 'ABC123' / '#AABBCC' → '#aabbcc'. Anything else → ''. */
function normalizeHex(value) {
  const raw = String(value == null ? '' : value).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw.split('').map((c) => c + c).join('').toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return '';
}

function clampNumber(value, { min, max }) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(max, Math.max(min, num));
}

/** WCAG 2.x relative luminance of a normalized '#rrggbb'. */
function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two normalized '#rrggbb' colours (1–21). */
function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const [darker, lighter] = a < b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * @returns {{ok: boolean, patch: object, errors: string[], warnings: string[]}}
 *   `errors` fail the candidate. `warnings` are values that were dropped or
 *   clamped but left enough behind to render — recorded so a consistently
 *   sloppy prompt is visible rather than silently absorbed.
 */
function validateThemePatch(raw) {
  const errors = [];
  const warnings = [];
  const patch = {};

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, patch: {}, errors: ['The model did not return a JSON object'], warnings };
  }

  for (const key of PALETTE_KEYS) {
    if (raw[key] === undefined) continue;
    const hex = normalizeHex(raw[key]);
    if (hex) patch[key] = hex;
    else warnings.push(`${key}: "${raw[key]}" is not a colour and was dropped`);
  }

  if (raw.palette !== undefined) {
    if (!raw.palette || typeof raw.palette !== 'object' || Array.isArray(raw.palette)) {
      errors.push('palette must be an object');
    } else {
      const palette = {};
      for (const role of PALETTE_ROLE_KEYS) {
        const value = raw.palette[role];
        if (value === undefined) continue;
        const hex = normalizeHex(value);
        if (hex) palette[role] = hex;
        else warnings.push(`palette.${role}: "${value}" is not a colour and was dropped`);
      }
      // Contrast-check every complete pair. Unreadable fails the candidate:
      // the operator is being asked to judge looks, and "navy text on navy"
      // is not a look, it is a bug the preview would faithfully render.
      for (const [bgRole, textRole] of PALETTE_ROLE_PAIRS) {
        if (!palette[bgRole] || !palette[textRole]) continue;
        const ratio = contrastRatio(palette[bgRole], palette[textRole]);
        if (ratio < CONTRAST_MIN) {
          errors.push(
            `palette.${textRole} on palette.${bgRole} is unreadable `
            + `(contrast ${ratio.toFixed(1)}:1, needs at least ${CONTRAST_MIN}:1)`
          );
        } else if (ratio < CONTRAST_COMFORT) {
          warnings.push(
            `palette.${textRole} on palette.${bgRole} is low-contrast `
            + `(${ratio.toFixed(1)}:1; ${CONTRAST_COMFORT}:1 is comfortable)`
          );
        }
      }
      if (Object.keys(palette).length) patch.palette = palette;
    }
  }

  if (raw.treatments !== undefined) {
    if (!raw.treatments || typeof raw.treatments !== 'object' || Array.isArray(raw.treatments)) {
      errors.push('treatments must be an object');
    } else {
      const treatments = {};
      if (raw.treatments.heroOverlay !== undefined) {
        const hex = normalizeHex(raw.treatments.heroOverlay);
        if (hex) treatments.heroOverlay = hex;
        else warnings.push(`treatments.heroOverlay: "${raw.treatments.heroOverlay}" is not a colour and was dropped`);
      }
      if (raw.treatments.heroOverlayOpacity !== undefined) {
        const clamped = clampNumber(raw.treatments.heroOverlayOpacity, { min: 0, max: 0.75 });
        if (clamped === null) {
          warnings.push(`treatments.heroOverlayOpacity: "${raw.treatments.heroOverlayOpacity}" is not a number and was dropped`);
        } else {
          if (clamped !== Number(raw.treatments.heroOverlayOpacity)) {
            warnings.push(`treatments.heroOverlayOpacity: ${raw.treatments.heroOverlayOpacity} clamped to ${clamped}`);
          }
          treatments.heroOverlayOpacity = clamped;
        }
      }
      for (const flag of ['cardOverlap', 'footerInverse']) {
        const value = raw.treatments[flag];
        if (value === undefined) continue;
        if (typeof value === 'boolean') treatments[flag] = value;
        else if (value === 'true' || value === 'false') treatments[flag] = value === 'true';
        else warnings.push(`treatments.${flag}: "${value}" is not true/false and was dropped`);
      }
      if (Object.keys(treatments).length) patch.treatments = treatments;
    }
  }

  const typography = raw.typography;
  if (typography !== undefined) {
    if (!typography || typeof typography !== 'object' || Array.isArray(typography)) {
      errors.push('typography must be an object');
    } else {
      const outTypography = {};

      if (typography.fonts !== undefined) {
        if (!typography.fonts || typeof typography.fonts !== 'object') {
          errors.push('typography.fonts must be an object');
        } else {
          const fonts = {};
          for (const role of FONT_ROLES) {
            const value = typography.fonts[role];
            if (value === undefined) continue;
            const key = String(value).trim().toLowerCase();
            if (FONT_KEYS.has(key)) {
              fonts[role] = key;
            } else {
              // Hard error, not a warning: the whole point of a direction is its
              // type character. A candidate that silently loses its heading font
              // is not the candidate the operator is being asked to judge.
              errors.push(`typography.fonts.${role}: "${value}" is not an available font`);
            }
          }
          if (Object.keys(fonts).length) outTypography.fonts = fonts;
        }
      }

      if (typography.colors !== undefined) {
        if (!typography.colors || typeof typography.colors !== 'object') {
          errors.push('typography.colors must be an object');
        } else {
          const colors = {};
          for (const role of COLOR_ROLES) {
            const value = typography.colors[role];
            if (value === undefined) continue;
            const hex = normalizeHex(value);
            if (hex) colors[role] = hex;
            else warnings.push(`typography.colors.${role}: "${value}" is not a colour and was dropped`);
          }
          if (Object.keys(colors).length) outTypography.colors = colors;
        }
      }

      if (typography.scale !== undefined) {
        if (!typography.scale || typeof typography.scale !== 'object') {
          errors.push('typography.scale must be an object');
        } else {
          const scale = {};
          for (const [key, limits] of Object.entries(SCALE_LIMITS)) {
            const value = typography.scale[key];
            if (value === undefined) continue;
            const clamped = clampNumber(value, limits);
            if (clamped === null) {
              warnings.push(`typography.scale.${key}: "${value}" is not a number and was dropped`);
              continue;
            }
            if (clamped !== Number(value)) {
              warnings.push(`typography.scale.${key}: ${value} clamped to ${clamped}`);
            }
            scale[key] = clamped;
          }
          if (Object.keys(scale).length) outTypography.scale = scale;
        }
      }

      if (Object.keys(outTypography).length) patch.typography = outTypography;
    }
  }

  // An empty patch is a failed candidate, not a neutral one — it would preview
  // as "no change at all" and read to the operator as a bland option rather
  // than a broken one.
  if (!errors.length && !Object.keys(patch).length) {
    errors.push('The model returned nothing usable — no colours and no typography');
  }

  return { ok: errors.length === 0, patch, errors, warnings };
}

/**
 * Belt and braces for spec §6.4. Locked values are stated in the prompt as hard
 * constraints AND overwritten here, because a prompt constraint is a request
 * and this is the guarantee. A model that ignores "keep this exact blue" must
 * not be able to change it anyway.
 *
 * `lockedValues` is keyed by dotted path into the patch:
 *   { "primaryColor": "#1a4d8f", "typography.fonts.heading": "lora" }
 */
function applyLockedValues(patch, lockedValues) {
  const locks = lockedValues && typeof lockedValues === 'object' ? lockedValues : {};
  const next = JSON.parse(JSON.stringify(patch || {}));
  const overridden = [];

  for (const [path, lockedValue] of Object.entries(locks)) {
    const segments = String(path).split('.').filter(Boolean);
    if (!segments.length) continue;

    let cursor = next;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
      cursor = cursor[seg];
    }
    const leaf = segments[segments.length - 1];
    if (cursor[leaf] !== lockedValue) overridden.push(path);
    cursor[leaf] = lockedValue;
  }

  return { patch: next, overridden };
}

module.exports = {
  FONT_KEYS,
  FONT_ROLES,
  COLOR_ROLES,
  PALETTE_KEYS,
  PALETTE_ROLE_KEYS,
  PALETTE_ROLE_PAIRS,
  SCALE_LIMITS,
  normalizeHex,
  contrastRatio,
  validateThemePatch,
  applyLockedValues,
};
