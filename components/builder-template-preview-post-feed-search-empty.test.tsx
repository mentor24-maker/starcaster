// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The Post Feed's dropdown filters each name themselves when they empty the
 * page ("No posts tagged X" — #572). Its search box did not, and that gap is
 * the same defect one step further on: a visitor who typed a word nothing
 * matched was told "No posts match your filters", which never says WHICH word
 * emptied the page.
 *
 * Worse, with a tag also selected the message read "No posts tagged
 * “beginner tennis”." — a sentence that is FALSE while posts carry that tag.
 * The search emptied the list; the tag took the blame. A confident wrong
 * message is the worst of the three (docs/DOCTRINE.md §5.31).
 *
 * These tests came out of 86bbvqhp6, where the /tags page's search was being
 * switched from the dead sidebar module to the feed's own field. That switch
 * is only worth making if the field tells the truth when it finds nothing.
 */

const POSTS = [
  { id: "p1", slug: "levels", title: "What Level Player Are You?", excerpt: "Find your level.", tags: ["beginner tennis"], categoryIds: [], status: "published", published_at: "2026-03-01" },
  { id: "p2", slug: "open",   title: "Delray Beach Open",          excerpt: "ATP week.",        tags: ["ATP tennis"],      categoryIds: [], status: "published", published_at: "2026-04-01" },
  { id: "p3", slug: "clinic", title: "Adult Clinics",              excerpt: "Weekly clinics.",  tags: ["beginner tennis"], categoryIds: [], status: "published", published_at: "2026-05-01" }
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
    if (href.includes("/api/blog/categories")) return { ok: true, json: async () => ({ categories: [] }) };
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
            modules: [{ id: "feed-1", type: "blog-post-list", column: "main", text: "", settings: { showSearch: "true", ...settings } }]
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

/*
 * React tracks an input's value on the DOM node, so assigning `.value` and
 * firing "input" is ignored — the native setter is what makes onChange run.
 * This is the visitor typing, which is the whole thing under test.
 */
async function typeInSearchBox(text: string) {
  const input = document.querySelector('input[type="search"]') as HTMLInputElement | null;
  if (!input) throw new Error("the feed rendered no search field");
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/*
 * The date bounds are two <input type="date"> in the filter bar, titled From
 * and To. Same native-setter dance as the search box: React ignores a plain
 * `.value =`.
 */
async function setDateBound(title: "From" | "To", value: string) {
  const input = document.querySelector(`input[type="date"][title="${title}"]`) as HTMLInputElement | null;
  if (!input) throw new Error(`the feed rendered no ${title} date field`);
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function cardTitles(): string {
  return Array.from(document.querySelectorAll("h3, h2")).map((h) => h.textContent ?? "").join(" ");
}

describe("Post Feed search that finds nothing", () => {
  it("filters the list down when the word does match", async () => {
    // A2's premise: the feed's own field really does search. If this fails,
    // switching /tags onto it would trade one dead box for another.
    await renderFeed("");
    await typeInSearchBox("Clinics");

    expect(cardTitles()).toContain("Adult Clinics");
    expect(cardTitles()).not.toContain("Delray Beach Open");
  });

  it("names the word that emptied the page", async () => {
    await renderFeed("");
    await typeInSearchBox("zzzznotarealquery");

    expect(document.body.textContent).toContain("No posts match “zzzznotarealquery”.");
    expect(document.body.textContent).not.toContain("No posts match your filters.");
  });

  it("does not blame the tag for an emptiness the search caused", async () => {
    // Posts tagged "beginner tennis" exist; "No posts tagged X." would be a lie.
    await renderFeed("?tag=beginner%20tennis", { filterMode: "tag" });
    expect(cardTitles()).toContain("What Level Player Are You?");

    await typeInSearchBox("zzzznotarealquery");

    expect(document.body.textContent)
      .toContain("No posts tagged “beginner tennis” match “zzzznotarealquery”.");
    expect(document.body.textContent).not.toContain("No posts tagged “beginner tennis”.");
  });

  it("offers a way back, and taking it restores the whole feed", async () => {
    await renderFeed("");
    await typeInSearchBox("zzzznotarealquery");

    const back = Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "Show all posts");
    expect(back).toBeTruthy();

    await act(async () => { back!.click(); });
    expect(cardTitles()).toContain("Delray Beach Open");
    expect(document.body.textContent).not.toContain("No posts match");
  });

  it("leaves the dropdown-only messages exactly as they were", async () => {
    // #572's wording is load-bearing and unchanged when nothing was typed.
    await renderFeed("?tag=junior%20tennis", { filterMode: "tag" });

    expect(document.body.textContent).toContain("No posts tagged “junior tennis”.");
    expect(document.body.textContent).not.toContain("match “");
  });
});

/*
 * Round 1 of 86bbvqhp6 came back: the message above named the search word for
 * an emptiness the DATE filter had caused, and offered to un-empty a page that
 * an unknown ?category= slug had emptied for good. Both are the original
 * defect with the roles swapped — a specific, confident, false sentence where
 * the vague-but-true one used to be — so both are regressions, not polish.
 */
describe("Post Feed empty state — every filter that narrowed the page names itself", () => {
  it("does not blame the search word for an emptiness a date bound caused", async () => {
    // Every post is published in 2026, so a From of 2030 empties the list on
    // its own while "Clinics" still matches a post sitting right there.
    await renderFeed("", { showDateFilter: "true" });
    await typeInSearchBox("Clinics");
    expect(cardTitles()).toContain("Adult Clinics");

    await setDateBound("From", "2030-01-01");

    /*
     * Updated by 86bbw4j6e. This used to read "... match “Clinics”." — the
     * date named alongside the word, per #643's "a filter only takes credit
     * alongside the search, never instead of it". But the date bound empties
     * this list on its OWN: clearing "Clinics" brings nothing back, so naming
     * it is an invitation the page cannot honour. That is word for word the
     * reason #643 gives above its own missingCatSlug carve-out, and it applies
     * to every dropdown, not to that one alone. The rule is now general — the
     * search is named only while the dropdowns leave posts standing.
     */
    expect(document.body.textContent)
      .toContain("No posts published on or after 2030-01-01.");
    expect(document.body.textContent).not.toContain("match “Clinics”");
    expect(document.body.textContent).not.toContain("No posts match your filters.");
  });

  it("names a date bound on its own when nothing was typed", async () => {
    await renderFeed("", { showDateFilter: "true" });
    await setDateBound("To", "2020-01-01");

    expect(document.body.textContent).toContain("No posts published on or before 2020-01-01.");
    expect(document.body.textContent).not.toContain("No posts match your filters.");
  });

  it("names both bounds as one range", async () => {
    await renderFeed("", { showDateFilter: "true" });
    await setDateBound("From", "2030-01-01");
    await setDateBound("To", "2030-12-31");

    expect(document.body.textContent)
      .toContain("No posts published between 2030-01-01 and 2030-12-31.");
  });

  it("names a tag and a date together, in one sentence", async () => {
    await renderFeed("?tag=beginner%20tennis", { filterMode: "tag", showDateFilter: "true" });
    await typeInSearchBox("Level");
    expect(cardTitles()).toContain("What Level Player Are You?");

    await setDateBound("From", "2030-01-01");

    /*
     * Updated by 86bbw4j6e for the same reason as the test above, and the
     * multi-filter sentence is why it keeps its own case: the tag and the date
     * still join with "and", and the search still drops out, because tag +
     * date alone already leave nothing.
     */
    expect(document.body.textContent).toContain(
      "No posts tagged “beginner tennis” and published on or after 2030-01-01."
    );
    expect(document.body.textContent).not.toContain("match “Level”");
  });

  it("does not invite clearing a search that an unknown category slug made irrelevant", async () => {
    // missingCatSlug drops every post whatever else is set, so "…match “Tennis”."
    // would promise that deleting the word brings posts back. Nothing will.
    await renderFeed("?category=ghost-slug");
    await typeInSearchBox("Tennis");

    expect(document.body.textContent).toContain("No posts in the category “ghost-slug”.");
    expect(document.body.textContent).not.toContain("match “Tennis”.");
  });
});

/*
 * Task 86bbw4j6e. #643 carved the search term out of the blame for an unknown
 * ?category= slug, giving the reason in full: "would promise that deleting the
 * word brings posts back. Nothing will." Every dropdown can empty the list on
 * its own, so that reason was never about the category slug — 97 tags on the
 * Delray project carry no published post at all (22 are published in total),
 * and the live tag cloud on /tags links to every one of them. The carve-out
 * becomes the rule it was already describing.
 */
describe("Post Feed empty state — a filter that empties the list on its own takes the whole blame", () => {
  it("does not name the search word when the tag has no posts at all", async () => {
    // Nothing carries "junior tennis", so clearing "tennis" brings nothing back.
    await renderFeed("?tag=junior%20tennis", { filterMode: "tag" });
    expect(document.body.textContent).toContain("No posts tagged “junior tennis”.");

    await typeInSearchBox("tennis");

    expect(document.body.textContent).toContain("No posts tagged “junior tennis”.");
    expect(document.body.textContent).not.toContain("match “tennis”");
  });

  it("does the same for an author nobody wrote as", async () => {
    await renderFeed("?author=Nobody");
    await typeInSearchBox("tennis");

    expect(document.body.textContent).toContain("No posts by “Nobody”.");
    expect(document.body.textContent).not.toContain("match “tennis”");
  });

  it("still names the search while the tag DOES leave posts standing", async () => {
    /*
     * The other direction, and the one #643 exists to protect. Posts carry
     * "beginner tennis", so the search is what emptied the page and the
     * sentence has to say so — this is the case the general rule must not
     * swallow.
     */
    await renderFeed("?tag=beginner%20tennis", { filterMode: "tag" });
    await typeInSearchBox("zzzznotarealquery");

    expect(document.body.textContent)
      .toContain("No posts tagged “beginner tennis” match “zzzznotarealquery”.");
  });

  it("offers a way back out of a filter-only emptiness", async () => {
    // The message stops naming the word, but the escape hatch stays.
    await renderFeed("?tag=junior%20tennis", { filterMode: "tag" });
    await typeInSearchBox("tennis");

    const back = Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "Show all posts");
    expect(back).toBeTruthy();

    await act(async () => { back!.click(); });
    expect(cardTitles()).toContain("Delray Beach Open");
  });
});
