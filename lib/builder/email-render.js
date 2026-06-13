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

// lib/builder-client/rich-text-image.ts
var init_rich_text_image = __esm({
  "lib/builder-client/rich-text-image.ts"() {
    "use strict";
  }
});

// lib/builder-client/sanitize-html.ts
function escapeHtmlText(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var EMBED_EXTRA_ATTR, BLOG_BODY_EXTRA_ATTR;
var init_sanitize_html = __esm({
  "lib/builder-client/sanitize-html.ts"() {
    "use strict";
    init_rich_text_image();
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

// lib/builder-client/builder-email-render.ts
var builder_email_render_exports = {};
__export(builder_email_render_exports, {
  renderBuilderEmailHtml: () => renderBuilderEmailHtml,
  renderBuilderEmailHtmlWithFallback: () => renderBuilderEmailHtmlWithFallback
});
module.exports = __toCommonJS(builder_email_render_exports);

// lib/builder-client/confetti-effect.ts
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

// lib/builder-client/builder-template.ts
var import_current_poll_module = __toESM(require_current_poll_stub());

// lib/builder-client/builder-hex-color.ts
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

// lib/builder-client/game-reminder.ts
var GAME_REMINDER_SELECT_COLUMNS = "id, name, display_type, message_html, criterion_type, criterion_value, is_active, sort_order, metadata, created_at, updated_at";
var GAME_REMINDER_EXTENDED_SELECT_COLUMNS = `${GAME_REMINDER_SELECT_COLUMNS}, audience, appearance`;

// lib/builder-client/builder-template.ts
var import_builder_asset_url = __toESM(require_asset_url_stub());
init_sanitize_html();
init_rich_text_image();
var import_builder_asset_url2 = __toESM(require_asset_url_stub());
function getLayoutColumns(layout) {
  if (layout === "two-column" || layout === "two-four" || layout === "four-two" || layout === "one-five" || layout === "five-one") {
    return ["left", "right"];
  }
  if (layout === "three-column" || layout === "one-four-one") {
    return ["left", "center", "right"];
  }
  return ["main"];
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

// lib/builder-client/email-rich-text.ts
init_sanitize_html();
function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}
function stripDangerousEmailHtml(html) {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "").replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "").replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "").replace(/<embed\b[^>]*>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/javascript:/gi, "");
}
function formatEmailRichTextContent(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  const html = looksLikeHtml(text) ? text : text.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtmlText(paragraph).replace(/\n/g, "<br />")}</p>`).join("");
  return stripDangerousEmailHtml(html);
}

// components/builder/builder-utils.ts
function getModuleAlignment(settings) {
  const alignment = settings.alignment;
  if (alignment === "center" || alignment === "right") {
    return alignment;
  }
  return "left";
}
function getSplitVerticalMarginStyle(top, bottom) {
  return {
    marginTop: `${normalizeSpacingValue(top, "0", 0, 160)}px`,
    marginBottom: `${normalizeSpacingValue(bottom, "0", 0, 160)}px`
  };
}
function getModuleMarginStyle(settings) {
  const legacy = settings.verticalMargin;
  return getSplitVerticalMarginStyle(
    settings.marginTop ?? legacy,
    settings.marginBottom ?? legacy
  );
}
function getSectionMarginStyle(section) {
  return getSplitVerticalMarginStyle(section.marginTop, section.marginBottom);
}
function getModuleNudgeTransform(settings) {
  const horizontal = Number.parseInt(normalizeSignedOffsetValue(settings.horizontalOffset, "0"), 10);
  const vertical = Number.parseInt(normalizeSignedOffsetValue(settings.verticalOffset, "0"), 10);
  const offsetX = Number.isFinite(horizontal) ? horizontal : 0;
  const offsetY = Number.isFinite(vertical) ? vertical : 0;
  if (offsetX === 0 && offsetY === 0) {
    return null;
  }
  return `translate(${offsetX}px, ${-offsetY}px)`;
}
function getButtonBackgroundSettings(settings) {
  const mode = settings.buttonBackgroundMode;
  if (mode) {
    return {
      mode,
      color: settings.buttonBackgroundColor || settings.buttonColor || "#214c71",
      color2: settings.buttonBackgroundColor2 || "#eaf4ff",
      imageUrl: (0, import_builder_asset_url2.resolvePublicBuilderAssetUrl)(settings.buttonBackgroundImageUrl),
      styleKey: settings.buttonBackgroundStyleKey === "blue-yellow-circles" ? "blue-yellow-circles" : ""
    };
  }
  return {
    mode: "color",
    color: settings.buttonColor || "#214c71",
    color2: "#eaf4ff",
    imageUrl: "",
    styleKey: ""
  };
}
function getModuleDropShadowStyle(settings) {
  const shadowX = Number.parseInt(settings.dropShadowX ?? "3", 10);
  const shadowY = Number.parseInt(settings.dropShadowY ?? "3", 10);
  const shadowBlur = Number.parseInt(settings.dropShadowBlur ?? "2", 10);
  const shadowColor = settings.dropShadowColor || "rgba(0, 0, 0, 0.55)";
  const dropShadowEnabled = settings.dropShadow === "true" || settings.dropShadow === "on";
  if (!dropShadowEnabled) {
    return "none";
  }
  return `${Number.isFinite(shadowX) ? shadowX : 3}px ${Number.isFinite(shadowY) ? shadowY : 3}px ${Number.isFinite(shadowBlur) ? shadowBlur : 2}px ${shadowColor}`;
}
function getButtonModuleStyle(settings) {
  const fontSize = Number.parseInt(settings.fontSize ?? "", 10);
  const textColor = settings.textColor || "#ffffff";
  const textShadow = getModuleDropShadowStyle(settings);
  const borderStyle = settings.borderStyle === "none" || settings.borderStyle === "dashed" || settings.borderStyle === "dotted" ? settings.borderStyle : "solid";
  const borderWidth = Number.parseInt(settings.borderWidth ?? "2", 10);
  const borderRadius = Number.parseInt(settings.borderRadius ?? "0", 10);
  const resolvedBorderWidth = borderStyle === "none" ? 0 : Math.max(Number.isFinite(borderWidth) ? borderWidth : 2, 0);
  const buttonBackground = getButtonBackgroundSettings(settings);
  const buttonFillStyle = getBuilderBackgroundStyle(buttonBackground);
  return {
    ...buttonFillStyle,
    ...!buttonFillStyle ? { "--btn-bg": settings.buttonColor || "#214c71" } : {},
    "--btn-bg-hover": settings.buttonHoverColor || "#0f4f8f",
    "--btn-color": textColor,
    "--btn-color-hover": settings.textHoverColor || "#ffffff",
    "--btn-text-shadow": textShadow,
    "--btn-border": settings.borderColor || "#214c71",
    color: textColor,
    textShadow,
    padding: `${settings.paddingY || "12"}px ${settings.paddingX || "24"}px`,
    borderStyle,
    borderColor: borderStyle === "none" ? "transparent" : settings.borderColor || "#214c71",
    borderWidth: `${resolvedBorderWidth}px`,
    borderRadius: `${Math.max(Number.isFinite(borderRadius) ? borderRadius : 0, 0)}px`,
    ...Number.isFinite(fontSize) && fontSize >= 10 ? { fontSize: `${fontSize}px` } : {},
    fontWeight: settings.bold === "false" ? 500 : 700,
    fontStyle: settings.italic === "true" ? "italic" : "normal",
    textDecoration: settings.underline === "true" ? "underline" : "none",
    textDecorationColor: settings.underline === "true" ? textColor : void 0
  };
}
var BUILDER_HEADING_FONTS = [
  { key: "", label: "Default (theme)", stack: "" },
  { key: "inter", label: "Inter", stack: "'Inter', system-ui, sans-serif" },
  { key: "poppins", label: "Poppins", stack: "'Poppins', system-ui, sans-serif" },
  { key: "montserrat", label: "Montserrat", stack: "'Montserrat', system-ui, sans-serif" },
  { key: "oswald", label: "Oswald", stack: "'Oswald', 'Arial Narrow', sans-serif" },
  { key: "archivo", label: "Archivo", stack: "'Archivo', system-ui, sans-serif" },
  { key: "space-grotesk", label: "Space Grotesk", stack: "'Space Grotesk', system-ui, sans-serif" },
  { key: "bebas", label: "Bebas Neue", stack: "'Bebas Neue', Impact, sans-serif" },
  { key: "playfair", label: "Playfair Display", stack: "'Playfair Display', Georgia, serif" },
  { key: "merriweather", label: "Merriweather", stack: "'Merriweather', Georgia, serif" },
  { key: "lora", label: "Lora", stack: "'Lora', Georgia, serif" }
];
var BUILDER_GOOGLE_FONTS_HREF = "https://fonts.googleapis.com/css2?" + [
  "family=Inter:wght@400;500;600;700;800;900",
  "family=Poppins:wght@400;500;600;700;800",
  "family=Montserrat:wght@400;500;600;700;800;900",
  "family=Oswald:wght@400;500;600;700",
  "family=Archivo:wght@400;500;600;700;800;900",
  "family=Space+Grotesk:wght@400;500;600;700",
  "family=Bebas+Neue",
  "family=Playfair+Display:wght@400;500;600;700;800;900",
  "family=Merriweather:wght@400;700;900",
  "family=Lora:wght@400;500;600;700"
].join("&") + "&display=swap";
function getHeadingFontStack(fontFamily) {
  if (!fontFamily) {
    return void 0;
  }
  return BUILDER_HEADING_FONTS.find((font) => font.key === fontFamily)?.stack || void 0;
}
var HEADING_TEXT_TRANSFORMS = /* @__PURE__ */ new Set(["none", "uppercase", "lowercase", "capitalize"]);
var HEADING_TEXT_ALIGNS = /* @__PURE__ */ new Set(["left", "center", "right"]);
function getHeadingFontWeight(settings) {
  const explicit = Number.parseInt(settings.fontWeight ?? "", 10);
  if (Number.isFinite(explicit) && explicit >= 100 && explicit <= 900) {
    return explicit;
  }
  return settings.bold === "false" ? 500 : 800;
}
function getHeadingModuleStyle(settings) {
  const fontSize = Number.parseInt(settings.fontSize ?? "32", 10);
  const color = settings.color || "#18324a";
  const dropShadow = getModuleDropShadowStyle(settings);
  const nudgeTransform = getModuleNudgeTransform(settings);
  const verticalOffset = Number.parseInt(normalizeSignedOffsetValue(settings.verticalOffset, "0"), 10);
  const offsetY = Number.isFinite(verticalOffset) ? verticalOffset : 0;
  const fontFamily = getHeadingFontStack(settings.fontFamily);
  const lineHeight = Number.parseFloat(settings.lineHeight ?? "");
  const letterSpacing = Number.parseFloat(settings.letterSpacing ?? "");
  const textAlign = HEADING_TEXT_ALIGNS.has(settings.textAlign ?? "") ? settings.textAlign : void 0;
  const textTransform = HEADING_TEXT_TRANSFORMS.has(settings.textTransform ?? "") ? settings.textTransform : void 0;
  return {
    margin: 0,
    fontSize: `${Math.max(Number.isFinite(fontSize) ? fontSize : 32, 10)}px`,
    color,
    ...fontFamily ? { fontFamily } : {},
    fontWeight: getHeadingFontWeight(settings),
    fontStyle: settings.italic === "true" ? "italic" : "normal",
    ...textAlign ? { textAlign } : {},
    ...Number.isFinite(lineHeight) && lineHeight > 0 ? { lineHeight } : {},
    ...Number.isFinite(letterSpacing) ? { letterSpacing: `${letterSpacing}px` } : {},
    ...textTransform && textTransform !== "none" ? { textTransform } : {},
    textDecoration: settings.underline === "true" ? "underline" : "none",
    textDecorationColor: settings.underline === "true" ? color : void 0,
    textShadow: dropShadow,
    WebkitTextStroke: settings.outline === "true" ? `2px ${color}` : void 0,
    ...nudgeTransform ? {
      position: "relative",
      transform: nudgeTransform,
      ...offsetY > 0 ? { marginBottom: `-${offsetY}px` } : {},
      ...offsetY < 0 ? { marginTop: `${Math.abs(offsetY)}px` } : {}
    } : {}
  };
}

// lib/builder-client/adapters/site-url.ts
function getSiteUrl() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:3001";
}
function toAbsoluteSiteUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  const base = getSiteUrl().replace(/\/+$/, "");
  return `${base}${text.startsWith("/") ? "" : "/"}${text}`;
}

// lib/builder-client/supabase-auth-email.ts
function applyAuthEmailMergeFields(html, context) {
  return String(html ?? "").replace(/\{\{\s*\.ConfirmationURL\s*\}\}/gi, context.confirmationUrl).replace(/\{\{\s*\.Email\s*\}\}/gi, context.email).replace(/\{\{\s*\.SiteURL\s*\}\}/gi, context.siteUrl);
}

// lib/builder-client/builder-email-render.ts
function cssPropertiesToInline(style) {
  if (!style) {
    return "";
  }
  return Object.entries(style).map(([key, value]) => {
    if (value == null || value === "") {
      return null;
    }
    const cssKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    return `${cssKey}:${String(value)}`;
  }).filter(Boolean).join(";");
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function wrapBackgroundStyle(background) {
  return cssPropertiesToInline(getBuilderBackgroundStyle(background));
}
function renderEmailModule(module2) {
  if (module2.type === "navigation" || module2.type === "contact-form" || module2.type === "player-portal" || module2.type === "current-poll" || module2.type === "previous-results" || module2.type === "confetti" || module2.type === "headline-rotator" || module2.type === "poll-category-list" || module2.type === "slider" || module2.type === "social" || module2.type === "social-share" || module2.type === "table" || module2.type === "code" || module2.type === "merch" || module2.type === "video" || module2.type === "floating-image") {
    return "";
  }
  const marginStyle = cssPropertiesToInline(getModuleMarginStyle(module2.settings));
  const alignment = getModuleAlignment(module2.settings);
  const alignAttr = alignment === "center" ? "center" : alignment === "right" ? "right" : "left";
  if (module2.type === "heading") {
    const level = module2.settings.level || "h2";
    const style = cssPropertiesToInline(getHeadingModuleStyle(module2.settings));
    return `<tr><td align="${alignAttr}" style="padding:0 40px 12px;${marginStyle}"><${level} style="margin:0;font-family:Arial,Helvetica,sans-serif;${style}">${escapeHtml(module2.text || "")}</${level}></td></tr>`;
  }
  if (module2.type === "text") {
    const html = formatEmailRichTextContent(module2.text);
    return `<tr><td align="${alignAttr}" style="padding:0 40px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#3d5a73;${marginStyle}">${html}</td></tr>`;
  }
  if (module2.type === "speech-bubble") {
    const html = formatEmailRichTextContent(module2.text);
    const backgroundColor = module2.settings.backgroundColor || "#ffffff";
    const borderColor = module2.settings.borderColor || "#9ed4ee";
    const borderThickness = Math.max(0, Number.parseInt(module2.settings.borderThickness ?? "2", 10) || 2);
    const borderRadius = Math.max(0, Number.parseInt(module2.settings.borderRadius ?? "40", 10) || 40);
    const textColor = module2.settings.textColor || "#18324a";
    return `<tr><td align="${alignAttr}" style="padding:0 40px 12px;${marginStyle}"><div style="display:inline-block;max-width:520px;padding:18px 22px;border:${borderThickness}px solid ${borderColor};border-radius:${borderRadius}px;background:${backgroundColor};color:${textColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;">${html}</div></td></tr>`;
  }
  if (module2.type === "quote") {
    return `<tr><td align="${alignAttr}" style="padding:0 40px 12px;${marginStyle}"><blockquote style="margin:0;padding:12px 16px;border-left:4px solid #12bdf4;color:#18324a;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(module2.text || "")}</blockquote></td></tr>`;
  }
  if (module2.type === "image") {
    const url = toAbsoluteSiteUrl(module2.settings.url);
    if (!url) {
      return "";
    }
    const size = Number.parseInt(module2.settings.size ?? "100", 10);
    const width = Number.isFinite(size) ? Math.min(Math.max(size, 10), 100) : 100;
    return `<tr><td align="${alignAttr}" style="padding:0 40px 12px;${marginStyle}"><img src="${escapeHtml(url)}" alt="${escapeHtml(module2.settings.alt || module2.name || "Normie")}" width="${Math.round(600 * (width / 100))}" style="display:block;max-width:100%;height:auto;border:0;" /></td></tr>`;
  }
  if (module2.type === "button") {
    const label = escapeHtml(module2.text || "Continue");
    const href = escapeHtml(module2.settings.href || "{{ .ConfirmationURL }}");
    const style = cssPropertiesToInline(getButtonModuleStyle(module2.settings));
    return `<tr><td align="${alignAttr}" style="padding:12px 40px 24px;${marginStyle}"><a href="${href}" style="display:inline-block;text-decoration:none;font-family:Arial,Helvetica,sans-serif;${style}">${label}</a></td></tr>`;
  }
  return "";
}
function renderEmailSection(section) {
  const sectionStyle = cssPropertiesToInline(getSectionMarginStyle(section));
  const columns = getLayoutColumns(section.layout);
  const modules = columns.flatMap(
    (column) => section.modules.filter((module2) => module2.column === column)
  );
  const renderedModules = modules.map((module2) => renderEmailModule(module2)).join("");
  if (!renderedModules) {
    return "";
  }
  const sectionBackground = wrapBackgroundStyle(section.background);
  return `<tr><td style="${sectionStyle}${sectionBackground ? `;${sectionBackground}` : ""}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${renderedModules}</table></td></tr>`;
}
function renderBuilderEmailHtml(template, mergeContext) {
  const outerBackground = wrapBackgroundStyle(template.pageBackground);
  const bodyBackground = outerBackground || "background:linear-gradient(160deg,#fff8dc 0%,#e8f4fc 45%,#fde8f2 100%);background-color:#e8f4fc;";
  const sectionsHtml = template.layoutSections.map((section) => renderEmailSection(section)).join("");
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(template.name || "Normie email")}</title>
  </head>
  <body style="margin:0;padding:0;${bodyBackground}">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="min-width:100%;${bodyBackground}">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:50px;border:1px solid #d9e4ef;overflow:hidden;box-shadow:0 18px 48px rgba(24,50,74,0.12);">
            ${sectionsHtml}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return mergeContext ? applyAuthEmailMergeFields(html, mergeContext) : html;
}
var AUTH_EMAIL_SHELL_OPEN = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin: 0; padding: 0; background-color: #e8f4fc;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: linear-gradient(160deg, #fff8dc 0%, #e8f4fc 45%, #fde8f2 100%); min-width: 100%;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 50px; border: 1px solid #d9e4ef; overflow: hidden; box-shadow: 0 18px 48px rgba(24, 50, 74, 0.12);">
            <tr>
              <td align="center" style="padding: 32px 36px 20px; background-color: #ffffff;">
                <img src="{{ .SiteURL }}/api/brand/normie-logo" alt="Normie" width="200" height="62" style="display: block; width: 200px; max-width: 100%; height: auto; border: 0; margin: 0 auto;" />
              </td>
            </tr>`;
var AUTH_EMAIL_SHELL_CLOSE = `
            <tr>
              <td style="padding: 0 40px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <p style="margin: 0 0 10px; font-size: 13px; line-height: 1.5; color: #6b8499;">
                  If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="margin: 0; font-size: 12px; line-height: 1.5; word-break: break-all;">
                  <a href="{{ .ConfirmationURL }}" style="color: #12bdf4;">{{ .ConfirmationURL }}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 40px 28px; background-color: #f7fbff; border-top: 1px solid #eef4f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #6b8499; text-align: center;">
                  Normie \xB7 Where Average is Awesome! \xB7 {{ .SiteURL }}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
