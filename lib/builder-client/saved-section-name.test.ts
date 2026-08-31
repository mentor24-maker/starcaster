import { describe, expect, it } from "vitest";
import {
  SAVED_SECTION_NAME_MAX,
  applySavedSectionName,
  describeSavedSectionRename,
  pushedSectionContent,
  relinkPushedSection,
  resolveSharedSectionTitle,
  savedSectionNameAfterPush,
  savedSectionTitleChanges,
  savedSectionTitleFor,
} from "./saved-section-name";
import { readFileSync } from "node:fs";
import { hasSectionDrifted } from "./section-drift";
import type { BlockUsage } from "./shared-block-usage";

/**
 * The rename that could not stick.
 *
 * Renaming the Delray site header in the manager wrote the row's `name` and
 * nothing else, then the fan-out pushed the master's content — old
 * `section.title` included — over every following page, so every card snapped
 * back. Three times, on 2026-08-29. The tests that matter most here are the
 * two ends of that loop: the stamp that makes the rename survive its own
 * push, and the display rule that stops a stale stamp contradicting the
 * manager in the meantime.
 */

const usage = (over: Partial<BlockUsage> = {}): BlockUsage => ({
  following: 0,
  independent: 0,
  pages: 0,
  pageLabels: [],
  ...over,
});

describe("savedSectionTitleFor", () => {
  it("trims, and truncates at the same 255 the store and the normalizer use", () => {
    expect(savedSectionTitleFor("  2a - Header  ")).toBe("2a - Header");
    expect(savedSectionTitleFor("x".repeat(300))).toHaveLength(SAVED_SECTION_NAME_MAX);
  });

  it("reads a missing name as empty rather than throwing", () => {
    expect(savedSectionTitleFor(null)).toBe("");
    expect(savedSectionTitleFor(undefined)).toBe("");
  });
});

describe("applySavedSectionName", () => {
  it("stamps the row's name onto the content, which is what a fan-out carries", () => {
    const section = { title: "2 - Menu Banner" };
    expect(applySavedSectionName(section, "2a - Header")).toEqual({ title: "2a - Header" });
  });

  it("returns the SAME object when the title already matches", () => {
    // Not a micro-optimisation: `hasSectionDrifted` compares content by value,
    // and a fresh copy is a needless write on a path that fans out to every
    // page following the master.
    const section = { title: "2a - Header" };
    expect(applySavedSectionName(section, "  2a - Header  ")).toBe(section);
  });

  it("leaves the title alone when the name is empty", () => {
    // The store rejects an empty name anyway. A helper that can blank a title
    // on a validation slip is a worse bug than the one it is fixing.
    const section = { title: "2 - Menu Banner" };
    expect(applySavedSectionName(section, "   ")).toBe(section);
    expect(applySavedSectionName(section, null)).toBe(section);
  });

  it("keeps every other field, because the whole section is what gets written", () => {
    const section = { title: "old", layout: "two-column", modules: [{ id: "m1" }] };
    expect(applySavedSectionName(section, "new")).toEqual({
      title: "new",
      layout: "two-column",
      modules: [{ id: "m1" }],
    });
  });
});

describe("savedSectionTitleChanges", () => {
  it("is true only when the stamped title actually moves", () => {
    expect(savedSectionTitleChanges({ title: "2 - Menu Banner" }, "2a - Header")).toBe(true);
    expect(savedSectionTitleChanges({ title: "2a - Header" }, "2a - Header")).toBe(false);
    expect(savedSectionTitleChanges({ title: "2a - Header" }, "")).toBe(false);
    expect(savedSectionTitleChanges(null, "2a - Header")).toBe(true);
  });

  it("compares what will be STORED, so padding and truncation count as a move", () => {
    // The guard used to trim both sides. It then said "no change" about a copy
    // titled "  Header  " while the write stored "Header", and the copy read
    // as hand-edited the moment it relinked.
    expect(savedSectionTitleChanges({ title: "  Header  " }, "Header")).toBe(true);
    expect(savedSectionTitleChanges({ title: "x".repeat(300) }, "x".repeat(300))).toBe(true);
    expect(savedSectionTitleChanges({ title: "Header" }, "  Header  ")).toBe(false);
  });
});

describe("savedSectionNameAfterPush", () => {
  it("takes the page's title, because a push is what moves the name", () => {
    expect(savedSectionNameAfterPush({ title: "  New name  " }, "2a - Header")).toBe("New name");
  });

  it("keeps the name already there when the page section is untitled", () => {
    // A push must never blank the row name.
    expect(savedSectionNameAfterPush({ title: "   " }, "2a - Header")).toBe("2a - Header");
    expect(savedSectionNameAfterPush({}, "2a - Header")).toBe("2a - Header");
    expect(savedSectionNameAfterPush(null, "2a - Header")).toBe("2a - Header");
  });
});

