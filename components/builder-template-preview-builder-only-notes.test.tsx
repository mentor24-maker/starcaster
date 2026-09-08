// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Ticket 86bbunq4c.
 *
 * A module that finds nothing sometimes explains itself — "Set a Form ID in
 * module settings", "Add tags in the Messaging section". That text is written
 * for whoever is BUILDING the page, and it was rendering on published tenant
 * sites, to readers with no module settings, no Messaging section and nothing
 * they can do about any of it.
 *
 * Dane reported one under a blog post on delraytennis.starcaster.pro on
 * 2026-09-03. Six were live. Two of them had been fixed earlier the same day
 * (PR #576) and the shape came straight back in the four that were missed,
 * which is why there is now a blocking check as well as these tests.
 *
 * Each module gets BOTH halves: silent for a visitor, and still helpful while
 * building. Testing only the first would let somebody "fix" a leak by deleting
 * the note, trading a visible failure for a silent one.
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

/** Every endpoint these modules touch answers "nothing here", which is the case under test. */
function stubEmptyApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const href = String(url);
    if (href.includes("/api/messaging/tags")) return { ok: true, json: async () => ({ tags: [] }) };
    if (href.includes("/api/messaging/topics")) return { ok: true, json: async () => ({ topics: [] }) };
    if (href.includes("/api/blog/posts")) return { ok: true, json: async () => ({ posts: [] }) };
    if (href.includes("/api/blog/categories")) return { ok: true, json: async () => ({ categories: [] }) };
    if (href.includes("/api/blog/relations")) return { ok: true, json: async () => ({ relatedIds: [] }) };
    if (href.includes("/api/crm")) return { ok: true, json: async () => ({ data: null }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

async function renderModule(type: string, settings: Record<string, string>, liveSite: boolean) {
  stubEmptyApi();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          { id: "row-1", title: "Row", layout: "single",
            modules: [{ id: `m-${type}`, type, column: "main", text: "", settings }] }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite={liveSite}
      />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

const text = () => document.body.textContent ?? "";

/**
 * Every module that carries a builder-only note, with the phrase that must
 * never reach a visitor. Adding a module here is cheaper than rediscovering
 * this on a client's site.
 */
const CASES: Array<{ name: string; type: string; settings: Record<string, string>; phrase: string }> = [
  {
    name: "messaging tag list (the one Dane reported)",
    type: "messaging-tag-list", settings: { layout: "cloud" },
    phrase: "No tags found",
  },
  {
    name: "messaging topic list",
    // showAll adds an "All Topics" pill, so the empty branch is only reached
    // with it off — the module is otherwise never empty, which is worth
    // knowing: the leak was narrower here than in its sibling.
    type: "messaging-topic-list", settings: { layout: "cloud", showAll: "false" },
    phrase: "No topics found",
  },
  {
    name: "CRM form with no form id",
    type: "crm-form", settings: {},
    phrase: "Set a Form ID in module settings",
  },
  {
    name: "newsletter block with no form id",
    type: "blog-newsletter-subscribe", settings: {},
    phrase: "Paste a CRM Form ID in module settings",
  },
  {
    name: "related posts, manual, with nothing added",
    type: "blog-related-posts", settings: { matchBy: "manual", manualPosts: "[]" },
    phrase: "Add posts in module settings",
  },
];

describe("a note meant for the page builder never reaches a visitor", () => {
  for (const { name, type, settings, phrase } of CASES) {
    it(`${name} is silent on a live site`, async () => {
      await renderModule(type, settings, true);
      expect(text()).not.toContain(phrase);
      // Nor any of the giveaway phrases, whatever the wording becomes.
      expect(text()).not.toMatch(/in module settings|in the Messaging section|in Builder ›/);
    });
  }
});

describe("...and still says what to do while building", () => {
  for (const { name, type, settings, phrase } of CASES) {
    it(`${name} still explains itself in the Builder`, async () => {
      // The other half of the rule. Deleting the note would pass the test
      // above and silently lose the only thing telling the operator why the
      // module is blank — trading a visible failure for an invisible one.
      await renderModule(type, settings, false);
      expect(text()).toContain(phrase);
    });
  }
});

describe("a note that is ALL the module would render takes the module with it", () => {
  it("the newsletter block does not leave a headline over nothing", async () => {
    // Hiding only the note leaves a coloured box and a heading promising a
    // signup that cannot happen — which looks like a form that failed to load.
    await renderModule("blog-newsletter-subscribe", { headline: "Stay in the loop" }, true);
    expect(text()).not.toContain("Stay in the loop");
    await renderModule("blog-newsletter-subscribe", { headline: "Stay in the loop", crmFormId: "form_1" }, true);
    expect(text()).toContain("Stay in the loop");
  });

  it("related posts does not leave its title over nothing", async () => {
    await renderModule("blog-related-posts", { matchBy: "manual", manualPosts: "[]", title: "You Might Also Like" }, true);
    expect(text()).not.toContain("You Might Also Like");
  });
});
