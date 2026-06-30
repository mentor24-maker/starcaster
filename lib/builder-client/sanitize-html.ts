import type DOMPurifyType from "dompurify";
import { isAllowedRichTextImageSrc } from "@/lib/rich-text-image";

const RICH_TEXT_ALLOWED_TAGS = [
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
] as const;

const RICH_TEXT_ALLOWED_ATTR = [
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
] as const;

const EMBED_EXTRA_TAGS = ["iframe"] as const;

const EMBED_EXTRA_ATTR = [
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
] as const;

let domPurifyInstance: typeof DOMPurifyType | null = null;
let isConfigured = false;

function getDomPurify() {
  if (!domPurifyInstance) {
    // Lazy-load so public SSR routes do not initialize jsdom unless sanitizing HTML.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer jsdom until sanitize runs
    domPurifyInstance = require("isomorphic-dompurify").default as typeof DOMPurifyType;
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

export function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeRichTextHtml(html: string) {
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

/** Fallback when DOMPurify/jsdom is unavailable (e.g. Vercel ESM/CJS mismatch). */
export function stripDangerousRichTextHtml(html: string) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export function sanitizeEmbedHtml(html: string) {
  ensureConfigured();

  return getDomPurify().sanitize(html, {
    ALLOWED_TAGS: [...RICH_TEXT_ALLOWED_TAGS, ...EMBED_EXTRA_TAGS],
    ALLOWED_ATTR: [...RICH_TEXT_ALLOWED_ATTR, ...EMBED_EXTRA_ATTR],
    ALLOW_DATA_ATTR: false
  });
}

const BLOG_BODY_EXTRA_TAGS = [
  "img",
  "hr",
  "iframe",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td"
] as const;

const BLOG_BODY_EXTRA_ATTR = [
  "src",
  "alt",
  "width",
  "height",
  "colspan",
  "rowspan",
  ...EMBED_EXTRA_ATTR
] as const;

const BLOG_EMBED_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "platform.twitter.com",
  "twitter.com",
  "x.com"
] as const;

function isAllowedBlogEmbedSrc(src: string) {
  try {
    const url = new URL(src, "https://starcaster.pro");

    return BLOG_EMBED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function filterAllowedBlogEmbeds(html: string) {
  return html.replace(/<iframe\b[^>]*\ssrc=["']([^"']+)["'][^>]*><\/iframe>/gi, (match, src) =>
    isAllowedBlogEmbedSrc(src) ? match : ""
  );
}

/** Used when DOMPurify/jsdom is unavailable on the server (e.g. Vercel function crash). */
export function stripDangerousBlogBodyHtml(html: string) {
  return filterAllowedBlogEmbeds(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/javascript:/gi, "")
  );
}

export function sanitizeBlogBodyHtml(html: string) {
  try {
    ensureConfigured();

    const clean = getDomPurify().sanitize(html, {
      ALLOWED_TAGS: [...RICH_TEXT_ALLOWED_TAGS, ...BLOG_BODY_EXTRA_TAGS],
      ALLOWED_ATTR: [...RICH_TEXT_ALLOWED_ATTR, ...BLOG_BODY_EXTRA_ATTR],
      ALLOW_DATA_ATTR: false
    });

    return filterAllowedBlogEmbeds(clean);
  } catch {
    return stripDangerousBlogBodyHtml(html);
  }
}