var AUTH_EMAIL_BUTTON = '<a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 16px 32px; background-color: #4cbb17; background-image: linear-gradient(180deg, #5fd428 0%, #4cbb17 55%, #3a9612 100%); color: #fff700; text-decoration: none; font-family: Arial, Helvetica, sans-serif; font-size: 18px; font-weight: 800; letter-spacing: 0.02em; border-radius: 999px; border: 2px solid #2d7a0e; text-shadow: 1px 1px 0 #000000, 2px 2px 0 #000000, 3px 3px 6px rgba(0, 0, 0, 0.85); white-space: nowrap;">';
function buildAuthEmailFallbackHtml(emailFunction) {
  if (emailFunction === "password_reset") {
    return `${AUTH_EMAIL_SHELL_OPEN}
            <tr>
              <td style="padding: 8px 40px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <p style="margin: 0 0 12px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #5a7a94; font-weight: 700;">
                  Password reset
                </p>
                <h1 style="margin: 0 0 16px; font-size: 26px; line-height: 1.2; color: #18324a; font-weight: 800;">
                  Reset your password
                </h1>
                <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3d5a73;">
                  We received a request to reset the password for
                  <strong style="color: #18324a;">{{ .Email }}</strong>.
                  Use the button below to choose a new password. If you did not request this, you can ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 12px 40px 36px;">
                ${AUTH_EMAIL_BUTTON}Reset Password</a>
              </td>
            </tr>${AUTH_EMAIL_SHELL_CLOSE}`;
  }
  return `${AUTH_EMAIL_SHELL_OPEN}
            <tr>
              <td style="padding: 8px 40px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <p style="margin: 0 0 12px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #5a7a94; font-weight: 700;">
                  Player signup
                </p>
                <h1 style="margin: 0 0 16px; font-size: 26px; line-height: 1.2; color: #18324a; font-weight: 800;">
                  Welcome to Normie
                </h1>
                <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3d5a73;">
                  Thanks for signing up. Confirm your email address
                  <strong style="color: #18324a;">{{ .Email }}</strong> to finish creating your player account and start answering polls.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 12px 40px 36px;">
                ${AUTH_EMAIL_BUTTON}Confirm Your Email</a>
              </td>
            </tr>${AUTH_EMAIL_SHELL_CLOSE}`;
}
function renderBuilderEmailHtmlWithFallback(template, mergeContext, emailFunction = "signup_confirmation") {
  if (template && template.layoutSections.length > 0) {
    return renderBuilderEmailHtml(template, mergeContext);
  }
  return applyAuthEmailMergeFields(buildAuthEmailFallbackHtml(emailFunction), mergeContext);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  renderBuilderEmailHtml,
  renderBuilderEmailHtmlWithFallback
});
