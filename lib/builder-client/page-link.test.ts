import { describe, expect, it } from "vitest";
import {
  addressForSlug,
  buildPageAddressMap,
  collectPageLinkIds,
  makePageLink,
  pageLinkHref,
  parsePageLink,
  resolvePageLink,
  resolvePageLinksInHtml,
  resolvePageLinksInJsonText,
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

  describe("links inside a list stored as JSON text — menus, cards, slides (task 86bcxmt5x)", () => {
    const navItems = JSON.stringify([
      { id: "a", label: "About", href: makePageLink("42", "/about") },
      { id: "b", label: "Shop", href: "https://shop.example.com" },
      { id: "c", label: "Old", href: "/typed-path", parentId: "a" }
    ]);

    it("a menu item follows its page after the page's address changes", () => {
      const out = resolvePageLinksInSettings({ navItems }, { "42": "about-v2" });
      const items = JSON.parse(out.navItems);
      expect(items[0].href).toBe("/about-v2");
    });

    it("leaves typed addresses and external links exactly as they were", () => {
      const out = JSON.parse(resolvePageLinksInSettings({ navItems }, { "42": "x" }).navItems);
      expect(out[1].href).toBe("https://shop.example.com");
      expect(out[2]).toEqual({ id: "c", label: "Old", href: "/typed-path", parentId: "a" });
    });

    it("uses the saved address when the page is gone", () => {
      const out = JSON.parse(resolvePageLinksInSettings({ navItems }, {}).navItems);
      expect(out[0].href).toBe("/about");
    });

    it("resolves at any depth, including a module stored inside a menu item", () => {
      const text = JSON.stringify([{ id: "a", featureModule: { settings: { href: makePageLink("7", "/x") } } }]);
      expect(JSON.parse(resolvePageLinksInJsonText(text, { "7": "y" }))[0].featureModule.settings.href).toBe("/y");
    });

    it("survives a fallback with quotes and backslashes in it", () => {
      const text = JSON.stringify([{ linkUrl: makePageLink("9", '/a"b\\c') }]);
      expect(JSON.parse(resolvePageLinksInJsonText(text, {}))[0].linkUrl).toBe('/a"b\\c');
      expect(JSON.parse(resolvePageLinksInJsonText(text, { "9": "z" }))[0].linkUrl).toBe("/z");
    });

    it("returns the same settings object when no list holds a reference", () => {
      const settings = { navItems: JSON.stringify([{ href: "/a" }]), text: "Visit page:1|x today" };
      expect(resolvePageLinksInSettings(settings, { "1": "q" })).toBe(settings);
    });

    it("does not touch prose that merely mentions a reference", () => {
      expect(resolvePageLinksInJsonText('see "page:1|/a" here', { "1": "q" })).toBe('see "page:1|/a" here');
    });

    it("the server finds the ids inside a menu, so it can send their addresses", () => {
      expect([...collectPageLinkIds({ settings: { navItems } })]).toEqual(["42"]);
    });
  });
});


describe("links typed inside rich text (task 86bcxthq5)", () => {
  const html =
    '<p>See <a href="/old-menu" data-page-link="page:42|/old-menu" rel="noopener noreferrer">the menu</a>, ' +
    '<a href="/typed">typed</a> and <a href="https://x.example/">out</a>.</p>';

  it("points a picked page at its current address and leaves every other byte alone", () => {
    const next = resolvePageLinksInHtml(html, { "42": "menu-v2" });
    expect(next).toBe(html.replace('href="/old-menu"', 'href="/menu-v2"'));
  });

  it("returns the same string when nothing is a picked page", () => {
    const plain = '<p><a href="/typed">typed</a></p>';
    expect(resolvePageLinksInHtml(plain, { "42": "x" })).toBe(plain);
  });

  it("keeps the saved address for a deleted page, and when nobody could look", () => {
    expect(resolvePageLinksInHtml(html, { "9": "other" })).toBe(html);
    expect(resolvePageLinksInHtml(html, null)).toBe(html);
  });

  it("reads single-quoted and entity-encoded attributes, and adds an href when there was none", () => {
    expect(resolvePageLinksInHtml("<a data-page-link='page:42|/a'>x</a>", { "42": "b&c" })).toBe(
      '<a href="/b&amp;c" data-page-link=\'page:42|/a\'>x</a>'
    );
  });

  it("ignores an attribute that is not a reference", () => {
    const odd = '<a href="/x" data-page-link="javascript:alert(1)">x</a>';
    expect(resolvePageLinksInHtml(odd, { "42": "y" })).toBe(odd);
  });

  it("resolves rich text held in a setting, but never reads JSON text as HTML", () => {
    expect(resolvePageLinksInSettings({ body: html }, { "42": "menu-v2" }).body).toContain('href="/menu-v2"');
    const json = JSON.stringify([{ html }]);
    expect(resolvePageLinksInSettings({ items: json }, { "42": "menu-v2" }).items).toBe(json);
  });

  it("the server finds the id inside rich text, so the live page is sent its address", () => {
    expect([...collectPageLinkIds([{ modules: [{ text: html }] }])]).toEqual(["42"]);
  });
});
