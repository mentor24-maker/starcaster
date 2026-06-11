"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/builder/current-poll-stub.js
var require_current_poll_stub = __commonJS({
  "lib/builder/current-poll-stub.js"(exports2, module2) {
    "use strict";
    function normalizePollContentWidth(value, fallback = "100") {
      const text = String(value ?? "").trim();
      if (text === "75" || text === "50" || text === "100") return text;
      return fallback;
    }
    function normalizeCurrentPollModuleWidth2(value) {
      return normalizePollContentWidth(value, "100");
    }
    module2.exports = {
      normalizeCurrentPollModuleWidth: normalizeCurrentPollModuleWidth2,
      POLL_CONTENT_WIDTH_OPTIONS: ["100", "75", "50"]
    };
  }
});

// lib/builder/asset-url-stub.js
var require_asset_url_stub = __commonJS({
  "lib/builder/asset-url-stub.js"(exports2, module2) {
    "use strict";
    function safeText3(value, max = 1e4) {
      return String(value ?? "").trim().slice(0, max);
    }
    function normalizeBuilderAssetUrl3(value) {
      const text = safeText3(value, 4e3);
      if (!text) return "";
      if (text.startsWith("/api/assets/")) {
        return text;
      }
      if (/^assets?\//i.test(text)) {
        return `/api/assets/${text.replace(/^assets?\//i, "")}`;
      }
      try {
        const url = new URL(text, "https://starcaster.local");
        if (url.pathname.startsWith("/api/assets/")) {
          return `${url.pathname}${url.search}`;
        }
      } catch (_) {
      }
      return text;
    }
    function resolvePublicBuilderAssetUrl2(value) {
      const normalized = normalizeBuilderAssetUrl3(value);
      if (!normalized) return "";
      if (/^https?:\/\//i.test(normalized)) return normalized;
      return normalized;
    }
    module2.exports = {
      safeText: safeText3,
      normalizeBuilderAssetUrl: normalizeBuilderAssetUrl3,
      resolvePublicBuilderAssetUrl: resolvePublicBuilderAssetUrl2
    };
  }
});

// ../normie/lib/rich-text-image.ts
function normalizeRichTextImagePath(value) {
  const text = value.trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("gallery/")) {
    return `/${text}`;
  }
  if (text.startsWith("/gallery/")) {
    return text;
  }
  if (text.startsWith("/api/admin/media-file/gallery/")) {
    return text.replace("/api/admin/media-file/gallery/", "/gallery/");
  }
  if (text.startsWith("api/admin/media-file/gallery/")) {
    return `/${text.replace("api/admin/media-file/gallery/", "gallery/")}`;
  }
  try {
    const url = new URL(text);
    if (url.pathname.startsWith("/api/admin/media-file/gallery/")) {
      return url.pathname.replace("/api/admin/media-file/gallery/", "/gallery/") + url.search;
    }
    if (url.pathname.startsWith("/gallery/")) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return text;
  }
  return text;
}
function isAllowedRichTextImageSrc(src) {
  const trimmed = src.trim();
  if (!trimmed || /^\s*javascript:/i.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("/gallery/") || trimmed.startsWith("/api/admin/media-file/")) {
    return true;
  }
  if (trimmed.startsWith("gallery/") || trimmed.startsWith("api/admin/media-file/")) {
    return true;
  }
  try {
    const url = new URL(trimmed, "https://www.normie.one");
    if (url.pathname.startsWith("/gallery/") || url.pathname.startsWith("/api/admin/media-file/")) {
      return true;
    }
    if (url.origin === "https://www.normie.one" || url.origin === "http://localhost:3000") {
      return url.pathname.startsWith("/gallery/") || url.pathname.startsWith("/api/admin/media-file/");
    }
  } catch {
    return false;
  }
  return false;
}
function resolveRichTextImageSrc(src, mode) {
  const normalized = normalizeRichTextImagePath(src);
  if (!normalized || !isAllowedRichTextImageSrc(normalized)) {
    return "";
  }
  const galleryPath = normalized.startsWith("/gallery/") ? normalized : normalized.startsWith("/api/admin/media-file/gallery/") ? normalized.replace("/api/admin/media-file/gallery/", "/gallery/") : "";
  if (mode === "storage") {
    return galleryPath || normalized;
  }
  if (galleryPath) {
    return mode === "display" ? galleryPath : `/api/admin/media-file${galleryPath}`;
  }
  if (normalized.startsWith("/api/admin/media-file/")) {
    return mode === "display" ? normalized.replace("/api/admin/media-file/", "/media/") : normalized;
  }
  return "";
}
function rewriteRichTextImageSrcInHtml(html, mode) {
  return html.replace(/<img\b([^>]*?)\ssrc=(["'])([^"']+)\2([^>]*)>/gi, (match, before, quote, src, after) => {
    const nextSrc = resolveRichTextImageSrc(src, mode);
    if (!nextSrc) {
      return "";
    }
    const attrs = `${before}${after}`;
    const classAttr = /\bclass=(["'])/i.test(attrs) ? "" : ` class="${RICH_TEXT_IMAGE_CLASS}"`;
    return `<img${before}${classAttr} src=${quote}${nextSrc}${quote}${after}>`;
  });
}
var RICH_TEXT_IMAGE_CLASS;
var init_rich_text_image = __esm({
  "../normie/lib/rich-text-image.ts"() {
    "use strict";
    RICH_TEXT_IMAGE_CLASS = "rich-text-editor-image";
  }
});

// ../normie/lib/sanitize-html.ts
function getDomPurify() {
  if (!domPurifyInstance) {
    domPurifyInstance = require("isomorphic-dompurify").default;
  }
  return domPurifyInstance;
}
function configureDomPurify() {
  const DOMPurify = getDomPurify();
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("rel", "noopener noreferrer");
      if (node.getAttribute("target") === "_blank") {
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (node.tagName === "IFRAME") {
      node.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-forms");
      if (!node.getAttribute("loading")) {
        node.setAttribute("loading", "lazy");
      }
      if (!node.getAttribute("tabindex")) {
        node.setAttribute("tabindex", "-1");
      }
    }
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") || "";
      if (!isAllowedRichTextImageSrc(src)) {
        node.remove();
        return;
      }
      if (!node.getAttribute("loading")) {
        node.setAttribute("loading", "lazy");
      }
    }
  });
}
function ensureConfigured() {
  if (!isConfigured) {
    configureDomPurify();
    isConfigured = true;
  }
}
function escapeHtmlText(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function sanitizeRichTextHtml(html) {
  try {
    ensureConfigured();
    return getDomPurify().sanitize(html, {
      ALLOWED_TAGS: [...RICH_TEXT_ALLOWED_TAGS],
      ALLOWED_ATTR: [...RICH_TEXT_ALLOWED_ATTR],
      ALLOW_DATA_ATTR: false
    });
  } catch {
    return stripDangerousRichTextHtml(html);
  }
}
function stripDangerousRichTextHtml(html) {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "").replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/javascript:/gi, "");
}
var RICH_TEXT_ALLOWED_TAGS, RICH_TEXT_ALLOWED_ATTR, EMBED_EXTRA_ATTR, domPurifyInstance, isConfigured, BLOG_BODY_EXTRA_ATTR;
var init_sanitize_html = __esm({
  "../normie/lib/sanitize-html.ts"() {
    "use strict";
    init_rich_text_image();
    RICH_TEXT_ALLOWED_TAGS = [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "del",
      "strike",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "a",
      "span",
      "div",
      "img"
    ];
    RICH_TEXT_ALLOWED_ATTR = [
      "href",
      "target",
      "rel",
      "style",
      "class",
      "id",
      "src",
      "alt",
      "width",
      "height",
      "loading"
    ];
    EMBED_EXTRA_ATTR = [
      "allow",
      "allowfullscreen",
      "frameborder",
      "scrolling",
      "src",
      "title",
      "width",
      "height",
      "loading",
      "referrerpolicy"
    ];
    domPurifyInstance = null;
    isConfigured = false;
    BLOG_BODY_EXTRA_ATTR = [
      "src",
      "alt",
      "width",
      "height",
      "colspan",
      "rowspan",
      ...EMBED_EXTRA_ATTR
    ];
  }
});

