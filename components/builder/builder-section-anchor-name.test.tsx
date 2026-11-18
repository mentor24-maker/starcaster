// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createEmptySection, normalizeLayoutSections, type BuilderTemplateSection } from "@/lib/builder-template";
import { BuilderSectionControls } from "./builder-section-controls";
import { BuilderPageSectionsContext } from "./builder-page-sections-context";
import { BuilderTemplatePreview } from "@/components/builder-template-preview";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A section's "Anchor name" (task SC-852): stored, cleaned, rendered as its id. */
function mount(section: BuilderTemplateSection, pageSections: BuilderTemplateSection[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let latest = section;
  const render = () =>
    root.render(
      <BuilderPageSectionsContext.Provider value={{ pageId: "p1", sections: pageSections.map((s) => (s.id === latest.id ? latest : s)) }}>
        <BuilderSectionControls
          section={latest}
          onUpdateSection={(updater) => {
            latest = updater(latest);
            render();
          }}
        />
      </BuilderPageSectionsContext.Provider>
    );
  act(() => render());
  const input = () => host.querySelector<HTMLInputElement>('input[aria-label="Anchor name"]')!;
  return {
    host,
    input,
    type(text: string) {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input(), text);
        input().dispatchEvent(new Event("input", { bubbles: true }));
      });
      return latest;
    },
    blur() {
      act(() => {
        input().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      return latest;
    },
    unmount: () => act(() => root.unmount())
  };
}

describe("the section panel's Anchor name", () => {
  it("keeps a hyphen while typing, and cleans the name when the box is left", () => {
    const section = { ...createEmptySection(), id: "a" };
    const panel = mount(section, [section]);
    expect(panel.type("Contact ").anchorName).toBe("contact-");
    expect(panel.type("Contact Us!").anchorName).toBe("contact-us");
    expect(panel.type("contact-").anchorName).toBe("contact-");
    expect(panel.blur().anchorName).toBe("contact");
    panel.unmount();
  });

  it("clearing the box removes the key, so the row saves as it did before", () => {
    const section = { ...createEmptySection(), id: "a", anchorName: "x" };
    const panel = mount(section, [section]);
    expect("anchorName" in panel.type("")).toBe(false);
    panel.unmount();
  });

  it("says so when another section on the page already has the name", () => {
    const other = { ...createEmptySection(), id: "b", title: "Footer", anchorName: "contact-us" };
    const section = { ...createEmptySection(), id: "a" };
    const panel = mount(section, [section, other]);
    expect(panel.host.querySelector(".builder-section-anchor-name-taken")).toBeNull();
    panel.type("contact-us");
    const note = panel.host.querySelector(".builder-section-anchor-name-taken");
    expect(note?.textContent).toContain("“contact-us” is already the anchor name of the section “Footer”");
    expect(panel.input().getAttribute("aria-invalid")).toBe("true");
    panel.unmount();
  });
});

describe("an anchor name through save, load and render", () => {
  it("is kept and cleaned by the section normalizer; a section with none gains no key", () => {
    const [named, plain] = normalizeLayoutSections([
      { id: "a", anchorName: " About Us ", modules: [] },
      { id: "b", modules: [] }
    ]);
    expect(named.anchorName).toBe("about-us");
    expect("anchorName" in plain).toBe(false);
  });

  it("renders as the section's id on the page, and no other section gains an id", () => {
    const sections = normalizeLayoutSections([
      { id: "a", anchorName: "services", modules: [] },
      { id: "b", modules: [] }
    ]);
    const html = renderToStaticMarkup(<BuilderTemplatePreview layoutSections={sections} liveSite />);
    expect(html).toMatch(/<section[^>]*\bid="services"/);
    expect((html.match(/<section[^>]*\bid="/g) || []).length).toBe(1);
  });
});
