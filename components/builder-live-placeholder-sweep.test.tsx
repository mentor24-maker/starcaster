// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILDER_MODULE_TYPES,
  createDefaultBackgroundSettings,
  normalizeLayoutSections,
  type BuilderTemplateModule
} from "@/lib/builder-template";
import { PRIVATE_ONLY_MODULE_TYPES } from "@/lib/public-site-sections";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Ticket 86bbvqcbk — the gate that closes the class.
 *
 * Four review rounds of 86bbugd2e each closed the Builder-time placeholder the
 * round before had named, and each missed the next one. That is not a build
 * failing: it is a criterion nobody can close by reading a 12,000-line file
 * with 61 module types in it. Three were still live on client sites when this
 * was written — "Post body will appear here when opened with ?post=slug." on
 * delraytennis.starcaster.pro/blog-post and on a law firm's public site,
 * "?event=your-event-slug" on the events page, and "Use the Create Post
 * module" on five published pages across two tenants.
 *
 * A grep could not have found any of them. None carries a phrase on
 * check:builder-notes's list and none is an `x.length ? x : PLACEHOLDER`
 * fallback — they are plain JSX. So this RENDERS instead: every module type,
 * with `liveSite` set, and reads the text a visitor would actually get.
 *
 * Two properties worth knowing before changing anything here:
 *
 * 1. Every module is rendered with EMPTY settings, so the only text this sweep
 *    can ever see is text the CODE supplies. A tenant's own copy never reaches
 *    it. That is what makes the phrase list below safe to keep broad — unlike
 *    check_builder_only_notes.cjs, which greps source and must stay narrow to
 *    avoid blocking a client's real words.
 *
 * 2. It renders each module in three PLACEMENTS, not one. A leak is not always
 *    in the module: `TableModulePreview` and the nav mega-menu's feature slot
 *    both rendered a nested module with no `liveSite` prop at all, so every
 *    guard in every module was bypassed inside them (86bbvqcbk, finding 1). A
 *    gate that only rendered modules at the top level would have certified a
 *    hole it could not see.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The giveaways, each with the reason it is one. Deliberately a list rather
 * than a heuristic: "is this text addressed to the person building the page"
 * has no clean mechanical test, and a list that says WHY each entry is here is
 * one the next reader can extend safely. It is expected to grow.
 */
const PLACEHOLDER_PHRASES: Array<{ re: RegExp; why: string }> = [
  { re: /\bmodules?\b/i, why: '"module" is a Builder word — a visitor has none to open' },
  { re: /\bin (?:the )?Builder\b|\bBuilder\s*›|\bin the editor\b/i, why: "names the page editor" },
  { re: /\bStarCaster\b/i, why: "names our product on the tenant's own site" },
  { re: /\bin the Messaging section\b/i, why: "names an admin section" },
  { re: /\?[a-z][\w-]*=/, why: "a query-string instruction — a visitor does not edit the address bar" },
  { re: /\bwill appear here\b|\bappears? here when\b/i, why: "design-time filler" },
  { re: /\bChoose (?:an?|the)\s+[a-z]/, why: "a builder affordance — a visitor has nothing to choose" },
  { re: /\bTest Burst\b/i, why: "a canvas-only test control" },
  {
    re: /\bLorem ipsum\b|\bExample Tag\b|\bPost Title\b|\bMerch product\b|\byour-[a-z-]*slug\b/i,
    why: "sample content standing in for the real thing",
  },
  /*
   * Anchored to the WHOLE rendered text, which is how a module-name-as-content
   * case gets recorded without flagging the same word used properly. An
   * unconfigured video module renders an empty frame captioned "Video"; a
   * configured one renders an embed, and a confetti module renders a button
   * that legitimately says "Confetti". Only the first has the module's name as
   * its entire output. Tenant copy can never reach this — the sweep renders
   * code defaults only.
   */
  { re: /^Video$/, why: "the module's own name standing alone where a video should be" },
];

/**
 * Modules allowed to speak to an admin, each with the reason it is allowed.
 *
 * This exists so "that one is meant to say that" is a recorded decision rather
 * than an omission nobody can tell from an oversight. Two strengths of reason,
 * and they are not the same:
 *
 *   STRIPPED — the module is in PRIVATE_ONLY_MODULE_TYPES, so
 *   filterPublicSections removes it from every public page before anything
 *   renders. Its text cannot reach a visitor at all. Asserted below against
 *   that set, so deleting a type from it fails this test rather than quietly
 *   widening the allow-list.
 *
 *   ADMIN PAGE — the module renders wherever it is placed, and is kept off
 *   public pages only by living on a private slug (`admin`, `admin-*`, and the
 *   exact list in public-site-page-slugs.js), which needs a project-admin
 *   login. Weaker: dropped onto a public page it WOULD paint. Earlier rounds
 *   of 86bbugd2e made that call deliberately for blog-card-manager and
 *   admin-modules; this records it rather than re-litigating it.
 */
