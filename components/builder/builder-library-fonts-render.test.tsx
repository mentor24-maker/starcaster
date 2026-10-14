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

function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("the font picker offers the font library", () => {
  it("Library font… lists the library and saves lf:<slug>", async () => {
    const onChange = vi.fn();
    mount(<BuilderFontSelect ariaLabel="Heading font" value="inter" onChange={onChange} />);
    choose(container!.querySelector("select")!, "__library__");
    await flush();
    const library = container!.querySelector<HTMLSelectElement>("select.builder-font-select-library")!;
    expect(library).toBeTruthy();
    expect(Array.from(library.options).map((o) => o.textContent)).toEqual([
      "Pick a font from the library",
      "Orbitron",
      "Space Mono",
    ]);
    choose(library, "orbitron");
    expect(onChange).toHaveBeenCalledWith("lf:orbitron");
  });

  it("shows a saved library font as chosen, by its family name", async () => {
    mount(<BuilderFontSelect value="lf:orbitron" onChange={() => {}} />);
    await flush();
    const [main, library] = Array.from(container!.querySelectorAll("select"));
    expect(main.value).toBe("__library__");
    expect(main.selectedOptions[0].textContent).toBe("Library font: Orbitron");
    expect(library.value).toBe("orbitron");
  });

  it("an empty library says so instead of offering an empty list", async () => {
    fetchMock.mockImplementation(() => json({ ok: true, data: { fonts: [] } }));
    mount(<BuilderFontSelect value="inter" onChange={() => {}} />);
    choose(container!.querySelector("select")!, "__library__");
    await flush();
    expect(container!.querySelector("select.builder-font-select-library")).toBeNull();
    expect(container!.querySelector(".builder-font-select-note")?.textContent).toContain("no fonts in it yet");
  });
});
