// @vitest-environment jsdom
/**
 * Task 86bcg88kk: a Google Doc pasted into a Paragraph module put a blank line
 * between every paragraph, and the live page showed double spacing. The
 * fixtures below are the shape Google Docs puts on the clipboard: every
 * paragraph wrapped in a `<b style="font-weight:normal" id="docs-internal-guid-…">`,
 * and each blank line in the document carried as a bare `<br />` BETWEEN the
 * `<p>` elements.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanPastedRichTextHtml } from "@/lib/rich-text-paste";

const DOCS_P = '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">';
const DOCS_SPAN =
  '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">';

function docsParagraph(text: string) {
  return `${DOCS_P}${DOCS_SPAN}${text}</span></p>`;
}

/** What `getData("text/html")` returns after copying three paragraphs with a blank line between each. */
const GOOGLE_DOCS_WITH_BLANK_LINES =
  "<meta charset='utf-8'><meta charset=\"utf-8\">" +
  '<b style="font-weight:normal;" id="docs-internal-guid-6a1d2f3e-7fff-9c2b-1a3d-0e5f6a7b8c9d">' +
  docsParagraph("First paragraph.") +
  "<br />" +
  docsParagraph("Second paragraph.") +
  "<br />" +
  docsParagraph("Third paragraph.") +
  "</b>" +
  '<br class="Apple-interchange-newline">';

function paragraphs(html: string) {
  const body = new DOMParser().parseFromString(html, "text/html").body;

  return Array.from(body.querySelectorAll("p")).map((p) => p.textContent);
}

function topLevelBreaks(html: string) {
  const body = new DOMParser().parseFromString(html, "text/html").body;

  return Array.from(body.querySelectorAll("br")).filter((br) => br.closest("p") === null).length;
}

describe("cleanPastedRichTextHtml on a Google Docs clipboard", () => {
  it("drops the bare <br> Google Docs puts between paragraphs for each blank line", () => {
    const cleaned = cleanPastedRichTextHtml(GOOGLE_DOCS_WITH_BLANK_LINES);

    expect(paragraphs(cleaned)).toEqual(["First paragraph.", "Second paragraph.", "Third paragraph."]);
    expect(topLevelBreaks(cleaned)).toBe(0);
  });

  it("drops a paragraph holding only a non-breaking space", () => {
    const html =
      docsParagraph("Before.") +
      docsParagraph("&nbsp;") +
      "<p><br></p>" +
      "<p></p>" +
      docsParagraph("After.");

    expect(paragraphs(cleanPastedRichTextHtml(html))).toEqual(["Before.", "After."]);
  });

  it("keeps a <br> inside a paragraph — that is the author's soft line break", () => {
    const html = docsParagraph("Line one<br />Line two") + "<br />" + docsParagraph("Next.");
    const cleaned = cleanPastedRichTextHtml(html);

    expect(cleaned).toContain("Line one<br>Line two");
    expect(topLevelBreaks(cleaned)).toBe(0);
    expect(paragraphs(cleaned)).toEqual(["Line oneLine two", "Next."]);
  });

  it("keeps a <br> between runs of inline text, which is that text's only line structure", () => {
    const html = "Line one<br>Line two<br>Line three";

    expect(cleanPastedRichTextHtml(html)).toBe(html);
  });

  it("keeps a paragraph whose only content is an image", () => {
    const html = docsParagraph("Caption above.") + '<p><img src="https://example.com/a.png" alt=""></p>';
    const cleaned = cleanPastedRichTextHtml(html);

    expect(cleaned).toContain("<img");
    expect(paragraphs(cleaned)).toHaveLength(2);
  });

  it("returns markup with nothing to clean byte for byte", () => {
    const html = "<p>One</p><p>Two</p>";

    expect(cleanPastedRichTextHtml(html)).toBe(html);
    expect(cleanPastedRichTextHtml("")).toBe("");
  });
});

describe("cleanPastedRichTextHtml without a DOM", () => {
  const parser = globalThis.DOMParser;

  afterEach(() => {
    globalThis.DOMParser = parser;
  });

  it("hands the markup back untouched rather than throwing", () => {
    // @ts-expect-error -- simulating an environment with no DOM at all
    delete globalThis.DOMParser;

    expect(cleanPastedRichTextHtml(GOOGLE_DOCS_WITH_BLANK_LINES)).toBe(GOOGLE_DOCS_WITH_BLANK_LINES);
  });
});