// ../normie/lib/builder-template.ts
var builder_template_exports = {};
__export(builder_template_exports, {
  BACKGROUND_STYLE_PRESETS: () => BACKGROUND_STYLE_PRESETS,
  BUILDER_PREVIEW_DEVICE_STORAGE_KEY: () => BUILDER_PREVIEW_DEVICE_STORAGE_KEY,
  BUILDER_PREVIEW_STORAGE_KEY: () => BUILDER_PREVIEW_STORAGE_KEY,
  createDefaultBackgroundSettings: () => createDefaultBackgroundSettings,
  createEmptyModule: () => createEmptyModule,
  createEmptySection: () => createEmptySection,
  createLocalId: () => createLocalId,
  formatRichTextContent: () => formatRichTextContent,
  getBuilderBackgroundStyle: () => getBuilderBackgroundStyle,
  getLayoutColumns: () => getLayoutColumns,
  getLayoutGridTemplate: () => getLayoutGridTemplate,
  looksLikeHtml: () => looksLikeHtml,
  normalizeAlignment: () => normalizeAlignment,
  normalizeBackgroundMode: () => normalizeBackgroundMode,
  normalizeBackgroundSettings: () => normalizeBackgroundSettings,
  normalizeBackgroundStyleKey: () => normalizeBackgroundStyleKey,
  normalizeBooleanText: () => normalizeBooleanText,
  normalizeBuilderAssetUrl: () => import_builder_asset_url2.normalizeBuilderAssetUrl,
  normalizeBuilderDocument: () => normalizeBuilderDocument,
  normalizeBuilderModuleSettingsForType: () => normalizeBuilderModuleSettingsForType,
  normalizeBuilderModules: () => normalizeBuilderModules,
  normalizeBuilderSection: () => normalizeBuilderSection,
  normalizeLayout: () => normalizeLayout,
  normalizeLayoutSections: () => normalizeLayoutSections,
  normalizeMobileLayout: () => normalizeMobileLayout,
  normalizeModuleSettings: () => normalizeModuleSettings,
  normalizeModuleType: () => normalizeModuleType,
  normalizeProductType: () => normalizeProductType,
  normalizeSignedOffsetValue: () => normalizeSignedOffsetValue,
  normalizeSpacingValue: () => normalizeSpacingValue,
  normalizeTemplateKind: () => normalizeTemplateKind,
  prepareRichTextHtmlForEditor: () => prepareRichTextHtmlForEditor,
  prepareRichTextHtmlForStorage: () => prepareRichTextHtmlForStorage,
  resolveBuilderModuleType: () => resolveBuilderModuleType,
  resolvePublicBuilderAssetUrl: () => import_builder_asset_url2.resolvePublicBuilderAssetUrl,
  rowToBuilderCellModule: () => rowToBuilderCellModule,
  rowToBuilderPage: () => rowToBuilderPage,
  rowToBuilderProduct: () => rowToBuilderProduct,
  rowToBuilderSavedSection: () => rowToBuilderSavedSection,
  rowToBuilderTemplate: () => rowToBuilderTemplate,
  safeText: () => import_builder_asset_url2.safeText,
  sanitizeCellBackgroundForDrillDown: () => sanitizeCellBackgroundForDrillDown,
  serializeBuilderDocument: () => serializeBuilderDocument,
  usesBuilderDrillDownSurfaceDefault: () => usesBuilderDrillDownSurfaceDefault
});
module.exports = __toCommonJS(builder_template_exports);

// ../normie/lib/builder-email-template.ts
var BUILDER_EMAIL_FUNCTIONS = [
  { value: "signup_confirmation", label: "Signup Confirmation" },
  { value: "password_reset", label: "Password Reset" },
  { value: "admin_invite", label: "Admin Invite" },
  { value: "magic_link", label: "Magic Link" }
];
function normalizeEmailFunction(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (BUILDER_EMAIL_FUNCTIONS.some((entry) => entry.value === text)) {
    return text;
  }
  return "";
}

// ../normie/lib/game-audience.ts
var GAME_AUDIENCE_OPTIONS = [
  { value: "public", label: "Public Site" },
  { value: "portal", label: "Player Portal" },
  { value: "both", label: "Public and Portal" }
];
function normalizeGameAudience(value) {
  const candidate = String(value ?? "").trim();
  if (GAME_AUDIENCE_OPTIONS.some((option) => option.value === candidate)) {
    return candidate;
  }
  return "both";
}

// ../normie/lib/module-game-audience.ts
var MODULE_GAME_AUDIENCE_SETTING_KEY = "gameAudience";
function normalizeModuleGameAudience(value) {
  return normalizeGameAudience(value);
}

// ../normie/lib/module-trigger.ts
var MODULE_TRIGGER_SETTING_KEY = "trigger";
var MODULE_TRIGGER_OPTIONS = [
  { value: "button", label: "Button Click" },
  { value: "on-load", label: "Page Load" },
  { value: "game", label: "Game" }
];
function normalizeModuleTrigger(value) {
  const allowed = new Set(MODULE_TRIGGER_OPTIONS.map((option) => option.value));
  const candidate = String(value ?? "").trim();
  if (allowed.has(candidate)) {
    return candidate;
  }
  return "button";
}

// ../normie/lib/confetti-effect.ts
var PLAYER_PORTAL_CONFETTI_Z_INDEX = 12e3;
var CONFETTI_EFFECT_DEFAULTS = {
  particleCount: "100",
  spread: "70",
  originX: "0.5",
  originY: "0.6",
  zIndex: String(PLAYER_PORTAL_CONFETTI_Z_INDEX),
  trigger: "button",
  buttonLabel: "Confetti",
  disableForReducedMotion: "false",
  sound: "pop",
  popVolume: "35"
};
var CONFETTI_SOUND_OPTIONS = [
  { value: "pop", label: "Pop" },
  { value: "chime", label: "Chime" },
  { value: "sparkle", label: "Sparkle" },
  { value: "fanfare", label: "Fanfare" },
  { value: "coin", label: "Coin" },
  { value: "off", label: "Off" }
];
function normalizeSoundType(value, playPopSoundLegacy) {
  const allowed = new Set(CONFETTI_SOUND_OPTIONS.map((option) => option.value));
  const candidate = String(value ?? "").trim();
  if (allowed.has(candidate)) {
    return candidate;
  }
  if (playPopSoundLegacy === "false") {
    return "off";
  }
  return "pop";
}
function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseFloat(String(value ?? fallback));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
function parseOrigin(value, fallback) {
  return clampNumber(value, fallback, 0, 1);
}
function normalizeConfettiModuleSettings(settings) {
  return {
    ...CONFETTI_EFFECT_DEFAULTS,
    ...settings,
    particleCount: String(
      Math.round(clampNumber(settings.particleCount, 100, 1, 500))
    ),
    spread: String(Math.round(clampNumber(settings.spread, 70, 0, 180))),
    originX: String(parseOrigin(settings.originX, 0.5)),
    originY: String(parseOrigin(settings.originY, 0.6)),
    zIndex: String(Math.round(clampNumber(settings.zIndex, 12e3, 1, 999999))),
    trigger: normalizeModuleTrigger(settings.trigger),
    [MODULE_GAME_AUDIENCE_SETTING_KEY]: normalizeModuleGameAudience(settings[MODULE_GAME_AUDIENCE_SETTING_KEY]),
    buttonLabel: String(settings.buttonLabel ?? CONFETTI_EFFECT_DEFAULTS.buttonLabel).trim() || "Confetti",
    disableForReducedMotion: settings.disableForReducedMotion === "true" ? "true" : "false",
    sound: normalizeSoundType(settings.sound, settings.playPopSound),
    popVolume: String(Math.round(clampNumber(settings.popVolume, 35, 0, 100)))
  };
}

// ../normie/lib/builder-template.ts
var import_current_poll_module = __toESM(require_current_poll_stub());

// ../normie/lib/builder-hex-color.ts
var DEFAULT_BUILDER_HEX_COLOR = "#ffffff";
var LEGACY_WHITE_RGBA = /* @__PURE__ */ new Set([
  "rgba(255, 255, 255, 0.94)",
  "rgba(255,255,255,0.94)",
  "rgba(255, 255, 255, 0.92)",
  "rgba(255,255,255,0.92)"
]);
function expandShortHex(hex) {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}
function rgbComponentsToHex(r, g, b) {
  return `#${[r, g, b].map(
    (channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")
  ).join("")}`;
}
function parseRgbOrRgba(value) {
  const match = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (!match) {
    return null;
  }
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = match[4] !== void 0 ? Number(match[4]) : 1;
  if (![r, g, b, a].every(Number.isFinite)) {
    return null;
  }
  return { r, g, b, a };
}
function isTransparentBuilderColor(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed || trimmed === "transparent") {
    return true;
  }
  if (/^#[0-9a-f]{8}$/i.test(trimmed) && trimmed.slice(-2) === "00") {
    return true;
  }
  const rgba = parseRgbOrRgba(trimmed);
  return rgba !== null && rgba.a <= 0;
}
function normalizeBuilderHexColor(value, fallback = DEFAULT_BUILDER_HEX_COLOR) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed.toLowerCase() === "transparent") {
    return "transparent";
  }
  const compact = trimmed.replace(/\s+/g, "");
  if (LEGACY_WHITE_RGBA.has(trimmed) || LEGACY_WHITE_RGBA.has(compact)) {
    return fallback;
  }
  if (/^#[0-9a-f]{3}$/i.test(trimmed) || /^#[0-9a-f]{6}$/i.test(trimmed)) {
    return expandShortHex(trimmed.toLowerCase());
  }
  const rgb = parseRgbOrRgba(trimmed);
  if (rgb) {
    if (rgb.a <= 0) {
      return "transparent";
    }
    return rgbComponentsToHex(rgb.r, rgb.g, rgb.b);
  }
  return fallback;
}

