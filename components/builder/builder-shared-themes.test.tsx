// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderSharedThemes, SHARED_THEMES_EMPTY_TEXT, describeThemeFonts } from "./builder-shared-themes";

/**
 * Task 86bcu6uav: themes another project shares with this one are listed
 * "from <project>" with their colours and fonts, and can be imported. An
 * empty group says WHY it is empty (CLAUDE.md landmine 17), a successful
 * import says the default and live site did not change, and a refused import
 * says so in words and reloads the list rather than leaving a stale button up.
 */

const mockFetch = vi.fn();
vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: (...args: unknown[]) => mockFetch(...args),
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  mockFetch.mockReset();
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 404) {
  return { ok, status, json: async () => body };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(match: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(match));
  if (!found) throw new Error(`No button containing "${match}"`);
  return found as HTMLButtonElement;
}

const SHARED = {
  id: "theme-ocean-a",
  name: "Ocean",
  primaryColor: "#112233",
  backgroundColor: "#ffffff",
  accentColor: "#ff6600",
  typography: { fonts: { heading: "Lora", body: "Inter" } },
  sourceProjectId: "proj-a",
  sourceProjectName: "Alpha",
};

describe("BuilderSharedThemes", () => {
  it("lists shared themes with where they came from, their colours and fonts, and an Import button", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED], items: [SHARED] }));
    render(<BuilderSharedThemes />);
    await flush();

    expect(mockFetch.mock.calls[0][0]).toBe("/api/admin/shared/themes");
    const text = container!.textContent ?? "";
    expect(text).toContain("Shared with this project");
    expect(text).toContain("Ocean");
    expect(text).toContain("from Alpha");
    expect(text).toContain("Lora / Inter");
    // Three colours set, one (secondary) not — only the set ones get a swatch.
    expect(container!.querySelectorAll(".builder-shared-themes-swatch")).toHaveLength(3);
    expect(button("Import")).toBeTruthy();
  });

  it("an empty list says why it is empty", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: [], items: [] }));
    render(<BuilderSharedThemes />);
    await flush();
    expect(container!.textContent).toContain(SHARED_THEMES_EMPTY_TEXT);
  });

  it("Import posts to the import route, tells the page, and says the default did not change", async () => {
    const onImported = vi.fn();
    const copy = { ...SHARED, id: "dtheme_new", name: "Ocean (2)", isDefault: false };
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED], items: [SHARED] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: copy, theme: copy }, true, 201));
    render(<BuilderSharedThemes onImported={onImported} />);
    await flush();

    act(() => button("Import").click());
    await flush();

    expect(mockFetch.mock.calls[1][0]).toBe("/api/admin/shared/themes/theme-ocean-a/import");
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(onImported).toHaveBeenCalledWith(copy);
    const text = container!.textContent ?? "";
    expect(text).toContain('Imported "Ocean (2)" from Alpha');
    expect(text).toContain("default theme and live site are unchanged");
  });

  it("a refused import shows the server's sentence, tells the page nothing, and reloads the list", async () => {
    const onImported = vi.fn();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [SHARED], items: [SHARED] }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: { message: "That theme is no longer shared with this project, so it cannot be imported." } }, false, 404))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [], items: [] }));
    render(<BuilderSharedThemes onImported={onImported} />);
    await flush();

    act(() => button("Import").click());
    await flush();
    await flush();

    expect(onImported).not.toHaveBeenCalled();
    const text = container!.textContent ?? "";
    expect(text).toContain("no longer shared with this project");
    expect(text).toContain(SHARED_THEMES_EMPTY_TEXT);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("a failed list read says so instead of looking empty", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: false, error: { message: "Could not read project shares" } }, false, 500));
    render(<BuilderSharedThemes />);
    await flush();
    const text = container!.textContent ?? "";
    expect(text).toContain("Could not read project shares");
    expect(text).not.toContain(SHARED_THEMES_EMPTY_TEXT);
  });
});

describe("describeThemeFonts", () => {
  it("names heading and body, collapses a pair that matches, and says when none are set", () => {
    expect(describeThemeFonts({ ...SHARED })).toBe("Lora / Inter");
    expect(describeThemeFonts({ ...SHARED, typography: { fonts: { heading: "Inter", body: "Inter" } } })).toBe("Inter");
    expect(describeThemeFonts({ ...SHARED, typography: null })).toBe("Site default fonts");
  });
});
