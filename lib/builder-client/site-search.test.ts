import { describe, expect, it } from "vitest";
import {
  buildSiteSearchIndex,
  classifySettingKey,
  collectModuleFragments,
  htmlToPlainText,
  isIndexableValue,
  matchQuality,
  normalizeSiteSearchQuery,
  normalizeSiteSearchPriority,
  searchSite,
  siteSearchQueryVariants,
  type SiteSearchPageInput
} from "./site-search";

function page(
  name: string,
  slug: string,
  modules: { type?: string; name?: string; text?: string; column?: string; settings?: Record<string, string> }[],
  extra: Partial<SiteSearchPageInput> & { cellIsPrivate?: Record<string, string> } = {}
): SiteSearchPageInput {
  const { cellIsPrivate, ...rest } = extra;
  return {
    id: slug || "home",
    name,
    slug,
    layoutSections: [
      {
        id: "s1",
        cellIsPrivate,
        modules: modules.map((m, i) => ({
          id: `m${i}`,
          type: m.type ?? "text",
          name: m.name ?? "",
          text: m.text ?? "",
          column: m.column ?? "col-1",
          settings: m.settings ?? {}
        }))
      }
    ],
    ...rest
  };
}

function search(query: string, pages: SiteSearchPageInput[]) {
  return searchSite(query, buildSiteSearchIndex(pages));
}

