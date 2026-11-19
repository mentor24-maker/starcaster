// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  pickTableOfContentsEntries,
  readPageHeadings,
  resolveTableOfContentsSettings,
  sameHeadings,
  tableOfContentsEmptyNote
} from "./table-of-contents";

function page(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const THREE_H2_TWO_H3 = `
  <h1 id="title">Programs</h1>
  <h2 id="juniors">Juniors</h2>
  <p>Kids.</p>
  <h3 id="ages-5-8">Ages 5–8</h3>
  <h3 id="ages-9-12">Ages 9–12</h3>
  <h2 id="adults">Adults</h2>
  <h4 id="fees">Fees</h4>
  <h2 id="private-lessons">Private <em>lessons</em></h2>
`;

describe("readPageHeadings", () => {
  it("reads every h2–h6 with an id, in page order, with its words", () => {
    expect(readPageHeadings(page(THREE_H2_TWO_H3))).toEqual([
      { level: 2, id: "juniors", text: "Juniors" },
      { level: 3, id: "ages-5-8", text: "Ages 5–8" },
      { level: 3, id: "ages-9-12", text: "Ages 9–12" },
      { level: 2, id: "adults", text: "Adults" },
      { level: 4, id: "fees", text: "Fees" },
      { level: 2, id: "private-lessons", text: "Private lessons" }
    ]);
  });

  it("skips headings with no id, and headings with no words", () => {
    const root = page(`<h2>No id</h2><h2 id="empty">  </h2><h2 id="kept">Kept</h2>`);
    expect(readPageHeadings(root)).toEqual([{ level: 2, id: "kept", text: "Kept" }]);
  });

  it("never lists a table of contents' own headings", () => {
    const root = page(`
      <nav data-table-of-contents><h2 id="toc-title">On this page</h2></nav>
      <h2 id="real">Real</h2>
    `);
    expect(readPageHeadings(root).map((h) => h.id)).toEqual(["real"]);
  });

  it("leaves out the excluded element", () => {
    const root = page(`<div id="mine"><h2 id="inside">Inside</h2></div><h2 id="outside">Outside</h2>`);
    expect(readPageHeadings(root, root.querySelector("#mine")).map((h) => h.id)).toEqual(["outside"]);
  });

  it("returns nothing without a root", () => {
    expect(readPageHeadings(null)).toEqual([]);
  });
});

describe("pickTableOfContentsEntries", () => {
  const headings = readPageHeadings(page(THREE_H2_TWO_H3));

  it("H2 and H3 (the default) lists five links with the H3s one step in", () => {
    const entries = pickTableOfContentsEntries(headings, resolveTableOfContentsSettings({}));
    expect(entries.map((e) => [e.id, e.depth])).toEqual([
      ["juniors", 0],
      ["ages-5-8", 1],
      ["ages-9-12", 1],
      ["adults", 0],
      ["private-lessons", 0]
    ]);
  });

  it("H2 only leaves the three H2s", () => {
    const entries = pickTableOfContentsEntries(headings, resolveTableOfContentsSettings({ headingLevels: "h2" }));
    expect(entries.map((e) => e.id)).toEqual(["juniors", "adults", "private-lessons"]);
  });

  it("all levels includes the H4, two steps in", () => {
    const entries = pickTableOfContentsEntries(headings, resolveTableOfContentsSettings({ headingLevels: "all" }));
    expect(entries.find((e) => e.id === "fees")?.depth).toBe(2);
    expect(entries).toHaveLength(6);
  });

  it("indent off puts every link at depth 0", () => {
    const entries = pickTableOfContentsEntries(headings, resolveTableOfContentsSettings({ indentSubheadings: "false" }));
    expect(entries.every((e) => e.depth === 0)).toBe(true);
  });

  it("counts depth from the shallowest heading listed, so an all-H3 page is not indented", () => {
    const only = [
      { level: 3, id: "a", text: "A" },
      { level: 3, id: "b", text: "B" }
    ];
    expect(pickTableOfContentsEntries(only, resolveTableOfContentsSettings({})).map((e) => e.depth)).toEqual([0, 0]);
  });

  it("never lists an H1", () => {
    const entries = pickTableOfContentsEntries([{ level: 1, id: "t", text: "T" }], resolveTableOfContentsSettings({ headingLevels: "all" }));
    expect(entries).toEqual([]);
  });
});

describe("resolveTableOfContentsSettings", () => {
  it("defaults", () => {
    expect(resolveTableOfContentsSettings(undefined)).toEqual({
      title: "On this page",
      levels: "h2-h3",
      indent: true,
      alignment: "left",
      fontSize: 16,
      color: ""
    });
  });

  it("keeps a title cleared on purpose", () => {
    expect(resolveTableOfContentsSettings({ title: "" }).title).toBe("");
  });

  it("refuses values it does not know", () => {
    const s = resolveTableOfContentsSettings({ headingLevels: "h9", alignment: "middle", fontSize: "900" });
    expect([s.levels, s.alignment, s.fontSize]).toEqual(["h2-h3", "left", 16]);
  });
});

describe("sameHeadings", () => {
  it("compares id, level and words", () => {
    const a = [{ level: 2, id: "x", text: "X" }];
    expect(sameHeadings(a, [{ level: 2, id: "x", text: "X" }])).toBe(true);
    expect(sameHeadings(a, [{ level: 3, id: "x", text: "X" }])).toBe(false);
    expect(sameHeadings(a, [])).toBe(false);
  });
});

describe("tableOfContentsEmptyNote", () => {
  it("says why the list is empty", () => {
    expect(tableOfContentsEmptyNote("h2-h3", false)).toBe(
      "No headings on this page yet. Headings in Text modules and blog posts are listed here."
    );
    expect(tableOfContentsEmptyNote("h2", true)).toContain("No H2 headings");
  });
});
