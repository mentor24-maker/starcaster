// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyModule, type BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderTableModuleSettings } from "./builder-table-module-settings";

/**
 * Task 86bcwwc4g: Dane could not put his saved module "Heading: WaveCenter"
 * into a table cell on the WaveCenter home page. The cell's ⊕ opened the
 * Module Library, but the library was never given the saved modules, so
 * searching for one found nothing. Driven through the real clicks: open the
 * cell's library, search, pick the saved module, and see it land in the cell.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFetch = vi.fn();
vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: (...args: unknown[]) => mockFetch(...args),
}));

const heading = {
  ...createEmptyModule("heading", ""),
  id: "heading-master",
  text: "WaveCenter",
  savedModuleId: "dmod_heading",
  canonical: true,
} as BuilderTemplateModule;

const savedRecords = [
  { id: "dmod_heading", name: "Heading: WaveCenter", moduleClass: "Headings", isPrivate: false, modules: [heading], createdAt: "", updatedAt: "" },
  // A cell cannot hold another table — a saved one must not be offered either.
  { id: "dmod_table", name: "Pricing Grid", moduleClass: "Tables", isPrivate: false, modules: [{ ...createEmptyModule("table", ""), id: "t1" }], createdAt: "", updatedAt: "" },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mockFetch.mockReset();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openCellLibrary() {
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ cellModules: savedRecords }), { status: 200, headers: { "Content-Type": "application/json" } })
  );
  let tableModule = {
    ...createEmptyModule("table", ""),
    settings: { tableData: JSON.stringify({ headers: ["A"], rowCount: 1, cells: {} }) },
  } as BuilderTemplateModule;
  const onUpdateModule = vi.fn((updater: (m: BuilderTemplateModule) => BuilderTemplateModule) => {
    tableModule = updater(tableModule);
  });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <BuilderTableModuleSettings
        module={tableModule}
        onUpdateModule={onUpdateModule}
        onUpdateModuleBackground={() => {}}
        renderCellPreview={() => null}
      />
    );
  });

  const add = document.querySelector<HTMLButtonElement>('button[title="Add module to this cell"]');
  expect(add, "the cell's ⊕ button").not.toBeNull();
  act(() => add!.click());
  await flush();
  return { getTable: () => tableModule };
}

function search(text: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search all modules and categories"]')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function hitButton(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>(".builder-module-palette-modal button")].find((button) =>
    button.textContent?.includes(label)
  );
}

describe("Table cell Module Library — saved modules", () => {
  it("finds a saved module by name and inserts a copy of it into the cell", async () => {
    const { getTable } = await openCellLibrary();
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/cell-modules", expect.anything());

    search("WaveCenter");
    const hit = hitButton("Heading: WaveCenter");
    expect(hit, "saved module in the search results").toBeTruthy();
    act(() => hit!.click());

    const cells = JSON.parse(getTable().settings.tableData).cells as Record<string, BuilderTemplateModule[]>;
    const inserted = Object.values(cells).flat();
    expect(inserted).toHaveLength(1);
    expect(inserted[0].type).toBe("heading");
    expect(inserted[0].text).toBe("WaveCenter");
    expect(inserted[0].id).not.toBe("heading-master");
    // Propagation never reaches inside a table cell, so the copy must not
    // claim to follow the saved module.
    expect(inserted[0].savedModuleId).toBeUndefined();
    expect(inserted[0].canonical).toBeUndefined();
  });

  it("does not offer a saved module the cell cannot hold", async () => {
    await openCellLibrary();
    search("Pricing");
    expect(hitButton("Pricing Grid")).toBeUndefined();
  });
});