describe("htmlToPlainText", () => {
  it("strips tags and collapses whitespace", () => {
    expect(htmlToPlainText("<p>Hello   <strong>world</strong></p>")).toBe("Hello world");
  });

  it("never welds two words across a tag boundary", () => {
    expect(htmlToPlainText("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("drops script and style bodies", () => {
    expect(htmlToPlainText("<div>Visible<script>var secret=1;</script></div>")).toBe("Visible");
    expect(htmlToPlainText("<style>.a{color:red}</style>Copy")).toBe("Copy");
  });

  it("decodes entities", () => {
    expect(htmlToPlainText("Ben &amp; Jerry&rsquo;s &#8212; open")).toBe("Ben & Jerry’s — open");
  });

  it("returns empty for non-strings", () => {
    expect(htmlToPlainText(undefined)).toBe("");
    expect(htmlToPlainText(42)).toBe("");
  });
});

describe("isIndexableValue", () => {
  it("keeps prose", () => {
    expect(isIndexableValue("Free shipping on orders over $50")).toBe(true);
    expect(isIndexableValue("Contact")).toBe(true);
  });

  it("keeps ordinary words that happen to be spellable in hex digits", () => {
    // A bare /[0-9a-f]{3,8}/ colour test would eat all of these.
    for (const word of ["cafe", "fee", "added", "decade", "faced", "beefed", "deface", "ace"]) {
      expect(isIndexableValue(word), word).toBe(true);
    }
  });

  it("rejects colours, numbers, booleans, ids and urls", () => {
    for (const junk of [
      "#0f4f8f", "#fff", "rgba(0,0,0,.4)", "24", "16px", "100%", "1.5rem",
      "true", "none", "auto", "https://example.com/x", "/pricing", "mailto:a@b.c",
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "card-slider-item"
    ]) {
      expect(isIndexableValue(junk), junk).toBe(false);
    }
  });
});

describe("classifySettingKey", () => {
  it("files titles, metadata and body separately", () => {
    expect(classifySettingKey("title")).toBe("title");
    expect(classifySettingKey("productName")).toBe("title");
    expect(classifySettingKey("alt")).toBe("meta");
    expect(classifySettingKey("linkLabel")).toBe("meta");
    expect(classifySettingKey("intro")).toBe("body");
  });

  it("drops styling, wiring and chrome", () => {
    for (const key of [
      "accentColor", "borderRadius", "cardGap", "mobileFontSize", "socialShadowBlur",
      "targetPageUrl", "crmFormId", "searchParam", "postSlug", "redirectAfterCreate",
      "showTags", "isPrivate", "hideOnMobile",
      "placeholder", "submitLabel", "buttonLabel", "emptyMessage"
    ]) {
      expect(classifySettingKey(key), key).toBeNull();
    }
  });
});

describe("collectModuleFragments", () => {
  it("treats a heading module's text as a title, a text module's as body", () => {
    const heading = collectModuleFragments({ type: "heading", text: "Our Services" });
    expect(heading).toEqual([{ kind: "title", sourceKey: "text", text: "Our Services" }]);

    const body = collectModuleFragments({ type: "text", text: "<p>We repair boilers.</p>" });
    expect(body).toEqual([{ kind: "body", sourceKey: "text", text: "We repair boilers." }]);
  });

  it("walks JSON collections and keeps only their prose leaves", () => {
    const fragments = collectModuleFragments({
      type: "slider",
      settings: {
        sliderItems: JSON.stringify([
          { title: "Winter Tune-Up", body: "Book before December.", bgColor: "#ffffff", imageUrl: "/a.png" },
          { title: "Spring Service", body: "Ninety-day warranty.", cardRadius: "12" }
        ])
      }
    });
    const texts = fragments.map((f) => f.text).sort();
    expect(texts).toEqual(["Book before December.", "Ninety-day warranty.", "Spring Service", "Winter Tune-Up"]);
    expect(fragments.find((f) => f.text === "Winter Tune-Up")?.kind).toBe("title");
    expect(fragments.some((f) => f.text.includes("#ffffff") || f.text.includes("/a.png"))).toBe(false);
  });

  it("splits comma-separated lists and files them as metadata", () => {
    const fragments = collectModuleFragments({ type: "blog-post-card", settings: { tags: "roofing, gutters, siding" } });
    expect(fragments.map((f) => f.text).sort()).toEqual(["gutters", "roofing", "siding"]);
    expect(fragments.every((f) => f.kind === "meta")).toBe(true);
  });

  it("survives malformed collection JSON without throwing", () => {
    expect(() => collectModuleFragments({ type: "slider", settings: { slides: '[{"title":"broken' } })).not.toThrow();
  });

  it("indexes the operator's module name", () => {
    const fragments = collectModuleFragments({ type: "table", name: "Spring Pricing Table" });
    expect(fragments).toEqual([{ kind: "title", sourceKey: "name", text: "Spring Pricing Table" }]);
  });
});

describe("matchQuality", () => {
  it("ranks exact above prefix above word-start above substring", () => {
    expect(matchQuality("pricing", "pricing")).toBe(1);
    expect(matchQuality("pric", "pricing page")).toBe(0.8);
    expect(matchQuality("pricing", "our pricing guide")).toBe(0.6);
    expect(matchQuality("ricing", "our pricing guide")).toBe(0.4);
    expect(matchQuality("absent", "our pricing guide")).toBe(0);
  });
});

describe("normalizeSiteSearchQuery", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeSiteSearchQuery("  Heat   PUMP ")).toBe("heat pump");
  });
});

