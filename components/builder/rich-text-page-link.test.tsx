// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import type { BuilderPickerOption } from "./builder-project-data-picker";
import { initialLinkChoice, linkValueForChoice, PageLink } from "./rich-text-page-link";

const PAGES: BuilderPickerOption[] = [
  { id: "12", label: "About", slug: "about", path: "/about" },
  { id: "13", label: "Menu", slug: "menu", path: "/menu" }
];

function roundTrip(html: string) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), PageLink.configure({ openOnClick: false })],
    content: html
  });
  const out = editor.getHTML();
  editor.destroy();
  return out;
}

describe("a link picked from the page list survives the editor (task 86bcxthq5)", () => {
  it("keeps the page id when the text is opened and saved again", () => {
    const out = roundTrip('<p><a href="/about" data-page-link="page:12|/about">About</a></p>');
    expect(out).toContain('data-page-link="page:12|/about"');
    expect(out).toContain('href="/about"');
  });

  it("leaves a typed address without one", () => {
    expect(roundTrip('<p><a href="https://x.example/">x</a></p>')).not.toContain("data-page-link");
  });

  it("drops a value that is not a reference", () => {
    expect(roundTrip('<p><a href="/x" data-page-link="nonsense">x</a></p>')).not.toContain("data-page-link");
  });
});

describe("the Link dialog's choices", () => {
  it("saves a picked page by id with today's address as the href", () => {
    expect(linkValueForChoice("page", PAGES[0], "")).toEqual({ href: "/about", pageLink: "page:12|/about" });
  });

  it("saves a typed address as just an address", () => {
    expect(linkValueForChoice("web", undefined, " https://x.example/ ")).toEqual({ href: "https://x.example/", pageLink: null });
    expect(linkValueForChoice("web", undefined, "  ")).toBeNull();
    expect(linkValueForChoice("page", undefined, "")).toBeNull();
  });

  it("opens on the page a link already points at, by id, whatever its saved address", () => {
    expect(initialLinkChoice({ href: "/old", pageLink: "page:13|/old" }, PAGES)).toEqual({ mode: "page", pageId: "13", missingFallback: "" });
  });

  it("says when the linked page is gone", () => {
    expect(initialLinkChoice({ href: "/gone", pageLink: "page:99|/gone" }, PAGES)).toEqual({ mode: "page", pageId: "99", missingFallback: "/gone" });
  });

  it("opens an old typed address that IS a page on that page, and anything else as a web address", () => {
    expect(initialLinkChoice({ href: "/menu", pageLink: null }, PAGES).pageId).toBe("13");
    expect(initialLinkChoice({ href: "https://x.example/", pageLink: null }, PAGES).mode).toBe("web");
    expect(initialLinkChoice({ href: "", pageLink: null }, []).mode).toBe("web");
  });
});
