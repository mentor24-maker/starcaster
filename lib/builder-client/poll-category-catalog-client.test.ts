import { describe, expect, it } from "vitest";
import { parsePollCategoriesApiResponse } from "@/lib/poll-category-catalog-client";

describe("parsePollCategoriesApiResponse", () => {
  it("reads categories from the API data envelope", () => {
    expect(
      parsePollCategoriesApiResponse({
        data: {
          categories: [
            { name: "Money & Success", slug: "money-success" },
            { name: "Archetype Drill", slug: "archetype-drill" }
          ]
        }
      })
    ).toHaveLength(2);
  });

  it("returns empty when the envelope is wrong (no legacy top-level categories)", () => {
    expect(
      parsePollCategoriesApiResponse({
        categories: [{ name: "Legacy Shape", slug: "legacy-shape" }]
      })
    ).toEqual([]);
  });
});
