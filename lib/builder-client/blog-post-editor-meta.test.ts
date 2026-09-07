import { describe, expect, it } from "vitest";
import {
  blogPostViewHref,
  blogPostViewLink,
  dateInputToPublishedAt,
  pickPostPagePath,
  publishedAtToDateInput
} from "./blog-post-editor-meta";

/** The local day a Date falls on, in the picker's format — computed the same way a browser would. */
function localDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

describe("publishedAtToDateInput", () => {
  it("shows the LOCAL day the stamp falls on, which is the day the post page prints", () => {
    // A stamp near midnight UTC lands on different days in different zones;
    // the picker must agree with toLocaleDateString, not with the Z clock.
    const iso = "2026-04-16T03:30:00.000Z";
    expect(publishedAtToDateInput(iso)).toBe(localDay(new Date(iso)));
  });

  it("is blank for no stamp and for one that does not parse", () => {
    expect(publishedAtToDateInput(null)).toBe("");
    expect(publishedAtToDateInput(undefined)).toBe("");
    expect(publishedAtToDateInput("")).toBe("");
    expect(publishedAtToDateInput("not a date")).toBe("");
  });
});

describe("dateInputToPublishedAt", () => {
  it("leaves the key out when the day is unchanged, so the stored time of day survives", () => {
    const iso = "2026-04-15T21:07:44.000Z";
    expect(dateInputToPublishedAt(publishedAtToDateInput(iso), iso)).toBeUndefined();
  });

  it("leaves the key out for a blank field on a post that never had a date (the store stamps publish time)", () => {
    expect(dateInputToPublishedAt("", null)).toBeUndefined();
    expect(dateInputToPublishedAt("", undefined)).toBeUndefined();
  });

  it("sends null when a dated post has its date cleared", () => {
    expect(dateInputToPublishedAt("", "2026-04-15T21:07:44.000Z")).toBeNull();
  });

  it("stamps a changed day at local noon, so the day reads back the same after the UTC round trip", () => {
    const out = dateInputToPublishedAt("2026-04-15", "2026-03-01T12:00:00.000Z");
    expect(typeof out).toBe("string");
    const back = new Date(out as string);
    expect(localDay(back)).toBe("2026-04-15");
    expect(back.getHours()).toBe(12);
    // And the picker shows the same day again on reload.
    expect(publishedAtToDateInput(out)).toBe("2026-04-15");
  });

  it("ignores a value the picker could not have produced rather than sending garbage", () => {
    expect(dateInputToPublishedAt("15/04/2026", "2026-03-01T12:00:00.000Z")).toBeUndefined();
  });
});

describe("blogPostViewHref", () => {
  it("appends ?post=<slug>, or &post= when the base already carries a query", () => {
    expect(blogPostViewHref("/blog-post", "my-post")).toBe("/blog-post?post=my-post");
    expect(blogPostViewHref("/blog-post?x=1", "my-post")).toBe("/blog-post?x=1&post=my-post");
  });

  it("URL-encodes the slug and refuses to build a link with either half missing", () => {
    expect(blogPostViewHref("/blog-post", "a b&c")).toBe("/blog-post?post=a%20b%26c");
    expect(blogPostViewHref("", "my-post")).toBe("");
    expect(blogPostViewHref("/blog-post", "")).toBe("");
  });
});

describe("blogPostViewLink", () => {
  it("links a published post to the live page and says so", () => {
    const link = blogPostViewLink("/blog-post", { slug: "hello", status: "published" });
    expect(link?.href).toBe("/blog-post?post=hello");
    expect(link?.live).toBe(true);
    expect(link?.label).toBe("View live post");
  });

  it("links a draft to the same page as a preview, and warns that only the signed-in editor can see it", () => {
    const link = blogPostViewLink("/blog-post", { slug: "hello", status: "draft" });
    expect(link?.href).toBe("/blog-post?post=hello");
    expect(link?.live).toBe(false);
    expect(link?.label).toBe("Preview draft");
    expect(link?.title).toMatch(/signed in/);
  });

  it("offers no link before a post has been saved — it has no address yet", () => {
    expect(blogPostViewLink("/blog-post", null)).toBeNull();
    expect(blogPostViewLink("/blog-post", { slug: "", status: "draft" })).toBeNull();
  });
});

describe("pickPostPagePath", () => {
  it("prefers the platform default when the site has it", async () => {
    const path = await pickPostPagePath(async () => true);
    expect(path).toBe("/blog-post-view");
  });

  it("falls through to the blog template's page when the default does not exist — Delray's shape", async () => {
    const asked: string[] = [];
    const path = await pickPostPagePath(async (slug) => { asked.push(slug); return slug === "blog-post"; });
    expect(path).toBe("/blog-post");
    expect(asked).toEqual(["blog-post-view", "blog-post"]);
  });

  it("answers null, not a guess, when the site has neither", async () => {
    expect(await pickPostPagePath(async () => false)).toBeNull();
  });

  it("treats a probe that throws as a no and keeps looking", async () => {
    const path = await pickPostPagePath(async (slug) => {
      if (slug === "blog-post-view") throw new Error("network");
      return true;
    });
    expect(path).toBe("/blog-post");
  });
});