describe("describeSavedSectionRename", () => {
  it("names both the old name and the new one, and how far the rename reaches", () => {
    const notice = describeSavedSectionRename(
      "2 - Menu Banner",
      "2a - Header",
      usage({ pages: 35, following: 35 })
    );
    expect(notice).toContain("35 pages");
    expect(notice).toContain('"2 - Menu Banner"');
    expect(notice).toContain('"2a - Header"');
  });

  it("SPEAKS UP when the row name and the stamped title disagree", () => {
    // The send-back, in one assertion. On the ~550 legacy masters whose `name`
    // and `section.title` never agreed, pushing a page's copy up sets the row
    // name from the page's stamp — undoing a rename made in the manager. The
    // old signature took the master's stamped TITLE, compared "Menu Banner"
    // with "Menu Banner", saw nothing moving, and returned null while the row
    // name went from "2a - Header" to "Menu Banner" in silence.
    const master = { name: "2a - Header", section: { title: "Menu Banner" } };
    const pageSection = { title: "Menu Banner" };

    const notice = describeSavedSectionRename(
      master.name,
      savedSectionNameAfterPush(pageSection, master.name),
      usage({ pages: 2, following: 2 })
    );

    expect(notice).not.toBeNull();
    expect(notice).toContain('"2a - Header"');
    expect(notice).toContain('"Menu Banner"');
  });

  it("counts every following page, DRIFTED INCLUDED, because every card renames", () => {
    // Round 3, and it reverses round 1 on purpose. Round 1 asked for the
    // drifted followers to be subtracted, to agree with `describePushImpact`
    // directly above. That is right about the DATA and wrong about this
    // SENTENCE: a drifted copy is still `canonical: true`, so
    // `resolveSharedSectionTitle` heads its card with the master's name
    // regardless of the stamp it carries. It renames on screen either way.
    expect(describeSavedSectionRename("old", "new", usage({ pages: 5 }), 2)).toContain("5 pages");
    expect(describeSavedSectionRename("old", "new", usage({ pages: 2 }), 1)).toContain("2 pages");
  });

  it("SPEAKS UP when every follower is drifted — all three cards still rename", () => {
    // The case subtracting produced: three followers, all drifted, notice null,
    // and all three cards renaming the moment the save lands. A rename with no
    // warning at all is the reported symptom over again.
    const notice = describeSavedSectionRename("old", "new", usage({ pages: 3 }), 3);
    expect(notice).not.toBeNull();
    expect(notice).toContain("3 pages");
  });

  it("still says which pages keep their own local edits", () => {
    // The honest half of round 1 survives: the count is the count of cards that
    // rename, and the stamp is reported separately rather than by shrinking it.
    expect(describeSavedSectionRename("old", "new", usage({ pages: 5 }), 2)).toContain(
      "2 pages keep their own local edits"
    );
    expect(describeSavedSectionRename("old", "new", usage({ pages: 5 }), 1)).toContain(
      "1 page keeps its own local edits"
    );
    expect(describeSavedSectionRename("old", "new", usage({ pages: 5 }), 0)).not.toContain("local edits");
  });

  it("says nothing when the name is not moving", () => {
    expect(describeSavedSectionRename("2a - Header", "2a - Header", usage({ pages: 35 }))).toBeNull();
    expect(describeSavedSectionRename("2a - Header", "  2a - Header  ", usage({ pages: 35 }))).toBeNull();
  });

  it("says nothing when no page follows the master", () => {
    // A rename nobody else sees is not worth a sentence in a dialog whose
    // whole job is to report reach.
    expect(describeSavedSectionRename("old", "new", usage())).toBeNull();
    expect(describeSavedSectionRename("old", "new", null)).toBeNull();
  });

  it("uses the singular for one page", () => {
    expect(describeSavedSectionRename("old", "new", usage({ pages: 1 }))).toContain("1 page");
  });

  it("still reports the rename when the master had no name to speak of", () => {
    const notice = describeSavedSectionRename("", "2a - Header", usage({ pages: 4 }));
    expect(notice).toContain("4 pages");
    expect(notice).toContain('"2a - Header"');
  });
});

