import { describe, expect, it } from "vitest";
import {
  appendRichTextImageToHtml,
  resolveRichTextImageSrc,
  rewriteRichTextImageSrcInHtml
} from "@/lib/rich-text-image";

describe("resolveRichTextImageSrc", () => {
  it("maps gallery paths to admin URLs in the editor and public gallery paths on the site", () => {
    expect(resolveRichTextImageSrc("/gallery/normie.png", "editor")).toBe(
      "/api/admin/media-file/gallery/normie.png"
    );
    expect(resolveRichTextImageSrc("/gallery/normie.png", "display")).toBe("/gallery/normie.png");
  });

  it("stores canonical gallery paths", () => {
    expect(resolveRichTextImageSrc("/api/admin/media-file/gallery/normie.png", "storage")).toBe(
      "/gallery/normie.png"
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
    const html = appendRichTextImageToHtml("", "/gallery/normie.png");
    expect(html).toContain("<img");
    expect(html).toContain("/gallery/normie.png");
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
