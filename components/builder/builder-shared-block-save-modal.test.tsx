// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderSharedBlockSaveModal } from "./builder-shared-block-save-modal";
import { describeCanonicalOverwrite, type BlockUsage } from "@/lib/shared-block-usage";
import { publishNamedPages } from "@/lib/publish-pages";

/**
 * The dialog that ends the "now go and publish it" step.
 *
 * Saving a saved section already rewrites it on every following page — but in
 * those pages' DRAFTS. The operator's next move was to leave this screen, open
 * a page, save it and publish it (his words, 2026-09-03), and a step you have
 * to remember on another screen is a step that gets skipped.
 *
 * What must not regress: the page list is readable BEFORE the click, and both
 * saves are offered with neither assumed. Publishing reaches the live site, so
 * it is never what a stray Enter does.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function buttonLabelled(match: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((button) =>
    (button.textContent ?? "").includes(match)
  );
  if (!found) throw new Error(`No button containing "${match}". Buttons: ${
    Array.from(document.querySelectorAll("button")).map((b) => b.textContent).join(" | ")
  }`);
  return found as HTMLButtonElement;
}

function usage(pageLabels: string[]): BlockUsage {
  return { following: pageLabels.length, independent: 0, pages: pageLabels.length, pageLabels };
}

const IMPACT = describeCanonicalOverwrite("Site Header", usage(["Home", "About", "Contact"]), []);

describe("BuilderSharedBlockSaveModal", () => {
  it("names every page the save will change, before anything is written", () => {
    render(
      <BuilderSharedBlockSaveModal
        blockKind="saved section"
        name="Site Header"
        impact={IMPACT}
        isSaving={false}
        onChoose={() => {}}
        onCancel={() => {}}
      />
    );
    const text = document.body.textContent ?? "";
    for (const page of ["Home", "About", "Contact"]) {
      expect(text).toContain(page);
    }
  });

  it("offers both saves, and reports which one was chosen", () => {
    const onChoose = vi.fn();
    render(
      <BuilderSharedBlockSaveModal
        blockKind="saved section"
        name="Site Header"
        impact={IMPACT}
        isSaving={false}
        onChoose={onChoose}
        onCancel={() => {}}
      />
    );

    act(() => buttonLabelled("Save & Publish").click());
    expect(onChoose).toHaveBeenCalledWith("save-and-publish");

    // "Save" alone must still be reachable — the draft-only save is the right
    // answer whenever the edit is not finished, and it is today's behaviour.
    onChoose.mockClear();
    const plainSave = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Save"
    );
    expect(plainSave, "a plain Save button, distinct from Save & Publish").toBeTruthy();
    act(() => (plainSave as HTMLButtonElement).click());
    expect(onChoose).toHaveBeenCalledWith("save");
  });

  it("cancel writes nothing — it is not a save", () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(
      <BuilderSharedBlockSaveModal
        blockKind="saved section"
        name="Site Header"
        impact={IMPACT}
        isSaving={false}
        onChoose={onChoose}
        onCancel={onCancel}
      />
    );
    act(() => buttonLabelled("Cancel").click());
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("never lists one page as both changing and left alone", () => {
    // `impact.pageLabels` is every FOLLOWING page — the population drift is
    // measured within — so a drifted page is in both lists at the source.
    // Rendering them unfiltered put "About" under "These pages change" AND
    // under "Left alone", each contradicting the other.
    const impact = describeCanonicalOverwrite("Site Header", usage(["Home", "About"]), ["About"]);
    render(
      <BuilderSharedBlockSaveModal
        blockKind="saved section"
        name="Site Header"
        impact={impact}
        isSaving={false}
        onChoose={() => {}}
        onCancel={() => {}}
      />
    );
    const lists = Array.from(document.querySelectorAll(".builder-choice-dialog-detail"));
    const changing = lists.find((el) => /change/i.test(el.textContent ?? ""));
    const leftAlone = lists.find((el) => /left alone/i.test(el.textContent ?? ""));
    expect(changing?.textContent).toContain("Home");
    expect(changing?.textContent, "the drifted page is not rewritten, so it is not changing")
      .not.toContain("About");
    expect(leftAlone?.textContent).toContain("About");
  });

  it("counts only the pages that will actually be published", () => {
    const impact = describeCanonicalOverwrite("Site Header", usage(["Home", "About"]), ["About"]);
    render(
      <BuilderSharedBlockSaveModal
        blockKind="saved section"
        name="Site Header"
        impact={impact}
        isSaving={false}
        onChoose={() => {}}
        onCancel={() => {}}
      />
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("that page goes live");
    expect(text, "two followers minus one drifted is one page, not two").not.toMatch(/those 2 pages go live/);
  });

  it("says which pages keep their local changes and are therefore NOT published", () => {
    const impact = describeCanonicalOverwrite("Site Header", usage(["Home", "About"]), ["About"]);
    render(
      <BuilderSharedBlockSaveModal
        blockKind="saved section"
        name="Site Header"
        impact={impact}
        isSaving={false}
        onChoose={() => {}}
        onCancel={() => {}}
      />
    );
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/neither rewritten nor published/i);
    expect(text).toContain("About");
  });

  it("Escape cancels; it never saves", () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(
      <BuilderSharedBlockSaveModal
        blockKind="saved section"
        name="Site Header"
        impact={IMPACT}
        isSaving={false}
        onChoose={onChoose}
        onCancel={onCancel}
      />
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });
});

/**
 * The publish half. It NAMES the pages: `POST /api/builder/publish` with no
 * `pageIds` publishes everything pending, so the obvious wiring would push
 * every unrelated half-finished draft in the project live as a side effect of
 * a routine section edit.
 */
