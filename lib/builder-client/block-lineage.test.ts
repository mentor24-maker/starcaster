import { describe, expect, it } from "vitest";
import { describeBlockLineage } from "./block-lineage";
import { buildSavedSectionUsageIndex, type BlockUsage } from "./shared-block-usage";

/**
 * The four states a block header must be able to tell apart, and the one
 * sentence each of them is allowed to say.
 *
 * The rule that carries the most weight here is the negative one: an
 * Independent block gets NO second line. A blank line, or the words
 * "used on 0 pages", both read as "this is connected to something and the
 * something is empty" — which is the opposite of the truth.
 */

const usage = (over: Partial<BlockUsage> = {}): BlockUsage => ({
  following: 0,
  independent: 0,
  pages: 0,
  pageLabels: [],
  ...over,
});

describe("describeBlockLineage", () => {
  it("names the master and the reach of a following copy", () => {
    const lineage = describeBlockLineage({
      isFollowing: true,
      masterName: "2 - Menu Banner",
      usage: usage({ pages: 35, following: 35 }),
    });
    expect(lineage.state).toBe("following");
    expect(lineage.label).toBe("Following");
    expect(lineage.line).toBe('Copy of "2 - Menu Banner" · used on 35 pages');
  });

  it("flips to Changed on drift without changing the lineage line", () => {
    const input = {
      isFollowing: true,
      masterName: "2 - Menu Banner",
      usage: usage({ pages: 35, following: 35 }),
    };
    const following = describeBlockLineage(input);
    const changed = describeBlockLineage({ ...input, hasDrifted: true });

    expect(changed.state).toBe("changed");
    expect(changed.label).toBe("Changed");
    // The line is the block's identity, not its status. Drift changes the chip
    // and must leave the sentence beneath it untouched, or the header reflows
    // every time somebody types in a shared section.
    expect(changed.line).toBe(following.line);
  });

  it("says 'page' rather than 'pages' for a single follower", () => {
    expect(
      describeBlockLineage({
        isFollowing: true,
        masterName: "Footer",
        usage: usage({ pages: 1, following: 1 }),
      }).line
    ).toBe('Copy of "Footer" · used on 1 page');
  });

  it("gives an Independent block the chip and NO line", () => {
    const lineage = describeBlockLineage({ isFollowing: false });
    expect(lineage.state).toBe("independent");
    expect(lineage.label).toBe("Independent");
    expect(lineage.line).toBeNull();
  });

  // Review finding 3, 2026-08-23. `saveSection()` keys off `savedSectionId`
  // ALONE and never reads `canonical`, so a disconnected copy's save button
  // still opens the "overwrite the original?" dialog and fans out to every
  // follower. Both blocks below used to promise "edits here stay on this
  // page"; for one of them that is the opposite of the truth, on the one
  // screen whose entire job is saying how far a save reaches.
  it("promises a local save ONLY for a block that never had a master", () => {
    const neverLinked = describeBlockLineage({ isFollowing: false, hasMasterSource: false });
    expect(neverLinked.hint).toContain("stay on this page");
  });

  it("warns that a disconnected copy can still overwrite its original", () => {
    const disconnected = describeBlockLineage({
      isFollowing: false,
      hasMasterSource: true,
      masterName: "2 - Menu Banner",
    });
    expect(disconnected.state).toBe("independent");
    expect(disconnected.label).toBe("Independent");
    expect(disconnected.line).toBeNull();
    // The promise that is false for this block must not be made.
    expect(disconnected.hint).not.toContain("stay on this page");
    expect(disconnected.hint).toMatch(/overwrite/i);
  });

  it("treats a deliberately detached copy as Independent, master or no master", () => {
    const lineage = describeBlockLineage({
      isFollowing: false,
      masterName: "2 - Menu Banner",
      usage: usage({ pages: 35, independent: 1 }),
    });
    expect(lineage.state).toBe("independent");
    expect(lineage.line).toBeNull();
  });

  it("calls the master itself Original and counts its followers", () => {
    const lineage = describeBlockLineage({
      isMaster: true,
      usage: usage({ pages: 35, following: 35 }),
    });
    expect(lineage.state).toBe("original");
    expect(lineage.label).toBe("Original");
    expect(lineage.line).toBe("Used on 35 pages");
  });

  it("says so plainly when a master has no followers yet", () => {
    expect(describeBlockLineage({ isMaster: true, usage: usage() }).line).toBe(
      "Not used on any page yet"
    );
  });

  it("never claims a master is unused when the count was not supplied", () => {
    // undefined means "nobody counted", and "Not used on any page yet" about a
    // master that 35 pages follow is the most dangerous sentence on the screen.
    const lineage = describeBlockLineage({ isMaster: true });
    expect(lineage.state).toBe("original");
    expect(lineage.line).toBeNull();
  });

  it("shows the state but names nothing when the master cannot be resolved", () => {
    const lineage = describeBlockLineage({ isFollowing: true, usage: usage({ pages: 4 }) });
    expect(lineage.state).toBe("following");
    expect(lineage.line).toBeNull();
  });

  it("drops the repeated name when the heading already shows the master's", () => {
    // Since the card titles a following copy by its master
    // (`resolveSharedSectionTitle`), `Copy of "2a - Header"` sat directly under
    // a heading reading `2a - Header`. Keep the reach, drop the repeat.
    const lineage = describeBlockLineage({
      isFollowing: true,
      masterName: "2a - Header",
      usage: usage({ pages: 35, following: 35 }),
      namedInTitle: true,
    });
    expect(lineage.line).toBe("Used on 35 pages");
    expect(lineage.line).not.toContain("Copy of");
  });

  it("says nothing at all when the heading names the master and nothing follows", () => {
    // Not an empty string and not "used on 0 pages" — the same negative rule
    // the Independent state is held to.
    expect(
      describeBlockLineage({
        isFollowing: true,
        masterName: "2a - Header",
        usage: usage(),
        namedInTitle: true,
      }).line
    ).toBeNull();
  });

  it("reads its count from the real usage index, not a second counter", () => {
    // Guards the wiring as well as the wording: if the index shape ever moves,
    // this fails here rather than showing a wrong number in the header.
    const index = buildSavedSectionUsageIndex([
      { name: "Home", layoutSections: [{ savedSectionId: "menu", canonical: true }] },
      { name: "About", layoutSections: [{ savedSectionId: "menu", canonical: true }] },
      { name: "Detached", layoutSections: [{ savedSectionId: "menu", canonical: false }] },
    ]);
    expect(
      describeBlockLineage({
        isFollowing: true,
        masterName: "Menu",
        usage: index.get("menu"),
      }).line
    ).toBe('Copy of "Menu" · used on 2 pages');
  });
});
