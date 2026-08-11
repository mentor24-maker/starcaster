import { describe, expect, it } from "vitest";
import { formatEmailPlainTextContent, formatEmailRichTextContent } from "@/lib/email-rich-text";

describe("formatEmailRichTextContent", () => {
  it("escapes plain text paragraphs", () => {
    expect(formatEmailRichTextContent("Hello\n\nWorld")).toContain("<p>Hello</p>");
    expect(formatEmailRichTextContent("3 < 5")).toContain("3 &lt; 5");
  });

  it("strips scripts from html without using dompurify", () => {
    const html = formatEmailRichTextContent("<p>Safe</p><script>alert(1)</script>");
    expect(html).toContain("Safe");
    expect(html).not.toContain("script");
  });
});

describe("formatEmailPlainTextContent", () => {
  it("emits no paragraph wrapper, only line breaks", () => {
    const html = formatEmailPlainTextContent("Hello\nWorld");
    expect(html).not.toContain("<p>");
    expect(html.toLowerCase()).toContain("<br");
  });

  it("escapes plain text", () => {
    expect(formatEmailPlainTextContent("3 < 5")).toContain("3 &lt; 5");
  });

  it("strips scripts from html", () => {
    const html = formatEmailPlainTextContent("Safe<script>alert(1)</script>");
    expect(html).toContain("Safe");
    expect(html).not.toContain("script");
  });

  // This file cannot import the page-side formatter (it must stay free of
  // jsdom/DOMPurify for serverless email render), so the two copies of the
  // rule are pinned here instead. If one is changed and the other isn't,
  // these fail.
  it("applies the same line-break rule as the page renderer", () => {
    expect(formatEmailPlainTextContent("First\nsecond <em>line</em>").toLowerCase()).toContain("<br");
    expect(formatEmailPlainTextContent("<h3>Title</h3>\n<div>Body</div>").toLowerCase()).not.toContain("<br");
  });
});
