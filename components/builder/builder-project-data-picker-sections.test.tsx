// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

/**
 * A menu item linking to a SECTION of a page (task SC-852): once a page is
 * chosen, the picker offers that page's named sections, and what it stores is
 * the section's id — never a copy of its name.
 */
vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: async () => ({
    json: async () => ({
      pages: [
        {
          id: "1571",
          name: "Home",
          slug: "",
          layoutSections: { sections: [{ id: "s-about", anchorName: "about-us", title: "About" }, { id: "s-plain" }] }
        },
        { id: "20", name: "Team", slug: "team", layoutSections: [{ id: "s-bios", anchorName: "bios" }] }
      ]
    })
  })
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { BuilderProjectDataPicker, pickerOptionValue, pickerSectionsFor } from "./builder-project-data-picker";
import { BuilderPageSectionsContext } from "./builder-page-sections-context";
import { createEmptySection } from "@/lib/builder-template";

async function mount(value: string, editing: { pageId: string; sections: ReturnType<typeof createEmptySection>[] } | null) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let latest = value;
  const render = (current: string) =>
    root.render(
      <BuilderPageSectionsContext.Provider value={editing}>
        <BuilderProjectDataPicker
          source="pages"
          valueKind="path"
          allowSections
          value={current}
          onChange={(next) => {
            latest = next;
          }}
          noneLabel="— No link —"
          ariaLabel="Menu link"
        />
      </BuilderPageSectionsContext.Provider>
    );
  await act(async () => {
    render(value);
  });
  // Let the page list resolve.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    host,
    sectionSelect: () => host.querySelector<HTMLSelectElement>('select[aria-label="Menu link (section)"]'),
    pick(select: HTMLSelectElement, next: string) {
      act(() => {
        select.value = next;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return latest;
    },
    unmount: () => act(() => root.unmount())
  };
}

describe("a menu link to a section of a page", () => {
  it("offers the chosen page's named sections, and stores the section by id", async () => {
    const picker = await mount("page:20|/team", null);
    const select = picker.sectionSelect();
    expect(select).not.toBeNull();
    expect([...select!.options].map((option) => option.textContent)).toEqual(["Top of the page", "#bios"]);
    expect(picker.pick(select!, "s-bios")).toBe("page:20#s-bios|/team#bios");
    picker.unmount();
  });

  it("shows the stored section selected, and Top of the page goes back to the plain page link", async () => {
    const picker = await mount("page:20#s-bios|/team#bios", null);
    const select = picker.sectionSelect()!;
    expect(select.value).toBe("s-bios");
    expect(picker.pick(select, "")).toBe("page:20|/team");
    picker.unmount();
  });

  it("lists the page being edited from the editor, including a name not yet saved", async () => {
    const services = { ...createEmptySection(), id: "s-new", anchorName: "services", title: "Services" };
    const picker = await mount("page:1571|/", { pageId: "1571", sections: [services] });
    const labels = [...picker.sectionSelect()!.options].map((option) => option.textContent);
    expect(labels).toEqual(["Top of the page", "#services — Services"]);
    const pageSelect = picker.host.querySelector<HTMLSelectElement>('select[aria-label="Menu link"]')!;
    expect([...pageSelect.options].some((option) => option.textContent === "Home (this page)")).toBe(true);
    picker.unmount();
  });

  it("offers no section list for a page with no named sections, or without allowSections", () => {
    expect(pickerSectionsFor({ id: "x", label: "X", slug: "x", path: "/x", sections: [] }, null)).toEqual([]);
    expect(pickerSectionsFor(undefined, null)).toEqual([]);
  });

  it("writes the section's name only as today's fallback address", () => {
    const value = pickerOptionValue({ id: "20", label: "Team", slug: "team", path: "/team" }, "path", "pages", {
      sectionId: "s-bios",
      anchorName: "bios",
      title: ""
    });
    expect(value).toBe("page:20#s-bios|/team#bios");
  });
});
