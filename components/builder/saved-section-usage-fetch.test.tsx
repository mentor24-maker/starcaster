import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSavedSectionUsageIndex,
  EMPTY_USAGE,
  loadSavedSectionUsage,
  type UsageResponse,
} from "@/lib/shared-block-usage";
import { describeBlockLineage } from "@/lib/block-lineage";

/**
 * Review finding 1, 2026-08-23 — "unused" must never be an answer the screen
 * INVENTED.
 *
 * `builderAdminFetch` does not throw on an HTTP error; it hands back a normal
 * response carrying the failure status. The modal's `loadUsage` only fell back
 * to "unknown" in its `catch`, so a 401 or a 500 left `body.pages` undefined,
 * `pages` became `[]`, and the count came back as a confident ZERO. The header
 * then read "Original — Not used on any page yet", tooltip "saving it changes
 * nothing else", for a master dozens of live tenant pages follow. That is the
 * single most dangerous sentence on this screen, and the file's own comment
 * says so.
 *
 * The fix is one branch, so what is pinned here is the branch's CONSEQUENCE:
 * a failed count must arrive as `null` (chip, no line), never as zero.
 */

/**
 * This calls the REAL helper the modal calls. An earlier draft of this file
 * re-implemented the four lines under test, which meant reverting the fix in
 * the modal left every assertion green -- a test that cannot fail. The branch
 * was moved into shared-block-usage.ts precisely so this file could reach it.
 */
function respond(status: number, body: unknown): () => Promise<UsageResponse> {
  return async () => ({ ok: status >= 200 && status < 300, json: async () => body });
}

function rejects(): () => Promise<UsageResponse> {
  return async () => {
    throw new Error("offline");
  };
}

const loadUsage = (fetchPages: () => Promise<UsageResponse>, id = "sec_1") =>
  loadSavedSectionUsage(fetchPages, id);

describe("the saved-section usage count when the page list cannot be read", () => {
  it("reports UNKNOWN, not zero, on a 401", async () => {
    expect(await loadUsage(respond(401, { error: "Not authenticated" }))).toBeNull();
  });

  it("reports UNKNOWN, not zero, on a 500", async () => {
    expect(await loadUsage(respond(500, {}))).toBeNull();
  });

  it("still reports UNKNOWN when the fetch itself throws", async () => {
    expect(await loadUsage(rejects())).toBeNull();
  });

  it("counts normally on a good response", async () => {
    const usage = await loadUsage(
      respond(200, {
        pages: [
          { id: "p1", name: "Home", layoutSections: [{ savedSectionId: "sec_1", canonical: true }] },
          { id: "p2", name: "About", layoutSections: [{ savedSectionId: "sec_1", canonical: true }] },
        ],
      })
    );
    expect(usage).not.toBeNull();
    expect(usage?.pages).toBe(2);
  });

  it("a genuinely unused master counts zero — which is different from unknown", async () => {
    const usage = await loadUsage(respond(200, { pages: [{ id: "p1", name: "Home", layoutSections: [] }] }));
    expect(usage).not.toBeNull();
    expect(usage?.pages).toBe(0);
  });
});

/**
 * Review finding 2, 2026-08-23 — the other half of the same confusion.
 *
 * `buildSavedSectionUsageIndex` only creates an entry for a section it actually
 * FOUND on a page, so a master nothing follows comes back `undefined` from the
 * index — indistinguishable, at the call site, from "not counted". The Modules
 * manager passed that `undefined` straight through, so an unused master got the
 * alarming "saving rewrites this section on every page that follows it" while
 * the Used In column in the same table row said "Not used yet".
 *
 * Here the index really was built from every page, so `undefined` genuinely
 * means zero and the call site says so with `?? EMPTY_USAGE`.
 */
describe("an unused master in the Modules manager", () => {
  it("the index returns undefined for a section no page uses", () => {
    const index = buildSavedSectionUsageIndex([
      { id: "p1", name: "Home", layoutSections: [] },
    ]);
    expect(index.get("sec_unused")).toBeUndefined();
  });

  it("undefined reads as NOT COUNTED, so the call site must not pass it through", () => {
    const passedThrough = describeBlockLineage({ isMaster: true, usage: undefined });
    expect(passedThrough.line).toBeNull();
    expect(passedThrough.hint).toMatch(/rewrites this section on every page/);

    const corrected = describeBlockLineage({ isMaster: true, usage: EMPTY_USAGE });
    expect(corrected.line).toBe("Not used on any page yet");
    expect(corrected.hint).toMatch(/changes nothing else/);
  });
});

/**
 * The call site itself, guarded at the source.
 *
 * This one is a single token in a 1,600-line component; reaching it through a
 * mounted test means standing up the whole Modules manager, and a test that
 * expensive for one `??` would not survive its first refactor. So this asserts
 * the token is present -- a weaker guard than behaviour, deliberately chosen,
 * and it does fail if someone takes it back out (verified by removing it).
 */
describe("the Modules manager call site", () => {
  it("resolves an uncounted master to zero, not to unknown", () => {
    const source = readFileSync(
      new URL("./builder-module-repository-list.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("savedSectionUsage.get(section.id) ?? EMPTY_USAGE");
  });
});
