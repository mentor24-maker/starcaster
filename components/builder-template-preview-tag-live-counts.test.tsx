// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Ticket 86bbume7b.
 *
 * The Blog Links Manager said "junior tennis — 13 posts". The public tag page
 * said none. Both were right: all 13 were DRAFTS, and the public feed asks for
 * published posts only. The manager's number was true and unreadable, and it
 * was reported as a broken front end.
 *
 * check:panels and check:render are both blind here — this is an admin-only
 * module, so builder-preview.html filters it off a public slug and the panel
 * lattice does not measure what a count SAYS. vitest is where this can be
 * held at all.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.querySelectorAll(".admin-blog-links-posts-overlay").forEach((el) => el.remove());
  container = null;
  root = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type TagRow = { tag: string; postCount: number; livePostCount?: number };

function stubApi(tags: TagRow[], posts: Record<string, unknown>[] = []) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const href = String(url);
    if (href.includes("/api/blog/tags/posts")) return { ok: true, json: async () => ({ posts }) };
    if (href.includes("/api/blog/tags")) return { ok: true, json: async () => ({ tags }) };
    if (href.includes("/api/blog/categories")) return { ok: true, json: async () => ({ categories: [] }) };
    if (href.includes("/api/blog/relations")) return { ok: true, json: async () => ({ relations: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

async function renderManager(tags: TagRow[], posts: Record<string, unknown>[] = []) {
  stubApi(tags, posts);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          {
            id: "row-1",
            title: "Links",
            layout: "single",
            modules: [{ id: "links-1", type: "admin-blog-links", column: "main", text: "", settings: { showCategories: "false" } }]
          }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
      />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

/** The count cell for one tag: the row's text, minus the tag itself. */
function rowText(tag: string): string {
  const label = Array.from(document.querySelectorAll("span")).find((el) => el.textContent === tag);
  const row = label?.parentElement;
  return (row?.textContent ?? "").trim();
}

async function openTagPosts(tag: string) {
  const button = Array.from(document.querySelectorAll("button.admin-blog-links-count-btn")).find(
    (el) => (el.getAttribute("title") ?? "").includes(tag)
  ) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`no count button for "${tag}"`);
  await act(async () => { button.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("the tag manager's count says how many posts are LIVE", () => {
  it("says none are live when every post carrying the tag is a draft", async () => {
    // The Delray case exactly.
    await renderManager([{ tag: "junior tennis", postCount: 13, livePostCount: 0 }]);
    expect(rowText("junior tennis")).toContain("13");
    expect(rowText("junior tennis")).toContain("none live");
  });

  it("says nothing extra when every post carrying the tag is published", async () => {
    // A healthy tag must not grow a warning. A note on every row is a note
    // nobody reads, and the point is that this one is unusual.
    await renderManager([{ tag: "tennis", postCount: 4, livePostCount: 4 }]);
    expect(rowText("tennis")).toContain("4");
    expect(rowText("tennis")).not.toContain("live");
  });

  it("gives the number when only some are live", async () => {
    await renderManager([{ tag: "events", postCount: 9, livePostCount: 2 }]);
    expect(rowText("events")).toContain("2 live");
  });

  it("says NOTHING when the server did not send a live count", async () => {
    // A server that predates this field is not a server saying "none are
    // live". Rendering the absence as 0 would tell the operator his whole
    // blog is dark — the same class of lie this ticket exists to remove.
    await renderManager([{ tag: "legacy", postCount: 6 }]);
    expect(rowText("legacy")).toContain("6");
    expect(rowText("legacy")).not.toContain("live");
  });

  it("puts the explanation in the tooltip too, in a full sentence", async () => {
    await renderManager([{ tag: "junior tennis", postCount: 13, livePostCount: 0 }]);
    const button = document.querySelector("button.admin-blog-links-count-btn");
    expect(button?.getAttribute("title")).toContain("None are published");
  });
});

describe("the posts popup explains why the public page is empty", () => {
  const DRAFTS = [
    { id: "p1", title: "After School Program", slug: "after-school", status: "draft" },
    { id: "p2", title: "Summer Camp", slug: "summer-camp", status: "draft" },
  ];

  it("states the published count in words when none are published", async () => {
    await renderManager([{ tag: "junior tennis", postCount: 2, livePostCount: 0 }], DRAFTS);
    await openTagPosts("junior tennis");
    const note = document.querySelector(".admin-blog-links-posts-live-note");
    expect(note?.textContent).toContain("0 of 2 published");
    expect(note?.textContent).toContain("public tag page shows nothing");
  });

  it("says nothing when they are all published", async () => {
    await renderManager(
      [{ tag: "tennis", postCount: 2, livePostCount: 2 }],
      DRAFTS.map((p) => ({ ...p, status: "published" }))
    );
    await openTagPosts("tennis");
    expect(document.querySelector(".admin-blog-links-posts-live-note")).toBeNull();
  });

  it("counts the posts it actually loaded, not the number on the tag row", async () => {
    // The row's count and the popup's list are two different reads, taken at
    // two different moments. Summarising from the row would report a number
    // nobody measured against the posts on screen — and would quietly go
    // wrong the moment one of them was published from another tab.
    await renderManager(
      [{ tag: "junior tennis", postCount: 2, livePostCount: 0 }],
      [
        { id: "p1", title: "After School Program", slug: "after-school", status: "published" },
        { id: "p2", title: "Summer Camp", slug: "summer-camp", status: "draft" },
      ]
    );
    await openTagPosts("junior tennis");
    const note = document.querySelector(".admin-blog-links-posts-live-note");
    expect(note?.textContent).toContain("1 of 2 published");
    expect(note?.textContent).not.toContain("0 of 2");
  });
});
