// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FontsManager, {
  DEFAULT_SAMPLE, EMPTY_LIBRARY_SENTENCE, NOT_USED_SENTENCE, PROJECT_SWITCH_EVENT, fontFaceCss, filterFonts,
  noMatchSentence, noTagMatchSentence, parseTagList, previewFamily, stylesSentence,
  type FontRow, type FontUsage,
} from "./fonts-manager";

/**
 * Font Library 2/7 (86bchyd41). The screen's three promises, each driven
 * through the real component against a fake App.api:
 *
 *  - an empty library says so in a sentence (landmine 17), never a blank table;
 *  - an uploaded font is drawn from ITS OWN FILE — an @font-face rule under a
 *    private name pointing at the stored URL, and the row's name set in it;
 *  - "Other / not sure" reaches the server, whose refusal is shown in the
 *    form, and no row appears.
 *
 * Plus: only a project's own fonts carry a Delete button.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LICENCE_REFUSED = "This font's licence does not allow use on a business website. "
  + "Starcaster accepts fonts under the SIL Open Font License, Apache 2.0, or public domain.";

function font(over: Partial<FontRow> = {}): FontRow {
  return {
    id: "f-orbitron",
    family: "Orbitron",
    category: "display",
    styles: [
      { weight: 700, style: "normal", url: "https://blob.example/Fonts/p/orbitron/700-normal.ttf", format: "ttf" },
      { weight: 400, style: "normal", url: "https://blob.example/Fonts/p/orbitron/400-normal.ttf", format: "ttf" },
    ],
    licence: "OFL-1.1",
    licenceText: "",
    sourceUrl: "https://fonts.google.com/specimen/Orbitron",
    sourceName: "Upload",
    tags: [],
    visibility: "project",
    ...over,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let library: FontRow[] = [];
let posts: Record<string, unknown>[] = [];
let patches: { path: string; body: Record<string, any> }[] = [];
let reads: string[] = [];
let activeProject = "proj_a";
let usageByFont: Record<string, FontUsage> = {};

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<FontsManager />); });
  await flush();
}

function button(text: string): HTMLButtonElement {
  const found = [...(container?.querySelectorAll("button") || [])].find((b) => b.textContent === text);
  if (!found) throw new Error(`no "${text}" button`);
  return found as HTMLButtonElement;
}

function click(el: Element) {
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

function change(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  act(() => { el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}

function pickFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

async function fillAndSave(licence: string) {
  click(button("Add Font"));
  const form = container!.querySelector("form[aria-label='Add a font']")!;
  change(form.querySelector("input[name='family']") as HTMLInputElement, "Orbitron");
  change(form.querySelector("select[name='category']") as HTMLSelectElement, "display");
  change(form.querySelector("select[name='licence']") as HTMLSelectElement, licence);
  change(form.querySelector("input[name='sourceUrl']") as HTMLInputElement, "https://fonts.google.com/specimen/Orbitron");
  pickFiles(form.querySelector("input[name='files']") as HTMLInputElement, [
    new File([new Uint8Array([0, 1, 0, 0, 9, 9])], "Orbitron-Regular.ttf"),
    new File([new Uint8Array([0, 1, 0, 0, 8, 8])], "Orbitron-Bold.ttf"),
  ]);
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

function rowNames(): string[] {
  return [...(container?.querySelectorAll(".fonts-manager-preview") || [])].map((el) => el.textContent || "");
}

beforeEach(() => {
  library = [];
  posts = [];
  reads = [];
  patches = [];
  activeProject = "proj_a";
  usageByFont = {};
  (window as unknown as { App: unknown }).App = {
    api: async (path: string, options: RequestInit = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      if (method === "GET") {
        reads.push(`${activeProject} ${path}`);
        const usage = path.match(/^\/api\/fonts\/([^/]+)\/usage$/);
        if (usage) {
          const id = decodeURIComponent(usage[1]);
          return { ok: true, data: usageByFont[id] || { sites: [], totalPages: 0, truncated: false } };
        }
        return { ok: true, data: { fonts: library, total: library.length } };
      }
      if (method === "POST") {
        const body = JSON.parse(String(options.body));
        posts.push(body);
        // routes/fonts.js answers a refused licence with 400 and lib/fontLicence.js's
        // message; App.api turns a non-2xx into a thrown Error carrying it.
        if (!["OFL-1.1", "Apache-2.0", "public-domain"].includes(body.licence)) throw new Error(LICENCE_REFUSED);
        const saved = font({ id: "f-new", family: body.family });
        library = [...library, saved];
        return { ok: true, data: { font: saved } };
      }
      if (method === "PATCH") {
        // Stand-in for routes/fonts.js: stores tags as lib/fontsStore.js cleanTags
        // would, and a sample line as given.
        const body = JSON.parse(String(options.body));
        patches.push({ path, body });
        const id = decodeURIComponent(path.split("/").pop() || "");
        const target = library.find((f) => f.id === id)!;
        if (target.visibility === "platform") throw new Error("shared font library");
        const next = { ...target };
        if (Array.isArray(body.tags)) next.tags = parseTagList(body.tags.join(","));
        if (typeof body.previewText === "string") next.previewText = body.previewText;
        library = library.map((f) => (f.id === id ? next : f));
        return { ok: true, data: { font: next } };
      }
      if (method === "DELETE") {
        return { ok: true, data: { font: library[0], filesRemoved: 2, filesNotRemoved: [] } };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
});

afterEach(() => {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  act(() => { root?.unmount(); });
  container?.remove();
  container = null;
  root = null;
});

describe("FontsManager", () => {
  it("an empty library says so in a sentence, with no table", async () => {
    await mount();
    expect(container!.textContent).toContain(EMPTY_LIBRARY_SENTENCE);
    expect(container!.querySelector("table")).toBeNull();
  });

  it("a read that fails says why, not that the library is empty", async () => {
    (window as unknown as { App: { api: unknown } }).App.api = async () => ({ ok: false, error: { message: "relation \"fonts\" does not exist" } });
    await mount();
    expect(container!.textContent).toContain("relation \"fonts\" does not exist");
    expect(container!.textContent).not.toContain(EMPTY_LIBRARY_SENTENCE);
  });

  it("uploading Orbitron adds a row whose name is drawn from Orbitron's own files", async () => {
    await mount();
    await fillAndSave("OFL-1.1");

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      family: "Orbitron",
      category: "display",
      licence: "OFL-1.1",
      sourceUrl: "https://fonts.google.com/specimen/Orbitron",
    });
    const files = posts[0].files as { name: string; data: string }[];
    expect(files.map((f) => f.name)).toEqual(["Orbitron-Regular.ttf", "Orbitron-Bold.ttf"]);
    expect(files[0].data).toBe(btoa(String.fromCharCode(0, 1, 0, 0, 9, 9))); // bare base64, no data: prefix

    expect(rowNames()).toEqual(["Orbitron"]);
    const preview = container!.querySelector(".fonts-manager-preview") as HTMLElement;
    expect(preview.style.fontFamily).toContain("scfl-f-new");
    const faces = container!.querySelector("style[data-fonts-manager-faces]")!.textContent || "";
    expect(faces).toContain('font-family: "scfl-f-new"');
    expect(faces).toContain('url("https://blob.example/Fonts/p/orbitron/700-normal.ttf") format("truetype")');
    expect(container!.textContent).toContain("Regular, Bold");
    expect(container!.querySelector("form[aria-label='Add a font']")).toBeNull();
  });

  it("\"Other / not sure\" is refused in the form with the licence message, and no row appears", async () => {
    await mount();
    await fillAndSave("other");

    expect(posts).toHaveLength(1);
    expect(posts[0].licence).toBe("other");
    const form = container!.querySelector("form[aria-label='Add a font']");
    expect(form).not.toBeNull();
    expect(form!.querySelector("[role='alert']")!.textContent).toBe(LICENCE_REFUSED);
    expect(rowNames()).toEqual([]);
    expect(library).toEqual([]);
  });

  it("only a project's own fonts carry a Delete button", async () => {
    library = [
      font({ id: "f-shared", family: "Exo", visibility: "platform" }),
      font({ id: "f-own", family: "Orbitron", visibility: "project" }),
    ];
    await mount();
    const rows = [...container!.querySelectorAll("tbody tr")] as HTMLElement[];
    const shared = rows.find((r) => r.dataset.fontId === "f-shared")!;
    const own = rows.find((r) => r.dataset.fontId === "f-own")!;
    expect(shared.querySelector(".actions-col button")).toBeNull();
    expect(shared.textContent).toContain("Shared library");
    expect(own.querySelector("button[aria-label='Delete Orbitron']")).not.toBeNull();
  });

  it("switching project drops the old project's fonts and reads the new one's", async () => {
    library = [font({ family: "Orbitron" })];
    await mount();
    expect(rowNames()).toEqual(["Orbitron"]);
    activeProject = "proj_b";
    library = [];
    await act(async () => { window.dispatchEvent(new Event(PROJECT_SWITCH_EVENT)); });
    await flush();
    expect(reads).toEqual(["proj_a /api/fonts", "proj_b /api/fonts"]);
    expect(rowNames()).toEqual([]);
    expect(container!.textContent).toContain(EMPTY_LIBRARY_SENTENCE);
  });
});

/** A library like the starter pack, in miniature: three categories, one tagged font. */
function starterLibrary(): FontRow[] {
  return [
    font({ id: "f-orbitron", family: "Orbitron", category: "display", visibility: "platform" }),
    font({ id: "f-exo", family: "Exo", category: "sans", tags: ["sci-fi"], visibility: "platform" }),
    font({ id: "f-audiowide", family: "Audiowide", category: "display", visibility: "platform", previewText: "Launch sequence" }),
    font({ id: "f-lora", family: "Lora", category: "serif", visibility: "project" }),
  ];
}

