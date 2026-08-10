import { describe, expect, it } from "vitest";
import {
  buildMegaColumns,
  eligibleNavParents,
  isNavDescendantOf,
  navDepthOf,
  navSubtreeHeight,
  type NavMegaItem
} from "@/lib/builder-nav-mega";

/** The blazefish.com "Play" menu, in our flat parentId shape. */
const PLAY_MENU: NavMegaItem[] = [
  { id: "play", label: "Play", href: "/play" },
  { id: "play-col", label: "Play", href: "", parentId: "play" },
  { id: "book", label: "Book a Court", href: "/book", parentId: "play-col" },
  { id: "fees", label: "Court Fees", href: "/fees", parentId: "play-col" },
  { id: "popular", label: "Popular", href: "", parentId: "play" },
  { id: "week", label: "This Week", href: "/week", parentId: "popular" }
];

const childrenIn = (items: NavMegaItem[]) => (parentId: string) =>
  items.filter((item) => item.parentId === parentId);

describe("buildMegaColumns", () => {
  it("turns level-2 items into column headings and level-3 into their links", () => {
    const children = PLAY_MENU.filter((item) => item.parentId === "play");
    const columns = buildMegaColumns(children, childrenIn(PLAY_MENU), 3);

    expect(columns).toHaveLength(2);
    expect(columns[0].heading?.label).toBe("Play");
    expect(columns[0].links.map((link) => link.label)).toEqual(["Book a Court", "Court Fees"]);
    expect(columns[1].heading?.label).toBe("Popular");
    expect(columns[1].links.map((link) => link.label)).toEqual(["This Week"]);
  });

  it("deals a flat two-level menu into headless columns", () => {
    const items: NavMegaItem[] = [
      { id: "a", label: "A", href: "/a", parentId: "top" },
      { id: "b", label: "B", href: "/b", parentId: "top" },
      { id: "c", label: "C", href: "/c", parentId: "top" },
      { id: "d", label: "D", href: "/d", parentId: "top" }
    ];
    const columns = buildMegaColumns(items, childrenIn(items), 2);

    expect(columns).toHaveLength(2);
    expect(columns.every((column) => column.heading === null)).toBe(true);
    expect(columns[0].links.map((link) => link.label)).toEqual(["A", "B"]);
    expect(columns[1].links.map((link) => link.label)).toEqual(["C", "D"]);
  });

  it("does not lose an item when the count divides unevenly", () => {
    const items: NavMegaItem[] = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      label: id.toUpperCase(),
      href: `/${id}`,
      parentId: "top"
    }));
    const columns = buildMegaColumns(items, childrenIn(items), 3);

    expect(columns.flatMap((column) => column.links)).toHaveLength(5);
  });

  it("returns no columns for an empty menu rather than one empty column", () => {
    expect(buildMegaColumns([], childrenIn([]), 3)).toEqual([]);
  });
});

describe("nav depth helpers", () => {
  it("reports depth from the top level down", () => {
    expect(navDepthOf(PLAY_MENU, PLAY_MENU[0])).toBe(0);
    expect(navDepthOf(PLAY_MENU, PLAY_MENU[1])).toBe(1);
    expect(navDepthOf(PLAY_MENU, PLAY_MENU[2])).toBe(2);
  });

  it("measures how far a subtree hangs below an item", () => {
    expect(navSubtreeHeight(PLAY_MENU, "play")).toBe(2);
    expect(navSubtreeHeight(PLAY_MENU, "play-col")).toBe(1);
    expect(navSubtreeHeight(PLAY_MENU, "book")).toBe(0);
  });

  it("survives a parentId cycle instead of hanging", () => {
    const cyclic: NavMegaItem[] = [
      { id: "x", label: "X", href: "", parentId: "y" },
      { id: "y", label: "Y", href: "", parentId: "x" }
    ];

    expect(() => navDepthOf(cyclic, cyclic[0])).not.toThrow();
    expect(() => navSubtreeHeight(cyclic, "x")).not.toThrow();
    expect(() => isNavDescendantOf(cyclic, "x", "y")).not.toThrow();
  });
});

describe("eligibleNavParents", () => {
  it("offers a level-2 item as a parent, which the old two-level rule could not", () => {
    const loose: NavMegaItem = { id: "new", label: "New Link", href: "/new" };
    const options = eligibleNavParents([...PLAY_MENU, loose], loose).map((item) => item.id);

    expect(options).toContain("play");
    expect(options).toContain("play-col");
  });

  it("refuses a parent that would push the menu past three levels", () => {
    // "book" already sits at depth 2; nothing may be filed under it.
    const loose: NavMegaItem = { id: "new", label: "New Link", href: "/new" };
    const options = eligibleNavParents([...PLAY_MENU, loose], loose).map((item) => item.id);

    expect(options).not.toContain("book");
  });

  it("accounts for the moved item's own children, not just its new depth", () => {
    // "play-col" carries one level of children, so it may only be filed
    // under a top-level item — never under another level-2 item.
    const options = eligibleNavParents(PLAY_MENU, PLAY_MENU[1]).map((item) => item.id);

    expect(options).toContain("play");
    expect(options).not.toContain("popular");
  });

  it("never offers an item's own descendant as its parent", () => {
    const options = eligibleNavParents(PLAY_MENU, PLAY_MENU[0]).map((item) => item.id);

    expect(options).not.toContain("play-col");
    expect(options).not.toContain("book");
  });
});
