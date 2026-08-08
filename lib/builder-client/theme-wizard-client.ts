/**
 * Theme Wizard — browser client for /api/builder/theme-wizard.
 *
 * The server does one model call per request and the client drives the loop
 * (see routes/themeWizard.js). That loop is the reason this file exists as
 * something separate from the component: it has real edge cases — a step that
 * fails, a round that never reports done, a user who navigates away mid-round —
 * and those are worth testing without mounting React.
 */

import { appApi, unwrapEnvelope } from "./adapters/starcaster-app";

/** Where the look is derived from (spec §5). */
export type ThemeWizardSeedType = "current_pages" | "external_url" | "brand_kit" | "brief";

export type ThemeWizardProgress = {
  step: string;
  label: string;
  current: number;
  total: number;
};

export type ThemeWizardCandidate = {
  id: string;
  sessionId: string;
  round: number;
  slot: number;
  direction: string;
  rationale: string;
  themePatch: Record<string, unknown>;
  rank: number | null;
  feedback: string;
};

export type ThemeWizardSession = {
  id: string;
  status: "active" | "applied" | "abandoned";
  seedType: string;
  previewPageId: string;
  styleBrief: Record<string, unknown>;
  lockedValues: Record<string, string>;
  roundCount: number;
  tokensSpent: number;
  appliedCandidateId: string;
  applySnapshotId: string;
};

export type ThemeWizardJob = {
  id: string;
  sessionId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: string;
  input: { round: number; completedSlots: number; warnings?: string[] };
};

type AdvanceResponse = {
  job: ThemeWizardJob;
  progress: ThemeWizardProgress;
  candidate?: ThemeWizardCandidate;
  done?: boolean;
  warnings?: string[];
};

/** Injected so tests never touch the network. */
export type ApiFn = (path: string, options?: RequestInit) => Promise<unknown>;

/**
 * A generated patch is one flat object, but the preview takes the palette and
 * the typography as two separate props — `themeStyles` drives the container
 * chrome, `theme` drives the type tokens. Splitting it here rather than inline
 * in the component keeps the mapping in one testable place, because getting it
 * wrong shows up as a preview that silently ignores half the theme.
 */
export function splitThemePatch(patch: Record<string, unknown> | null | undefined) {
  const source = patch && typeof patch === "object" ? patch : {};
  const typography = (source.typography ?? {}) as Record<string, unknown>;

  const themeStyles: Record<string, unknown> = {};
  for (const key of ["primaryColor", "secondaryColor", "backgroundColor", "accentColor"]) {
    if (typeof source[key] === "string" && source[key]) themeStyles[key] = source[key];
  }

  return {
    // Merged over the "inherit" defaults so any slot the model left out keeps
    // the site's existing value instead of rendering as empty.
    theme: {
      typography: {
        fonts: { heading: "", body: "", mono: "", ...(typography.fonts as object ?? {}) },
        scale: { baseSize: 0, ratio: 0, baseLineHeight: 0, ...(typography.scale as object ?? {}) },
        colors: {
          text: "", heading: "", muted: "", link: "", linkHover: "", selection: "",
          ...(typography.colors as object ?? {})
        },
        elements: {}
      }
    },
    themeStyles
  };
}

const BASE = "/api/builder/theme-wizard";

/**
 * A round is five steps today. The cap is deliberately loose rather than exact:
 * it exists to stop a server bug from spinning the browser forever, not to
 * encode the step count in two places.
 */
const MAX_ADVANCE_STEPS = 12;

function defaultApi(path: string, options?: RequestInit) {
  return appApi(path, options).then((body) => unwrapEnvelope<unknown>(body));
}

function post(api: ApiFn, path: string, body?: unknown) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
}

export type LockableValue = {
  /** Dotted path into the theme patch — the key `lockedValues` is stored under. */
  path: string;
  label: string;
  value: string;
  kind: "colour" | "font";
};

const LOCKABLE: Array<{ path: string; label: string; kind: "colour" | "font" }> = [
  { path: "primaryColor", label: "Primary", kind: "colour" },
  { path: "secondaryColor", label: "Secondary", kind: "colour" },
  { path: "backgroundColor", label: "Background", kind: "colour" },
  { path: "accentColor", label: "Accent", kind: "colour" },
  { path: "typography.fonts.heading", label: "Heading font", kind: "font" },
  { path: "typography.fonts.body", label: "Body font", kind: "font" }
];

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((cursor, segment) => {
    if (!cursor || typeof cursor !== "object") return undefined;
    return (cursor as Record<string, unknown>)[segment];
  }, source);
}

/**
 * The values an operator can pin from a candidate (spec §6.4 — "keep this exact
 * blue", "keep this heading font").
 *
 * Deliberately a short list rather than every field in the patch. A pin is a
 * constraint on every future round, and a wall of forty toggles invites pinning
 * so much that later rounds have nothing left to vary — which is the same as
 * turning the wizard off.
 */
export function lockableValuesFrom(patch: Record<string, unknown> | null | undefined): LockableValue[] {
  const source = patch && typeof patch === "object" ? patch : {};
  return LOCKABLE.map((entry) => {
    const raw = readPath(source, entry.path);
    const value = typeof raw === "string" ? raw : "";
    return value ? { ...entry, value } : null;
  }).filter((entry): entry is LockableValue => entry !== null);
}

