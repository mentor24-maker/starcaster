// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Ticket 86bbw4dcp — the Auto-tag button in the Blog Links manager.
 *
 * check:render and check:panels are both blind here: an admin-only module is
 * filtered off builder-preview.html, and the panel lattice measures layout,
 * not what a run SAYS. So the whole flow is driven here against a mocked
 * server: confirm → batches → progress → results → Undo → counts re-read.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Batch = { results: Array<{ postId: string; title: string; added: Array<{ tag: string; evidence: string[] }> }>; failed?: Array<{ postId: string; error: string }> };

function stubServer(opts: {
  postIds: string[];
  tagCount: number;
  batches: Batch[];
  stillPresent?: number;
  undoRestored?: number;
  runFails?: boolean;
}) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let batchIndex = 0;
  let tagsReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    const method = String(init?.method || "GET");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: href, method, body });
    const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (href.includes("/api/blog/tags/auto-tag/candidates")) {
      return json({ candidates: { postIds: opts.postIds, total: opts.postIds.length, tagCount: opts.tagCount, batchSize: 2 } });
    }
    if (href.endsWith("/undo") && method === "POST") {
      return json({ undo: { restored: Array.from({ length: opts.undoRestored ?? 1 }, (_, i) => ({ postId: `p${i}` })), failed: [], undone: true } });
    }
    if (href.includes("/api/blog/tags/auto-tag/") && method === "GET") {
      return json({ run: { tagsStillPresent: opts.stillPresent ?? 3, postCount: 2, undone: false } });
    }
    if (href.includes("/api/blog/tags/auto-tag") && method === "POST") {
      if (opts.runFails && batchIndex === 1) {
        return { ok: false, status: 500, json: async () => ({ ok: false, error: { message: "The auto-tag run history table is missing. Run docs/SQL/blog_tag_runs_setup.sql in Supabase." } }) };
      }
      const batch = opts.batches[batchIndex++] ?? { results: [] };
      return json({ run: { runId: "run-1", results: batch.results, failed: batch.failed ?? [] } });
    }
    if (href.includes("/api/blog/tags")) {
      tagsReads++;
      return json({ tags: [{ tag: "junior tennis", postCount: tagsReads > 1 ? 14 : 13, livePostCount: 5 }] });
    }
    if (href.includes("/api/blog/categories")) return json({ categories: [] });
    if (href.includes("/api/blog/relations")) return json({ relations: [] });
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  return calls;
}

async function renderManager(settings: Record<string, string> = {}, liveSite = true) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          { id: "row-1", title: "Links", layout: "single", modules: [{ id: "links-1", type: "admin-blog-links", column: "main", text: "", settings: { showCategories: "false", ...settings } }] }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite={liveSite}
      />
    );
  });
  await settle();
}

