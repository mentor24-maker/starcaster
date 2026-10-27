// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FontsManager, {
  EMPTY_LIBRARY_SENTENCE, NO_FAVOURITES_SENTENCE, PROJECT_SWITCH_EVENT, VIEW_STORAGE_KEY,
  fontFaceCss, previewFamily, stylesSentence,
  type FontRow,
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
let reads: string[] = [];
let activeProject = "proj_a";
/** The server's stars: what GET reports and what PUT / DELETE …/favorite change. */
let starred = new Set<string>();
let favoritesError = "";
let refuseStar = "";

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
  activeProject = "proj_a";
  starred = new Set();
  favoritesError = "";
  refuseStar = "";
  window.localStorage.clear();
  (window as unknown as { App: unknown }).App = {
    api: async (path: string, options: RequestInit = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      if (method === "GET") {
        reads.push(`${activeProject} ${path}`);
        const fonts = library.map((f) => ({ ...f, isFavorite: starred.has(f.id) }));
        return { ok: true, data: { fonts, total: fonts.length, favoritesError } };
      }
      const fav = /^\/api\/fonts\/([^/]+)\/favorite$/.exec(path);
      if (fav && (method === "PUT" || method === "DELETE")) {
        if (refuseStar) return { ok: false, error: { message: refuseStar } };
        const id = decodeURIComponent(fav[1]);
        if (method === "PUT") starred.add(id); else starred.delete(id);
        return { ok: true, data: { fontId: id, isFavorite: starred.has(id) } };
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
      if (method === "DELETE") {
        return { ok: true, data: { font: library[0], filesRemoved: 2, filesNotRemoved: [] } };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
});

afterEach(() => {
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
    expect(shared.querySelector("button[aria-label^='Delete']")).toBeNull();
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

describe("FontsManager favourites (Font Library 8)", () => {
  const three = () => [
    font({ id: "f-bungee", family: "Bungee", visibility: "platform" }),
    font({ id: "f-exo", family: "Exo", visibility: "platform" }),
    font({ id: "f-orbitron", family: "Orbitron", visibility: "platform" }),
  ];
  const star = (family: string) => container!.querySelector(
    `button[aria-label='Add ${family} to favourites'], button[aria-label='Remove ${family} from favourites']`,
  ) as HTMLButtonElement;
  const favouritesButton = () => [...container!.querySelectorAll(".fonts-manager-view-switch button")]
    .find((b) => (b.textContent || "").startsWith("Favourites")) as HTMLButtonElement;

  async function remount() {
    act(() => { root?.unmount(); });
    container?.remove();
    await mount();
  }

  it("clicking ☆ turns it to ★, and after a reload it is still ★", async () => {
    library = three();
    await mount();
    expect(star("Orbitron").textContent).toBe("☆");
    click(star("Orbitron"));
    await flush();
    expect(star("Orbitron").textContent).toBe("★");
    expect(star("Orbitron").getAttribute("aria-pressed")).toBe("true");
    expect([...starred]).toEqual(["f-orbitron"]);

    await remount();
    expect(star("Orbitron").textContent).toBe("★");
    expect(star("Exo").textContent).toBe("☆");
  });

  it("Favourites (N) shows exactly the starred fonts, N matches, and unstarring removes one", async () => {
    library = three();
    starred = new Set(["f-orbitron", "f-bungee"]);
    await mount();
    expect(favouritesButton().textContent).toBe("Favourites (2)");
    expect(rowNames()).toEqual(["Bungee", "Exo", "Orbitron"]);

    click(favouritesButton());
    expect(rowNames()).toEqual(["Bungee", "Orbitron"]);

    click(star("Bungee"));
    await flush();
    expect(rowNames()).toEqual(["Orbitron"]);
    expect(favouritesButton().textContent).toBe("Favourites (1)");

    click(button("All fonts"));
    expect(rowNames()).toEqual(["Bungee", "Exo", "Orbitron"]);
  });

  it("with nothing starred the Favourites view says why, with no table", async () => {
    library = three();
    await mount();
    click(favouritesButton());
    expect(container!.textContent).toContain(NO_FAVOURITES_SENTENCE);
    expect(container!.querySelector("table")).toBeNull();
    // The switch stays, so the way back to All fonts is still on screen.
    expect(button("All fonts")).toBeTruthy();
  });

  it("the switch remembers its position after a reload", async () => {
    library = three();
    starred = new Set(["f-exo"]);
    await mount();
    click(favouritesButton());
    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBe("favorites");

    await remount();
    expect(favouritesButton().getAttribute("aria-pressed")).toBe("true");
    expect(rowNames()).toEqual(["Exo"]);

    click(button("All fonts"));
    await remount();
    expect(rowNames()).toEqual(["Bungee", "Exo", "Orbitron"]);
  });

  it("a refused star stays ☆ and says why", async () => {
    library = three();
    refuseStar = "Nobody is signed in, so there is no list of favourite fonts to read or change.";
    await mount();
    click(star("Exo"));
    await flush();
    expect(star("Exo").textContent).toBe("☆");
    expect(container!.textContent).toContain(refuseStar);
  });

  it("when the server could not read the stars, the Favourites view says that instead of 'no favourites'", async () => {
    library = three();
    favoritesError = "Your favourite fonts could not be read: relation \"font_favorites\" does not exist";
    await mount();
    expect(container!.textContent).toContain(favoritesError);
    click(favouritesButton());
    expect(container!.textContent).toContain(favoritesError);
    expect(container!.textContent).not.toContain(NO_FAVOURITES_SENTENCE);
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
