import { describe, expect, it } from "vitest";
import { moduleFollowsMaster, sectionFollowsMaster, setFollowsMaster } from "./canonical-follow";

/**
 * The browser's half of the one polarity.
 *
 * These assertions are deliberately the same ones the server twin is held to
 * (`scripts/builder/canonicalPropagation.test.js`). If the two ever disagree,
 * the badge on a module card claims one thing and the push does another —
 * which is precisely the state Sync 7/7 exists to end.
 */
describe("does this copy follow its master", () => {
  it("reads the one spelling, at both levels", () => {
    expect(moduleFollowsMaster({ canonical: true })).toBe(true);
    expect(moduleFollowsMaster({ canonical: false })).toBe(false);
    expect(sectionFollowsMaster({ canonical: true })).toBe(true);
    expect(sectionFollowsMaster({ canonical: false })).toBe(false);
  });

  it("still reads the module side's legacy opt-out, and lets it win", () => {
    expect(moduleFollowsMaster({ canonicalLocked: true })).toBe(false);
    // A push stamps `canonical: true` on every copy it writes. Locking that
    // copy afterwards has to stick, or the badge says Custom and the next push
    // overwrites it anyway.
    expect(moduleFollowsMaster({ canonical: true, canonicalLocked: true })).toBe(false);
  });

  it("keeps each level's historic default for a copy that never answered", () => {
    // Inserting a saved section has always offered "linked" or "just a copy";
    // an unmarked one is the copy. A saved module never had an opt-in at all.
    // Flip either and copies on live client pages silently change behaviour.
    expect(sectionFollowsMaster({})).toBe(false);
    expect(moduleFollowsMaster({})).toBe(true);
  });

  it("writes one field and removes the other", () => {
    const locked = { id: "m1", canonicalLocked: true as boolean };
    const relinked = setFollowsMaster(locked, true);
    expect(relinked.canonical).toBe(true);
    expect("canonicalLocked" in relinked).toBe(false);

    const detached = setFollowsMaster({ id: "m1", canonical: true }, false);
    expect(detached.canonical).toBe(false);
  });

  it("round-trips a toggle, so a click cannot leave the two fields disagreeing", () => {
    let copy: { canonical?: boolean; canonicalLocked?: boolean } = { canonicalLocked: true };
    copy = setFollowsMaster(copy, !moduleFollowsMaster(copy));
    expect(moduleFollowsMaster(copy)).toBe(true);
    copy = setFollowsMaster(copy, !moduleFollowsMaster(copy));
    expect(moduleFollowsMaster(copy)).toBe(false);
    expect(copy).toEqual({ canonical: false });
  });

  it("treats a missing copy as not following, rather than throwing", () => {
    expect(moduleFollowsMaster(null)).toBe(false);
    expect(sectionFollowsMaster(undefined)).toBe(false);
  });
});