function sampleLines(): string[] {
  return [...(container?.querySelectorAll(".fonts-manager-sample") || [])].map((el) => el.textContent || "");
}

function input(name: string): HTMLInputElement {
  return container!.querySelector(`input[name='${name}']`) as HTMLInputElement;
}

describe("FontsManager — finding a font in hundreds (7/7)", () => {
  it("typing 'orb' shows Orbitron and hides every font that does not match", async () => {
    library = starterLibrary();
    await mount();
    change(input("fontSearch"), "orb");
    expect(rowNames()).toEqual(["Orbitron"]);
    change(input("fontSearch"), "ORB");
    expect(rowNames()).toEqual(["Orbitron"]);
  });

  it("search matches a tag as well as the family name", async () => {
    library = starterLibrary();
    await mount();
    change(input("fontSearch"), "sci-fi");
    expect(rowNames()).toEqual(["Exo"]);
  });

  it("search, category and the Tag box apply together, and an empty result names all three", async () => {
    library = [
      ...starterLibrary(),
      font({ id: "f-orb2", family: "Orbit Sans", category: "sans", tags: ["wide"], visibility: "platform" }),
    ];
    await mount();
    change(input("fontSearch"), "orb");
    expect(rowNames()).toEqual(["Orbitron", "Orbit Sans"]);
    change(input("tagFilter"), "wide");
    expect(rowNames()).toEqual(["Orbit Sans"]);
    click(button("Display"));
    expect(rowNames()).toEqual([]);
    expect(container!.textContent).toContain("No display fonts tagged 'wide' match 'orb'.");
  });

  it("clicking Display shows only display fonts, and All brings the rest back", async () => {
    library = starterLibrary();
    await mount();
    click(button("Display"));
    expect(rowNames()).toEqual(["Orbitron", "Audiowide"]);
    expect(button("Display").getAttribute("aria-pressed")).toBe("true");
    click(button("All"));
    expect(rowNames()).toHaveLength(4);
  });

  it("typed sample text replaces every row's line, in that row's font, at the slider's size", async () => {
    library = starterLibrary();
    await mount();
    expect(sampleLines()).toEqual([DEFAULT_SAMPLE, DEFAULT_SAMPLE, "Launch sequence", DEFAULT_SAMPLE]);
    change(input("sampleText"), "STRANDS");
    expect(sampleLines()).toEqual(["STRANDS", "STRANDS", "STRANDS", "STRANDS"]);
    const first = container!.querySelector(".fonts-manager-sample") as HTMLElement;
    expect(first.style.fontFamily).toContain("scfl-f-orbitron");
    expect(first.style.fontSize).toBe("32px");
    change(input("sampleSize"), "64");
    const sizes = [...container!.querySelectorAll(".fonts-manager-sample")].map((el) => (el as HTMLElement).style.fontSize);
    expect(sizes).toEqual(["64px", "64px", "64px", "64px"]);
  });

  it("a filter that matches nothing says which filter, and Clear puts everything back", async () => {
    library = starterLibrary();
    await mount();
    click(button("Display"));
    change(input("fontSearch"), "zzzz");
    expect(rowNames()).toEqual([]);
    expect(container!.textContent).toContain("No display fonts match 'zzzz'.");
    expect(container!.textContent).not.toContain(EMPTY_LIBRARY_SENTENCE);
    click(button("Clear"));
    expect(rowNames()).toHaveLength(4);
    expect(input("fontSearch").value).toBe("");
  });

  it("only rows that have come near the screen get a font file to download", async () => {
    const observed: Element[] = [];
    let fire: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | null = null;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      constructor(cb: (entries: { target: Element; isIntersecting: boolean }[]) => void) { fire = cb; }
      observe(el: Element) { observed.push(el); }
      disconnect() {}
      unobserve() {}
    };
    library = starterLibrary();
    await mount();
    expect(observed.length).toBe(4);
    // Nothing reported on screen yet: no @font-face rule at all, so nothing to fetch.
    expect(container!.querySelector("style[data-fonts-manager-faces]")).toBeNull();
    const row = (id: string) => container!.querySelector(`tr[data-font-id='${id}']`)!;
    await act(async () => { fire!([{ target: row("f-orbitron"), isIntersecting: true }, { target: row("f-exo"), isIntersecting: true }]); });
    await flush();
    const faces = container!.querySelector("style[data-fonts-manager-faces]")!.textContent || "";
    expect(faces).toContain("scfl-f-orbitron");
    expect(faces).toContain("scfl-f-exo");
    expect(faces).not.toContain("scfl-f-audiowide");
    expect(faces).not.toContain("scfl-f-lora");
  });

  it("a project font's sample line can be edited, and is saved with PATCH", async () => {
    library = starterLibrary();
    await mount();
    const lora = container!.querySelector("tr[data-font-id='f-lora']")!;
    click(lora.querySelector("button[aria-label=\"Edit Lora's sample line\"]")!);
    const form = container!.querySelector("form[aria-label='Sample line for Lora']")!;
    change(form.querySelector("input[name='previewText']") as HTMLInputElement, "Serve and volley");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(patches).toEqual([{ path: "/api/fonts/f-lora", body: { previewText: "Serve and volley" } }]);
    expect(sampleLines()[3]).toBe("Serve and volley");
    // A shared-library font is the platform's; the server refuses edits to it, so no button.
    const orbitron = container!.querySelector("tr[data-font-id='f-orbitron'] td.actions-col")!;
    expect(orbitron.querySelector("button")).toBeNull();
  });
});