describe("searchSite — ranking", () => {
  it("returns nothing for an empty query", () => {
    expect(search("", [page("Home", "", [{ text: "anything" }])])).toEqual([]);
  });

  it("puts a page NAMED for the term above a page that merely mentions it", () => {
    const results = search("pricing", [
      page("Blog", "blog", [{ text: "A note about our pricing changes this year." }]),
      page("Pricing", "pricing", [{ text: "Plans start at $19." }])
    ]);
    expect(results[0]?.pageName).toBe("Pricing");
    expect(results[1]?.pageName).toBe("Blog");
  });

  it("puts a heading match above a body match", () => {
    const results = search("warranty", [
      page("A", "a", [{ type: "text", text: "Every job carries a warranty." }]),
      page("B", "b", [{ type: "heading", text: "Warranty" }])
    ]);
    expect(results[0]?.pageName).toBe("B");
    expect(results[0]?.topMatch.kind).toBe("title");
  });

  it("puts body text above alt text", () => {
    const results = search("gutters", [
      page("A", "a", [{ type: "image", settings: { alt: "gutters on a roof" } }]),
      page("B", "b", [{ type: "text", text: "We clean gutters twice a year." }])
    ]);
    expect(results[0]?.pageName).toBe("B");
    expect(results[1]?.topMatch.kind).toBe("meta");
  });

  it("does not let a long page win on volume alone", () => {
    const many = Array.from({ length: 40 }, () => ({ text: "terms and conditions about shipping" }));
    const results = search("shipping", [
      page("Terms", "terms", many),
      page("Shipping", "shipping", [{ text: "Orders ship in two days." }])
    ]);
    expect(results[0]?.pageName).toBe("Shipping");
  });

  it("gives a small lift for several distinct matches", () => {
    const one = search("solar", [page("A", "a", [{ text: "We install solar." }])])[0]!;
    const several = search("solar", [
      page("A", "a", [
        { text: "We install solar." },
        { text: "Solar panels are cleaned yearly." },
        { text: "Ask about the solar rebate." }
      ])
    ])[0]!;
    expect(several.score).toBeGreaterThan(one.score);
    expect(several.matchCount).toBe(3);
  });

  it("ranks an earlier section above a later one, all else equal", () => {
    const build = (index: number): SiteSearchPageInput => ({
      id: `p${index}`,
      name: `Page ${index}`,
      slug: `p${index}`,
      layoutSections: Array.from({ length: index + 1 }, (_v, i) => ({
        id: `s${i}`,
        modules: i === index ? [{ id: "m", type: "text", text: "roof inspection", column: "col-1", settings: {} }] : []
      }))
    });
    const results = search("roof inspection", [build(4), build(0)]);
    expect(results[0]?.pageName).toBe("Page 0");
  });
});

describe("searchSite — repeated site chrome", () => {
  const footer = { type: "text", text: "Call us on 555-0100 for a free estimate" };

  it("suppresses text that appears on most pages", () => {
    const pages = [
      page("Home", "", [footer]),
      page("About", "about", [footer]),
      page("Services", "services", [footer]),
      page("Contact", "contact", [footer, { type: "heading", text: "Free estimate" }]),
      page("Blog", "blog", [footer])
    ];
    const results = search("free estimate", pages);
    expect(results[0]?.pageName).toBe("Contact");
    // The other four still match, but far below.
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score * 5);
  });

  it("does not suppress anything on a site too small to tell", () => {
    const pages = [page("Home", "", [footer]), page("About", "about", [footer])];
    const results = search("free estimate", pages);
    expect(results).toHaveLength(2);
    expect(results[0]!.score).toBeGreaterThan(1);
  });

  it("never treats a page's own name as boilerplate", () => {
    const pages = Array.from({ length: 6 }, (_v, i) => page("Services", `s${i}`, [{ text: "filler copy here" }]));
    const results = search("services", pages);
    expect(results[0]?.topMatch.kind).toBe("pageName");
    expect(results[0]!.score).toBeGreaterThan(5);
  });
});

describe("searchSite — what is never indexed", () => {
  it("skips navigation, breadcrumb and social chrome", () => {
    for (const type of ["navigation", "tractor-nav", "breadcrumb", "blog-toc", "social", "social-share"]) {
      const results = search("unicorn", [page("A", "a", [{ type, settings: { navItems: '[{"label":"Unicorn"}]' } }])]);
      expect(results, type).toEqual([]);
    }
  });

  it("skips admin and manager modules", () => {
    for (const type of [
      "admin-team-users", "admin-site-settings", "admin-login",
      "blog-post-manager", "blog-category-manager", "blog-post-create", "blog-card-manager",
      "event-manager"
    ]) {
      const results = search("secret", [page("A", "a", [{ type, name: "Secret Admin Panel", text: "secret" }])]);
      expect(results, type).toEqual([]);
    }
  });

  it("skips a module in a column marked Private", () => {
    const pages = [
      page("A", "a", [{ text: "internal rates sheet", column: "col-2" }], { cellIsPrivate: { "col-2": "true" } })
    ];
    expect(search("internal rates", pages)).toEqual([]);
  });

  it("still indexes the public columns of a section that has a private one", () => {
    const pages = [
      page(
        "A",
        "a",
        [
          { text: "internal rates sheet", column: "col-2" },
          { text: "public opening hours", column: "col-1" }
        ],
        { cellIsPrivate: { "col-2": "true" } }
      )
    ];
    expect(search("internal", pages)).toEqual([]);
    expect(search("opening hours", pages)).toHaveLength(1);
  });
});