describe("resolveSharedSectionTitle", () => {
  it("shows a following copy under its MASTER's name, not its stamped title", () => {
    // The bug, in one assertion: 550 production rows carry a stamp written by
    // a fan-out that predates the rename. The card must never show a name the
    // manager disagrees with.
    expect(
      resolveSharedSectionTitle({
        isFollowing: true,
        masterName: "2a - Header",
        title: "2 - Menu Banner",
        fallback: "Section 3",
      })
    ).toBe("2a - Header");
  });

  it("falls back to the stamp when the master could not be resolved", () => {
    // A deleted master leaves the stamp as the only name there is.
    expect(
      resolveSharedSectionTitle({ isFollowing: true, masterName: "", title: "2 - Menu Banner", fallback: "Section 3" })
    ).toBe("2 - Menu Banner");
  });

  it("leaves an independent section under its own title", () => {
    expect(
      resolveSharedSectionTitle({
        isFollowing: false,
        masterName: "2a - Header",
        title: "Local hero",
        fallback: "Section 3",
      })
    ).toBe("Local hero");
  });

  it("uses the fallback when there is no name of any kind", () => {
    expect(resolveSharedSectionTitle({ title: "  ", fallback: "Section 3" })).toBe("Section 3");
  });

  it("still strips the legacy trailing 'Canonical' from an unresolved stamp", () => {
    // Stamps from before the canonical chip existed ended in the literal word,
    // and the card has always stripped it. Moving the decision here must not
    // quietly bring it back.
    expect(
      resolveSharedSectionTitle({ isFollowing: true, title: "Site Header Canonical", fallback: "Section 1" })
    ).toBe("Site Header");
  });

  it("does not strip 'Canonical' from a section that is not following", () => {
    expect(
      resolveSharedSectionTitle({ isFollowing: false, title: "Site Header Canonical", fallback: "Section 1" })
    ).toBe("Site Header Canonical");
  });
});

describe("the round trip a rename has to survive", () => {
  it("stamps, propagates, and comes back reading the new name", () => {
    // The whole loop the manager rename kept losing: name the master, stamp
    // its content, let the fan-out copy that content onto a follower, and ask
    // the card what it shows.
    const master = { title: "2 - Menu Banner", layout: "one-column" };
    const renamed = applySavedSectionName(master, "2a - Header");

    // What `propagateCanonicalSection` writes onto each following page.
    const follower = { ...renamed, id: "section-9", savedSectionId: "ss1", canonical: true };

    expect(
      resolveSharedSectionTitle({
        isFollowing: true,
        masterName: "2a - Header",
        title: follower.title,
        fallback: "Section 1",
      })
    ).toBe("2a - Header");
    // And the two names now agree in the DATA too, not only on screen — which
    // is the half a display-only fix would have left broken.
    expect(follower.title).toBe("2a - Header");
  });
});

describe("a push from a page ends the drift instead of creating it", () => {
  /**
   * The second half of the send-back. A push writes the page's content to the
   * master, the route normalises it on the way in, and the page's copy is then
   * relinked. If the copy is not made equal to what was STORED, it rejoins a
   * master it already differs from — `hasSectionDrifted` compares content
   * verbatim — so it reads as Changed at once and every later fan-out skips
   * the page.
   *
   * `relinkPushedSection` is the real branch the editor calls. A test that
   * restated the rule instead of calling it could not fail when the editor
   * stopped applying it.
   */
  /** What the save route hands back: the name stamped, plus its own defaults. */
  const stored = (title: string) => ({
    title,
    layout: "single",
    // The route fills in some forty of these. The client never sent them, and
    // they are why matching titles alone was not enough.
    widthMode: "contained",
    locked: false,
    background: { mode: "none", color: "#ffffff" },
    modules: [{ id: "m1", type: "text", settings: { html: "<p>hi</p>" } }],
  });

  const pushed = (pageSection: Record<string, unknown>, masterName: string) => {
    const nextName = savedSectionNameAfterPush(pageSection as { title?: string }, masterName);
    const master = stored(savedSectionTitleFor(nextName));
    return { master, copy: relinkPushedSection(pageSection, master, "ss1") };
  };

  it("an untitled section does not relink as Changed", () => {
    const { master, copy } = pushed({ id: "s1", title: "" }, "2a - Header");
    expect(copy.title).toBe("2a - Header");
    expect(hasSectionDrifted(copy, master)).toBe(false);
  });

  it("a padded title does not relink as Changed", () => {
    const { master, copy } = pushed({ id: "s1", title: "  Header  " }, "2a - Header");
    expect(copy.title).toBe("Header");
    expect(hasSectionDrifted(copy, master)).toBe(false);
  });

  it("a title past the 255-character limit does not relink as Changed", () => {
    const { master, copy } = pushed({ id: "s1", title: "x".repeat(300) }, "2a - Header");
    expect(copy.title).toHaveLength(SAVED_SECTION_NAME_MAX);
    expect(hasSectionDrifted(copy, master)).toBe(false);
  });

  it("the route's own normalisation does not count as drift either", () => {
    // Titles matching exactly was never sufficient: the copy still held the
    // sparse object the client pushed, against a master carrying every filled
    // default. That is what a flags-only relink could not fix at all.
    const sparse = { id: "s1", title: "Header", layout: "single" };
    const master = stored("Header");
    expect(hasSectionDrifted(sparse, master)).toBe(true);
    expect(hasSectionDrifted(relinkPushedSection(sparse, master, "ss1"), master)).toBe(false);
  });

  it("keeps the copy's OWN id, and relinks it", () => {
    const master = stored("Header");
    const copy = relinkPushedSection({ id: "s1" }, master, "ss1");
    expect(copy.id).toBe("s1");
    expect(copy.savedSectionId).toBe("ss1");
    expect(copy.canonical).toBe(true);
  });

  it("does not share mutable objects with the saved-sections list", () => {
    // The page's draft is edited in place; the master lives in React state.
    const master = stored("Header");
    const copy = relinkPushedSection({ id: "s1" }, master, "ss1");
    expect(copy.background).not.toBe(master.background);
    expect(copy.modules[0]).not.toBe(master.modules[0]);
    expect(copy.modules[0].settings).not.toBe(master.modules[0].settings);
  });
});