describe("filterFonts / noMatchSentence", () => {
  it("narrows by category and query together", () => {
    const lib = starterLibrary();
    expect(filterFonts(lib, "", "").map((f) => f.family)).toHaveLength(4);
    expect(filterFonts(lib, "orb", "display").map((f) => f.family)).toEqual(["Orbitron"]);
  });
  it("names the category and the words", () => {
    expect(noMatchSentence("orbit", "display")).toBe("No display fonts match 'orbit'.");
    expect(noMatchSentence("zzzz", "")).toBe("No fonts match 'zzzz'.");
    expect(noMatchSentence("", "monospace")).toBe("No monospace fonts in the library yet.");
    expect(noMatchSentence("", "", ["wide"])).toBe("No fonts tagged 'wide'.");
    expect(noMatchSentence("orb", "serif", ["wide"])).toBe("No serif fonts tagged 'wide' match 'orb'.");
  });
});

describe("Used by Sites (Font Library 6/7)", () => {
  const strands = (pages: number) => ({
    projectId: "strands",
    name: "Strands",
    url: "https://strands.example",
    pages: Array.from({ length: pages }, (_, i) => ({
      id: `p${i}`, name: `Page ${i}`, slug: `page-${i}`, url: `https://strands.example/page-${i}`,
    })),
  });

  it("opening the screen asks no font which sites use it", async () => {
    library = [font({ id: "f-a" }), font({ id: "f-b", family: "Inter" })];
    await mount();
    expect(rowNames()).toEqual(["Orbitron", "Inter"]);
    expect(reads.filter((r) => r.includes("/usage"))).toEqual([]);
  });

  it("Show sites lists \"Strands (3 pages)\", opening to live links in a new tab", async () => {
    library = [font({ id: "f-orbitron" })];
    usageByFont["f-orbitron"] = { sites: [strands(3)], totalPages: 3, truncated: false };
    await mount();
    click(button("Show sites"));
    await flush();
    expect(reads.filter((r) => r.includes("/usage"))).toEqual(["proj_a /api/fonts/f-orbitron/usage"]);
    const summary = container!.querySelector(".fonts-manager-usage-site summary");
    expect(summary?.textContent).toBe("Strands (3 pages)");
    const links = [...container!.querySelectorAll(".fonts-manager-usage-pages a")] as HTMLAnchorElement[];
    expect(links.map((a) => a.href)).toEqual([
      "https://strands.example/page-0", "https://strands.example/page-1", "https://strands.example/page-2",
    ]);
    expect(links.every((a) => a.target === "_blank" && a.rel.includes("noopener"))).toBe(true);
  });

  it("a font used nowhere says so in a sentence", async () => {
    library = [font({ id: "f-lonely" })];
    await mount();
    click(button("Show sites"));
    await flush();
    expect(container!.querySelector(".fonts-manager-usage")?.textContent).toBe(NOT_USED_SENTENCE);
  });

  it("one page reads \"1 page\", and a site with no address lists it unlinked and says why", async () => {
    library = [font({ id: "f-orbitron" })];
    usageByFont["f-orbitron"] = {
      sites: [{ projectId: "x", name: "No Domain Co", url: "", pages: [{ id: "h", name: "Home", slug: "home", url: "" }] }],
      totalPages: 1,
      truncated: false,
    };
    await mount();
    click(button("Show sites"));
    await flush();
    expect(container!.querySelector(".fonts-manager-usage-site summary")?.textContent).toBe("No Domain Co (1 page)");
    expect(container!.querySelector(".fonts-manager-usage-pages a")).toBeNull();
    expect(container!.textContent).toContain("no web address set");
  });
});