describe("searchSite — snippets", () => {
  it("returns the whole text when it is short", () => {
    const results = search("boilers", [page("A", "a", [{ text: "We repair boilers." }])]);
    expect(results[0]?.topMatch.snippet).toBe("We repair boilers.");
  });

  it("windows a long body around the match and marks it", () => {
    const filler = "lorem ipsum dolor sit amet ".repeat(20);
    const results = search("keystone", [page("A", "a", [{ text: `${filler}keystone${filler}` }])]);
    const match = results[0]!.topMatch;
    expect(match.snippet.startsWith("…")).toBe(true);
    expect(match.snippet.endsWith("…")).toBe(true);
    expect(match.snippet.length).toBeLessThan(260);
    const [highlight] = match.highlights;
    expect(match.snippet.slice(highlight!.start, highlight!.end)).toBe("keystone");
  });

  it("de-duplicates repeated matches within a page", () => {
    const results = search("oak", [
      page("A", "a", [{ type: "table", settings: { tableData: JSON.stringify([["oak"], ["oak"], ["oak"], ["maple"]]) } }])
    ]);
    expect(results[0]?.otherMatches).toHaveLength(0);
    expect(results[0]?.matchCount).toBe(3);
  });
});

describe("searchSite — multi-word queries", () => {
  it("prefers a page holding the whole phrase", () => {
    const results = search("heat pump", [
      page("A", "a", [{ text: "We service every heat exchanger and every pump." }]),
      page("B", "b", [{ text: "Heat pump installation and repair." }])
    ]);
    expect(results[0]?.pageName).toBe("B");
    expect(results[1]?.pageName).toBe("A");
  });

  it("finds a page whose terms are scattered across different modules", () => {
    const results = search("heat pump", [
      page("A", "a", [{ text: "Radiant heat systems." }, { text: "Sump pump replacement." }])
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.matchCount).toBeGreaterThan(0);
  });

  it("drops a page missing one of the terms entirely", () => {
    expect(search("heat pump", [page("A", "a", [{ text: "Radiant heat systems." }])])).toEqual([]);
  });
});

describe("siteSearchQueryVariants", () => {
  it("offers the singular for a plural and the plural for a singular", () => {
    expect(siteSearchQueryVariants("lessons")).toEqual(["lessons", "lesson"]);
    expect(siteSearchQueryVariants("lesson")).toEqual(["lesson", "lessons"]);
    expect(siteSearchQueryVariants("classes")).toEqual(["classes", "class"]);
    expect(siteSearchQueryVariants("class")).toEqual(["class", "classes"]);
    expect(siteSearchQueryVariants("policies")).toEqual(["policies", "policy"]);
    expect(siteSearchQueryVariants("policy")).toEqual(["policy", "policies"]);
  });

  it("only inflects the last word", () => {
    expect(siteSearchQueryVariants("junior lessons")).toEqual(["junior lessons", "junior lesson"]);
  });

  it("leaves short words and false plurals alone", () => {
    expect(siteSearchQueryVariants("gas")).toEqual(["gas"]);
    expect(siteSearchQueryVariants("tennis")).toEqual(["tennis"]);
    expect(siteSearchQueryVariants("chassis")).toEqual(["chassis"]);
  });
});

describe("searchSite — near word forms", () => {
  it("finds a singular page from a plural query", () => {
    // The gap this closes: found live on a real 60-page site, where searching
    // "lessons" did not surface the page called "Lesson Prices".
    const results = search("lessons", [page("Lesson Prices", "lesson-prices", [{ text: "filler" }])]);
    expect(results).toHaveLength(1);
    expect(results[0]?.pageName).toBe("Lesson Prices");
  });

  it("finds a plural page from a singular query", () => {
    const results = search("clinic", [page("Adult Clinics", "clinics", [{ text: "filler" }])]);
    expect(results).toHaveLength(1);
  });

  it("still ranks the exact wording first", () => {
    const results = search("lessons", [
      page("Lesson Prices", "a", [{ text: "filler" }]),
      page("Lessons", "b", [{ text: "filler" }])
    ]);
    expect(results[0]?.pageName).toBe("Lessons");
  });

  it("highlights the form that actually matched, not the one typed", () => {
    const results = search("lessons", [page("A", "a", [{ text: "Private lesson rates for members." }])]);
    const match = results[0]!.topMatch;
    const [highlight] = match.highlights;
    expect(match.snippet.slice(highlight!.start, highlight!.end)).toBe("lesson");
  });
});

describe("searchSite — result shape", () => {
  it("builds a usable href from the slug, and / for home", () => {
    const results = search("welcome", [
      page("Home", "", [{ text: "welcome" }]),
      page("About Us", "about-us", [{ text: "welcome" }]),
      page("Legacy", "home", [{ text: "welcome" }])
    ]);
    const byName = Object.fromEntries(results.map((r) => [r.pageName, r.href]));
    expect(byName["Home"]).toBe("/");
    expect(byName["Legacy"]).toBe("/");
    expect(byName["About Us"]).toBe("/about-us");
  });

  it("honours the limit", () => {
    const pages = Array.from({ length: 10 }, (_v, i) => page(`Page ${i}`, `p${i}`, [{ text: "common word" }]));
    expect(searchSite("common", buildSiteSearchIndex(pages), { limit: 3 })).toHaveLength(3);
  });

  it("carries a bounded number of other matches", () => {
    const modules = Array.from({ length: 12 }, (_v, i) => ({ text: `mention ${i} of oak` }));
    const results = searchSite("oak", buildSiteSearchIndex([page("A", "a", modules)]), { otherMatchLimit: 2 });
    expect(results[0]?.otherMatches).toHaveLength(2);
    expect(results[0]?.matchCount).toBe(12);
  });

  it("tolerates pages with no sections and modules with no settings", () => {
    expect(() =>
      searchSite("x", buildSiteSearchIndex([{ id: "1", name: "Bare", slug: "bare" }, { id: "2" }]))
    ).not.toThrow();
  });
});

describe("normalizeSiteSearchPriority", () => {
  it("accepts the five rungs, in any casing", () => {
    expect(normalizeSiteSearchPriority("pinned")).toBe("pinned");
    expect(normalizeSiteSearchPriority(" BOOSTED ")).toBe("boosted");
    expect(normalizeSiteSearchPriority("hidden")).toBe("hidden");
  });

  it("treats unset, empty and nonsense as normal — this is what skips the backfill", () => {
    for (const v of [undefined, null, "", "   ", "urgent", 7]) {
      expect(normalizeSiteSearchPriority(v), String(v)).toBe("normal");
    }
  });
});

describe("searchSite — the operator's page ranking", () => {
  const pages = () => [
    page("Pricing", "pricing", [{ type: "heading", text: "Court rates" }]),
    page("Old Blog Post", "old", [{ type: "heading", text: "Court rates" }]),
    page("Contact", "contact", [{ text: "Ask us about court rates." }])
  ];

  function withPriority(list: SiteSearchPageInput[], slug: string, priority: string) {
    return list.map((p) => (p.slug === slug ? { ...p, searchPriority: priority } : p));
  }

  it("changes nothing when no page has been given a ranking", () => {
    const before = search("court rates", pages()).map((r) => r.pageName);
    const after = search("court rates", withPriority(pages(), "pricing", "normal")).map((r) => r.pageName);
    expect(after).toEqual(before);
  });

  it("pins a page above a BETTER match, which is the whole point of pinning", () => {
    // Contact only mentions the words in body copy; the other two have it as a
    // heading. Pinned still wins — a multiplier could not promise that.
    const results = search("court rates", withPriority(pages(), "contact", "pinned"));
    expect(results[0]?.pageName).toBe("Contact");
    expect(results[0]?.pinned).toBe(true);
    expect(results[1]?.pinned).toBe(false);
  });

  it("orders several pinned pages among themselves by how well they matched", () => {
    let list = withPriority(pages(), "contact", "pinned");
    list = withPriority(list, "pricing", "pinned");
    const results = search("court rates", list);
    expect(results.slice(0, 2).every((r) => r.pinned)).toBe(true);
    // Pricing's heading beats Contact's body copy.
    expect(results[0]?.pageName).toBe("Pricing");
  });

  it("lifts a boosted page over an equal match without overturning a better one", () => {
    const lifted = search("court rates", withPriority(pages(), "old", "boosted"));
    expect(lifted[0]?.pageName).toBe("Old Blog Post");

    // Boosting the weakest match does NOT put it first — it is a nudge.
    const nudged = search("court rates", withPriority(pages(), "contact", "boosted"));
    expect(nudged[0]?.pageName).not.toBe("Contact");
  });

  it("sinks a lowered page below its equals", () => {
    const results = search("court rates", withPriority(pages(), "pricing", "lowered"));
    expect(results[0]?.pageName).toBe("Old Blog Post");
    expect(results.map((r) => r.pageName)).toContain("Pricing");
  });

  it("removes a hidden page from results entirely", () => {
    const results = search("court rates", withPriority(pages(), "pricing", "hidden"));
    expect(results.map((r) => r.pageName)).not.toContain("Pricing");
    expect(results).toHaveLength(2);
  });

  it("stops hidden duplicates from making the real page look like boilerplate", () => {
    // Imported sites accumulate "-copy" pages; Delray really does carry a
    // "Welcome … Copy" of its home page. Four of them sharing the home page's
    // heading puts that text on 5 of 8 pages — past the 60% share at which
    // repeated text is treated as site chrome and suppressed. Hiding the
    // copies has to take their votes with them, or hiding a duplicate would
    // still leave the original crippled.
    const shared = { type: "heading" as const, text: "Summer camp registration" };
    const filler = [
      page("About", "about", [{ text: "filler copy" }]),
      page("Contact", "contact", [{ text: "filler copy" }]),
      page("Hours", "hours", [{ text: "filler copy" }])
    ];
    const copies = [1, 2, 3, 4].map((n) => page(`Home Copy ${n}`, `home-copy-${n}`, [shared]));
    const list: SiteSearchPageInput[] = [page("Home", "", [shared]), ...copies, ...filler];

    const withDuplicates = search("summer camp registration", list);
    const duplicatesHidden = search(
      "summer camp registration",
      list.map((p) => (p.slug.startsWith("home-copy") ? { ...p, searchPriority: "hidden" } : p))
    );

    expect(duplicatesHidden.map((r) => r.pageName)).toEqual(["Home"]);
    // Suppressed as chrome while the copies counted; real content once they don't.
    expect(withDuplicates.find((r) => r.pageName === "Home")!.score).toBeLessThan(1);
    expect(duplicatesHidden[0]!.score).toBeGreaterThan(5);
  });

  it("reports the ranking on every result so the module can label it", () => {
    const results = search("court rates", withPriority(pages(), "pricing", "boosted"));
    const byName = Object.fromEntries(results.map((r) => [r.pageName, r.priority]));
    expect(byName["Pricing"]).toBe("boosted");
    expect(byName["Contact"]).toBe("normal");
  });
});
