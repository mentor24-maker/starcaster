/**
 * Clean HTML arriving on the clipboard BEFORE the rich-text editor parses it.
 *
 * Why this exists (task 86bcg88kk, 2026-10-09): a Google Doc copied into a
 * Paragraph module showed a blank line between every paragraph, and the live
 * page showed double spacing. Google Docs paragraphs carry no margin, so a
 * blank line is how spacing is made there, and the clipboard HTML carries each
 * one as a bare `<br />` sitting BETWEEN the `<p>` elements (sometimes as a
 * paragraph holding only `&nbsp;`). The editor turns each into an empty
 * paragraph; our paragraphs already carry spacing, so the empty one is extra.
 *
 * Only PASTED markup runs through here. Pressing Enter twice in the editor is
 * typing, not a paste, and still makes a blank line on purpose.
 *
 * Two rules, both on the pasted document only:
 *   1. An empty paragraph goes — one whose text is nothing but whitespace or
 *      non-breaking spaces and which holds no image or other media.
 *   2. A `<br>` that sits between two blocks (or at the very start or end of a
 *      run of blocks) goes. A `<br>` INSIDE a paragraph is a soft line break
 *      the author made and stays; so does one between two runs of inline text,
 *      which is the only line structure that text has.
 */

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "DL",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "HR",
  "FIGURE",
  "SECTION",
  "ARTICLE",
  "ASIDE",
  "HEADER",
  "FOOTER"
]);

// A paragraph holding one of these is not empty even when it has no text.
const MEDIA_SELECTOR = "img, iframe, video, audio, svg, hr, table";

/**
 * A block tag, or an inline wrapper that holds blocks — Google Docs wraps the
 * whole paste in `<b style="font-weight:normal" id="docs-internal-guid-…">`,
 * and the `<br class="Apple-interchange-newline">` WebKit appends after it is
 * as much "between blocks" as one sitting between two `<p>`s.
 */
function isBlockLike(node: Node | null): boolean {
  if (!node || node.nodeType !== 1) {
    return false;
  }

  const element = node as Element;

  if (BLOCK_TAGS.has(element.tagName)) {
    return true;
  }

  return Array.from(element.children).some((child) => BLOCK_TAGS.has(child.tagName));
}

function isBlankText(node: Node): boolean {
  return node.nodeType === 3 && /^[\s ]*$/.test(node.textContent ?? "");
}

function isLineBreak(node: Node): boolean {
  return node.nodeType === 1 && (node as Element).tagName === "BR";
}

/**
 * The nearest sibling that is not blank text and not another `<br>` — so a
 * run of several breaks between two paragraphs is judged as one gap.
 */
function significantSibling(node: Node, direction: "previous" | "next"): Node | null {
  let current = direction === "previous" ? node.previousSibling : node.nextSibling;

  while (current && (isBlankText(current) || isLineBreak(current))) {
    current = direction === "previous" ? current.previousSibling : current.nextSibling;
  }

  return current;
}

function isEmptyParagraph(paragraph: Element): boolean {
  if (paragraph.querySelector(MEDIA_SELECTOR)) {
    return false;
  }

  return /^[\s ]*$/.test(paragraph.textContent ?? "");
}

/**
 * A `<br>` sits "between blocks" when whatever is on each side of it is a block
 * element or nothing at all. Inline text on either side means the break is
 * part of that text and stays.
 */
function isBreakBetweenBlocks(lineBreak: Element): boolean {
  const before = significantSibling(lineBreak, "previous");
  const after = significantSibling(lineBreak, "next");

  const beforeIsBlockOrEdge = before === null || isBlockLike(before);
  const afterIsBlockOrEdge = after === null || isBlockLike(after);

  // Both edges with nothing else around it is an empty paste; leave it alone.
  if (before === null && after === null) {
    return false;
  }

  return beforeIsBlockOrEdge && afterIsBlockOrEdge;
}

/**
 * Returns the cleaned HTML, or the input untouched when there was nothing to
 * clean — so markup that needed no help is never re-serialised.
 */
export function cleanPastedRichTextHtml(html: string): string {
  if (typeof html !== "string" || !html || typeof DOMParser === "undefined") {
    return html;
  }

  const body = new DOMParser().parseFromString(html, "text/html").body;

  if (!body) {
    return html;
  }

  let removed = 0;

  for (const paragraph of Array.from(body.querySelectorAll("p"))) {
    if (isEmptyParagraph(paragraph)) {
      paragraph.remove();
      removed += 1;
    }
  }

  for (const lineBreak of Array.from(body.querySelectorAll("br"))) {
    if (isBreakBetweenBlocks(lineBreak)) {
      lineBreak.remove();
      removed += 1;
    }
  }

  return removed > 0 ? body.innerHTML : html;
}