const ADMIN_ALLOWED: Record<string, string> = {
  "blog-post-create": "STRIPPED — the post editor; filterPublicSections removes it from every public page",
  "blog-post-manager": "STRIPPED — the post manager; filterPublicSections removes it from every public page",
  "blog-category-manager": "STRIPPED — the category manager; same filter",
  "event-manager": "STRIPPED — the event manager; same filter",
  "blog-card-manager": "ADMIN PAGE — the card-template editor, reached from the tenant admin back-end (86bbugd2e left this deliberately)",
  "media-manager": "ADMIN PAGE — the media library, reached from the tenant admin back-end",
  "admin-modules": "ADMIN PAGE — the feature switchboard on admin-* slugs (86bbugd2e left this deliberately)",
  "admin-team-users": "ADMIN PAGE — the user list on admin-* slugs",
  "admin-site-settings": "ADMIN PAGE — the settings form on admin-* slugs",
  "admin-support-form": "ADMIN PAGE — the tenant's support request form on admin-* slugs",
  // 86bbuhph0 added both of these to PRIVATE_ONLY_MODULE_TYPES, so their reason
  // strengthens from ADMIN PAGE to STRIPPED. admin-blog-links had been on the
  // weaker footing since it shipped — placed on a public page it WOULD have
  // painted (a panel of 401s rather than a tenant's data, but painted). The
  // split put a second management module beside it, which is when that was
  // noticed; both are removed by filterPublicSections now.
  "admin-blog-links": "STRIPPED — the blog tag manager; filterPublicSections removes it from every public page",
  "admin-related-articles": "STRIPPED — the related-articles picker; same filter",
};

/**
 * Settings that reach a branch EMPTY settings cannot.
 *
 * The sweep renders every module with `{}`, which is the state a page comes up
 * in and the state three live leaks were found in. It is not every state: a
 * module whose scaffolding sits behind a setting is invisible to the default
 * pass. That is not theoretical — breaking the confetti fix on purpose did not
 * turn this gate red, because confetti defaults to a button trigger and its
 * builder chrome ("Confetti runs when this page loads", a Test Burst button,
 * "no button on the live page") lives on the other two.
 *
 * So: when a fix lands in a branch `{}` cannot reach, its settings go here.
 * The list is short on purpose — every entry is a branch somebody actually
 * found something in.
 */
const SETTINGS_VARIANTS: Record<string, Array<{ label: string; settings: Record<string, string> }>> = {
  confetti: [
    { label: "page-load trigger", settings: { trigger: "on-load" } },
    { label: "game trigger", settings: { trigger: "game" } },
  ],
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Every endpoint answers "nothing here", which is the case under test: an
 * unconfigured module on a page nobody has filled in yet. Anything not named
 * answers 404 rather than an empty 200 — an empty 200 is a DIFFERENT case
 * (a malformed payload) and it crashes the page-level reminder runtime, which
 * would mask every reading this sweep takes.
 */
function stubEmptyApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const href = String(url);
    if (href.includes("/api/messaging/tags")) return { ok: true, json: async () => ({ tags: [] }) };
    if (href.includes("/api/messaging/topics")) return { ok: true, json: async () => ({ topics: [] }) };
    if (href.includes("/api/blog/posts")) return { ok: true, json: async () => ({ posts: [] }) };
    if (href.includes("/api/blog/categories")) return { ok: true, json: async () => ({ categories: [] }) };
    if (href.includes("/api/blog/relations")) return { ok: true, json: async () => ({ relatedIds: [] }) };
    if (href.includes("/api/events")) return { ok: true, json: async () => ({ events: [] }) };
    if (href.includes("/api/crm")) return { ok: true, json: async () => ({ data: null }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  /*
   * jsdom has no 2D canvas. The confetti variants below fire a real burst, and
   * canvas-confetti then throws inside a requestAnimationFrame callback AFTER
   * the test has finished — vitest counts that as an unhandled error and exits
   * non-zero with every test green, which would make this gate red for a
   * reason that has nothing to do with any module's text. A no-op context is
   * the smallest honest fix: the sweep reads TEXT, never pixels.
   */
  const canvasProto = window.HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
  };
  canvasProto.getContext = () =>
    new Proxy({}, { get: (_t, key) => (key === "canvas" ? undefined : () => undefined) });

  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false, media: "", onchange: null,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {}, dispatchEvent: () => false,
      }),
    });
  }
}

