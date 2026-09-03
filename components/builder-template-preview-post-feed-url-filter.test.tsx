// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The Post Feed reads ?tag= and ?category= off the page URL. It always did —
 * what it did NOT do was admit it, and on 2026-09-03 that cost the operator a
 * diagnosis: /tags?tag=junior%20tennis showed the tag dropdown reading "All
 * Tags" above "No posts match your filters", which reads as a parameter that
 * was ignored. It had not been ignored; the site simply has no such tag.
 *
 * A <select> whose value matches none of its <option>s displays the first one,
 * so the control was contradicting the filter it was applying. These tests hold
 * the three honesty properties that came out of that: the seeded value is
 * VISIBLE, the empty state NAMES it, and an unknown ?category= empties the page
 * the same way an unknown ?tag= does instead of silently showing everything.
 */

const POSTS = [
  { id: "p1", slug: "levels", title: "What Level Player Are You?", tags: ["beginner tennis", "tennis levels"], categoryIds: ["c1"], status: "published" },
  { id: "p2", slug: "open",   title: "Delray Beach Open",         tags: ["ATP tennis", "tournament"],          categoryIds: ["c2"], status: "published" },
  { id: "p3", slug: "clinic", title: "Adult Clinics",             tags: ["tennis clinics"],                    categoryIds: [],     status: "published" }
];
const CATEGORIES = [
  { id: "c1", name: "Guides", slug: "guides" },
  { id: "c2", name: "Events", slug: "events" }
];

// react-dom 18 wants this flag before act(); without it every render warns.
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

function stubApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const href = String(url);
    if (href.includes("/api/blog/posts")) return { ok: true, json: async () => ({ posts: POSTS }) };
    if (href.includes("/api/blog/categories")) return { ok: true, json: async () => ({ categories: CATEGORIES }) };
    // Anything else this page happens to call (the card template, the
    // reminder runtime's context) answers the way an unreachable endpoint
    // does, so no other module's fallback path is skipped by the stub.
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

async function renderFeed(search: string, settings: Record<string, string> = {}) {
  window.history.replaceState({}, "", `/tags${search}`);
  stubApi();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          {
            id: "row-1",
            title: "Feed",
            layout: "single",
            modules: [{ id: "feed-1", type: "blog-post-list", column: "main", text: "", settings }]
          }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
      />
    );
  });
  // Let the posts/categories/card-template promises settle.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function selectShowing(firstOptionLabel: string): HTMLSelectElement {
  const found = Array.from(document.querySelectorAll("select")).find((el) =>
    (el.options[0]?.textContent ?? "") === firstOptionLabel
  );
  if (!found) throw new Error(`No <select> whose first option is "${firstOptionLabel}"`);
  return found;
}

function cardTitles(): string[] {
  return Array.from(document.querySelectorAll("h3, h2")).map((h) => h.textContent ?? "");
}

describe("Post Feed seeded from the URL", () => {
  it("shows the tag it filtered on, and only its posts", async () => {
    await renderFeed("?tag=beginner%20tennis");

    const select = selectShowing("All Tags");
    expect(select.value).toBe("beginner tennis");
    expect(cardTitles().join(" ")).toContain("What Level Player Are You?");
    expect(cardTitles().join(" ")).not.toContain("Delray Beach Open");
  });

  it("shows a tag no post carries, rather than snapping back to All Tags", async () => {
    // The 9/3 report exactly: the tag does not exist on this site.
    await renderFeed("?tag=junior%20tennis");

    const select = selectShowing("All Tags");
    expect(select.value).toBe("junior tennis");
    expect(Array.from(select.options).map((o) => o.textContent)).toContain("junior tennis");
  });

  it("names the tag in the empty state instead of blaming 'your filters'", async () => {
    await renderFeed("?tag=junior%20tennis");

    expect(document.body.textContent).toContain("No posts tagged “junior tennis”.");
    expect(document.body.textContent).not.toContain("No posts match your filters.");
    expect(Array.from(document.querySelectorAll("button")).map((b) => b.textContent))
      .toContain("Show all posts");
  });

  it("clears back to the whole feed from that empty state", async () => {
    await renderFeed("?tag=junior%20tennis");
    const button = Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "Show all posts")!;

    await act(async () => { button.click(); });

    expect(cardTitles().join(" ")).toContain("Delray Beach Open");
  });

  it("orders tags alphabetically without filing the capitalised ones first", async () => {
    await renderFeed("?tag=beginner%20tennis");

    const labels = Array.from(selectShowing("All Tags").options)
      .map((o) => o.textContent ?? "")
      .slice(1);
    // Plain .sort() would put "ATP tennis" above every lowercase tag.
    expect(labels).toEqual(["ATP tennis", "beginner tennis", "tennis clinics", "tennis levels", "tournament"]);
  });

  it("shows the category it filtered on, by slug", async () => {
    await renderFeed("?category=events");

    expect(selectShowing("All Categories").selectedOptions[0]?.textContent).toBe("Events");
    expect(cardTitles().join(" ")).toContain("Delray Beach Open");
    expect(cardTitles().join(" ")).not.toContain("Adult Clinics");
  });

  it("empties the page for an unknown category instead of showing every post", async () => {
    // The mirror-image bug: an unmatched slug used to leave the filter unset,
    // so the visitor got the full feed as though they had asked for nothing.
    await renderFeed("?category=nonsense");

    expect(cardTitles().join(" ")).not.toContain("Delray Beach Open");
    expect(document.body.textContent).toContain("No posts in the category “nonsense”.");
    expect(selectShowing("All Categories").selectedOptions[0]?.textContent).toBe("nonsense");
  });

  it("leaves a feed with no URL parameter exactly as it was", async () => {
    await renderFeed("");

    expect(selectShowing("All Tags").value).toBe("");
    expect(cardTitles().join(" ")).toContain("Delray Beach Open");
    expect(document.body.textContent).not.toContain("No posts");
  });
});
