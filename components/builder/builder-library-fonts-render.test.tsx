// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections, normalizeTheme } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "../builder-template-preview";
import { BuilderFontSelect, resetLibraryFontChoicesForTest } from "./builder-font-select";
import { getHeadingFontStack } from "./builder-utils";
import { resetLibraryFontFacesForTest } from "./use-library-font-faces";

/**
 * Font Library 3/7 (task 86bchyd46): a page naming a font-library font
 * ("lf:<slug>") loads exactly that font's files, and the theme picker offers
 * the library.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

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
    if (url === "/api/fonts") return json({ ok: true, data: { fonts: [ORBITRON, { slug: "space-mono", family: "Space Mono" }] } });
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

const fontFaces = () =>
  Array.from(document.head.querySelectorAll<HTMLStyleElement>("style[data-builder-library-font]"));
const publicFontReads = () =>
  fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith("/api/public/fonts"));

function page(theme: ReturnType<typeof normalizeTheme>, projectId = "") {
  return (
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        { id: "r", title: "r", layout: "single", modules: [{ id: "h", type: "heading", column: "main", text: "Hi", settings: {} }] },
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      theme={theme}
      projectId={projectId}
      showShell={false}
    />
  );
}

describe("a rendered page loads the library fonts it uses", () => {
  it("theme heading font → one read for that font, its @font-face, and the font on the page", async () => {
    mount(page(normalizeTheme({ typography: { fonts: { heading: "lf:orbitron", body: "inter", mono: "" } } }), "p1"));
    await flush();
    expect(publicFontReads()).toEqual(["/api/public/fonts?slugs=orbitron&projectId=p1"]);
    const faces = fontFaces();
    expect(faces).toHaveLength(1);
    expect(faces[0].textContent).toContain("font-family:'lf-orbitron'");
    expect(faces[0].textContent).toContain("https://blob.example/orbitron-400.woff2");
    expect(container!.innerHTML).toContain("lf-orbitron");
  });

  it("a page with no library font makes no request", async () => {
    mount(page(normalizeTheme({ typography: { fonts: { heading: "gf:Open Sans", body: "inter", mono: "" } } })));
    await flush();
    expect(publicFontReads()).toEqual([]);
    expect(fontFaces()).toHaveLength(0);
  });

  it("the heading font stack resolves a library font", () => {
    expect(getHeadingFontStack("lf:orbitron")).toBe("'lf-orbitron', system-ui, sans-serif");
  });
});

const dialog = () => document.body.querySelector<HTMLElement>("[role=dialog]");
const optionNames = () =>
  Array.from(dialog()?.querySelectorAll<HTMLElement>("[role=option]") ?? []).map((o) => o.textContent);
const groupNames = () =>
  Array.from(dialog()?.querySelectorAll<HTMLElement>(".builder-font-picker-group") ?? []).map((g) => g.textContent);
const option = (name: string) =>
  Array.from(dialog()!.querySelectorAll<HTMLElement>("[role=option]")).find((o) => o.textContent === name)!;
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const trigger = () => container!.querySelector<HTMLButtonElement>("button.builder-font-select-trigger")!;
const BUILTIN_NAMES = ["Default (theme)", "Inter", "Poppins", "Montserrat", "Oswald", "Archivo", "Space Grotesk", "Bebas Neue", "Playfair Display", "Merriweather", "Lora"];

describe("the font picker window (task 86bctd64g)", () => {
  it("opens a window listing the built-ins and then the whole library", async () => {
    mount(<BuilderFontSelect ariaLabel="Heading font" value="inter" onChange={() => {}} />);
    expect(dialog()).toBeNull();
    click(trigger());
    await flush();
    expect(dialog()).toBeTruthy();
    expect(groupNames()).toEqual(["Built-in fonts", "Font library"]);
    expect(optionNames()).toEqual([...BUILTIN_NAMES, "Orbitron", "Space Mono"]);
    expect(option("Inter").getAttribute("aria-selected")).toBe("true");
  });

  it("clicking a library font saves lf:<slug> and closes the window", async () => {
    const onChange = vi.fn();
    mount(<BuilderFontSelect ariaLabel="Heading font" value="inter" onChange={onChange} />);
    click(trigger());
    await flush();
    click(option("Orbitron"));
    expect(onChange).toHaveBeenCalledWith("lf:orbitron");
    expect(dialog()).toBeNull();
  });

  it("clicking a built-in saves its key", async () => {
    const onChange = vi.fn();
    mount(<BuilderFontSelect value="lf:orbitron" onChange={onChange} />);
    await flush();
    click(trigger());
    await flush();
    click(option("Lora"));
    expect(onChange).toHaveBeenCalledWith("lora");
  });

  it("draws each library name in its own font, from that font's own file", async () => {
    fetchMock.mockImplementation(() => json({ ok: true, data: { fonts: [{ ...ORBITRON, id: "f1" }] } }));
    mount(<BuilderFontSelect value="inter" onChange={() => {}} />);
    click(trigger());
    await flush();
    expect(option("Orbitron").style.fontFamily).toContain("scfl-f1");
    const faces = Array.from(dialog()!.querySelectorAll("style")).map((el) => el.textContent).join("\n");
    expect(faces).toContain('font-family: "scfl-f1"');
    expect(faces).toContain("https://blob.example/orbitron-400.woff2");
    expect(option("Lora").style.fontFamily).toContain("Lora");
  });

  it("shows a saved library font on the button by its family name, drawn in it", async () => {
    fetchMock.mockImplementation(() => json({ ok: true, data: { fonts: [{ ...ORBITRON, id: "f1" }] } }));
    mount(<BuilderFontSelect value="lf:orbitron" onChange={() => {}} />);
    await flush();
    const current = container!.querySelector<HTMLElement>(".builder-font-select-current")!;
    expect(current.textContent).toBe("Orbitron");
    expect(current.style.fontFamily).toContain("scfl-f1");
  });

  it("search narrows the list by name", async () => {
    mount(<BuilderFontSelect value="inter" onChange={() => {}} />);
    click(trigger());
    await flush();
    const search = dialog()!.querySelector<HTMLInputElement>("input[type=search]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "orb");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(optionNames()).toEqual(["Orbitron"]);
  });

  it("Escape closes the window without changing anything", async () => {
    const onChange = vi.fn();
    mount(<BuilderFontSelect value="inter" onChange={onChange} />);
    click(trigger());
    await flush();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dialog()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the person's favourite fonts come first, under a Favourites heading (Font Library 8)", async () => {
    fetchMock.mockImplementation(() => json({ ok: true, data: { fonts: [
      { slug: "bungee", family: "Bungee", isFavorite: false },
      { slug: "orbitron", family: "Orbitron", isFavorite: false },
      { slug: "space-mono", family: "Space Mono", isFavorite: true },
    ] } }));
    const onChange = vi.fn();
    mount(<BuilderFontSelect value="inter" onChange={onChange} />);
    click(trigger());
    await flush();
    expect(groupNames()).toEqual(["Built-in fonts", "Favourites", "All library fonts"]);
    expect(optionNames().slice(BUILTIN_NAMES.length)).toEqual(["Space Mono", "Bungee", "Orbitron"]);
    click(option("Space Mono"));
    expect(onChange).toHaveBeenCalledWith("lf:space-mono");
  });

  it("an empty library says so instead of offering an empty list", async () => {
    fetchMock.mockImplementation(() => json({ ok: true, data: { fonts: [] } }));
    mount(<BuilderFontSelect value="inter" onChange={() => {}} />);
    click(trigger());
    await flush();
    expect(optionNames()).toEqual(BUILTIN_NAMES);
    expect(dialog()!.querySelector(".builder-font-picker-note")?.textContent).toContain("no fonts in it yet");
  });
});