function bareModule(type: string, settings: Record<string, string> = {}): BuilderTemplateModule {
  return { id: `m-${type}`, type, column: "main", text: "", settings } as unknown as BuilderTemplateModule;
}

/**
 * The three placements a module can render in, each paired with the DOM node
 * that holds ONLY the module under test.
 *
 * Reading the whole container was wrong, and green for the wrong reason. In
 * both nested placements the fixture's own text ran straight into the module's
 * with no separator — `textContent` concatenates sibling nodes, so an image in
 * a table cell read as "ColumnChoose an image". Every phrase anchored with a
 * `\b` at the START of a module's output therefore never matched, and four of
 * the ten guards this gate exists for — image, floating-image, merch and
 * video — passed inside a table cell and a mega-menu slot while measuring
 * nothing (86bbvqcbk, round 1).
 *
 * The fix is to read the module's OWN subtree, and it needs no production
 * markup because both nested placements already wrap it: a table cell renders
 * `div.builder-preview-module` around each module it holds, and the mega-menu
 * feature slot renders `div.site-nav-mega-feature-module`. The FIRST match is
 * the module under test — a module that renders wrappers of its own nests them
 * inside, never outside.
 *
 * It also settles `video`, which is why that rule keeps its whole-string
 * anchor: `/^Video$/` cannot match "ColumnVideo", but it matches the subtree
 * text "Video" in all three placements. De-anchoring it was the alternative
 * and it is worse — the word would then be flagged wherever a module used it
 * properly, which is the exact thing the anchor was chosen to avoid.
 */
const PLACEMENTS: Array<{
  name: string;
  /** The node holding only the module under test; the FIRST match is it. */
  selector: string;
  wrap: (type: string, settings: Record<string, string>) => BuilderTemplateModule[];
}> = [
  {
    name: "on its own in a row",
    selector: ".builder-preview-module",
    wrap: (type, settings) => [bareModule(type, settings)],
  },
  {
    name: "inside a table cell",
    selector: "td .builder-preview-module",
    wrap: (type, settings) => [
      bareModule("table", {
        tableData: JSON.stringify({
          headers: ["Column"],
          rowCount: 1,
          cells: { "0-0": [bareModule(type, settings)] },
        }),
      }),
    ],
  },
  {
    name: "in a mega-menu feature slot",
    selector: ".site-nav-mega-feature-module",
    wrap: (type, settings) => [
      bareModule("navigation", {
        navDropdownStyle: "mega",
        /*
         * The child item is load-bearing: a top-level item with no children
         * renders as a plain link and never reaches NavMegaItem at all, so the
         * feature slot is never drawn. The instrument control below caught
         * exactly that — 61 silent "passes" measuring nothing.
         */
        navItems: JSON.stringify([
          { id: "nav-1", label: "Menu", href: "/", featureModule: bareModule(type, settings) },
          { id: "nav-1-a", parentId: "nav-1", label: "Child", href: "/child" },
        ]),
      }),
    ],
  },
];

/**
 * What a visitor would read from ONE module. Stylesheets and scripts are not
 * text on a page.
 *
 * Text nodes are joined with a space rather than concatenated, which is a
 * SECOND gluing hole and a different one from the placement chrome above:
 * `textContent` also welds a module's own sibling nodes together. An
 * unconfigured blog-post module renders "Post Title" and its body as separate
 * nodes, so read raw it is "Post TitlePost body will appear here…" — in which
 * the `\bPost Title\b` rule cannot match either, at any placement including
 * the top level. Reading the subtree removes the fixture's words; joining
 * removes the module's internal welds. Both are real and both are needed.
 */
function visitorText(node: Element): string {
  const clone = node.cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll("style, script, template"))) el.remove();
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function render(
  modules: BuilderTemplateModule[],
  liveSite: boolean,
  selector: string,
): Promise<string> {
  stubEmptyApi();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          { id: "row-1", title: "Row", layout: "single", modules }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite={liveSite}
      />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  /*
   * A missing wrapper is the instrument being blind, not the module being
   * clean, so it throws rather than returning "" — an empty string passes
   * every assertion in this file. This is the same failure the mega-menu
   * fixture already had once, caught structurally this time instead of by a
   * control somebody remembered to write.
   */
  const target = container.querySelector(selector);
  if (!target) {
    throw new Error(
      `the sweep found no "${selector}" — that placement rendered no module wrapper, ` +
      `so every reading it takes is meaningless. Fix the fixture, never the assertion.`,
    );
  }
  return visitorText(target);
}

