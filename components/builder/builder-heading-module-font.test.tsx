// @vitest-environment jsdom
import { useState } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultBackgroundSettings,
  normalizeLayoutSections,
  normalizeTheme,
  type BuilderTemplateModule
} from "@/lib/builder-template";
import { BuilderTemplatePreview } from "../builder-template-preview";
import { resetLibraryFontChoicesForTest } from "./builder-font-select";
import { BuilderHeadingModuleSettings } from "./builder-heading-module-settings";
import { resetLibraryFontFacesForTest } from "./use-library-font-faces";

/**
 * Task 86bctarde: the Heading module's Font field offered only the eleven
 * built-ins, so a font-library or Google font could be put on a theme but
 * never on one heading. It is the theme's picker now. These drive the PANEL
 * (not the picker on its own, which its own tests cover) and then put what it
 * wrote through the normaliser that runs on every save and every load.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const flush = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const ORBITRON = {
  slug: "orbitron",
  family: "Orbitron",
  category: "display",
  styles: [{ weight: 400, style: "normal", url: "https://blob.example/orbitron-400.woff2", format: "woff2" }],
};

beforeEach(() => {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/public/fonts")) return json({ ok: true, data: { fonts: [ORBITRON] } });
    if (url === "/api/fonts") return json({ ok: true, data: { fonts: [ORBITRON] } });
    return json({ ok: false }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.head.querySelectorAll("style[data-builder-library-font]").forEach((el) => el.remove());
  resetLibraryFontFacesForTest();
  resetLibraryFontChoicesForTest();
  vi.unstubAllGlobals();
});

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function heading(fontFamily = ""): BuilderTemplateModule {
  const [section] = normalizeLayoutSections([
    {
      id: "s",
      title: "s",
      layout: "single",
      modules: [{ id: "h", type: "heading", column: "main", text: "Hi", settings: { fontFamily } }]
    }
  ]);
  return section.modules[0];
}

/** The module as the panel left it, read back after every update. */
let latest: BuilderTemplateModule;

function Panel({ initial }: { initial: BuilderTemplateModule }) {
  const [module, setModule] = useState(initial);
  latest = module;
  return (
    <BuilderHeadingModuleSettings
      module={module}
      onUpdateModule={(updater) => setModule((current) => updater(current))}
    />
  );
}

/** What a save followed by a reload hands back: the normaliser, both ways. */
function savedAndReloaded(module: BuilderTemplateModule) {
  const [section] = normalizeLayoutSections(
    JSON.parse(JSON.stringify([{ id: "s", title: "s", layout: "single", modules: [module] }]))
  );
  return section.modules[0].settings.fontFamily;
}

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const trigger = () =>
  container!.querySelector<HTMLButtonElement>("button.builder-font-select-trigger[aria-label^='Heading font']")!;
const dialog = () => document.body.querySelector<HTMLElement>("[role=dialog]");
const option = (name: string) =>
  Array.from(dialog()!.querySelectorAll<HTMLElement>("[role=option]")).find((o) => o.textContent === name)!;

describe("the Heading module's Font field (task 86bctarde)", () => {
  it("is the font picker, not the list of built-ins", () => {
    mount(<Panel initial={heading()} />);
    expect(trigger()).toBeTruthy();
    expect(container!.querySelector(".builder-font-select-current")!.textContent).toBe("Default (theme)");
  });

  it("Library font → Orbitron writes lf:orbitron, and it survives save and reload", async () => {
    mount(<Panel initial={heading()} />);
    click(trigger());
    await flush();
    click(option("Orbitron"));
    expect(latest.settings.fontFamily).toBe("lf:orbitron");
    expect(savedAndReloaded(latest)).toBe("lf:orbitron");
    await flush();
    expect(container!.querySelector(".builder-font-select-current")!.textContent).toBe("Orbitron");
  });

  it("a Google font by name writes gf:<Family>, and it survives save and reload", () => {
    mount(<Panel initial={heading()} />);
    click(trigger());
    click(document.body.querySelector<HTMLButtonElement>("[role=dialog] button.builder-font-picker-google")!);
    const input = container!.querySelector<HTMLInputElement>("input.builder-font-select-google")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Open Sans");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(latest.settings.fontFamily).toBe("gf:Open Sans");
    expect(savedAndReloaded(latest)).toBe("gf:Open Sans");
  });

  it("a heading already on a built-in font shows it and keeps it", () => {
    mount(<Panel initial={heading("lora")} />);
    expect(container!.querySelector(".builder-font-select-current")!.textContent).toBe("Lora");
    expect(latest.settings.fontFamily).toBe("lora");
    expect(savedAndReloaded(latest)).toBe("lora");
  });

  it("a page whose heading module names a library font loads that font", async () => {
    mount(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          { id: "s", title: "s", layout: "single", modules: [heading("lf:orbitron")] }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        theme={normalizeTheme({})}
        projectId="p1"
        showShell={false}
      />
    );
    await flush();
    const reads = fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith("/api/public/fonts"));
    expect(reads).toEqual(["/api/public/fonts?slugs=orbitron&projectId=p1"]);
    expect(container!.querySelector<HTMLElement>(".builder-preview-heading")!.style.fontFamily).toContain("lf-orbitron");
  });
});
