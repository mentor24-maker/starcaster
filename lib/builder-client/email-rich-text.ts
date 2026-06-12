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
