import { describe, expect, it } from "vitest";
import {
  addressForSlug,
  buildPageAddressMap,
  collectPageLinkIds,
  makePageLink,
  pageLinkHref,
  parsePageLink,
  resolvePageLink,
  resolvePageLinksInSettings
} from "./page-link";

describe("page links stored by reference (task 86bcxmrw2)", () => {
  it("writes and reads back the one stored shape", () => {
    const value = makePageLink("1217", "/fraud");
    expect(value).toBe("page:1217|/fraud");
    expect(parsePageLink(value)).toEqual({ pageId: "1217", fallback: "/fraud" });
  });

  it("follows the page after its address changes — the whole point", () => {
    const value = makePageLink("42", "/about");
    expect(pageLinkHref(value, { "42": "about-v2" })).toBe("/about-v2");
    expect(pageLinkHref(value, new Map([["42", "about-us"]]))).toBe("/about-us");
  });

  it("answers in the shape the fallback has: a path stays a path, a slug stays a slug", () => {
    expect(pageLinkHref(makePageLink("7", "/blog-post-view"), { "7": "post" })).toBe("/post");
    expect(pageLinkHref(makePageLink("7", "blog-post-view"), { "7": "post" })).toBe("post");
    expect(addressForSlug("", "/")).toBe("/");
    expect(addressForSlug("/x", "/old")).toBe("/x");
  });

  it("leaves every value that is not a reference exactly as it was", () => {
    for (const old of ["/about", "about", "https://example.com/x", "", "#", "page:", "page:12", "mailto:a@b.c"]) {
      expect(resolvePageLink(old, { "12": "nope" })).toEqual({ href: old, pageId: "", missing: false });
    }
  });

  it("falls back to the saved address when the page is gone, and says so", () => {
    expect(resolvePageLink("page:9|/gone", { "1": "home" })).toEqual({ href: "/gone", pageId: "9", missing: true });
  });

  it("does not call a page gone when nobody could look", () => {
    expect(resolvePageLink("page:9|/gone", null)).toEqual({ href: "/gone", pageId: "9", missing: false });
  });

  it("resolves a settings object, and returns the same object when nothing needs it", () => {
    const plain = { href: "/about", text: "Hi" };
    expect(resolvePageLinksInSettings(plain, { "1": "x" })).toBe(plain);
    const linked = { href: "page:1|/old", targetPageUrl: "page:2|/search", label: "page:not-a-link" };
    expect(resolvePageLinksInSettings(linked, { "1": "new", "2": "find" })).toEqual({
      href: "/new",
      targetPageUrl: "/find",
      label: "page:not-a-link"
    });
    expect(linked.href).toBe("page:1|/old");
  });

  it("finds references at any depth, including a table's cells stored as JSON text", () => {
    const tableData = JSON.stringify({ cells: { "0-0": [{ settings: { linkUrl: "page:55|/menu" } }] } });
    const ids = collectPageLinkIds([{ modules: [{ settings: { href: "page:3|/a", tableData } }] }]);
    expect([...ids].sort()).toEqual(["3", "55"]);
  });

  it("builds the id → slug map from page records", () => {
    expect(buildPageAddressMap([{ id: 3, slug: "/a" }, { id: "", slug: "b" }, { id: "4", slug: "" }])).toEqual({ "3": "a", "4": "" });
  });
});
