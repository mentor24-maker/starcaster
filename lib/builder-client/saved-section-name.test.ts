import { describe, expect, it } from "vitest";
import {
  SAVED_SECTION_NAME_MAX,
  applySavedSectionName,
  describeSavedSectionRename,
  resolveSharedSectionTitle,
  savedSectionTitleChanges,
  savedSectionTitleFor,
} from "./saved-section-name";
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
});

describe("describeSavedSectionRename", () => {
  it("names both the old stamp and the new one, and how far the rename reaches", () => {
    const notice = describeSavedSectionRename(
      { title: "2 - Menu Banner" },
      "2a - Header",
      usage({ pages: 35, following: 35 })
    );
    expect(notice).toContain("35 pages");
    expect(notice).toContain('"2 - Menu Banner"');
    expect(notice).toContain('"2a - Header"');
  });

  it("says nothing when the name is not moving", () => {
    expect(
      describeSavedSectionRename({ title: "2a - Header" }, "2a - Header", usage({ pages: 35 }))
    ).toBeNull();
  });

  it("says nothing when no page follows the master", () => {
    // A rename nobody else sees is not worth a sentence in a dialog whose
    // whole job is to report reach.
    expect(describeSavedSectionRename({ title: "old" }, "new", usage())).toBeNull();
    expect(describeSavedSectionRename({ title: "old" }, "new", null)).toBeNull();
  });

  it("uses the singular for one page", () => {
    expect(describeSavedSectionRename({ title: "old" }, "new", usage({ pages: 1 }))).toContain("1 page");
  });

  it("still reports the rename when the copy had no title at all", () => {
    const notice = describeSavedSectionRename({}, "2a - Header", usage({ pages: 4 }));
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
