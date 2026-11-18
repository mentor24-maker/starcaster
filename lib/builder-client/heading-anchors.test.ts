import { describe, expect, it } from "vitest";

import {
  addHeadingAnchors,
  applyHeadingAnchors,
  createAnchorAllocator,
  headingAnchorBase,
  listHeadings,
  planHeadingAnchors
} from "@/lib/heading-anchors";

describe("headingAnchorBase", () => {
  it("lower-cases and hyphenates a heading's words", () => {
    expect(headingAnchorBase("Junior Programs")).toBe("junior-programs");
  });

  it("drops punctuation and folds accents", () => {
    expect(headingAnchorBase("Café & Courts!")).toBe("cafe-courts");
    expect(headingAnchorBase("Player's Guide")).toBe("players-guide");
  });

  it("gives a heading with no letters or numbers no anchor", () => {
    expect(headingAnchorBase("")).toBe("");
    expect(headingAnchorBase("🎾")).toBe("");
    expect(headingAnchorBase(" — ")).toBe("");
  });
});

describe("listHeadings", () => {
  it("reads every level's words, through inline markup and entities", () => {
    const html = '<h1>One</h1><p>x</p><h3><strong>Café</strong> &amp; Courts</h3><h6>Six<br />Lines</h6>';
    expect(listHeadings(html)).toEqual([
      { existingId: "", base: "one" },
      { existingId: "", base: "cafe-courts" },
      { existingId: "", base: "six-lines" }
    ]);
  });

  it("reports an id a heading already has, in any quoting", () => {
    expect(listHeadings('<h2 id="my-name">A</h2><h2 class="x" id=\'b\'>B</h2><h2 id=c>C</h2>')).toEqual([
      { existingId: "my-name", base: "" },
      { existingId: "b", base: "" },
      { existingId: "c", base: "" }
    ]);
  });

  it("does not read a data-id or a grid attribute as the heading's id", () => {
    expect(listHeadings('<h2 data-id="nope">Real</h2>')).toEqual([{ existingId: "", base: "real" }]);
  });
});

describe("applyHeadingAnchors / addHeadingAnchors", () => {
  it("gives a heading with no id one from its words", () => {
    expect(addHeadingAnchors("<h2>Junior Programs</h2>")).toBe('<h2 id="junior-programs">Junior Programs</h2>');
  });

  it("keeps a heading's own id, untouched", () => {
    expect(addHeadingAnchors('<h2 id="my-name">Junior Programs</h2>')).toBe('<h2 id="my-name">Junior Programs</h2>');
  });

  it("keeps the heading's other attributes", () => {
    expect(addHeadingAnchors('<h3 style="color: red">Hi</h3>')).toBe('<h3 id="hi" style="color: red">Hi</h3>');
  });

  it("numbers repeated words instead of repeating an id", () => {
    expect(addHeadingAnchors("<h2>FAQ</h2><h3>FAQ</h3><h4>FAQ</h4>")).toBe(
      '<h2 id="faq">FAQ</h2><h3 id="faq-2">FAQ</h3><h4 id="faq-3">FAQ</h4>'
    );
  });

  it("does not copy an id a heading already carries", () => {
    expect(addHeadingAnchors('<h2>Hours</h2><h2 id="hours">Opening</h2>')).toBe(
      '<h2 id="hours-2">Hours</h2><h2 id="hours">Opening</h2>'
    );
  });

  it("leaves an emoji-only heading without an id", () => {
    expect(addHeadingAnchors("<h2>🎾</h2>")).toBe("<h2>🎾</h2>");
  });

  it("leaves html with no headings, and empty html, as it was", () => {
    expect(addHeadingAnchors("<p>Just a paragraph</p>")).toBe("<p>Just a paragraph</p>");
    expect(addHeadingAnchors("")).toBe("");
    expect(applyHeadingAnchors("<h2>A</h2>", undefined)).toBe("<h2>A</h2>");
  });
});

describe("planHeadingAnchors — one numbering for the whole page", () => {
  it("numbers the same heading in two modules across the page", () => {
    const { ids } = planHeadingAnchors([
      { key: "m1", html: "<h2>Junior Programs</h2>" },
      { key: "m2", html: "<p>x</p><h2>Junior Programs</h2>" }
    ]);
    expect(ids.get("m1")).toEqual(["junior-programs"]);
    expect(ids.get("m2")).toEqual(["junior-programs-2"]);
    expect(applyHeadingAnchors("<p>x</p><h2>Junior Programs</h2>", ids.get("m2"))).toBe(
      '<p>x</p><h2 id="junior-programs-2">Junior Programs</h2>'
    );
  });

  it("never takes a section's anchor name", () => {
    const { ids } = planHeadingAnchors([{ key: "m1", html: "<h2>Contact Us</h2>" }], ["contact-us"]);
    expect(ids.get("m1")).toEqual(["contact-us-2"]);
  });

  it("never copies an id a heading in a LATER module already has", () => {
    const { ids } = planHeadingAnchors([
      { key: "m1", html: "<h2>Team</h2>" },
      { key: "m2", html: '<h2 id="team">Our people</h2>' }
    ]);
    expect(ids.get("m1")).toEqual(["team-2"]);
    expect(ids.get("m2")).toEqual([""]);
  });

  it("leaves a key that appears twice out of the plan, so neither copy draws the other's ids", () => {
    const { ids, allocator } = planHeadingAnchors([
      { key: "dup", html: "<h2>Alpha</h2>" },
      { key: "dup", html: "<h2>Beta</h2>" }
    ]);
    expect(ids.has("dup")).toBe(false);
    expect(addHeadingAnchors("<h2>Beta</h2>", allocator.fork())).toBe('<h2 id="beta-2">Beta</h2>');
  });

  it("hands later rich text (a blog body) a fork that avoids the page's ids, every draw alike", () => {
    const { allocator } = planHeadingAnchors([{ key: "m1", html: "<h2>Results</h2>" }]);
    const first = addHeadingAnchors("<h2>Results</h2>", allocator.fork());
    const second = addHeadingAnchors("<h2>Results</h2>", allocator.fork());
    expect(first).toBe('<h2 id="results-2">Results</h2>');
    expect(second).toBe(first);
  });
});

describe("createAnchorAllocator", () => {
  it("forks without changing the original", () => {
    const allocator = createAnchorAllocator(["a"]);
    const fork = allocator.fork();
    expect(fork.take("b")).toBe("b");
    expect(allocator.has("b")).toBe(false);
    expect(allocator.take("a")).toBe("a-2");
  });
});