// ../normie/lib/game-reminder.ts
var GAME_REMINDER_DISPLAY_TYPES = ["popup", "inline"];
var GAME_REMINDER_APPEARANCES = ["speech_bubble", "strip"];
var GAME_REMINDER_CRITERION_TYPES = [
  "polls_taken",
  "logins",
  "specific_poll",
  "registered"
];
var GAME_REMINDER_OPERATORS = ["gte", "eq", "lte"];
var GAME_REMINDER_CRITERIA_LOGIC_OPTIONS = ["and", "or"];
function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function normalizeDisplayType(value) {
  const displayType = String(value ?? "").trim();
  return GAME_REMINDER_DISPLAY_TYPES.includes(displayType) ? displayType : "popup";
}
function normalizeGameReminderAppearance(value) {
  const appearance = String(value ?? "").trim();
  if (GAME_REMINDER_APPEARANCES.includes(appearance)) {
    return appearance;
  }
  const legacyDisplay = normalizeDisplayType(value);
  return legacyDisplay === "inline" ? "strip" : "speech_bubble";
}
var GAME_REMINDER_SELECT_COLUMNS = "id, name, display_type, message_html, criterion_type, criterion_value, is_active, sort_order, metadata, created_at, updated_at";
var GAME_REMINDER_EXTENDED_SELECT_COLUMNS = `${GAME_REMINDER_SELECT_COLUMNS}, audience, appearance`;
function normalizeCriterionType(value) {
  const criterionType = String(value ?? "").trim();
  return GAME_REMINDER_CRITERION_TYPES.includes(criterionType) ? criterionType : "polls_taken";
}
function normalizeOperator(value) {
  const operator = String(value ?? "").trim();
  return GAME_REMINDER_OPERATORS.includes(operator) ? operator : "gte";
}
function normalizeCriteriaLogic(value) {
  const logic = String(value ?? "").trim();
  return GAME_REMINDER_CRITERIA_LOGIC_OPTIONS.includes(logic) ? logic : "and";
}
function normalizeCriterionValue(criterionType, value) {
  const record = toRecord(value);
  if (criterionType === "specific_poll") {
    return { pollId: String(record.pollId ?? "").trim() };
  }
  if (criterionType === "registered") {
    return { registered: record.registered === true };
  }
  const count = Number.parseInt(String(record.count ?? 1), 10);
  return {
    operator: normalizeOperator(record.operator),
    count: Number.isFinite(count) ? Math.max(0, count) : 1
  };
}
function createDefaultReminderCriterion(type = "polls_taken") {
  if (type === "specific_poll") {
    return { id: crypto.randomUUID(), type, value: { pollId: "" } };
  }
  if (type === "registered") {
    return { id: crypto.randomUUID(), type, value: { registered: false } };
  }
  return { id: crypto.randomUUID(), type, value: { operator: "gte", count: 1 } };
}
function normalizeReminderCriterion(value) {
  const record = toRecord(value);
  const type = normalizeCriterionType(record.type ?? record.criterionType);
  const id = String(record.id ?? "").trim() || crypto.randomUUID();
  return {
    id,
    type,
    value: normalizeCriterionValue(type, record.value ?? record.criterionValue)
  };
}
function parseReminderCriteriaInput(input) {
  const rawCriteria = Array.isArray(input.criteria) ? input.criteria : [];
  if (rawCriteria.length > 0) {
    const criteria = rawCriteria.map((entry) => normalizeReminderCriterion(entry)).filter((entry) => entry !== null);
    if (criteria.length === 0) {
      return { config: { logic: "and", criteria: [createDefaultReminderCriterion()] }, error: "Add at least one valid criterion." };
    }
    for (const criterion of criteria) {
      if (criterion.type === "specific_poll" && !asPollCriterionValue(criterion.value).pollId) {
        return { config: { logic: "and", criteria }, error: "Select a poll for each specific-poll criterion." };
      }
    }
    return {
      config: {
        logic: normalizeCriteriaLogic(input.criteriaLogic),
        criteria
      },
      error: null
    };
  }
  const criterionType = normalizeCriterionType(input.criterionType);
  const criterionValue = normalizeCriterionValue(criterionType, input.criterionValue);
  if (criterionType === "specific_poll" && !asPollCriterionValue(criterionValue).pollId) {
    return {
      config: { logic: "and", criteria: [createDefaultReminderCriterion("specific_poll")] },
      error: "Select a poll for this reminder."
    };
  }
  return {
    config: {
      logic: normalizeCriteriaLogic(input.criteriaLogic),
      criteria: [{ id: crypto.randomUUID(), type: criterionType, value: criterionValue }]
    },
    error: null
  };
}
function asPollCriterionValue(value) {
  if ("pollId" in value) {
    return value;
  }
  return { pollId: "" };
}

// ../normie/lib/builder-reminder-module.ts
var REMINDER_APPEARANCE_SETTING_KEY = "appearance";
var REMINDER_CRITERIA_LOGIC_SETTING_KEY = "criteriaLogic";
var REMINDER_CRITERIA_JSON_SETTING_KEY = "reminderCriteriaJson";
var REMINDER_RECORDS_JSON_SETTING_KEY = "reminderRecordsJson";
var NON_POLL_REMINDER_SORT_BASE = 9e3;
var LEGACY_MODULE_SETTING_KEYS = [
  REMINDER_APPEARANCE_SETTING_KEY,
  REMINDER_CRITERIA_LOGIC_SETTING_KEY,
  REMINDER_CRITERIA_JSON_SETTING_KEY,
  "gameAudience",
  "isActive",
  "sortOrder",
  "backgroundColor",
  "borderColor",
  "borderThickness",
  "containerWidth",
  "offsetX",
  "offsetY",
  "zIndex"
];
function resolveReminderQuestionNumber(record, pollOrderById = {}) {
  const specificPoll = record.criteria.find((criterion) => criterion.type === "specific_poll");
  if (specificPoll && "pollId" in specificPoll.value && specificPoll.value.pollId) {
    const orderIndex = pollOrderById[specificPoll.value.pollId];
    if (Number.isFinite(orderIndex) && orderIndex > 0) {
      return orderIndex;
    }
  }
  const pollsTaken = record.criteria.find((criterion) => criterion.type === "polls_taken");
  if (pollsTaken && "count" in pollsTaken.value) {
    const count = pollsTaken.value.count;
    if (Number.isFinite(count) && count > 0) {
      return count;
    }
  }
  return null;
}
function sortReminderRecordsByQuestionNumber(records, pollOrderById = {}) {
  return [...records].map((record, index) => ({
    record,
    questionNumber: resolveReminderQuestionNumber(record, pollOrderById),
    index
  })).sort((left, right) => {
    const leftKey = left.questionNumber ?? NON_POLL_REMINDER_SORT_BASE + left.index;
    const rightKey = right.questionNumber ?? NON_POLL_REMINDER_SORT_BASE + right.index;
    if (leftKey !== rightKey) {
      return leftKey - rightKey;
    }
    return left.record.name.localeCompare(right.record.name, void 0, { sensitivity: "base" });
  }).map((entry, index) => ({
    ...entry.record,
    sortOrder: entry.questionNumber ?? NON_POLL_REMINDER_SORT_BASE + index
  }));
}
function parseReminderCriteriaFromModuleSettings(settings) {
  let parsedCriteria = [];
  try {
    parsedCriteria = JSON.parse(settings[REMINDER_CRITERIA_JSON_SETTING_KEY] ?? "[]");
  } catch {
    parsedCriteria = [];
  }
  return parseReminderCriteriaInput({
    criteriaLogic: settings[REMINDER_CRITERIA_LOGIC_SETTING_KEY],
    criteria: parsedCriteria
  });
}
function parseRecordCriteria(raw) {
  const parsed = parseReminderCriteriaInput({
    criteriaLogic: "and",
    criteria: Array.isArray(raw) ? raw : []
  });
  return parsed.config.criteria.length > 0 ? parsed.config.criteria : [createDefaultReminderCriterion()];
}
function normalizeRecordSortOrder(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function normalizeReminderRecord(raw, fallbackIndex) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = raw;
  const criteriaLogic = entry.criteriaLogic === "or" ? "or" : "and";
  const criteria = parseRecordCriteria(entry.criteria);
  const { config } = parseReminderCriteriaInput({ criteriaLogic, criteria });
  const rawName = String(entry.name ?? "");
  const rawId = String(entry.id ?? `reminder-${fallbackIndex + 1}`).trim();
  return {
    id: rawId || `reminder-${fallbackIndex + 1}`,
    name: rawName.trim().length > 0 ? rawName : `Reminder ${fallbackIndex + 1}`,
    messageHtml: String(entry.messageHtml ?? ""),
    appearance: normalizeGameReminderAppearance(entry.appearance),
    gameAudience: normalizeModuleGameAudience(
      typeof entry.gameAudience === "string" ? entry.gameAudience : void 0
    ),
    isActive: entry.isActive !== false && entry.isActive !== "false",
    sortOrder: normalizeRecordSortOrder(entry.sortOrder, fallbackIndex),
    criteriaLogic: config.logic,
    criteria: config.criteria,
    backgroundColor: normalizeBuilderHexColor(String(entry.backgroundColor ?? "#ffffff")),
    borderColor: normalizeBuilderHexColor(String(entry.borderColor ?? "#4cbb17")),
    borderThickness: String(entry.borderThickness ?? "2"),
    containerWidth: String(entry.containerWidth ?? "520"),
    offsetX: String(entry.offsetX ?? "0"),
    offsetY: String(entry.offsetY ?? "0"),
    zIndex: String(entry.zIndex ?? "46")
  };
}
function createSignupNudgeReminderRecord(id) {
  const { config } = parseReminderCriteriaInput({
    criteriaLogic: "and",
    criteria: [
      { id: "polls-taken", type: "polls_taken", value: { operator: "gte", count: 1 } },
      { id: "not-registered", type: "registered", value: { registered: false } }
    ]
  });
  return {
    id: id ?? crypto.randomUUID(),
    name: "Signup Nudge",
    messageHtml: "<p>Create a free account to save your picks and earn points.</p>",
    appearance: "speech_bubble",
    gameAudience: "both",
    isActive: true,
    sortOrder: 0,
    criteriaLogic: config.logic,
    criteria: config.criteria,
    backgroundColor: "#ffffff",
    borderColor: "#4cbb17",
    borderThickness: "2",
    containerWidth: "520",
    offsetX: "0",
    offsetY: "0",
    zIndex: "46"
  };
}
function legacyModuleToReminderRecord(module2) {
  const { config } = parseReminderCriteriaFromModuleSettings(module2.settings);
  return {
    id: module2.id,
    name: module2.name.trim() || "Reminder",
    messageHtml: module2.text ?? "",
    appearance: normalizeGameReminderAppearance(module2.settings[REMINDER_APPEARANCE_SETTING_KEY]),
    gameAudience: normalizeModuleGameAudience(module2.settings.gameAudience),
    isActive: module2.settings.isActive !== "false",
    sortOrder: normalizeRecordSortOrder(module2.settings.sortOrder, 0),
    criteriaLogic: config.logic,
    criteria: config.criteria.length > 0 ? config.criteria : [createDefaultReminderCriterion()],
    backgroundColor: normalizeBuilderHexColor(module2.settings.backgroundColor || "#ffffff"),
    borderColor: normalizeBuilderHexColor(module2.settings.borderColor || "#4cbb17"),
    borderThickness: module2.settings.borderThickness ?? "2",
    containerWidth: module2.settings.containerWidth ?? "520",
    offsetX: module2.settings.offsetX ?? "0",
    offsetY: module2.settings.offsetY ?? "0",
    zIndex: module2.settings.zIndex ?? "46"
  };
}
function hasLegacyReminderModuleFields(settings) {
  return Boolean(
    settings[REMINDER_CRITERIA_JSON_SETTING_KEY]?.trim() || settings[REMINDER_APPEARANCE_SETTING_KEY]?.trim() || settings.gameAudience?.trim() || settings.isActive?.trim() || settings.sortOrder?.trim()
  );
}
function parseReminderRecordsFromModule(module2) {
  const rawJson = module2.settings[REMINDER_RECORDS_JSON_SETTING_KEY];
  if (rawJson?.trim()) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((entry, index) => normalizeReminderRecord(entry, index)).filter((record) => record !== null);
      }
    } catch {
    }
  }
  if (hasLegacyReminderModuleFields(module2.settings) || module2.text.trim() || module2.name.trim()) {
    return [legacyModuleToReminderRecord(module2)];
  }
  return [createSignupNudgeReminderRecord()];
}
function serializeReminderRecords(records, pollOrderById = {}) {
  const sortedRecords = sortReminderRecordsByQuestionNumber(records, pollOrderById);
  return JSON.stringify(
    sortedRecords.map((record) => {
      const { config } = parseReminderCriteriaInput({
        criteriaLogic: record.criteriaLogic,
        criteria: record.criteria
      });
      return {
        id: record.id,
        name: record.name,
        messageHtml: record.messageHtml,
        appearance: record.appearance,
        gameAudience: record.gameAudience,
        isActive: record.isActive,
        sortOrder: record.sortOrder,
        criteriaLogic: config.logic,
        criteria: config.criteria.map((criterion) => ({
          id: criterion.id,
          type: criterion.type,
          value: criterion.value
        })),
        backgroundColor: normalizeBuilderHexColor(record.backgroundColor),
        borderColor: normalizeBuilderHexColor(record.borderColor),
        borderThickness: record.borderThickness,
        containerWidth: record.containerWidth,
        offsetX: record.offsetX,
        offsetY: record.offsetY,
        zIndex: record.zIndex
      };
    })
  );
}
function normalizeReminderModuleSettings(settings, module2) {
  const nextSettings = { ...settings };
  const records = module2 ? parseReminderRecordsFromModule({ id: module2.id, name: module2.name, text: module2.text, type: "reminder", column: "", settings: nextSettings }) : parseReminderRecordsFromModule({
    id: "reminder-module",
    name: "",
    text: "",
    type: "reminder",
    column: "",
    settings: nextSettings
  });
  nextSettings[REMINDER_RECORDS_JSON_SETTING_KEY] = serializeReminderRecords(records);
  for (const key of LEGACY_MODULE_SETTING_KEYS) {
    delete nextSettings[key];
  }
  return nextSettings;
}
function defaultReminderModuleSettings() {
  return {
    [REMINDER_RECORDS_JSON_SETTING_KEY]: serializeReminderRecords([createSignupNudgeReminderRecord()])
  };
}