const renderLive = (modules: BuilderTemplateModule[], selector: string) =>
  render(modules, true, selector);
const renderCanvas = (modules: BuilderTemplateModule[], selector: string) =>
  render(modules, false, selector);

function leaksIn(text: string): Array<{ phrase: string; why: string }> {
  return PLACEHOLDER_PHRASES.filter(({ re }) => re.test(text)).map(({ re, why }) => ({
    phrase: String(text.match(re)?.[0] ?? re.source),
    why,
  }));
}

describe("no module shows a visitor its Builder-time scaffolding", () => {
  for (const placement of PLACEMENTS) {
    for (const type of BUILDER_MODULE_TYPES) {
      const allowed = ADMIN_ALLOWED[type];
      const variants = [
        { label: "", settings: {} as Record<string, string> },
        ...(SETTINGS_VARIANTS[type] ?? []),
      ];
      for (const variant of variants) {
        const label = `${type}${variant.label ? ` (${variant.label})` : ""} — ${placement.name}`;
        it(allowed ? `${label} (admin: ${allowed.split(" — ")[0]})` : label, async () => {
          const text = await renderLive(placement.wrap(type, variant.settings), placement.selector);
          const found = leaksIn(text);
          if (allowed) return; // recorded decision; see ADMIN_ALLOWED
          expect(
            found.map((f) => `"${f.phrase}" — ${f.why}`),
            `${type} rendered this to a visitor:\n  ${text.slice(0, 400)}\n`,
          ).toEqual([]);
        }, 20000);
      }
    }
  }
});

describe("the instrument proves itself before its readings are worth anything", () => {
  /*
   * A placement that silently renders NOTHING passes every assertion above —
   * which is the shape of green this repo has been bitten by more than once.
   * So each placement is checked against a module with a known canvas
   * affordance: an image with no picture says "Choose an image". If one of
   * these fails, the sweep is blind in that placement and its passes there
   * mean nothing. Fix the fixture, never the assertion.
   */
  for (const placement of PLACEMENTS) {
    it(`${placement.name} really does reach the module`, async () => {
      expect(
        await renderCanvas(placement.wrap("image", {}), placement.selector),
      ).toContain("Choose an image");
    }, 20000);
  }

  /*
   * The control above only asks whether the text ARRIVED, and that is exactly
   * how round 1 got through: in both nested placements the text arrived and
   * the phrase list still could not match it, because the fixture's own words
   * were welded to the front. "Choose an image" was present as a substring the
   * whole time, so a `toContain` control could never see the hole.
   *
   * So this asks the question that was actually being got wrong — does the
   * MATCHING fire? — and it is what turns red if a future placement, or a
   * future change to visitorText, reintroduces the welding.
   */
  for (const placement of PLACEMENTS) {
    it(`${placement.name} — the phrase list can match what renders there`, async () => {
      const text = await renderCanvas(placement.wrap("image", {}), placement.selector);
      // Asserted on the REASON, not the matched substring: the phrase list
      // reports whatever the regex captured ("Choose an i"), which is a detail
      // of the pattern rather than the thing being proved.
      expect(leaksIn(text).map((f) => f.why)).toContain(
        "a builder affordance — a visitor has nothing to choose",
      );
    }, 20000);
  }

  /*
   * And the same for a rule anchored to the WHOLE of a module's output.
   * `/^Video$/` is the only one, and it is the rule a container-wide read can
   * never satisfy in a nested placement, since "ColumnVideo" is not "Video".
   * If this goes red, the sweep is reading more than the module again and
   * `video`'s guard is back to measuring nothing.
   */
  for (const placement of PLACEMENTS) {
    it(`${placement.name} — a whole-string rule still matches there`, async () => {
      const text = await renderCanvas(placement.wrap("video", {}), placement.selector);
      expect(text).toBe("Video");
      expect(leaksIn(text).map((f) => f.why)).toContain(
        "the module's own name standing alone where a video should be",
      );
    }, 20000);
  }

  /*
   * A module's OWN sibling nodes are welded by textContent too. That is a
   * different hole from the placement chrome, and the two controls above are
   * blind to it by construction — reading the module's subtree already drops
   * the fixture's words, so they pass whether the nodes are joined or not.
   *
   * An unconfigured blog-post renders "Post Title" and its body as separate
   * nodes: concatenated that is "Post TitlePost body will appear here…", in
   * which `\bPost Title\b` cannot match at ANY placement, the top level
   * included. Today it is still caught there by "will appear here", so the
   * welding costs a phrase rather than a module — which is exactly why it
   * needs its own control. The day it is the only phrase a module has, the
   * cost is the module.
   */
  it("a module's own sibling text nodes are not welded together", async () => {
    const [top] = PLACEMENTS;
    const text = await renderCanvas(top.wrap("blog-post", {}), top.selector);
    expect(text).toContain("Post Title Post body");
    expect(leaksIn(text).map((f) => f.phrase)).toContain("Post Title");
  }, 20000);

  it("and the guard under test is what silences it, not the placement", async () => {
    // The same fixture, live: silent because BuilderImagePreview returns null,
    // not because the placement never rendered anything.
    for (const placement of PLACEMENTS) {
      expect(
        await renderLive(placement.wrap("image", {}), placement.selector),
      ).not.toContain("Choose an image");
    }
  }, 20000);
});