describe("publishNamedPages", () => {
  function ok(data: Record<string, unknown>) {
    return { ok: true, json: async () => ({ ok: true, data }) };
  }

  it("sends the page ids, and keeps asking until the server says done", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const answers = [
      ok({ buildId: "b1", published: 2, remaining: 1, done: false }),
      ok({ buildId: "b1", published: 1, remaining: 0, done: true }),
    ];
    const result = await publishNamedPages(async (body) => {
      sent.push(body);
      return answers.shift()!;
    }, ["10", "11", "12"]);

    expect(result).toEqual({ published: 3, error: null });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ pageIds: ["10", "11", "12"] });
    // The second batch continues the same build rather than starting a new one.
    expect(sent[1]).toEqual({ pageIds: ["10", "11", "12"], buildId: "b1" });
  });

  it("publishes NOTHING when the page list is empty, and never asks the server", async () => {
    // The hazard in one test: an empty list must not become "no filter".
    const post = vi.fn();
    const result = await publishNamedPages(post, []);
    expect(result).toEqual({ published: 0, error: null });
    expect(post).not.toHaveBeenCalled();
  });

  it("reports a failed batch instead of returning a clean publish", async () => {
    const result = await publishNamedPages(
      async () => ({ ok: false, json: async () => ({ error: { message: "Could not publish" } }) }),
      ["10"]
    );
    expect(result.published).toBe(0);
    expect(result.error).toBe("Could not publish");
  });

  it("says how far it got when a later batch fails", async () => {
    const answers = [
      ok({ buildId: "b1", published: 2, remaining: 5, done: false }),
      { ok: false, json: async () => ({ error: "Publishing stopped" }) },
    ];
    const result = await publishNamedPages(async () => answers.shift()!, ["1", "2", "3"]);
    expect(result.published).toBe(2);
    expect(result.error).toBe("Publishing stopped");
  });

  it("a thrown network error is an error, not a silent zero", async () => {
    const result = await publishNamedPages(async () => {
      throw new Error("offline");
    }, ["10"]);
    expect(result).toEqual({ published: 0, error: "offline" });
  });

  it("a server that never says done stops, and says the site may be part-published", async () => {
    const result = await publishNamedPages(
      async () => ok({ buildId: "b1", published: 0, remaining: 1, done: false }),
      ["10"]
    );
    expect(result.error).toMatch(/did not finish/i);
  });
});
