import { describe, it, expect, vi } from "vitest";

import { createWizardClient, splitThemePatch } from "./theme-wizard-client";

/**
 * The server does one model call per request and this client drives the loop.
 * The loop is where the edge cases live: a step that fails, a round that never
 * reports done, and a user who navigates away while three Fable 5 calls are
 * still queued up behind them.
 */

type Step = { progress?: unknown; candidate?: unknown; done?: boolean; warnings?: string[] };

/** An api() that replays a fixed list of advance responses. */
function scriptedApi(steps: Step[]) {
  const calls: string[] = [];
  let index = 0;
  const api = vi.fn(async (path: string) => {
    calls.push(path);
    if (path.endsWith("/advance")) {
      const step = steps[index];
      index += 1;
      if (!step) throw new Error("advanced further than the script allows");
      return step;
    }
    return {};
  });
  return { api, calls };
}

const progressAt = (label: string) => ({ step: "candidates", label, current: 1, total: 5 });

describe("advanceUntilDone", () => {
  it("drives the round to completion and reports each step", async () => {
    const { api, calls } = scriptedApi([
      { progress: progressAt("Choosing three directions") },
      { progress: progressAt("Generating 1 of 3"), candidate: { id: "c1" } },
      { progress: progressAt("Generating 2 of 3"), candidate: { id: "c2" } },
      { progress: progressAt("Generating 3 of 3"), candidate: { id: "c3" }, done: true }
    ]);
    const client = createWizardClient(api);

    const seen: string[] = [];
    const got: string[] = [];
    const result = await client.advanceUntilDone("job_1", {
      onProgress: (p) => seen.push(p.label),
      onCandidate: (c) => got.push(c.id)
    });

    expect(result.done).toBe(true);
    expect(result.stopped).toBe(false);
    expect(calls.filter((c) => c.endsWith("/advance"))).toHaveLength(4);
    expect(seen).toEqual([
      "Choosing three directions",
      "Generating 1 of 3",
      "Generating 2 of 3",
      "Generating 3 of 3"
    ]);
    // Options arrive one at a time so the compare screen fills in progressively
    // rather than sitting empty until all three exist.
    expect(got).toEqual(["c1", "c2", "c3"]);
  });

  it("stops when the caller says to, without firing another request", async () => {
    // The component clears its flag on unmount. Without this check, navigating
    // away mid-round leaves Fable 5 calls in flight and being paid for against
    // a screen nobody is looking at.
    const { api, calls } = scriptedApi([
      { progress: progressAt("Generating 1 of 3"), candidate: { id: "c1" } },
      { progress: progressAt("Generating 2 of 3"), candidate: { id: "c2" } }
    ]);
    const client = createWizardClient(api);

    let alive = true;
    const result = await client.advanceUntilDone("job_1", {
      onCandidate: () => { alive = false; },
      shouldContinue: () => alive
    });

    expect(result.stopped).toBe(true);
    expect(result.done).toBe(false);
    expect(calls.filter((c) => c.endsWith("/advance"))).toHaveLength(1);
  });

  it("gives up with a plain-language message rather than looping forever", async () => {
    // A server bug that never sets done must not spin the browser.
    const never: Step[] = Array.from({ length: 30 }, () => ({ progress: progressAt("Working") }));
    const client = createWizardClient(scriptedApi(never).api);

    await expect(client.advanceUntilDone("job_1")).rejects.toThrow(/did not finish/);
    await expect(client.advanceUntilDone("job_1")).rejects.toThrow(/Nothing was applied/);
  });

  it("lets the server's own error text reach the operator", async () => {
    // The server writes messages for a person — "needs 30-day data retention",
    // "the model declined this request". Flattening those into "generation
    // failed" would throw away the only useful part.
    const api = vi.fn(async () => {
      throw new Error("claude-fable-5 needs 30-day data retention enabled on the Anthropic account.");
    });
    const client = createWizardClient(api);

    await expect(client.advanceUntilDone("job_1")).rejects.toThrow(/30-day data retention/);
  });

  it("collects warnings across steps without failing the round", async () => {
    const { api } = scriptedApi([
      { progress: progressAt("Generating 1 of 3"), warnings: ["accentColor: dropped"] },
      { progress: progressAt("Generating 2 of 3"), warnings: ["scale.baseSize: clamped to 24"], done: true }
    ]);
    const client = createWizardClient(api);

    const result = await client.advanceUntilDone("job_1");
    expect(result.done).toBe(true);
    expect(result.warnings).toEqual(["accentColor: dropped", "scale.baseSize: clamped to 24"]);
  });
});

describe("splitThemePatch", () => {
  it("routes the palette to themeStyles and the type tokens to theme", () => {
    const { theme, themeStyles } = splitThemePatch({
      primaryColor: "#1f2933",
      backgroundColor: "#f5f7fa",
      typography: { fonts: { heading: "archivo" }, colors: { text: "#1f2933" } }
    });

    expect(themeStyles).toEqual({ primaryColor: "#1f2933", backgroundColor: "#f5f7fa" });
    expect(theme.typography.fonts.heading).toBe("archivo");
    expect(theme.typography.colors.text).toBe("#1f2933");
  });

  it("leaves unfilled slots inheriting rather than blank", () => {
    // "" is the inherit sentinel throughout the builder. A slot the model did
    // not mention must keep the site's existing value, not wipe it.
    const { theme } = splitThemePatch({ typography: { fonts: { heading: "lora" } } });
    expect(theme.typography.fonts.body).toBe("");
    expect(theme.typography.fonts.mono).toBe("");
    expect(theme.typography.colors.selection).toBe("");
  });

  it("survives an empty or missing patch", () => {
    for (const input of [null, undefined, {}]) {
      const { theme, themeStyles } = splitThemePatch(input as Record<string, unknown>);
      expect(themeStyles).toEqual({});
      expect(theme.typography.scale.baseSize).toBe(0);
    }
  });
});

describe("request shapes", () => {
  it("starts a session against the current site", async () => {
    const api = vi.fn(async () => ({ id: "twiz_1" }));
    const client = createWizardClient(api);

    await client.startSession({ previewPageId: "page_9" });

    const [path, options] = api.mock.calls[0];
    expect(path).toBe("/api/builder/theme-wizard/sessions");
    expect(JSON.parse(String(options?.body))).toEqual({
      seedType: "current_pages",
      previewPageId: "page_9"
    });
  });

  it("encodes ids so an odd id cannot break the path", async () => {
    const api = vi.fn(async () => ({}));
    const client = createWizardClient(api);

    await client.revert("twiz/../evil");

    expect(api.mock.calls[0][0]).toBe("/api/builder/theme-wizard/sessions/twiz%2F..%2Fevil/revert");
  });
});
