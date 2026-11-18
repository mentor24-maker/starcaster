// @vitest-environment jsdom
/**
 * EVERY link box that picks a page also offers "a section on that page"
 * (task SC-853, done-means 3).
 *
 * SC-852 gave menus the choice. This walks the ONE list of settings that hold
 * a page link — LINK_SETTINGS / LIST_LINK_SETTINGS in lib/pageInboundLinks.js,
 * the same list the delete warning and the weekly broken-links scan read — and
 * opens each module's real settings panel with that setting pointing at a page
 * that has a named section. The section list must appear; and it must NOT
 * appear when the setting is empty, so a section list some other box shows
 * cannot be mistaken for this one's.
 *
 * A setting where a section would break the link (the module adds a search, a
 * post or an event to the address) is named, with its reason, in
 * NO_SECTION_LINK_SETTINGS — and for those the test asserts the opposite.
 * So the next link box added to LINK_SETTINGS cannot miss the choice silently:
 * it either offers sections or says why not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      pages: [{ id: "20", name: "Team", slug: "team", layoutSections: [{ id: "s-bios", anchorName: "bios", title: "Bios" }] }],
      data: []
    })
  })
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);

import { BuilderModuleCard } from "@/components/builder/builder-module-card";
import { createEmptyModule, type BuilderTemplateModule } from "@/lib/builder-template";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const inbound = require("../../lib/pageInboundLinks.js") as {
  LINK_SETTINGS: Record<string, Record<string, string>>;
  LIST_LINK_SETTINGS: Record<string, Record<string, Record<string, string>>>;
  NO_SECTION_LINK_SETTINGS: Record<string, Record<string, string>>;
  offersSectionLink: (type: string, key: string) => boolean;
};

const LINK = "page:20|/team";

/**
 * Settings a panel needs before it shows the link box at all (a gate the
 * operator would open first). Only what reveals the field — nothing here is
 * about links.
 */
const REVEAL: Record<string, Record<string, string>> = {
  galaxy: { placement: "inline" }
};

const mounted: Array<{ root: Root; container: HTMLElement }> = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

const noop = () => {};

async function sectionListsIn(type: string, settings: Record<string, string>): Promise<number> {
  const base = createEmptyModule(type as BuilderTemplateModule["type"]);
  const module = { ...base, id: "m1", settings: { ...base.settings, ...(REVEAL[type] ?? {}), ...settings } } as BuilderTemplateModule;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <BuilderModuleCard
        module={module}
        sectionId="s1"
        isExpanded
        onToggleExpanded={noop}
        onUpdateModule={noop}
        onUpdateModuleBackground={noop}
        onMoveUp={noop}
        onMoveDown={noop}
        onRemove={noop}
        onOpenGallery={noop}
        onOpenSocialIconGallery={noop}
        onUploadMedia={noop}
        onClone={noop}
      />
    );
  });
  // Let the page list resolve.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const lists = [...container.querySelectorAll<HTMLSelectElement>("select.builder-picker-section-select")];
  return lists.filter((select) => [...select.options].some((option) => option.textContent === "#bios — Bios")).length;
}

const singles = Object.entries(inbound.LINK_SETTINGS).flatMap(([type, keys]) =>
  Object.keys(keys).map((key) => ({ type, key, label: `${type} › ${key}`, settings: { [key]: LINK } }))
);
const lists = Object.entries(inbound.LIST_LINK_SETTINGS).flatMap(([type, listKeys]) =>
  Object.entries(listKeys).flatMap(([listKey, fields]) =>
    Object.keys(fields).map((field) => ({
      type,
      key: listKey,
      label: `${type} › ${listKey} › ${field}`,
      settings: { [listKey]: JSON.stringify([{ id: "item-1", label: "Item", title: "Item", text: "Item", [field]: LINK }]) }
    }))
  )
);

describe("every link setting offers a section of the chosen page, or says why not", () => {
  it("names only settings that exist in LINK_SETTINGS", () => {
    for (const [type, keys] of Object.entries(inbound.NO_SECTION_LINK_SETTINGS)) {
      for (const [key, reason] of Object.entries(keys)) {
        expect(inbound.LINK_SETTINGS[type]?.[key], `${type} › ${key} is not a link setting`).toBeTruthy();
        expect(reason.length, `${type} › ${key} needs its reason`).toBeGreaterThan(10);
      }
    }
  });

  for (const entry of [...singles, ...lists]) {
    const offers = inbound.offersSectionLink(entry.type, entry.key);
    it(`${entry.label} ${offers ? "offers" : "does not offer"} a section`, async () => {
      const without = await sectionListsIn(entry.type, {});
      const withLink = await sectionListsIn(entry.type, entry.settings);
      expect(without, `${entry.label}: a section list with nothing linked`).toBe(0);
      if (offers) expect(withLink, `${entry.label}: no section list once it links to a page`).toBeGreaterThan(0);
      else expect(withLink, `${entry.label}: offers a section, but NO_SECTION_LINK_SETTINGS says it must not`).toBe(0);
    });
  }
});
