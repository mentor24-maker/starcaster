// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

/**
 * A link typed inside rich text pointing at a SECTION of a page (task SC-853,
 * done-means 2). It uses the shape SC-852 built for menus: the section by id,
 * its anchor name only as today's fallback address.
 */
vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: async () => ({
    json: async () => ({
      pages: [
        { id: "12", name: "About", slug: "about", layoutSections: [] },
        { id: "20", name: "Team", slug: "team", layoutSections: [{ id: "s-bios", anchorName: "bios", title: "Bios" }] }
      ]
    })
  })
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { initialLinkChoice, linkValueForChoice, PageLink, RichTextLinkDialog, type RichTextLinkValue } from "./rich-text-page-link";

const TEAM = { id: "20", label: "Team", slug: "team", path: "/team", sections: [{ sectionId: "s-bios", anchorName: "bios", title: "Bios" }] };

describe("a rich-text link to a section of a page", () => {
  it("stores the section by id, with today's address as the href", () => {
    expect(linkValueForChoice("page", TEAM, "", TEAM.sections[0])).toEqual({
      href: "/team#bios",
      pageLink: "page:20#s-bios|/team#bios"
    });
  });

  it("opens on the section the link already names", () => {
    expect(initialLinkChoice({ href: "/team#bios", pageLink: "page:20#s-bios|/team#bios" }, [TEAM])).toEqual({
      mode: "page",
      pageId: "20",
      missingFallback: "",
      sectionId: "s-bios"
    });
  });

  it("keeps the section reference when the text is opened and saved again", () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ link: false }), PageLink.configure({ openOnClick: false })],
      content: '<p><a href="/team#bios" data-page-link="page:20#s-bios|/team#bios">Bios</a></p>'
    });
    const out = editor.getHTML();
    editor.destroy();
    expect(out).toContain('data-page-link="page:20#s-bios|/team#bios"');
  });

  it("the dialog offers the chosen page's named sections, and Apply saves the one picked", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let applied: RichTextLinkValue | null = null;
    await act(async () => {
      root.render(
        <RichTextLinkDialog
          current={{ href: "/team", pageLink: "page:20|/team" }}
          onApply={(value) => {
            applied = value;
          }}
          onRemove={() => {}}
          onClose={() => {}}
        />
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const section = host.querySelector<HTMLSelectElement>('select[aria-label="Section"]');
    expect(section, "a Section list once a page with named sections is chosen").not.toBeNull();
    expect([...section!.options].map((option) => option.textContent)).toEqual(["Top of the page", "#bios — Bios"]);
    act(() => {
      section!.value = "s-bios";
      section!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const apply = [...host.querySelectorAll("button")].find((button) => button.textContent === "Apply")!;
    act(() => apply.click());
    expect(applied).toEqual({ href: "/team#bios", pageLink: "page:20#s-bios|/team#bios" });

    // A page with no named sections shows no Section list.
    const page = host.querySelector<HTMLSelectElement>('select[aria-label="Page"]')!;
    act(() => {
      page.value = "12";
      page.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector('select[aria-label="Section"]')).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});