// ../normie/lib/headline-rotator.ts
var HEADLINE_ROTATOR_MAX_Y_PERCENT = 60;
var HEADLINE_ROTATOR_DEFAULT_FONT_SIZE = "32";
var HEADLINE_ROTATOR_SKY_POSITIONS = [
  { xAxis: "6", yAxis: "10" },
  { xAxis: "78", yAxis: "8" },
  { xAxis: "34", yAxis: "22" },
  { xAxis: "92", yAxis: "15" },
  { xAxis: "4", yAxis: "42" },
  { xAxis: "58", yAxis: "12" },
  { xAxis: "22", yAxis: "48" },
  { xAxis: "86", yAxis: "28" },
  { xAxis: "12", yAxis: "22" },
  { xAxis: "68", yAxis: "52" },
  { xAxis: "48", yAxis: "9" },
  { xAxis: "96", yAxis: "45" }
];
var HEADLINE_ROTATOR_DEFAULT_MIN_HEIGHT = "480";
function getHeadlineRotatorSkyPosition(index) {
  const slot = HEADLINE_ROTATOR_SKY_POSITIONS[index % HEADLINE_ROTATOR_SKY_POSITIONS.length];
  return { xAxis: slot.xAxis, yAxis: slot.yAxis };
}
function usesDefaultHeadlineRotatorPosition(xAxis, yAxis) {
  const x = (xAxis ?? "").trim() || "50";
  const y = (yAxis ?? "").trim() || "50";
  return x === "50" && y === "50";
}
function withClampedYAxis(entry) {
  return { ...entry, yAxis: String(clampHeadlineRotatorYPercent(entry.yAxis)) };
}
function normalizeHeadlineRotatorEntry(entry, index) {
  if (!usesDefaultHeadlineRotatorPosition(entry.xAxis, entry.yAxis)) {
    return withClampedYAxis(entry);
  }
  const position = getHeadlineRotatorSkyPosition(index);
  return withClampedYAxis({ ...entry, xAxis: position.xAxis, yAxis: position.yAxis });
}
function mapHeadlineRotatorRecord(record, index, fallbackColor) {
  return normalizeHeadlineRotatorEntry(
    {
      id: String(record.id || `headline-${index + 1}`),
      label: String(record.label || ""),
      href: String(record.href || ""),
      xAxis: String(record.xAxis ?? "50"),
      yAxis: String(record.yAxis ?? "50"),
      color: String(record.color || fallbackColor),
      overlap: String(record.overlap ?? "0")
    },
    index
  );
}
function serializeHeadlineRotatorEntries(entries) {
  return JSON.stringify(entries);
}
function normalizeHeadlineRotatorHeadlinesJson(raw, fallbackColor) {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) {
      return raw;
    }
    const normalized = parsed.map((item, index) => {
      const record = item && typeof item === "object" ? item : {};
      return mapHeadlineRotatorRecord(record, index, fallbackColor);
    });
    return serializeHeadlineRotatorEntries(normalized);
  } catch {
    return raw;
  }
}
function clampHeadlineRotatorYPercent(value, fallback = 30) {
  return Math.min(Math.max(Number.parseFloat(value ?? "") || fallback, 0), HEADLINE_ROTATOR_MAX_Y_PERCENT);
}

