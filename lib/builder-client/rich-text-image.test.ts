import { describe, expect, it } from "vitest";
import {
  appendRichTextImageToHtml,
  isAllowedRichTextImageSrc,
  resolveRichTextImageSrc,
  rewriteRichTextImageSrcInHtml
} from "@/lib/rich-text-image";
import { sanitizeRichTextHtml } from "@/lib/sanitize-html";

describe("resolveRichTextImageSrc", () => {
  it("maps gallery paths to admin URLs in the editor and public gallery paths on the site", () => {
    expect(resolveRichTextImageSrc("/gallery/sample.png", "editor")).toBe(
      "/api/admin/media-file/gallery/sample.png"
    );
    expect(resolveRichTextImageSrc("/gallery/sample.png", "display")).toBe("/gallery/sample.png");
  });

  it("stores canonical gallery paths", () => {
    expect(resolveRichTextImageSrc("/api/admin/media-file/gallery/sample.png", "storage")).toBe(
      "/gallery/sample.png"
    );
  });

  it("accepts absolute gallery URLs on the admin host as well as the apex", () => {
    expect(resolveRichTextImageSrc("https://app.starcaster.pro/gallery/sample.png", "storage")).toBe(
      "/gallery/sample.png"
    );
    expect(resolveRichTextImageSrc("https://www.starcaster.pro/gallery/sample.png", "storage")).toBe(
      "/gallery/sample.png"
    );
  });

  it("rejects unsafe sources", () => {
    expect(resolveRichTextImageSrc("javascript:alert(1)", "editor")).toBe("");
  });

  it("keeps admin media-file paths for non-gallery assets", () => {
    expect(resolveRichTextImageSrc("/api/admin/media-file/logo.png", "editor")).toBe(
      "/api/admin/media-file/logo.png"
    );
  });
});

describe("appendRichTextImageToHtml", () => {
  it("appends an image paragraph to empty content", () => {
    const html = appendRichTextImageToHtml("", "/gallery/sample.png");
    expect(html).toContain("<img");
    expect(html).toContain("/gallery/sample.png");
  });
});

describe("rewriteRichTextImageSrcInHtml", () => {
  it("rewrites image src for display output", () => {
    const html = rewriteRichTextImageSrcInHtml(
      '<p>Hi</p><img src="/gallery/test.png" alt="" />',
      "display"
    );

    expect(html).toContain('src="/gallery/test.png"');
    expect(html).toContain('class="rich-text-editor-image"');
  });
});

// Task 86bcv0fhh, decision A1: a text module may show a picture from Site
// Import's own folder in Starcaster's Blob store — so an imported logo can sit
// beside its brand name — and from nowhere else it could not before.
describe("imported pictures in a text module", () => {
  const IMPORTED =
    "https://astujhe2hvjqd0kf.public.blob.vercel-storage.com/SiteImportApplied/proj_1/assets/a7.png";

  it("keeps an imported picture unchanged in every mode", () => {
    for (const mode of ["editor", "display", "storage"] as const) {
      expect(resolveRichTextImageSrc(IMPORTED, mode)).toBe(IMPORTED);
    }
  });

  it("keeps an imported picture through the sanitizer the live site renders with", () => {
    const html = rewriteRichTextImageSrcInHtml(
      sanitizeRichTextHtml(
        `<div style="display:flex;align-items:center;gap:12px"><img src="${IMPORTED}" alt="Logo" /><div><p>Alphire</p></div></div>`
      ),
      "display"
    );
    expect(html).toContain(`src="${IMPORTED}"`);
    expect(html).toContain("display:flex");
  });

  it.each([
    ["another site entirely", "https://evil.example/SiteImportApplied/proj_1/a.png"],
    ["another Blob store", "https://otherstore.public.blob.vercel-storage.com/SiteImportApplied/proj_1/a.png"],
    ["a folder that is not the import's durable copy", "https://astujhe2hvjqd0kf.public.blob.vercel-storage.com/SiteImport/simp_1/a.png"],
    ["a path that climbs out of the folder", "https://astujhe2hvjqd0kf.public.blob.vercel-storage.com/SiteImportApplied/../APP_Assets/a.png"],
    ["plain http", "http://astujhe2hvjqd0kf.public.blob.vercel-storage.com/SiteImportApplied/proj_1/a.png"],
  ])("still strips a picture from %s", (_label, src) => {
    expect(isAllowedRichTextImageSrc(src)).toBe(false);
    const html = rewriteRichTextImageSrcInHtml(sanitizeRichTextHtml(`<p>Hi</p><img src="${src}" alt="" />`), "display");
    expect(html).not.toContain("<img");
    expect(html).toContain("Hi");
  });
});
