import { describe, it, expect, vi } from "vitest";

import { createWizardClient, splitThemePatch, lockableValuesFrom } from "./theme-wizard-client";

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

  it("carries the role palette on themeStyles so the preview emits its vars", () => {
    const { themeStyles } = splitThemePatch({
      backgroundColor: "#f5f7fa",
      palette: { header: "#132a4a", headerText: "#ffffff", button: "#5aa02c", buttonText: "#ffffff" }
    });
    expect(themeStyles.palette).toEqual({
      header: "#132a4a", headerText: "#ffffff", button: "#5aa02c", buttonText: "#ffffff"
    });
  });

  it("drops a malformed or empty palette rather than passing junk to the shell", () => {
    expect(splitThemePatch({ palette: "navy-ish" as never }).themeStyles.palette).toBeUndefined();
    expect(splitThemePatch({ palette: {} }).themeStyles.palette).toBeUndefined();
    expect(splitThemePatch({ palette: { header: 7 } as never }).themeStyles.palette).toBeUndefined();
  });
});

describe("lockableValuesFrom", () => {
  it("offers the palette and the two font slots, keyed by their patch path", () => {
    const values = lockableValuesFrom({
      primaryColor: "#1a4d8f",
      accentColor: "#d08c34",
      typography: { fonts: { heading: "lora", body: "inter" } }
    });

    expect(values.map((v) => v.path)).toEqual([
      "primaryColor",
      "accentColor",
      "typography.fonts.heading",
      "typography.fonts.body"
    ]);
    // Role-palette pins ride the same dotted-path mechanism.
    const withPalette = lockableValuesFrom({
      palette: { header: "#132a4a", button: "#5aa02c" }
    });
    expect(withPalette.map((v) => v.path)).toEqual(["palette.header", "palette.button"]);
    expect(withPalette[0].kind).toBe("colour");
    // The path is what lockedValues is keyed by, so it has to survive intact
    // all the way to applyLockedValues on the server.
    expect(values.find((v) => v.path === "typography.fonts.heading")?.value).toBe("lora");
    expect(values.find((v) => v.path === "primaryColor")?.kind).toBe("colour");
  });

  it("omits values the candidate does not actually have", () => {
    // A pin on an empty value would lock every future round to "inherit",
    // which reads as the wizard quietly refusing to change anything.
    const values = lockableValuesFrom({ primaryColor: "#111111" });
    expect(values).toHaveLength(1);
    expect(values[0].path).toBe("primaryColor");
  });

  it("survives a missing or malformed patch", () => {
    expect(lockableValuesFrom(null)).toEqual([]);
    expect(lockableValuesFrom({ typography: "not an object" } as never)).toEqual([]);
  });
});

describe("endpoint paths", () => {
  // `/api/builder/pages` was assumed rather than looked up. It does not exist,
  // and nothing caught it until a live round trip returned "API route not
  // found" — because the call was inline in the component where no test could
  // reach it. These assertions are the cheap version of that discovery.
  it("reads pages from the endpoint that actually exists", async () => {
    const api = vi.fn(async () => []);
    await createWizardClient(api).loadPages();
    expect(api).toHaveBeenCalledWith("/api/builder/landing-pages");
  });

  it("reads brand images from the assets endpoint", async () => {
    const api = vi.fn(async () => []);
    await createWizardClient(api).loadBrandImages();
    expect(api).toHaveBeenCalledWith("/api/assets");
  });

  it("keeps only images that have a file behind them", async () => {
    const api = vi.fn(async () => [
      { id: 1, assetName: "Logo", assetType: "Image", location: "https://cdn/logo.png" },
      { id: 2, assetName: "No file", assetType: "Image", location: "" },
      { id: 3, assetName: "A PDF", assetType: "Document", location: "https://cdn/a.pdf" }
    ]);
    const images = await createWizardClient(api).loadBrandImages();
    expect(images).toEqual([{ id: "1", assetName: "Logo" }]);
  });

  it("covers every wizard endpoint the server actually serves", async () => {
    // One place listing every path this client can hit. If a route is renamed
    // server-side, this is the test that should go red.
    const api = vi.fn(async () => ({ job: { id: "j1" } }));
    const client = createWizardClient(api);

    await client.startSession();
    await client.loadSession("s1");
    await client.queueRound("s1");
    await client.rank("s1", []);
    await client.setLocks("s1", {});
    await client.apply("c1");
    await client.revert("s1");
    await client.loadPages();
    await client.loadBrandImages();

    expect(api.mock.calls.map(([path]) => path)).toEqual([
      "/api/builder/theme-wizard/sessions",
      "/api/builder/theme-wizard/sessions/s1",
      "/api/builder/theme-wizard/sessions/s1/generate",
      "/api/builder/theme-wizard/sessions/s1/rank",
      "/api/builder/theme-wizard/sessions/s1/locks",
      "/api/builder/theme-wizard/candidates/c1/apply",
      "/api/builder/theme-wizard/sessions/s1/revert",
      "/api/builder/landing-pages",
      "/api/assets"
    ]);
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
      seedPayload: {},
      previewPageId: "page_9"
    });
  });

  it("carries the seed's own input through for the other starting points", async () => {
    const api = vi.fn(async () => ({ id: "twiz_1" }));
    const client = createWizardClient(api);

    await client.startSession({ seedType: "external_url", seedPayload: { url: "example.com" } });
    await client.startSession({ seedType: "brief", seedPayload: { text: "A tennis club." } });
    await client.startSession({ seedType: "brand_kit", seedPayload: { assetId: "42" } });

    const bodies = api.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
    expect(bodies[0].seedType).toBe("external_url");
    expect(bodies[0].seedPayload).toEqual({ url: "example.com" });
    expect(bodies[1].seedPayload).toEqual({ text: "A tennis club." });
    expect(bodies[2].seedPayload).toEqual({ assetId: "42" });
  });

  it("encodes ids so an odd id cannot break the path", async () => {
    const api = vi.fn(async () => ({}));
    const client = createWizardClient(api);

    await client.revert("twiz/../evil");

    expect(api.mock.calls[0][0]).toBe("/api/builder/theme-wizard/sessions/twiz%2F..%2Fevil/revert");
  });
});

describe("past runs", () => {
  it("lists sessions from the sessions endpoint", async () => {
    const api = vi.fn(async () => [{ id: "twiz_1", status: "active" }]);
    const client = createWizardClient(api);

    const runs = await client.listSessions();

    expect(runs).toEqual([{ id: "twiz_1", status: "active" }]);
    expect(api.mock.calls[0][0]).toBe("/api/builder/theme-wizard/sessions");
  });

  it("deletes a run through an encoded id", async () => {
    // Same rule as revert above: the id goes into the URL, so it must not be
    // able to smuggle path segments.
    const api = vi.fn(async () => ({ deleted: true, id: "twiz/../evil" }));
    const client = createWizardClient(api);

    await client.deleteSession("twiz/../evil");

    expect(api.mock.calls[0][0]).toBe("/api/builder/theme-wizard/sessions/twiz%2F..%2Fevil");
    expect(api.mock.calls[0][1]).toEqual({ method: "DELETE" });
  });
});