describe("FontsManager tags (Font Library 5/7)", () => {
  function row(id: string): HTMLElement {
    return container!.querySelector(`tr[data-font-id='${id}']`) as HTMLElement;
  }
  function chips(id: string): string[] {
    return [...row(id).querySelectorAll(".fonts-manager-chip-filter")].map((el) => el.textContent || "");
  }
  function typeTags(id: string, text: string) {
    const input = row(id).querySelector(".fonts-manager-tag-input") as HTMLInputElement;
    change(input, text);
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  }

  it("typing 'sci-fi, wide' in + tag adds two chips, and × removes one — both saved through PATCH", async () => {
    library = [font({ id: "f-own", tags: ["geometric"] })];
    await mount();
    typeTags("f-own", "Sci-Fi, wide");
    await flush();
    expect(patches[0]).toEqual({ path: "/api/fonts/f-own", body: { tags: ["geometric", "sci-fi", "wide"] } });
    expect(chips("f-own")).toEqual(["geometric", "sci-fi", "wide"]);
    expect((row("f-own").querySelector(".fonts-manager-tag-input") as HTMLInputElement).value).toBe("");

    click(row("f-own").querySelector("button[aria-label='Remove tag wide from Orbitron']")!);
    await flush();
    expect(patches[1].body.tags).toEqual(["geometric", "sci-fi"]);
    expect(chips("f-own")).toEqual(["geometric", "sci-fi"]);
    expect(library[0].tags).toEqual(["geometric", "sci-fi"]);
  });

  it("a shared-library font shows its chips but offers no × and no + tag", async () => {
    library = [font({ id: "f-shared", visibility: "platform", tags: ["sci-fi", "wide"] })];
    await mount();
    expect(chips("f-shared")).toEqual(["sci-fi", "wide"]);
    expect(row("f-shared").querySelector(".fonts-manager-chip-remove")).toBeNull();
    expect(row("f-shared").querySelector(".fonts-manager-tag-input")).toBeNull();
  });

  it("clicking a chip shows only fonts with that tag; a tag nobody carries says so", async () => {
    library = [
      font({ id: "f-orb", family: "Orbitron", visibility: "platform", tags: ["sci-fi", "wide"] }),
      font({ id: "f-lob", family: "Lobster", visibility: "platform", tags: ["script", "retro"] }),
      font({ id: "f-exo", family: "Exo", visibility: "platform", tags: ["sci-fi"] }),
    ];
    await mount();
    expect(rowNames()).toEqual(["Orbitron", "Lobster", "Exo"]);

    click([...row("f-orb").querySelectorAll(".fonts-manager-chip-filter")].find((b) => b.textContent === "sci-fi")!);
    expect(rowNames()).toEqual(["Orbitron", "Exo"]);
    const box = container!.querySelector("input[name='tagFilter']") as HTMLInputElement;
    expect(box.value).toBe("sci-fi");

    change(box, "sci-fi, wide");
    expect(rowNames()).toEqual(["Orbitron"]);

    change(box, "nothing-has-this");
    expect(rowNames()).toEqual([]);
    expect(container!.textContent).toContain("No fonts tagged 'nothing-has-this'.");
    expect(container!.textContent).not.toContain(EMPTY_LIBRARY_SENTENCE);

    click(button("Clear"));
    expect(rowNames()).toEqual(["Orbitron", "Lobster", "Exo"]);
  });

  it("an upload the AI could not tag says so instead of passing silently", async () => {
    (window as unknown as { App: { api: unknown } }).App.api = async (path: string, options: RequestInit = {}) => {
      if (String(options.method || "GET").toUpperCase() === "POST") {
        return { ok: true, data: { font: font({ id: "f-new" }), autoTagError: "The AI refused: credit exhausted" } };
      }
      return { ok: true, data: { fonts: [], total: 0 } };
    };
    await mount();
    await fillAndSave("OFL-1.1");
    expect(container!.textContent).toContain("could not be tagged automatically (The AI refused: credit exhausted)");
  });
});

