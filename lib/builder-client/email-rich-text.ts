import { escapeHtmlText } from "@/lib/sanitize-html";

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

/** Regex sanitizer for serverless email render — avoids jsdom / isomorphic-dompurify on Vercel. */
export function stripDangerousEmailHtml(html: string) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

/** Rich text for auth/builder emails — no DOMPurify/jsdom dependency. */
export function formatEmailRichTextContent(value: unknown): string {
  const text = String(value ?? "").trim();

  if (!text) {
    return "";
  }

  const html = looksLikeHtml(text)
    ? text
    : text
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtmlText(paragraph).replace(/\n/g, "<br />")}</p>`)
        .join("");

  return stripDangerousEmailHtml(html);
}

/**
 * The Simple Text variant in email. Same rule as on the page (see
 * `formatPlainTextContent` in `builder-template.ts`, which carries the
 * reasoning): no `<p>` wrapper, typed newlines become `<br />`, and a value
 * that already contains block-level tags lays itself out. Duplicated rather
 * than shared because this file must stay free of jsdom/DOMPurify for
 * serverless email render — the two are checked against each other in
 * `email-rich-text.test.ts`.
 */
const BLOCK_LEVEL_TAG =
  /<\s*(p|div|h[1-6]|ul|ol|li|dl|blockquote|pre|table|thead|tbody|tr|td|th|section|article|aside|header|footer|figure|figcaption|hr)\b/i;

export function formatEmailPlainTextContent(value: unknown): string {
  const text = String(value ?? "").trim();

  if (!text) {
    return "";
  }

  const escaped = looksLikeHtml(text) ? text : escapeHtmlText(text);
  const html = BLOCK_LEVEL_TAG.test(text) ? escaped : escaped.replace(/\n/g, "<br />");

  return stripDangerousEmailHtml(html);
}
