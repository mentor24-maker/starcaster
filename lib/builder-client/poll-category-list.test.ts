import { describe, expect, it } from "vitest";
import { buildPublicPollCategoryPath } from "@/lib/poll-categories";
import {
  buildPollCategoryListEntries,
  getPollCategoryListEntries,
  orderPollCategoryListForGrid,
  sortPollCategoriesForList
} from "@/lib/poll-category-list";

const SAMPLE_CATALOG = [
  { name: "Absurd but Revealing", slug: "absurd-but-revealing" },
  { name: "Identity & Psychology", slug: "identity-psychology" },
  { name: "Money & Success", slug: "money-success" }
];

describe("poll category list", () => {
  it("sorts categories alphabetically by display name", () => {
    const sorted = sortPollCategoriesForList(SAMPLE_CATALOG, "alphabetical");
    const names = sorted.map((category) => category.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
    expect(names[0]).toBe("Absurd but Revealing");
  });

  it("keeps canonical seed order when requested", () => {
    expect(sortPollCategoriesForList(SAMPLE_CATALOG, "canonical")).toEqual([...SAMPLE_CATALOG]);
  });

  it("links each category to the home page with a category query", () => {
    const entry = getPollCategoryListEntries("canonical", SAMPLE_CATALOG).find(
      (category) => category.slug === "identity-psychology"
    );

    expect(entry?.href).toBe(buildPublicPollCategoryPath({ slug: "identity-psychology" }));
    expect(entry?.href).toBe("/?category=identity-psychology");
  });

  it("orders alphabetized categories down each column before the next", () => {
    const entries = buildPollCategoryListEntries(
      [
        { name: "Alpha", slug: "alpha" },
        { name: "Beta", slug: "beta" },
        { name: "Gamma", slug: "gamma" },
        { name: "Delta", slug: "delta" },
        { name: "Epsilon", slug: "epsilon" },
        { name: "Zeta", slug: "zeta" }
      ],
      "alphabetical"
    );

    expect(orderPollCategoryListForGrid(entries, "columns", 3).map((entry) => entry.name)).toEqual([
      "Alpha",
      "Delta",
      "Gamma",
      "Beta",
      "Epsilon",
      "Zeta"
    ]);
  });
});
