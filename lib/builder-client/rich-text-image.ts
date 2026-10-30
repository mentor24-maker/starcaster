import { sanitizeRichTextHtml } from "./sanitize-html";

export const RICH_TEXT_IMAGE_CLASS = "rich-text-editor-image";

function normalizeRichTextImagePath(value: string) {
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

export type RichTextImageSrcMode = "editor" | "display" | "storage";

/**
 * Starcaster's own Vercel Blob store, and the one folder in it a text module
 * may show pictures from: the durable copies Site Import makes of a client
 * site's pictures (`SiteImportApplied/<projectId>/…`). An imported logo lockup
 * — a logo beside the brand name — arrives as one text module holding the
 * picture (task 86bcv0fhh), and without this it was stripped on render.
 *
 * Decision A1 (Dane, 2026-10-29): any project's text module may show any
 * project's IMPORTED pictures. They are public addresses already; the only
 * widening is that a pasted address from another client's import would show.
 * Every other Blob folder, every other store and every other host is still
 * stripped. Checking "this project's own" would mean threading the project
 * through every text render path (option A2, not chosen).
 */
const STARCASTER_BLOB_HOST = "astujhe2hvjqd0kf.public.blob.vercel-storage.com";
const IMPORTED_PICTURE_FOLDER = "/SiteImportApplied/";

export function isImportedPictureSrc(src: string) {
  try {
    const url = new URL(src.trim());
    return (
      url.protocol === "https:" &&
      url.hostname === STARCASTER_BLOB_HOST &&
      // URL() has already resolved any "/../", so this is the real folder.
      url.pathname.startsWith(IMPORTED_PICTURE_FOLDER)
    );
  } catch {
    return false;
  }
}

export function isAllowedRichTextImageSrc(src: string) {
  const trimmed = src.trim();

  if (!trimmed || /^\s*javascript:/i.test(trimmed)) {
    return false;
  }

  if (trimmed.startsWith("/gallery/") || trimmed.startsWith("/api/admin/media-file/")) {
    return true;
  }

  if (isImportedPictureSrc(trimmed)) {
    return true;
  }

  if (trimmed.startsWith("gallery/") || trimmed.startsWith("api/admin/media-file/")) {
    return true;
  }

  try {
    const url = new URL(trimmed, "https://www.starcaster.pro");

    if (url.pathname.startsWith("/gallery/") || url.pathname.startsWith("/api/admin/media-file/")) {
      return true;
    }

    if (
      url.origin === "https://app.starcaster.pro" ||
      url.origin === "https://www.starcaster.pro" ||
      url.origin === "http://localhost:3000"
    ) {
      return url.pathname.startsWith("/gallery/") || url.pathname.startsWith("/api/admin/media-file/");
    }
  } catch {
    return false;
  }

  return false;
}

export function resolveRichTextImageSrc(src: string, mode: RichTextImageSrcMode) {
  const normalized = normalizeRichTextImagePath(src);

  if (!normalized || !isAllowedRichTextImageSrc(normalized)) {
    return "";
  }

  if (isImportedPictureSrc(normalized)) {
    return normalized;
  }

  const galleryPath = normalized.startsWith("/gallery/")
    ? normalized
    : normalized.startsWith("/api/admin/media-file/gallery/")
      ? normalized.replace("/api/admin/media-file/gallery/", "/gallery/")
      : "";

  if (mode === "storage") {
    return galleryPath || normalized;
  }

  if (galleryPath) {
    return mode === "display" ? galleryPath : `/api/admin/media-file${galleryPath}`;
  }

  if (normalized.startsWith("/api/admin/media-file/")) {
    return mode === "display"
      ? normalized.replace("/api/admin/media-file/", "/media/")
      : normalized;
  }

  return "";
}

export function buildRichTextImageTag(imagePath: string) {
  const src = resolveRichTextImageSrc(imagePath, "storage");

  if (!src) {
    return "";
  }

  return `<img src="${src}" alt="" class="${RICH_TEXT_IMAGE_CLASS}" />`;
}

/** Append a gallery image to stored rich-text HTML (used when picking from the media gallery). */
export function appendRichTextImageToHtml(html: string, imagePath: string) {
  const imgTag = buildRichTextImageTag(imagePath);

  if (!imgTag) {
    return html;
  }

  const trimmed = html.trim();
  const empty =
    !trimmed ||
    trimmed === "<p></p>" ||
    trimmed === "<p><br></p>" ||
    trimmed === "<p><br/></p>" ||
    trimmed === "<p><br /></p>";

  const next = empty ? `<p>${imgTag}</p>` : `${trimmed}<p>${imgTag}</p>`;

  // sanitize-html defers its jsdom/DOMPurify load internally, so this
  // top-level import stays lightweight for path-resolver-only consumers.
  return rewriteRichTextImageSrcInHtml(sanitizeRichTextHtml(next), "storage");
}

export function rewriteRichTextImageSrcInHtml(html: string, mode: RichTextImageSrcMode) {
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
