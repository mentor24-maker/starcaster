import { describe, expect, it } from "vitest";

// The helper is public/shared/pageSort.js, not a file in this folder: it has to
// be ONE rule across two runtimes (the React builder bundles it; the frozen
// vanilla admin app reaches it as window.App.pageSort), and public/shared/ is
// the repo's answer to exactly that. The test lives here because this is where
// vitest looks — and it is a hand-written committed file, not a generated
// server lib, so landmine 14 does not apply.
import { comparePageNames, pageSortKey, sortPagesByName } from "../../public/shared/pageSort.js";

type Page = { id?: string; name?: string; slug?: string };

const names = (pages: Page[]) => pages.map((page) => page.name ?? page.slug ?? "(nothing)");

describe("sortPagesByName", () => {
  it("orders pages A→Z", () => {
    const sorted = sortPagesByName([
      { name: "Welcome to Delray Beach Tennis Center" },
      { name: "Events Details" },
      { name: "Tennis Drills & Clinics" }
    ]);
    // The operator's actual complaint: on the Post Page picker, "Tennis Drills"
    // sat between "Events Details" and "Welcome…" only because that is roughly
    // the order the pages were created in.
    expect(names(sorted)).toEqual([
      "Events Details",
      "Tennis Drills & Clinics",
      "Welcome to Delray Beach Tennis Center"
    ]);
  });

  it("does not split the list by case", () => {
    // What this actually defends: a naive `a < b` comparison, which sorts every
    // capitalised name as one block ahead of every lowercase one and reads as
    // two lists. Break-tested — swapping localeCompare for `<` fails this.
    // Being straight about the limit: removing `sensitivity: "base"` alone does
    // NOT fail this test, because localeCompare already folds case at the level
    // that decides order. The option is belt-and-braces, not what is under test.
    const sorted = sortPagesByName([
      { name: "banner" },
      { name: "About Us" },
      { name: "about" },
      { name: "Banner" }
    ]);
    const order = names(sorted);
    expect(order.slice(0, 2).map((n) => n.toLowerCase())).toEqual(["about", "about us"]);
    expect(order.slice(2).map((n) => n.toLowerCase())).toEqual(["banner", "banner"]);
  });

  it("orders numbers naturally, so Page 2 comes before Page 10", () => {
    const sorted = sortPagesByName([
      { name: "Page 10" },
      { name: "Page 2" },
      { name: "Page 1" }
    ]);
    expect(names(sorted)).toEqual(["Page 1", "Page 2", "Page 10"]);
  });

  it("files a page with no name under its slug", () => {
    const sorted = sortPagesByName([
      { name: "Zebra" },
      { slug: "apple-orchard" },
      { name: "Mango" }
    ]);
    expect(names(sorted)).toEqual(["apple-orchard", "Mango", "Zebra"]);
  });

  it("sends a page with neither name nor slug to the END, not the top", () => {
    // Plain string ordering puts "" first, which would park the least useful
    // row where the operator looks first.
    const sorted = sortPagesByName([
      { name: "Zebra", id: "z" },
      { id: "orphan" },
      { name: "Apple", id: "a" }
    ]);
    expect(sorted[sorted.length - 1]!.id).toBe("orphan");
    expect(names(sorted).slice(0, 2)).toEqual(["Apple", "Zebra"]);
  });

  it("keeps equal names in the order they arrived", () => {
    const sorted = sortPagesByName([
      { name: "Home", id: "second" },
      { name: "Home", id: "first" }
    ]);
    expect(sorted.map((page: Page) => page.id)).toEqual(["second", "first"]);
  });

  it("never reorders the caller's array — the sort is display-only", () => {
    // The array handed in is the store's array. Reordering it in place would
    // change what every other reader sees.
    const original: Page[] = [{ name: "Zebra" }, { name: "Apple" }];
    const sorted = sortPagesByName(original);
    expect(names(original)).toEqual(["Zebra", "Apple"]);
    expect(names(sorted)).toEqual(["Apple", "Zebra"]);
    expect(sorted).not.toBe(original);
  });

  it("sorts by a caller-supplied name when the list is not page records", () => {
    // Campaigns holds { value, label } option objects, not pages.
    const options = [
      { value: "b", label: "Builder: Zebra" },
      { value: "a", label: "Builder: Apple" }
    ];
    const sorted = sortPagesByName(options, (option: { label: string }) => option.label);
    expect(sorted.map((option: { value: string }) => option.value)).toEqual(["a", "b"]);
  });

  it("survives a list that is not a list", () => {
    expect(sortPagesByName(null)).toEqual([]);
    expect(sortPagesByName(undefined)).toEqual([]);
  });
});

describe("pageSortKey", () => {
  it("prefers the name, falls back to the slug, then to nothing", () => {
    expect(pageSortKey({ name: "Home", slug: "home-page" })).toBe("Home");
    expect(pageSortKey({ slug: "home-page" })).toBe("home-page");
    expect(pageSortKey({ id: "abc" })).toBe("");
    expect(pageSortKey(null)).toBe("");
  });

  it("ignores surrounding whitespace, so a padded name still sorts as itself", () => {
    expect(pageSortKey({ name: "  Home  " })).toBe("Home");
    expect(pageSortKey({ name: "   ", slug: "home" })).toBe("home");
  });
});

describe("comparePageNames", () => {
  it("puts an empty name after a real one, both ways round", () => {
    expect(comparePageNames("", "Apple")).toBeGreaterThan(0);
    expect(comparePageNames("Apple", "")).toBeLessThan(0);
    expect(comparePageNames("", "")).toBe(0);
  });
});