// ../normie/lib/builder-template.ts
var import_builder_asset_url = __toESM(require_asset_url_stub());
init_sanitize_html();
init_rich_text_image();
var import_builder_asset_url2 = __toESM(require_asset_url_stub());
var BUILDER_PREVIEW_STORAGE_KEY = "normie_builder_preview_draft";
var BUILDER_PREVIEW_DEVICE_STORAGE_KEY = "normie_builder_preview_device";
var BACKGROUND_STYLE_PRESETS = [
  { value: "blue-yellow-circles", label: "blue-yellow-circles" }
];
function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}
function buildRichTextHtmlFromValue(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  return looksLikeHtml(text) ? text : text.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtmlText(paragraph).replace(/\n/g, "<br />")}</p>`).join("");
}
function formatRichTextContent(value) {
  const html = buildRichTextHtmlFromValue(value);
  if (!html) {
    return "";
  }
  return rewriteRichTextImageSrcInHtml(sanitizeRichTextHtml(html), "display");
}
function prepareRichTextHtmlForEditor(value) {
  const html = buildRichTextHtmlFromValue(value);
  if (!html) {
    return "";
  }
  return rewriteRichTextImageSrcInHtml(sanitizeRichTextHtml(html), "editor");
}
function prepareRichTextHtmlForStorage(html) {
  return rewriteRichTextImageSrcInHtml(sanitizeRichTextHtml(html), "storage");
}
function createLocalId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function getLayoutColumns(layout) {
  if (layout === "two-column" || layout === "two-four" || layout === "four-two" || layout === "one-five" || layout === "five-one") {
    return ["left", "right"];
  }
  if (layout === "three-column" || layout === "one-four-one") {
    return ["left", "center", "right"];
  }
  return ["main"];
}
function resolveModuleColumnForLayout(column, layout) {
  const normalizedLayout = normalizeLayout(layout);
  const allowedColumns = getLayoutColumns(normalizedLayout);
  const raw = (0, import_builder_asset_url.safeText)(column, 40).toLowerCase();
  if (allowedColumns.includes(raw)) {
    return raw;
  }
  const legacyMapThree = {
    col1: "left",
    col2: "center",
    col3: "right",
    main: "main",
    left: "left",
    center: "center",
    right: "right"
  };
  const legacyMapTwo = {
    col1: "left",
    col2: "right",
    main: "main",
    left: "left",
    right: "right"
  };
  const legacyMapSingle = {
    col1: "main",
    main: "main"
  };
  const map = normalizedLayout === "single"
    ? legacyMapSingle
    : normalizedLayout === "three-column" || normalizedLayout === "one-four-one"
      ? legacyMapThree
      : legacyMapTwo;
  const mapped = map[raw];
  if (mapped && allowedColumns.includes(mapped)) {
    return mapped;
  }
  return allowedColumns[0] || "main";
}
function getLayoutGridTemplate(layout) {
  if (layout === "four-two") {
    return "4fr 2fr";
  }
  if (layout === "two-four") {
    return "2fr 4fr";
  }
  if (layout === "one-five") {
    return "1fr 5fr";
  }
  if (layout === "five-one") {
    return "5fr 1fr";
  }
  if (layout === "two-column") {
    return "1fr 1fr";
  }
  if (layout === "three-column") {
    return "1fr 1fr 1fr";
  }
  if (layout === "one-four-one") {
    return "1fr 4fr 1fr";
  }
  return "1fr";
}
function normalizeLayout(value) {
  const layout = (0, import_builder_asset_url.safeText)(value, 40).toLowerCase();
  if (layout === "hero-split") {
    return "four-two";
  }
  const legacyLayoutMap = {
    "6": "single",
    "1-5": "one-five",
    "5-1": "five-one",
    "2-4": "two-four",
    "4-2": "four-two",
    "3-3": "two-column",
    "2-2-2": "three-column",
    "1-4-1": "one-four-one"
  };
  if (legacyLayoutMap[layout]) {
    return legacyLayoutMap[layout];
  }
  if (layout === "two-column" || layout === "three-column" || layout === "two-four" || layout === "four-two" || layout === "one-five" || layout === "five-one" || layout === "one-four-one") {
    return layout;
  }
  return "single";
}
function normalizeAlignment(value) {
  const alignment = (0, import_builder_asset_url.safeText)(value, 20).toLowerCase();
  if (alignment === "center" || alignment === "right") {
    return alignment;
  }
  return "left";
}
function normalizeMobileLayout(value) {
  const mobileLayout = (0, import_builder_asset_url.safeText)(value, 40).toLowerCase();
  if (mobileLayout === "keep" || mobileLayout === "reverse-stack") {
    return mobileLayout;
  }
  return "stack";
}
function normalizeBooleanText(value) {
  return (0, import_builder_asset_url.safeText)(value, 10).toLowerCase() === "true" ? "true" : "false";
}
function normalizeSpacingValue(value, fallback = "0", min = 0, max = 160) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  const fallbackValue = Number.parseInt(fallback, 10);
  const normalized = Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : Math.min(Math.max(Number.isFinite(fallbackValue) ? fallbackValue : min, min), max);
  return String(normalized);
}
function normalizeSignedOffsetValue(value, fallback = "0", min = -500, max = 500) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  const fallbackValue = Number.parseInt(fallback, 10);
  const normalized = Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : Math.min(Math.max(Number.isFinite(fallbackValue) ? fallbackValue : min, min), max);
  return String(normalized);
}
function normalizeBackgroundMode(value) {
  const mode = (0, import_builder_asset_url.safeText)(value, 20).toLowerCase();
  if (mode === "color" || mode === "gradient" || mode === "image" || mode === "style") {
    return mode;
  }
  return "none";
}
function normalizeBackgroundStyleKey(value) {
  const styleKey = (0, import_builder_asset_url.safeText)(value, 80).toLowerCase();
  if (styleKey === "blue-yellow-circles") {
    return "blue-yellow-circles";
  }
  return "";
}
function createDefaultBackgroundSettings() {
  return {
    mode: "none",
    color: "#ffffff",
    color2: "#eaf4ff",
    imageUrl: "",
    imageAssetId: "",
    styleKey: ""
  };
}
function normalizeBackgroundSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultBackgroundSettings();
  }
  const background = value;
  return {
    mode: normalizeBackgroundMode(background.mode),
    color: normalizeBuilderHexColor((0, import_builder_asset_url.safeText)(background.color, 40), "#ffffff"),
    color2: normalizeBuilderHexColor((0, import_builder_asset_url.safeText)(background.color2, 40), "#eaf4ff"),
    imageUrl: (0, import_builder_asset_url.normalizeBuilderAssetUrl)(background.imageUrl),
    imageAssetId: (0, import_builder_asset_url.safeText)(background.imageAssetId, 120),
    styleKey: normalizeBackgroundStyleKey(background.styleKey)
  };
}
function normalizeRowOverlayScreenSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      background: createDefaultBackgroundSettings(),
      opacity: 100
    };
  }
  const opacityRaw = Number(value.opacity);
  const opacity = Number.isFinite(opacityRaw) ? Math.min(100, Math.max(0, Math.round(opacityRaw))) : 100;
  return {
    background: normalizeBackgroundSettings(value.background),
    opacity
  };
}
function getBuilderBackgroundStyle(background) {
  if (!background || background.mode === "none") {
    return void 0;
  }
  if (background.mode === "color") {
    if (isTransparentBuilderColor(background.color)) {
      return {
        background: "transparent",
        backgroundColor: "transparent"
      };
    }
    return {
      background: background.color
    };
  }
  if (background.mode === "gradient") {
    return {
      backgroundImage: `linear-gradient(135deg, ${background.color} 0%, ${background.color2} 100%)`
    };
  }
  if (background.mode === "image" && background.imageUrl) {
    return {
      backgroundImage: `url("${background.imageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center"
    };
  }
  if (background.mode === "style" && background.styleKey === "blue-yellow-circles") {
    return {
      background: "radial-gradient(circle at 15% 15%, rgba(255, 214, 10, 0.35), transparent 18%), radial-gradient(circle at 82% 14%, rgba(23, 183, 238, 0.28), transparent 18%), radial-gradient(circle at 50% 72%, rgba(255, 255, 255, 0.92), transparent 24%), linear-gradient(135deg, #d9f5ff 0%, #f8feff 36%, #fff7bf 100%)"
    };
  }
  return void 0;
}
var LIGHT_CELL_FILL_COLORS = /* @__PURE__ */ new Set([
  "#ffffff",
  "#fff",
  "#eef6ff",
  "#ddeeff",
  "#bbddee",
  "#f8fdff",
  "#f6fbff",
  "#eaf4ff",
  "#e8f5e9",
  "#f0fdf4",
  "#ecfdf5"
]);
function normalizeCellBackgroundHexColor(value) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith("#")) {
    return trimmed;
  }
  if (trimmed.length === 4) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return trimmed;
}
function usesBuilderDrillDownSurfaceDefault(background) {
  if (!background || background.mode === "none") {
    return true;
  }
  if (background.mode === "style") {
    return true;
  }
  if (background.mode === "color") {
    return LIGHT_CELL_FILL_COLORS.has(normalizeCellBackgroundHexColor(background.color));
  }
  return false;
}
function sanitizeCellBackgroundForDrillDown(background) {
  if (usesBuilderDrillDownSurfaceDefault(background)) {
    return createDefaultBackgroundSettings();
  }
  return background;
}
function normalizeCellBackgrounds(value, layout) {
  const columns = getLayoutColumns(layout);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.fromEntries(columns.map((column) => [column, createDefaultBackgroundSettings()]));
  }
  const raw = value;
  return Object.fromEntries(
    columns.map((column) => {
      const background = normalizeBackgroundSettings(raw[column]);
      return [column, sanitizeCellBackgroundForDrillDown(background)];
    })
  );
}
function normalizeCellPadding(value, layout) {
  const columns = getLayoutColumns(layout);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.fromEntries(columns.map((column) => [column, "18"]));
  }
  const raw = value;
  return Object.fromEntries(
    columns.map((column) => {
      const parsed = Number.parseInt(String(raw[column] ?? "18"), 10);
      const normalized = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 50) : 18;
      return [column, String(normalized)];
    })
  );
}
function normalizeCellMetric(value, layout, fallback, min, max) {
  const columns = getLayoutColumns(layout);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.fromEntries(columns.map((column) => [column, fallback]));
  }
  const raw = value;
  return Object.fromEntries(
    columns.map((column) => {
      return [column, normalizeSpacingValue(raw[column], fallback, min, max)];
    })
  );
}
function normalizeCellColor(value, layout, fallback) {
  const columns = getLayoutColumns(layout);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.fromEntries(columns.map((column) => [column, fallback]));
  }
  const raw = value;
  return Object.fromEntries(
    columns.map((column) => {
      const color = (0, import_builder_asset_url.safeText)(raw[column], 40);
      return [column, color || fallback];
    })
  );
}
function normalizeModuleType(value) {
  const type = (0, import_builder_asset_url.safeText)(value, 40).toLowerCase();
  if (type === "navigation" || type === "heading" || type === "headline-rotator" || type === "code" || type === "merch" || type === "image" || type === "floating-image" || type === "video" || type === "quote" || type === "speech-bubble" || type === "reminder" || type === "button" || type === "contact-form" || type === "player-portal" || type === "table" || type === "slider" || type === "social" || type === "social-share" || type === "previous-results" || type === "current-poll" || type === "poll-category-list" || type === "confetti") {
    return type;
  }
  return "text";
}
function normalizeModuleSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, raw]) => {
      const normalizedKey = (0, import_builder_asset_url.safeText)(key, 120);
      const normalizedValue = normalizedKey === "background" && raw && typeof raw === "object" && !Array.isArray(raw) ? normalizeBackgroundSettings(raw) : normalizedKey === "url" || normalizedKey === "backgroundImageUrl" ? (0, import_builder_asset_url.normalizeBuilderAssetUrl)(raw) : normalizedKey === "navItems" ? (Array.isArray(raw) ? JSON.stringify(raw) : (0, import_builder_asset_url.safeText)(raw, 5e5)) : normalizedKey === "tableData" || normalizedKey === "content" || normalizedKey === "tableContents" ? (0, import_builder_asset_url.safeText)(raw, 2e5) : normalizedKey === "borderThickness" || normalizedKey === "borderWidth" ? normalizeSpacingValue(raw, "1", 0, 24) : normalizedKey === "cellPadding" ? normalizeSpacingValue(raw, "14", 0, 40) : normalizedKey === "columnsCount" || normalizedKey === "rowsCount" ? normalizeSpacingValue(raw, "1", 1, 20) : (0, import_builder_asset_url.safeText)(raw, 1e4);
      return [normalizedKey, normalizedValue];
    })
  );
}
var OVERLAY_ONLY_IMAGE_SETTINGS = [
  "positionMode",
  "overlayAnchor",
  "offsetX",
  "offsetY",
  "zIndex"
];
function stripOverlayOnlyImageSettings(settings) {
  for (const key of OVERLAY_ONLY_IMAGE_SETTINGS) {
    delete settings[key];
  }
}
function resolveBuilderModuleType(rawType, settings) {
  const type = normalizeModuleType(rawType);
  if (type === "text" && (settings.particleCount !== void 0 || settings.spread !== void 0 || settings.originX !== void 0 || settings.popVolume !== void 0)) {
    return "confetti";
  }
  if (type === "image" && settings.positionMode === "overlay" && settings.variant !== "video") {
    return "floating-image";
  }
  return type;
}
function normalizeBuilderModuleSettingsForType(type, value, moduleContext) {
  const settings = normalizeModuleSettings(value);
  if (type === "navigation") {
    delete settings.navBackground;
    if (settings.navItems != null && typeof settings.navItems !== "string") {
      try {
        settings.navItems = JSON.stringify(settings.navItems);
      } catch {
        settings.navItems = "[]";
      }
    }
    if (!settings.menuName) settings.menuName = "Main Menu";
    if (!settings.menuLocation) settings.menuLocation = "primary";
    if (!settings.variant) settings.variant = "horizontal";
  }
  if (type === "image") {
    stripOverlayOnlyImageSettings(settings);
    settings.horizontalOffset = normalizeSignedOffsetValue(settings.horizontalOffset, "0");
    settings.verticalOffset = normalizeSignedOffsetValue(settings.verticalOffset, "0");
  }
  if (type === "floating-image") {
    delete settings.positionMode;
    delete settings.linkUrl;
    delete settings.newTab;
    settings.offsetX = normalizeSignedOffsetValue(settings.offsetX, "0");
    settings.offsetY = normalizeSignedOffsetValue(settings.offsetY, "0");
    settings.horizontalOffset = normalizeSignedOffsetValue(settings.horizontalOffset, "0");
    settings.verticalOffset = normalizeSignedOffsetValue(settings.verticalOffset, "0");
    settings.zIndex = normalizeSpacingValue(settings.zIndex, "20", -999, 999999);
    const trigger = normalizeModuleTrigger(settings[MODULE_TRIGGER_SETTING_KEY]);
    const anchor = (0, import_builder_asset_url.safeText)(settings.overlayAnchor, 24) || "center";
    const offsetY = Number.parseInt(settings.offsetY ?? "0", 10);
    if (trigger === "button" && (anchor === "center" || anchor === "")) {
      settings.overlayAnchor = "top-center";
      if (Number.isFinite(offsetY) && offsetY > 120) {
        settings.offsetY = "0";
      }
    }
  }
  if (type === "heading") {
    const legacy = settings.verticalMargin;
    settings.marginTop = normalizeSpacingValue(settings.marginTop ?? legacy, "0");
    settings.marginBottom = normalizeSpacingValue(settings.marginBottom ?? legacy, "0");
    settings.horizontalOffset = normalizeSignedOffsetValue(settings.horizontalOffset, "0");
    settings.verticalOffset = normalizeSignedOffsetValue(settings.verticalOffset, "0");
  }
  if (type === "current-poll") {
    settings.size = (0, import_current_poll_module.normalizeCurrentPollModuleWidth)(settings.size);
  }
  if (type === "confetti") {
    return normalizeConfettiModuleSettings(settings);
  }
  if (type === "reminder") {
    delete settings.alignment;
    delete settings.verticalMargin;
    delete settings.width;
    return normalizeReminderModuleSettings(settings, moduleContext);
  }
  if (type === "speech-bubble") {
    settings.backgroundColor = normalizeBuilderHexColor(settings.backgroundColor || "#ffffff");
    settings.borderColor = normalizeBuilderHexColor(settings.borderColor || "#9ed4ee");
    settings.textColor = normalizeBuilderHexColor(settings.textColor || "#18324a");
    settings.borderRadius = normalizeSpacingValue(settings.borderRadius, "40", 0, 80);
    settings.borderThickness = normalizeSpacingValue(settings.borderThickness, "2", 0, 24);
    settings.containerWidth = normalizeSpacingValue(settings.containerWidth ?? settings.width, "520", 200, 900);
    delete settings.width;
    settings.containerHeight = normalizeSpacingValue(settings.containerHeight, "0", 0, 800);
    settings.offsetX = normalizeSignedOffsetValue(settings.offsetX, "0");
    settings.offsetY = normalizeSignedOffsetValue(settings.offsetY, "0");
    settings.zIndex = normalizeSpacingValue(settings.zIndex, "10", -999, 999999);
    settings[MODULE_TRIGGER_SETTING_KEY] = normalizeModuleTrigger(settings[MODULE_TRIGGER_SETTING_KEY] ?? "game");
    settings[MODULE_GAME_AUDIENCE_SETTING_KEY] = normalizeModuleGameAudience(
      settings[MODULE_GAME_AUDIENCE_SETTING_KEY] ?? "both"
    );
  }
  if (type === "headline-rotator") {
    settings.headlines = normalizeHeadlineRotatorHeadlinesJson(
      settings.headlines ?? "",
      settings.color || "#18324a"
    );
    settings.minHeight = normalizeSpacingValue(
      settings.minHeight,
      HEADLINE_ROTATOR_DEFAULT_MIN_HEIGHT,
      0,
      1200
    );
    if (!settings.verticalAlignment) {
      settings.verticalAlignment = "top";
    }
  }
  if (type === "poll-category-list") {
    settings.color = normalizeBuilderHexColor(settings.color || "#18324a");
    settings.fontSize = normalizeSpacingValue(
      settings.fontSize,
      "18",
      10,
      120
    );
    settings.itemGap = normalizeSpacingValue(settings.itemGap, "8", 0, 48);
    if (settings.categorySort !== "canonical") {
      settings.categorySort = "alphabetical";
    }
    if (settings.categoryListFlow !== "columns") {
      settings.categoryListFlow = "rows";
    }
    settings.listTitle = (0, import_builder_asset_url.safeText)(settings.listTitle, 120) || "Categories";
    if (!settings.bold) {
      settings.bold = "true";
    }
    const rawBackgroundMode = (0, import_builder_asset_url.safeText)(settings.backgroundMode, 20);
    const panelBackground = normalizeBackgroundSettings({
      mode: rawBackgroundMode || "color",
      color: settings.backgroundColor,
      color2: settings.backgroundColor2,
      imageUrl: settings.backgroundImageUrl,
      styleKey: settings.backgroundStyleKey
    });
    if (!rawBackgroundMode) {
      settings.backgroundMode = "color";
      settings.backgroundColor = normalizeBuilderHexColor(settings.backgroundColor, "#e8f6fc");
      settings.backgroundColor2 = panelBackground.color2;
      settings.backgroundImageUrl = "";
      settings.backgroundStyleKey = "";
    } else {
      settings.backgroundMode = panelBackground.mode;
      if (panelBackground.mode === "none") {
        settings.backgroundColor = "";
        settings.backgroundColor2 = "";
        settings.backgroundImageUrl = "";
        settings.backgroundStyleKey = "";
      } else {
        settings.backgroundColor = normalizeBuilderHexColor(settings.backgroundColor, "#e8f6fc");
        settings.backgroundColor2 = panelBackground.color2;
        settings.backgroundImageUrl = panelBackground.imageUrl;
        settings.backgroundStyleKey = panelBackground.styleKey;
      }
    }
    settings.panelBorderColor = normalizeBuilderHexColor(settings.panelBorderColor || "#c6e8f5", "#c6e8f5");
  }
  if (type === "text" && (settings.content || settings.textAlign || settings.maxWidth)) {
    const textBackground = normalizeBackgroundSettings(
      settings.background,
      settings.backgroundColor,
      settings.backgroundImageId
    );
    settings.background = textBackground;
    if (textBackground.mode === "color") {
      settings.backgroundColor = normalizeBuilderHexColor(textBackground.color, "#ffffff");
    } else if (textBackground.mode === "transparent") {
      settings.backgroundColor = "transparent";
    }
    if (textBackground.mode === "image" && textBackground.imageAssetId) {
      settings.backgroundImageId = textBackground.imageAssetId;
    }
  }
  if (type === "table") {
    const borderThickness = normalizeSpacingValue(settings.borderThickness ?? settings.borderWidth, "1", 0, 24);
    settings.borderThickness = borderThickness;
    settings.borderWidth = borderThickness;
    settings.cellPadding = normalizeSpacingValue(settings.cellPadding, "14", 0, 40);
    settings.columnsCount = normalizeSpacingValue(settings.columnsCount ?? settings.columns, "3", 1, 8);
    settings.rowsCount = normalizeSpacingValue(settings.rowsCount, "4", 1, 20);
  }
  return settings;
}
function normalizeBuilderModuleFromRecord(module2, fallbackId, fallbackColumn) {
  const rawSettings = normalizeModuleSettings(module2.settings);
  const type = resolveBuilderModuleType(module2.type, rawSettings);
  return {
    id: (0, import_builder_asset_url.safeText)(module2.id, 120) || fallbackId,
    type,
    column: (0, import_builder_asset_url.safeText)(module2.column, 40) || fallbackColumn,
    name: (0, import_builder_asset_url.safeText)(module2.name, 255),
    text: (0, import_builder_asset_url.safeText)(module2.text, 1e4),
    settings: normalizeBuilderModuleSettingsForType(type, rawSettings, {
      id: (0, import_builder_asset_url.safeText)(module2.id, 120) || fallbackId,
      name: (0, import_builder_asset_url.safeText)(module2.name, 255),
      text: (0, import_builder_asset_url.safeText)(module2.text, 1e4)
    })
  };
}
function normalizeBuilderModules(value, fallbackColumn = "main") {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((module2, moduleIndex) => {
    if (!module2 || typeof module2 !== "object" || Array.isArray(module2)) {
      return null;
    }
    return normalizeBuilderModuleFromRecord(
      module2,
      `module-${moduleIndex + 1}`,
      fallbackColumn
    );
  }).filter((module2) => Boolean(module2));
}
function rowToBuilderCellModule(row) {
  return {
    id: (0, import_builder_asset_url.safeText)(row.id, 120),
    name: (0, import_builder_asset_url.safeText)(row.name, 255),
    moduleClass: (0, import_builder_asset_url.safeText)(row.module_class ?? row.moduleClass, 255),
    modules: normalizeBuilderModules(row.modules),
    createdAt: (0, import_builder_asset_url.safeText)(row.created_at ?? row.createdAt, 120),
    updatedAt: (0, import_builder_asset_url.safeText)(row.updated_at ?? row.updatedAt, 120)
  };
}
function normalizeBuilderSection(value) {
  return normalizeLayoutSections([value])[0] ?? null;
}
function rowToBuilderSavedSection(row) {
  const section = normalizeBuilderSection(row.section);
  if (!section) {
    return null;
  }
  return {
    id: (0, import_builder_asset_url.safeText)(row.id, 120),
    name: (0, import_builder_asset_url.safeText)(row.name, 255),
    section,
    createdAt: (0, import_builder_asset_url.safeText)(row.created_at ?? row.createdAt, 120),
    updatedAt: (0, import_builder_asset_url.safeText)(row.updated_at ?? row.updatedAt, 120)
  };
}
function normalizeProductType(value) {
  const type = (0, import_builder_asset_url.safeText)(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return type === "personality_profile" ? "personality_profile" : "merch";
}
function rowToBuilderProduct(row) {
  return {
    id: (0, import_builder_asset_url.safeText)(row.id, 120),
    name: (0, import_builder_asset_url.safeText)(row.name, 255),
    productType: normalizeProductType(row.product_type ?? row.productType),
    productUrl: (0, import_builder_asset_url.normalizeBuilderAssetUrl)(row.product_url ?? row.productUrl),
    imageUrl: (0, import_builder_asset_url.normalizeBuilderAssetUrl)(row.image_url ?? row.imageUrl),
    createdAt: (0, import_builder_asset_url.safeText)(row.created_at ?? row.createdAt, 120),
    updatedAt: (0, import_builder_asset_url.safeText)(row.updated_at ?? row.updatedAt, 120)
  };
}
function normalizeLayoutSections(value) {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    try {
      return normalizeLayoutSections(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((section, sectionIndex) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      return null;
    }
    const normalizedSection = section;
    const layout = normalizeLayout(normalizedSection.layout);
    const modules = Array.isArray(normalizedSection.modules) ? normalizedSection.modules.map((module2, moduleIndex) => {
      if (!module2 || typeof module2 !== "object" || Array.isArray(module2)) {
        return null;
      }
      const normalizedModule = module2;
      const column = resolveModuleColumnForLayout(normalizedModule.column, layout);
      const resolved = normalizeBuilderModuleFromRecord(
        normalizedModule,
        `module-${sectionIndex + 1}-${moduleIndex + 1}`,
        column
      );
      if (!resolved) {
        return null;
      }
      return {
        ...resolved,
        column
      };
    }).filter((module2) => Boolean(module2)) : [];
    return {
      id: (0, import_builder_asset_url.safeText)(normalizedSection.id, 120) || `section-${sectionIndex + 1}`,
      title: (0, import_builder_asset_url.safeText)(normalizedSection.title, 255),
      layout,
      alignment: normalizeAlignment(normalizedSection.alignment),
      marginTop: normalizeSpacingValue(
        normalizedSection.marginTop ?? normalizedSection.verticalMargin,
        "0",
        0,
        160
      ),
      marginBottom: normalizeSpacingValue(
        normalizedSection.marginBottom ?? normalizedSection.verticalMargin,
        "0",
        0,
        160
      ),
      mobileHidden: normalizeBooleanText(normalizedSection.mobileHidden),
      desktopHidden: normalizeBooleanText(normalizedSection.desktopHidden),
      mobileLayout: normalizeMobileLayout(normalizedSection.mobileLayout),
      background: normalizeBackgroundSettings(normalizedSection.background),
      overlayScreen: normalizeRowOverlayScreenSettings(normalizedSection.overlayScreen),
      cellBackgrounds: normalizeCellBackgrounds(normalizedSection.cellBackgrounds, layout),
      cellPadding: normalizeCellPadding(normalizedSection.cellPadding, layout),
      cellVerticalMargin: normalizeCellMetric(normalizedSection.cellVerticalMargin, layout, "0", 0, 160),
      cellMobileHidden: normalizeCellColor(normalizedSection.cellMobileHidden, layout, "false"),
      cellDesktopHidden: normalizeCellColor(normalizedSection.cellDesktopHidden, layout, "false"),
      cellBorderWidth: normalizeCellMetric(normalizedSection.cellBorderWidth, layout, "1", 0, 20),
      cellBorderColor: normalizeCellColor(normalizedSection.cellBorderColor, layout, "#d9e4ef"),
      cellBorderRadius: normalizeCellMetric(normalizedSection.cellBorderRadius, layout, "24", 0, 60),
      cellBorderStyle: normalizeCellColor(normalizedSection.cellBorderStyle, layout, "solid"),
      cellShadow: normalizeCellColor(normalizedSection.cellShadow, layout, "none"),
      cellOpacity: normalizeCellColor(normalizedSection.cellOpacity, layout, "1"),
      cellHAlign: normalizeCellColor(normalizedSection.cellHAlign, layout, "left"),
      cellVAlign: normalizeCellColor(normalizedSection.cellVAlign, layout, "top"),
      modules
    };
  }).filter((section) => Boolean(section));
}
function createEmptySection(layout = "single") {
  return {
    id: createLocalId("section"),
    title: "",
    layout,
    alignment: "left",
    marginTop: "0",
    marginBottom: "0",
    mobileHidden: "false",
    desktopHidden: "false",
    mobileLayout: "stack",
    background: createDefaultBackgroundSettings(),
    overlayScreen: normalizeRowOverlayScreenSettings(null),
    cellBackgrounds: Object.fromEntries(
      getLayoutColumns(layout).map((column) => [column, createDefaultBackgroundSettings()])
    ),
    cellPadding: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "18"])),
    cellVerticalMargin: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "0"])),
    cellMobileHidden: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "false"])),
    cellDesktopHidden: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "false"])),
    cellBorderWidth: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "1"])),
    cellBorderColor: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "#d9e4ef"])),
    cellBorderRadius: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "24"])),
    cellBorderStyle: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "solid"])),
    cellShadow: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "none"])),
    cellOpacity: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "1"])),
    cellHAlign: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "left"])),
    cellVAlign: Object.fromEntries(getLayoutColumns(layout).map((column) => [column, "top"])),
    modules: []
  };
}
function createEmptyModule(type = "text", column = "main") {
  const defaults = type === "heading" ? {
    level: "h2",
    fontSize: "32",
    color: "#18324a",
    bold: "true",
    italic: "false",
    underline: "false",
    dropShadow: "false",
    dropShadowX: "3",
    dropShadowY: "3",
    dropShadowBlur: "2",
    dropShadowColor: "rgba(0, 0, 0, 0.55)",
    outline: "false",
    horizontalOffset: "0",
    verticalOffset: "0"
  } : type === "image" ? {
    url: "",
    linkUrl: "",
    newTab: "false",
    alt: "",
    size: "100",
    borderThickness: "0",
    borderColor: "#0f4f8f",
    borderRadius: "18",
    horizontalOffset: "0",
    verticalOffset: "0",
    effect: "none"
  } : type === "floating-image" ? {
    url: "",
    alt: "",
    size: "15",
    borderThickness: "0",
    borderColor: "#0f4f8f",
    borderRadius: "18",
    overlayAnchor: "center",
    offsetX: "0",
    offsetY: "0",
    horizontalOffset: "0",
    verticalOffset: "0",
    zIndex: "20",
    effect: "none"
  } : type === "code" ? {
    label: "",
    snippetMode: "html"
  } : type === "merch" ? {
    productId: "",
    productUrl: "",
    productName: "",
    imageUrl: "",
    buttonLabel: "Buy on Redbubble"
  } : type === "video" ? {
    url: "",
    newTab: "true",
    videoName: "",
    videoDescription: ""
  } : type === "reminder" ? defaultReminderModuleSettings() : type === "speech-bubble" ? {
    backgroundColor: "#ffffff",
    borderColor: "#9ed4ee",
    borderThickness: "2",
    textColor: "#18324a",
    borderRadius: "40",
    containerWidth: "520",
    containerHeight: "0",
    trigger: "game",
    gameAudience: "both",
    offsetX: "0",
    offsetY: "0",
    zIndex: "10"
  } : type === "button" ? {
    href: "",
    buttonColor: "#214c71",
    buttonHoverColor: "#0f4f8f",
    textColor: "#ffffff",
    textHoverColor: "#ffffff",
    borderColor: "#214c71",
    paddingX: "24",
    paddingY: "12"
  } : type === "contact-form" ? {
    formMode: "squeeze"
  } : type === "player-portal" ? {
    redirectPath: "/portal/dashboard",
    defaultMode: "login",
    showRegister: "true",
    showForgotPassword: "true"
  } : type === "table" ? {
    columns: "3",
    borderWidth: "1",
    borderColor: "#cccccc",
    cellPadding: "8",
    backgroundColor: "#ffffff",
    tableData: JSON.stringify({
      headers: ["", "", ""],
      cells: {},
      rowCount: 2
    })
  } : type === "slider" ? {
    sliderGap: "16",
    sliderCardWidth: "280",
    sliderHeight: "auto",
    sliderItems: JSON.stringify([])
  } : type === "social" ? {
    socialIconSize: "44",
    socialGap: "14",
    socialShowLabels: "true",
    socialItems: JSON.stringify([])
  } : type === "previous-results" ? {
    showFallbackCopy: "true",
    size: "100"
  } : type === "current-poll" ? {
    showPromptCopy: "true",
    size: "100"
  } : type === "poll-category-list" ? {
    listTitle: "Categories",
    categorySort: "alphabetical",
    categoryListFlow: "rows",
    fontSize: "18",
    color: "#18324a",
    bold: "true",
    alignment: "left",
    itemGap: "8",
    backgroundMode: "color",
    backgroundColor: "#e8f6fc",
    backgroundColor2: "#eaf4ff",
    backgroundImageUrl: "",
    backgroundStyleKey: "",
    panelBorderColor: "#c6e8f5"
  } : type === "social-share" ? {
    shareLabel: "Share this poll",
    shareTemplate: 'I just answered: "{pollQuestion}" What would you pick? {url}',
    shareHashtags: "Normie,WYR",
    shareVia: "Normie765714",
    shareLabelSize: "14",
    shareIconBackground: "#ffffff",
    shareIconSize: "36",
    shareGlyphSize: "20",
    shareIconGap: "12"
  } : type === "confetti" ? { ...CONFETTI_EFFECT_DEFAULTS } : type === "headline-rotator" ? {
    fontSize: HEADLINE_ROTATOR_DEFAULT_FONT_SIZE,
    color: "#18324a",
    bold: "true",
    dropShadow: "false",
    dropShadowX: "3",
    dropShadowY: "3",
    dropShadowBlur: "2",
    dropShadowColor: "rgba(0, 0, 0, 0.55)",
    alignment: "center",
    verticalAlignment: "top",
    minHeight: HEADLINE_ROTATOR_DEFAULT_MIN_HEIGHT,
    fadeDuration: "800",
    displaySpeed: "3000",
    headlines: JSON.stringify([])
  } : {};
  return {
    id: createLocalId("module"),
    type,
    column,
    name: "",
    text: "",
    settings: { verticalMargin: "0", mobileHidden: "false", desktopHidden: "false", ...defaults }
  };
}
function normalizeTemplateKind(value) {
  const kind = (0, import_builder_asset_url.safeText)(value, 40).toLowerCase();
  if (kind === "email") {
    return "email";
  }
  return "modular";
}
function rowToBuilderTemplate(row) {
  const document = normalizeBuilderDocument(row.layout_sections ?? row.layoutSections);
  return {
    id: (0, import_builder_asset_url.safeText)(row.id, 120),
    name: (0, import_builder_asset_url.safeText)(row.name, 255),
    templateKind: normalizeTemplateKind(row.template_kind ?? row.templateKind),
    emailFunction: normalizeEmailFunction(row.email_function ?? row.emailFunction),
    pageBackground: document.pageBackground,
    layoutSections: document.layoutSections,
    createdAt: (0, import_builder_asset_url.safeText)(row.created_at ?? row.createdAt, 120),
    updatedAt: (0, import_builder_asset_url.safeText)(row.updated_at ?? row.updatedAt, 120)
  };
}
function rowToBuilderPage(row) {
  const document = normalizeBuilderDocument(row.layout_sections ?? row.layoutSections);
  return {
    id: (0, import_builder_asset_url.safeText)(row.id, 120),
    name: (0, import_builder_asset_url.safeText)(row.name, 255),
    slug: (0, import_builder_asset_url.safeText)(row.slug, 255),
    templateId: (0, import_builder_asset_url.safeText)(row.template_id ?? row.templateId, 120),
    pageBackground: document.pageBackground,
    layoutSections: document.layoutSections,
    createdAt: (0, import_builder_asset_url.safeText)(row.created_at ?? row.createdAt, 120),
    updatedAt: (0, import_builder_asset_url.safeText)(row.updated_at ?? row.updatedAt, 120),
    isPublished: Boolean(row.is_published ?? row.isPublished ?? true)
  };
}
function normalizeBuilderDocument(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const document = value;
    return {
      pageBackground: normalizeBackgroundSettings(document.pageBackground),
      layoutSections: normalizeLayoutSections(document.sections ?? document.layoutSections)
    };
  }
  return {
    pageBackground: createDefaultBackgroundSettings(),
    layoutSections: normalizeLayoutSections(value)
  };
}
function serializeBuilderDocument(input) {
  return {
    pageBackground: normalizeBackgroundSettings(input.pageBackground),
    sections: normalizeLayoutSections(input.layoutSections)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BACKGROUND_STYLE_PRESETS,
  BUILDER_PREVIEW_DEVICE_STORAGE_KEY,
  BUILDER_PREVIEW_STORAGE_KEY,
  createDefaultBackgroundSettings,
  createEmptyModule,
  createEmptySection,
  createLocalId,
  formatRichTextContent,
  getBuilderBackgroundStyle,
  getLayoutColumns,
  getLayoutGridTemplate,
  looksLikeHtml,
  normalizeAlignment,
  normalizeBackgroundMode,
  normalizeBackgroundSettings,
  normalizeBackgroundStyleKey,
  normalizeBooleanText,
  normalizeBuilderAssetUrl,
  normalizeBuilderDocument,
  normalizeBuilderModuleSettingsForType,
  normalizeBuilderModules,
  normalizeBuilderSection,
  normalizeLayout,
  normalizeLayoutSections,
  normalizeMobileLayout,
  normalizeModuleSettings,
  normalizeModuleType,
  normalizeProductType,
  normalizeSignedOffsetValue,
  normalizeSpacingValue,
  normalizeTemplateKind,
  prepareRichTextHtmlForEditor,
  prepareRichTextHtmlForStorage,
  resolveBuilderModuleType,
  resolvePublicBuilderAssetUrl,
  rowToBuilderCellModule,
  rowToBuilderPage,
  rowToBuilderProduct,
  rowToBuilderSavedSection,
  rowToBuilderTemplate,
  safeText,
  sanitizeCellBackgroundForDrillDown,
  serializeBuilderDocument,
  usesBuilderDrillDownSurfaceDefault
});