describe("parseTagList", () => {
  it("trims, lowercases, collapses spaces and drops duplicates and blanks", () => {
    expect(parseTagList(" Sci-Fi ,  WIDE,, sci-fi , bold   display")).toEqual(["sci-fi", "wide", "bold display"]);
    expect(noTagMatchSentence(["sci-fi", "script"])).toBe("No fonts tagged 'sci-fi, script'.");
  });
});

describe("stylesSentence", () => {
  it("orders by weight, upright before italic, and names italics", () => {
    expect(stylesSentence([
      { weight: 700, style: "italic", url: "", format: "" },
      { weight: 400, style: "italic", url: "", format: "" },
      { weight: 700, style: "normal", url: "", format: "" },
      { weight: 400, style: "normal", url: "", format: "" },
    ])).toBe("Regular, Italic, Bold, Bold Italic");
    expect(stylesSentence([])).toBe("No files");
  });
});

describe("fontFaceCss", () => {
  it("leaves out a file whose URL could end the rule early", () => {
    const css = fontFaceCss([font({
      id: "x",
      styles: [
        { weight: 400, style: "normal", url: 'https://blob.example/a.woff2") ; } body { color: red', format: "woff2" },
        { weight: 700, style: "normal", url: "https://blob.example/b.woff2", format: "woff2" },
      ],
    })]);
    expect(css.split("@font-face")).toHaveLength(2);
    expect(css).toContain(`font-family: "${previewFamily({ id: "x" })}"`);
    expect(css).toContain('format("woff2")');
    expect(css).not.toContain("color: red");
  });
});