export function createWizardClient(api: ApiFn = defaultApi) {
  return {
    /**
     * The project's pages, for the preview picker.
     *
     * The endpoint is `/api/builder/landing-pages`, not `/api/builder/pages` —
     * the latter does not exist and was assumed rather than checked, which cost
     * a live round trip to find out. It lives here rather than inline in the
     * component so the path is something a test can hold onto.
     */
    async loadPages() {
      return (await api("/api/builder/landing-pages")) as Array<{
        id: string;
        name?: string;
        slug?: string;
        layoutSections?: unknown[];
        pageBackground?: unknown;
      }>;
    },

    /** Images from Assets, for the brand-kit starting point. */
    async loadBrandImages() {
      const assets = (await api("/api/assets")) as Array<Record<string, unknown>>;
      return (Array.isArray(assets) ? assets : [])
        .filter((a) => String(a.assetType || "").toLowerCase().includes("image") && a.location)
        .map((a) => ({ id: String(a.id), assetName: String(a.assetName || "") }));
    },

    async startSession(
      input: {
        previewPageId?: string;
        seedType?: ThemeWizardSeedType;
        seedPayload?: Record<string, string>;
      } = {}
    ) {
      return (await post(api, `${BASE}/sessions`, {
        seedType: input.seedType || "current_pages",
        seedPayload: input.seedPayload || {},
        previewPageId: input.previewPageId || ""
      })) as ThemeWizardSession;
    },

    async loadSession(sessionId: string) {
      return (await api(`${BASE}/sessions/${encodeURIComponent(sessionId)}`)) as {
        session: ThemeWizardSession;
        candidates: ThemeWizardCandidate[];
        jobs: ThemeWizardJob[];
      };
    },

    async queueRound(sessionId: string, input: { parentCandidateId?: string; feedback?: string } = {}) {
      return (await post(api, `${BASE}/sessions/${encodeURIComponent(sessionId)}/generate`, {
        parentCandidateId: input.parentCandidateId || "",
        feedback: input.feedback || ""
      })) as { job: ThemeWizardJob; round: number; progress: ThemeWizardProgress };
    },

    /**
     * Drive a queued round to completion, one model call per request.
     *
     * `onProgress` fires after every step so the screen can say what is actually
     * happening rather than showing a spinner with a guessed caption. Candidates
     * are handed over as they arrive, so the compare screen can fill in one
     * option at a time instead of waiting for all three.
     *
     * `shouldContinue` is checked before each step — the component passes a flag
     * it clears on unmount, so navigating away stops the loop instead of leaving
     * requests in flight against a screen that no longer exists.
     */
    async advanceUntilDone(
      jobId: string,
      handlers: {
        onProgress?: (progress: ThemeWizardProgress) => void;
        onCandidate?: (candidate: ThemeWizardCandidate) => void;
        shouldContinue?: () => boolean;
      } = {}
    ): Promise<{ done: boolean; stopped: boolean; warnings: string[] }> {
      const warnings: string[] = [];

      for (let step = 0; step < MAX_ADVANCE_STEPS; step += 1) {
        if (handlers.shouldContinue && !handlers.shouldContinue()) {
          return { done: false, stopped: true, warnings };
        }

        // A failed step throws out of appApi with the server's message, which is
        // written for the operator. Let it propagate rather than flattening it
        // into a generic "generation failed".
        const result = (await post(api, `${BASE}/jobs/${encodeURIComponent(jobId)}/advance`)) as AdvanceResponse;

        if (result.progress) handlers.onProgress?.(result.progress);
        if (result.candidate) handlers.onCandidate?.(result.candidate);
        if (Array.isArray(result.warnings)) warnings.push(...result.warnings);

        if (result.done) return { done: true, stopped: false, warnings };
      }

      throw new Error(
        `The round did not finish after ${MAX_ADVANCE_STEPS} steps. Nothing was applied; start a new round.`
      );
    },

    async rank(sessionId: string, rankings: Array<{ candidateId: string; rank: number; feedback?: string }>) {
      return (await post(api, `${BASE}/sessions/${encodeURIComponent(sessionId)}/rank`, {
        rankings
      })) as ThemeWizardCandidate[];
    },

    async setLocks(sessionId: string, lockedValues: Record<string, string>) {
      return (await post(api, `${BASE}/sessions/${encodeURIComponent(sessionId)}/locks`, {
        lockedValues
      })) as ThemeWizardSession;
    },

    async apply(candidateId: string, name?: string) {
      return (await post(api, `${BASE}/candidates/${encodeURIComponent(candidateId)}/apply`, {
        name: name || ""
      })) as {
        theme: { id: string; name: string };
        snapshotId: string | null;
        applied: number;
        failed: number;
        failures: Array<{ id: string; name: string; error: string }>;
      };
    },

    async revert(sessionId: string) {
      return (await post(api, `${BASE}/sessions/${encodeURIComponent(sessionId)}/revert`)) as {
        restored: number;
        failed: number;
        failures: Array<{ id: string; name: string; error: string }>;
        sessionStatus: string;
      };
    }
  };
}

export type ThemeWizardClient = ReturnType<typeof createWizardClient>;