async function settle() {
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

const TWO_BATCHES: Batch[] = [
  { results: [
    { postId: "p1", title: "Summer Camp Fun", added: [{ tag: "junior tennis", evidence: ["camp", "kids"] }, { tag: "tennis camp", evidence: ["camp"] }] },
    { postId: "p2", title: "Already Tagged", added: [] },
  ] },
  { results: [
    { postId: "p3", title: "Friday Round Robin", added: [{ tag: "tennis mixer", evidence: ["mixer"] }] },
  ] },
];

describe("Auto-tag button in the Blog Links manager", () => {
  it("confirms with the real counts, runs in batches, shows progress, results and the tally, then re-reads the counts", async () => {
    const calls = stubServer({ postIds: ["p1", "p2", "p3"], tagCount: 7, batches: TWO_BATCHES });
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    await renderManager();

    const btn = button("Auto-tag");
    expect(btn, "the button renders").toBeTruthy();
    expect(btn!.disabled).toBe(false);
    await act(async () => { btn!.click(); });
    await settle();

    expect(confirm).toHaveBeenCalledWith("Read 3 posts and add matching tags from your 7 existing tags? Nothing new is invented, and you can undo the run.");
    const posts = calls.filter((c) => c.url.endsWith("/api/blog/tags/auto-tag") && c.method === "POST");
    expect(posts.map((c) => (c.body as { postIds: string[] }).postIds)).toEqual([["p1", "p2"], ["p3"]]);
    expect((posts[0].body as { runId?: string }).runId).toBeUndefined();
    expect((posts[1].body as { runId?: string }).runId).toBe("run-1");

    const text = document.body.textContent || "";
    expect(text).toContain("3 of 3 posts read — done");
    expect(text).toContain("Added 3 tags across 2 posts. 1 post already had every matching tag.");
    expect(text).toContain("Summer Camp Fun");
    expect(text).toContain("Friday Round Robin");
    expect(text).not.toContain("Already Tagged");
    const chip = Array.from(document.querySelectorAll(".admin-blog-links-autotag-tag")).find((el) => el.textContent === "junior tennis");
    expect(chip?.getAttribute("title")).toBe("Earned by: camp, kids");
    // The link goes to the post's editor on the manager page.
    const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "Summer Camp Fun");
    expect(link?.getAttribute("href")).toBe("/admin-blog-manager?id=p1");
    // Counts were re-read after the run (a second /api/blog/tags read landed).
    expect(calls.filter((c) => /\/api\/blog\/tags(\?|$)/.test(c.url)).length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("14");
    expect(button("Undo this run")).toBeTruthy();
  });

  it("Undo confirms with the server's live count, posts the undo, reports and strikes the tags", async () => {
    const calls = stubServer({ postIds: ["p1", "p2", "p3"], tagCount: 7, batches: TWO_BATCHES, stillPresent: 3, undoRestored: 2 });
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    await renderManager();
    await act(async () => { button("Auto-tag")!.click(); });
    await settle();

    await act(async () => { button("Undo this run")!.click(); });
    await settle();
    expect(confirm).toHaveBeenLastCalledWith("Remove the 3 tags this run added across 2 posts? Tags you added by hand stay.");
    expect(calls.some((c) => c.url.endsWith("/api/blog/tags/auto-tag/run-1/undo") && c.method === "POST")).toBe(true);
    expect(document.body.textContent).toContain("Restored 2 posts. The tags this run added are gone.");
    expect(button("Undo this run")).toBeUndefined();
    expect(document.body.textContent).toContain("Post (tags removed again)");
  });

  it("says why when no post gained a tag", async () => {
    stubServer({ postIds: ["p1"], tagCount: 7, batches: [{ results: [{ postId: "p1", title: "Done Already", added: [] }] }] });
    vi.stubGlobal("confirm", vi.fn(() => true));
    await renderManager();
    await act(async () => { button("Auto-tag")!.click(); });
    await settle();
    expect(document.body.textContent).toContain("No post gained a tag — every clear match was already tagged.");
    expect(button("Undo this run")).toBeTruthy();
  });

  it("a batch that fails keeps the earlier batch visible and undoable, and names the reason", async () => {
    stubServer({ postIds: ["p1", "p2", "p3"], tagCount: 7, batches: TWO_BATCHES, runFails: true });
    vi.stubGlobal("confirm", vi.fn(() => true));
    await renderManager();
    await act(async () => { button("Auto-tag")!.click(); });
    await settle();
    const text = document.body.textContent || "";
    expect(text).toContain("blog_tag_runs_setup.sql");
    expect(text).toContain("Summer Camp Fun");
    expect(button("Undo this run")).toBeTruthy();
  });

  it("cancelling the confirm changes nothing", async () => {
    const calls = stubServer({ postIds: ["p1"], tagCount: 7, batches: TWO_BATCHES });
    vi.stubGlobal("confirm", vi.fn(() => false));
    await renderManager();
    await act(async () => { button("Auto-tag")!.click(); });
    await settle();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(document.body.textContent).not.toContain("posts read");
  });

  it("is inert in the Builder with a note, and honours the two settings", async () => {
    stubServer({ postIds: ["p1"], tagCount: 7, batches: [] });
    await renderManager({}, false);
    expect(button("Auto-tag")!.disabled).toBe(true);
    expect(document.body.textContent).toContain("runs on the admin site, not in the Builder");
    act(() => root?.unmount());

    stubServer({ postIds: ["p1"], tagCount: 7, batches: [] });
    await renderManager({ autoTagButtonLabel: "Tag everything" });
    expect(button("Tag everything")).toBeTruthy();
    expect(document.body.textContent).not.toContain("runs on the admin site");
    act(() => root?.unmount());

    stubServer({ postIds: ["p1"], tagCount: 7, batches: [] });
    await renderManager({ showAutoTag: "false" });
    expect(button("Auto-tag")).toBeUndefined();
  });
});
