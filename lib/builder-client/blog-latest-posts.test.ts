import { describe, expect, it } from "vitest";
import { createEmptyModule, normalizeLayoutSections } from "./builder-template";
import {
  hasNoFilterChosen,
  latestPostsEmptyReason,
  resolveLatestPostsSettings,
  selectLatestPosts
} from "./blog-latest-posts";

type Post = { id: string; published_at?: string; tags?: string[]; categoryIds?: string[] };

const posts: Post[] = [
  { id: "old", published_at: "2026-01-05T10:00:00Z", tags: ["Junior Tennis"], categoryIds: ["c-juniors"] },
  { id: "newest", published_at: "2026-09-10T10:00:00Z", tags: ["pickleball"] },
  { id: "middle", published_at: "2026-05-01T10:00:00Z", tags: ["clinics", "junior tennis"] },
  { id: "undated", tags: ["junior tennis"] },
  { id: "recent", published_at: "2026-08-20T10:00:00Z", categoryIds: ["c-adults"] }
];

const ids = (list: Post[]) => list.map((p) => p.id);

describe("blog-latest-posts: which posts the row shows", () => {
  it("defaults to the newest published posts, newest first, capped at the count", () => {
    const s = resolveLatestPostsSettings({ count: "3" });
    expect(s.latest).toBe(true);
    // Deliberately handed over out of order: the order is the module's job.
    expect(ids(selectLatestPosts(posts, s))).toEqual(["newest", "recent", "middle"]);
  });

  it("ignores chosen tags while Latest posts is ticked", () => {
    const s = resolveLatestPostsSettings({ latestPosts: "true", filterTags: '["clinics"]', count: "2" });
    expect(ids(selectLatestPosts(posts, s))).toEqual(["newest", "recent"]);
  });

  it("unticked, keeps posts with ANY chosen tag, matched regardless of capitalisation", () => {
    const s = resolveLatestPostsSettings({ latestPosts: "false", filterTags: '["junior tennis"]', count: "10" });
    expect(ids(selectLatestPosts(posts, s))).toEqual(["middle", "old", "undated"]);
  });

  it("unticked, a tag OR a category is enough", () => {
    const s = resolveLatestPostsSettings({
      latestPosts: "false",
      filterTags: '["pickleball"]',
      filterCategories: '["c-adults"]',
      count: "10"
    });
    expect(ids(selectLatestPosts(posts, s))).toEqual(["newest", "recent"]);
  });

  it("unticked with nothing chosen shows nothing, and says why", () => {
    const s = resolveLatestPostsSettings({ latestPosts: "false" });
    expect(hasNoFilterChosen(s)).toBe(true);
    expect(selectLatestPosts(posts, s)).toEqual([]);
    expect(latestPostsEmptyReason(s, { publishedCount: 5, categoryNames: {} })).toMatch(/tick Latest posts/);
  });

  it("names every chosen value when a filter matches nothing", () => {
    const s = resolveLatestPostsSettings({
      latestPosts: "false",
      filterTags: '["doubles"]',
      filterCategories: '["c-x"]'
    });
    expect(selectLatestPosts(posts, s)).toEqual([]);
    expect(latestPostsEmptyReason(s, { publishedCount: 5, categoryNames: { "c-x": "Leagues" } })).toBe(
      "Latest Blog Posts: no published posts tagged “doubles” or in the category “Leagues”."
    );
  });

  it("clamps nonsense settings instead of rendering nothing", () => {
    const s = resolveLatestPostsSettings({ count: "abc", columns: "9", filterTags: "not json" });
    expect(s.count).toBe(3);
    expect(s.columns).toBe(4);
    expect(s.tags).toEqual([]);
  });
});

describe("blog-latest-posts: heading style", () => {
  it("a module saved before the setting existed keeps an h2 in the site colour", () => {
    const s = resolveLatestPostsSettings({ title: "Latest" });
    expect(s.headingLevel).toBe("h2");
    expect(s.headingColor).toBe("");
  });

  it("reads a chosen level and colour, and refuses a tag that is not a heading", () => {
    expect(resolveLatestPostsSettings({ headingLevel: "H4", headingColor: "#ff0000" })).toMatchObject({
      headingLevel: "h4",
      headingColor: "#ff0000"
    });
    expect(resolveLatestPostsSettings({ headingLevel: "script" }).headingLevel).toBe("h2");
  });
});

describe("blog-latest-posts: registration", () => {
  it("a new module from the palette starts in Latest posts mode", () => {
    const created = createEmptyModule("blog-latest-posts");
    expect(created.type).toBe("blog-latest-posts");
    expect(created.settings.latestPosts).toBe("true");
    expect(created.settings.count).toBe("3");
  });

  it("a saved module keeps its type through normalization (not coerced to text)", () => {
    const [section] = normalizeLayoutSections([
      {
        id: "s1",
        title: "",
        layout: "single",
        modules: [{ id: "m1", type: "blog-latest-posts", column: "main", text: "", settings: { count: "4" } }]
      }
    ]);
    expect(section.modules[0].type).toBe("blog-latest-posts");
  });
});