/**
 * The other half of every fix in this ticket.
 *
 * Silencing a module on a live page is easy to "fix" by deleting the text
 * outright, which passes every assertion above and quietly costs whoever is
 * building the page the only thing telling them why the module is blank. Each
 * entry below is a guard added for 86bbvqcbk, paired with the affordance it
 * must NOT have taken with it.
 */
const CANVAS_AFFORDANCES: Array<{ type: string; settings?: Record<string, string>; phrase: string }> = [
  { type: "blog-post", phrase: "Post body will appear here" },
  { type: "event-detail", phrase: "?event=your-event-slug" },
  { type: "blog-post-list", phrase: "Use the Create Post module" },
  { type: "image", phrase: "Choose an image" },
  { type: "floating-image", phrase: "Choose a floating image" },
  { type: "video", phrase: "Video" },
  { type: "merch", phrase: "Merch product" },
  { type: "player-portal", phrase: "Player Portal modules are not available in StarCaster." },
  { type: "confetti", settings: { trigger: "on-load" }, phrase: "Confetti runs when this page loads" },
  { type: "confetti", settings: { trigger: "game" }, phrase: "no button on the live page" },
];

describe("...and every one of them still says its piece on the Builder canvas", () => {
  for (const { type, settings, phrase } of CANVAS_AFFORDANCES) {
    const label = settings ? `${type} (${Object.values(settings).join(", ")})` : type;
    it(`${label} still shows "${phrase.slice(0, 40)}"`, async () => {
      const [top] = PLACEMENTS;
      expect(
        await renderCanvas(top.wrap(type, settings ?? {}), top.selector),
      ).toContain(phrase);
    }, 20000);
  }
});

describe("the sweep cannot quietly stop covering something", () => {
  it("renders every module type in every placement", () => {
    // A new module type is swept the moment it joins the registry, because the
    // loop above IS the registry. This asserts the registry has not been
    // emptied or swapped for something the loop no longer reads.
    expect(BUILDER_MODULE_TYPES.length).toBeGreaterThan(50);
    expect(PLACEMENTS).toHaveLength(3);
  });

  it("every settings variant names a real module type", () => {
    const known = new Set<string>(BUILDER_MODULE_TYPES);
    expect(Object.keys(SETTINGS_VARIANTS).filter((t) => !known.has(t))).toEqual([]);
  });

  it("every allow-list entry names a real module type", () => {
    // A typo here allows nothing and hides nothing — it just sits there
    // looking like a decision. Worse than no entry at all.
    const known = new Set<string>(BUILDER_MODULE_TYPES);
    expect(Object.keys(ADMIN_ALLOWED).filter((t) => !known.has(t))).toEqual([]);
  });

  it("every STRIPPED reason is backed by the filter that strips it", () => {
    // The four strongest entries claim filterPublicSections removes them. If
    // a type ever leaves PRIVATE_ONLY_MODULE_TYPES, that claim becomes false
    // and this allow-list silently becomes four holes.
    const claimed = Object.entries(ADMIN_ALLOWED)
      .filter(([, why]) => why.startsWith("STRIPPED"))
      .map(([type]) => type)
      .sort();
    expect(claimed).toEqual([...PRIVATE_ONLY_MODULE_TYPES].sort());
  });
});
