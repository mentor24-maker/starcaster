// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Ticket 86bbump4y.
 *
 * "You Might Also Like" flashed on load and then disappeared on a live post
 * page. Nothing was broken: the module was set to match by CATEGORY, and no
 * post on the platform had one (the post editor's Categories field never
 * saved — #568). It matched nothing, and on nothing it returned null, heading
 * included. A module that renders nothing is indistinguishable from a module
 * that is broken.
 *
 * Hiding it from a visitor is right. Hiding it from the person building the
 * page cost an afternoon. These tests hold BOTH halves — and the live-site one
 * matters most, because the failure it guards against (an explanation leaking
 * onto a published page) is the kind nobody notices until a client does.
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

const THE_POST = {
  id: "p1", slug: "what-level", title: "What Level Player Are You?",
  status: "published", tags: ["beginner tennis"], categoryIds: [] as string[],
};

function stubApi({
  current = THE_POST,
  published = [] as Record<string, unknown>[],
  relatedIds = [] as string[],
} = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const href = String(url);
    if (href.includes("/api/blog/relations")) return { ok: true, json: async () => ({ relatedIds }) };
    if (href.includes("/api/blog/posts/")) return { ok: true, json: async () => ({ post: current }) };
    if (href.includes("/api/blog/posts")) return { ok: true, json: async () => ({ posts: published }) };
    if (href.includes("/api/blog/categories")) return { ok: true, json: async () => ({ categories: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

async function render(settings: Record<string, string>, liveSite: boolean) {
  window.history.replaceState({}, "", "/blog-post?post=what-level");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          { id: "row-1", title: "Post", layout: "single",
            modules: [{ id: "rel-1", type: "blog-related-posts", column: "main", text: "", settings }] }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite={liveSite}
      />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

const emptyBox = () => document.querySelector(".builder-related-posts-empty");
const bodyText = () => document.body.textContent ?? "";

describe("on a LIVE published page", () => {
  it("renders nothing at all when there are no matches", async () => {
    // The one behaviour that was always right. A visitor must not be shown an
    // empty box, and must never be shown the builder's explanation.
    stubApi();
    await render({ matchBy: "categories" }, true);
    expect(emptyBox()).toBeNull();
    expect(bodyText()).not.toContain("Nothing to show here yet");
    expect(bodyText()).not.toContain("only visible while building");
    expect(bodyText()).not.toContain("You Might Also Like");
  });

  it("leaks no explanation in hand-picked mode either", async () => {
    stubApi({ relatedIds: [] });
    await render({ matchBy: "picked" }, true);
    expect(emptyBox()).toBeNull();
    expect(bodyText()).not.toContain("pick its related posts");
  });
});

describe("while BUILDING the page, it says why it is empty", () => {
  it("names the real cause when the post has no categories", async () => {
    // The Delray case exactly: match by category, no post has one.
    stubApi();
    await render({ matchBy: "categories" }, false);
    expect(emptyBox()).not.toBeNull();
    expect(bodyText()).toContain("not in any category");
    expect(bodyText()).toContain("Match By to Tags or Hand-picked");
  });

  it("distinguishes 'nothing picked' from 'what is picked is unpublished'", async () => {
    // Two states that look identical on the page and need different fixes.
    stubApi({ relatedIds: [] });
    await render({ matchBy: "picked" }, false);
    expect(bodyText()).toContain("Nothing is related to this post yet");

    act(() => root?.unmount());
    container?.remove();
    // Two relations exist, but neither is in the published list.
    stubApi({ relatedIds: ["p9", "p8"], published: [] });
    await render({ matchBy: "picked" }, false);
    expect(bodyText()).toContain("none are published");
    expect(bodyText()).not.toContain("Nothing is related to this post yet");
  });

  it("says the post has no tags when matching on tags it does not have", async () => {
    stubApi({ current: { ...THE_POST, tags: [] } });
    await render({ matchBy: "tags" }, false);
    expect(bodyText()).toContain("no tags");
  });

  it("says nobody SHARES one when the post does have tags", async () => {
    // A different cause from "this post has none", and a different fix.
    stubApi({
      published: [
        { id: "p2", slug: "other", title: "Other", status: "published", tags: ["doubles"], categoryIds: [] },
        { id: "p1", slug: "what-level", title: "What Level Player Are You?", status: "published", tags: ["beginner tennis"], categoryIds: [] },
      ],
    });
    await render({ matchBy: "tags" }, false);
    expect(bodyText()).toContain("No other published post shares a tag");
  });

  it("says so when the module is not on a post page at all", async () => {
    window.history.replaceState({}, "", "/some-other-page");
    stubApi();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <BuilderTemplatePreview
          layoutSections={normalizeLayoutSections([
            { id: "row-1", title: "Post", layout: "single",
              modules: [{ id: "rel-1", type: "blog-related-posts", column: "main", text: "", settings: { matchBy: "categories" } }] }
          ])}
          pageBackground={createDefaultBackgroundSettings()}
          showShell={false}
        />
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(emptyBox()).not.toBeNull();
    expect(bodyText()).toContain("Related posts appear here when viewing a blog post");
  });

  it("does not show the off-a-post-page note to a VISITOR either", async () => {
    // The mirror of the same defect, and it was already shipped: this branch
    // never checked liveSite, so a module sitting on any published page that
    // is not a post told readers where related posts "appear" — an
    // instruction aimed at somebody who cannot act on it.
    window.history.replaceState({}, "", "/some-other-page");
    stubApi();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <BuilderTemplatePreview
          layoutSections={normalizeLayoutSections([
            { id: "row-1", title: "Post", layout: "single",
              modules: [{ id: "rel-1", type: "blog-related-posts", column: "main", text: "", settings: { matchBy: "categories" } }] }
          ])}
          pageBackground={createDefaultBackgroundSettings()}
          showShell={false}
          liveSite
        />
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(emptyBox()).toBeNull();
    expect(bodyText()).not.toContain("Related posts appear here");
  });

  it("shows the posts, and no explanation, when there ARE matches", async () => {
    // The note must not survive alongside a working list.
    stubApi({
      relatedIds: ["p2"],
      published: [{ id: "p2", slug: "clay", title: "Why Clay Courts", status: "published", tags: [], categoryIds: [] }],
    });
    await render({ matchBy: "picked" }, false);
    expect(emptyBox()).toBeNull();
    expect(bodyText()).toContain("Why Clay Courts");
  });
});
