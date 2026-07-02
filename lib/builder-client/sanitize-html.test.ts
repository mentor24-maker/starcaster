import { describe, expect, it } from "vitest";
import {
  escapeHtmlText,
  sanitizeBlogBodyHtml,
  sanitizeEmbedHtml,
  sanitizeRichTextHtml,
  stripDangerousBlogBodyHtml
} from "@/lib/sanitize-html";

describe("escapeHtmlText", () => {
  it("escapes angle brackets and quotes", () => {
    expect(escapeHtmlText(`<script>"x"</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot;&lt;/script&gt;"
    );
  });
});

describe("sanitizeRichTextHtml", () => {
  it("strips script tags", () => {
    const clean = sanitizeRichTextHtml('<p>Hello</p><script>alert("x")</script>');
    expect(clean).toContain("<p>Hello</p>");
    expect(clean.toLowerCase()).not.toContain("<script");
  });

  it("keeps basic formatting tags", () => {
    const clean = sanitizeRichTextHtml("<p><strong>Bold</strong></p>");
    expect(clean).toContain("<strong>Bold</strong>");
  });

  it("keeps gallery images with safe src", () => {
    const clean = sanitizeRichTextHtml('<p>Hi</p><img src="/gallery/test.png" alt="Sample" />');
    expect(clean.toLowerCase()).toContain("<img");
    expect(clean).toContain("/gallery/test.png");
  });

  it("strips images with unsafe src", () => {
    const clean = sanitizeRichTextHtml('<img src="javascript:alert(1)" alt="x" />');
    expect(clean.toLowerCase()).not.toContain("<img");
  });
});

describe("sanitizeBlogBodyHtml", () => {
  it("strips script tags from blog body html", () => {
    const clean = sanitizeBlogBodyHtml('<p>Hello</p><script>alert("x")</script>');
    expect(clean).toContain("<p>Hello</p>");
    expect(clean.toLowerCase()).not.toContain("<script");
  });
});

describe("stripDangerousBlogBodyHtml", () => {
  it("removes scripts and inline handlers", () => {
    const clean = stripDangerousBlogBodyHtml('<p onclick="x()">Hi</p><script>bad()</script>');
    expect(clean).toContain("<p");
    expect(clean.toLowerCase()).not.toContain("<script");
    expect(clean).not.toContain("onclick");
  });
});

describe("sanitizeEmbedHtml", () => {
  it("allows iframes but removes scripts", () => {
    const clean = sanitizeEmbedHtml(
      '<iframe src="https://example.com/embed"></iframe><script>alert(1)</script>'
    );
    expect(clean.toLowerCase()).toContain("<iframe");
    expect(clean.toLowerCase()).not.toContain("<script");
  });

  it("strips style tags but keeps dexscreener embed markup", () => {
    const clean = sanitizeEmbedHtml(
      '<style>#dexscreener-embed{width:100%;}</style><motion.div id="dexscreener-embed"><iframe src="https://dexscreener.com/solana/test?embed=1"></iframe></div>'.replace(
        /motion\./g,
        ""
      )
    );
    expect(clean.toLowerCase()).not.toContain("<style");
    expect(clean).toContain('id="dexscreener-embed"');
    expect(clean.toLowerCase()).toContain("<iframe");
  });
});
