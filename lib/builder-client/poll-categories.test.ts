import { describe, expect, it } from "vitest";
import {
  buildPollsNextRequestUrl,
  buildPublicPollCategoryPath,
  buildPublicPollViewPath,
  formatPollCategoryDisplayName,
  getPollCategoryMeta,
  pollCategoriesEqual,
  pollCategorySlugMatchesAny,
  resolvePollCategoryName,
  slugifyPollCategory
} from "@/lib/poll-categories";

const SAMPLE_CATALOG = [
  { name: "Identity & Psychology", slug: "identity-psychology" },
  { name: "Self-Perception", slug: "self-perception" },
  { name: "Future / Power", slug: "future-power" }
];

describe("poll category helpers", () => {
  it("resolves category slugs to display names from catalog", () => {
    expect(resolvePollCategoryName("self-perception", SAMPLE_CATALOG)).toBe("Self-Perception");
    expect(resolvePollCategoryName("identity-psychology", SAMPLE_CATALOG)).toBe("Identity & Psychology");
  });

  it("accepts canonical category names in the URL", () => {
    expect(resolvePollCategoryName("Self-Perception", SAMPLE_CATALOG)).toBe("Self-Perception");
  });

  it("formats slug-style categories for headlines", () => {
    expect(formatPollCategoryDisplayName("core-personality")).toBe("Core Personality");
    expect(formatPollCategoryDisplayName("identity-psychology")).toBe("Identity Psychology");
  });

  it("resolves uppercase and lowercase labels to the same canonical name", () => {
    expect(resolvePollCategoryName("SELF-PERCEPTION", SAMPLE_CATALOG)).toBe("Self-Perception");
    expect(resolvePollCategoryName("identity & psychology", SAMPLE_CATALOG)).toBe("Identity & Psychology");
    expect(pollCategoriesEqual("SELF-PERCEPTION", "self-perception")).toBe(true);
    expect(slugifyPollCategory("IDENTITY & PSYCHOLOGY")).toBe("identity-psychology");
  });

  it("maps known aliases used in navigation", () => {
    expect(resolvePollCategoryName("future-and-past")).toBe("Future / Power");
  });

  it("returns category meta for headlines and API responses", () => {
    expect(getPollCategoryMeta("self-perception", SAMPLE_CATALOG)).toEqual({
      name: "Self-Perception",
      slug: "self-perception"
    });
  });

  it("matches preferred category slugs", () => {
    expect(pollCategorySlugMatchesAny("endurance-athletics", ["endurance-athletics"])).toBe(true);
    expect(pollCategorySlugMatchesAny("Endurance Athletics", ["endurance-athletics"])).toBe(true);
    expect(slugifyPollCategory("scenario")).toBe("scenario");
    expect(slugifyPollCategory("Scenarios")).toBe("scenarios");
  });

  it("builds polls/next URL with category and startPoll", () => {
    expect(buildPollsNextRequestUrl(null, "550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/api/polls/next?startPoll=550e8400-e29b-41d4-a716-446655440000"
    );
    expect(buildPollsNextRequestUrl("identity-psychology", "550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/api/polls/next?category=identity-psychology&startPoll=550e8400-e29b-41d4-a716-446655440000"
    );
  });

  it("builds home page path for a category filter", () => {
    expect(buildPublicPollCategoryPath({ slug: "dark-truth" })).toBe("/?category=dark-truth");
  });

  it("builds public poll view path with startPoll only", () => {
    expect(
      buildPublicPollViewPath({
        id: "550e8400-e29b-41d4-a716-446655440000"
      })
    ).toBe("/?startPoll=550e8400-e29b-41d4-a716-446655440000");
  });
});
