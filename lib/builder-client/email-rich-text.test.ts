import { describe, expect, it } from "vitest";
import { formatEmailRichTextContent } from "@/lib/email-rich-text";

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