describe("pushedSectionContent — the preview and the write must be one thing", () => {
  // The round-3 send-back, in a suite. The confirmation dialog previewed the
  // RAW content while the PATCH sent the STAMPED content, so an untitled copy
  // pushed over a named master told the operator their section's name was
  // about to be erased on every following page — in the very product whose
  // complaint that week was a name behaving unpredictably.

  it("stamps the master's name onto an untitled copy, so the preview reports NO title change", () => {
    // The case the suite never constructed.
    const content = { title: "", modules: [] };
    expect(pushedSectionContent(content, "2a - Header").title).toBe("2a - Header");
  });

  it("carries the page's OWN title up when it has one — that push is a rename", () => {
    const content = { title: "Menu Banner", modules: [] };
    expect(pushedSectionContent(content, "2a - Header").title).toBe("Menu Banner");
  });

  it("is EXACTLY what saveSavedSection stamps, so the two readers cannot diverge", () => {
    // Not a restatement of the doc comment — the assertion. `saveSavedSection`
    // writes `applySavedSectionName(content, name)` where the push hands it
    // `savedSectionNameAfterPush(section, master.name)`. If either side is ever
    // edited alone, this fails.
    for (const content of [
      { title: "", modules: [] },
      { title: "Menu Banner", modules: [] },
      { title: "   padded   ", modules: [] },
      { title: "x".repeat(300), modules: [] },
    ]) {
      for (const masterName of ["2a - Header", "", "  spaced  "]) {
        const whatTheWriteSends = applySavedSectionName(
          content,
          savedSectionNameAfterPush(content, masterName)
        );
        expect(pushedSectionContent(content, masterName)).toEqual(whatTheWriteSends);
      }
    }
  });

  it("leaves the content alone when there is no name of any kind to stamp", () => {
    // A master deleted in another tab: no name, no stamp, and above all no
    // blanked title. Same object back, so nothing counts as a write.
    const content = { title: "", modules: [] };
    expect(pushedSectionContent(content, undefined)).toBe(content);
  });
});

describe("every create path stamps, including the ones not written yet", () => {
  /**
   * A saved section is created by a `window.prompt`, so its name is whatever
   * was typed — and both POST paths sent the section content unstamped. Answer
   * that prompt with anything but the default it offers and the row was born
   * with `name` and `section.title` already disagreeing: the exact divergence
   * this whole ticket is about, created on the spot. It hid because
   * `resolveSharedSectionTitle` reconciles the card on read, and came back the
   * first time somebody pushed a page's copy back up.
   *
   * Fixing the two that exist does not stop a third being added, and this is
   * round three of a ticket whose subject is a section having two names. So
   * this reads the editor and asserts the RULE rather than the instances.
   */
  const source = readFileSync(
    new URL("../../components/admin-builder-editor.tsx", import.meta.url),
    "utf8"
  );

  it("posts no saved section without applySavedSectionName in the body", () => {
    // Every call to the COLLECTION endpoint, with the request that follows it.
    // The `${id}` endpoint is a different string and is not matched here; the
    // list GET is matched and then dropped for not being a POST.
    const calls = source
      .split('builderAdminFetch("/api/admin/saved-sections"')
      .slice(1)
      // Up to the next fetch, so one call's body can never be read as another's
      // — and capped, so a trailing call cannot swallow the rest of the file.
      .map((tail) => tail.split("builderAdminFetch(")[0].slice(0, 2000));
    const posts = calls.filter((call) => call.includes('method: "POST"'));

    // A guard that cannot find its subject is not a guard: if the endpoint is
    // renamed or the calls are refactored away, fail loudly rather than pass by
    // matching nothing.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(posts.length).toBeGreaterThanOrEqual(2);

    for (const post of posts) {
      expect(post).toContain("applySavedSectionName(");
    }
  });
});
