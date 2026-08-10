import { useState, useEffect, useCallback, useRef } from "react";

import { BuilderTemplatePreview } from "@/components/builder-template-preview";
import { BuilderImagePickerField } from "@/components/builder/builder-image-picker-field";
import {
  createWizardClient,
  splitThemePatch,
  lockableValuesFrom,
  type ThemeWizardCandidate,
  type ThemeWizardProgress,
  type ThemeWizardSession,
  type ThemeWizardSeedType,
  type ThemeWizardSeedPayload
} from "@/lib/theme-wizard-client";

/**
 * Theme Wizard — the operator-facing flow (spec §8).
 *
 * Screens run in order: start → generating → compare-and-rank → apply. The
 * loop back for another round lives on the compare screen, because "generate
 * another" and "apply this one" are the same decision made at the same moment.
 *
 * Two things here are deliberate rather than incidental:
 *
 *   * Options appear one at a time as they finish. A round is four model calls
 *     and Fable 5 is not fast; showing the first option while the third is
 *     still generating is the difference between a wizard that feels alive and
 *     one that looks hung.
 *   * The apply confirmation names the page count out loud and says undo
 *     exists. Applying rewrites every page in the project (hazard 4.1), and a
 *     button that quietly does that is how the Marinoff menu was lost.
 */

type PageRecord = {
  id: string;
  name: string;
  slug?: string;
  layoutSections?: unknown[];
  pageBackground?: unknown;
};

type Step = "start" | "generating" | "compare" | "applied";

const client = createWizardClient();

/** Patch paths read back to the operator in plain words. */
const LOCK_LABELS: Record<string, string> = {
  primaryColor: "the primary colour",
  secondaryColor: "the secondary colour",
  backgroundColor: "the background colour",
  accentColor: "the accent colour",
  "palette.header": "the header colour",
  "palette.button": "the button colour",
  "typography.fonts.heading": "the heading font",
  "typography.fonts.body": "the body font"
};

/**
 * The role palette shown as five labelled chips — background swatch with "Aa"
 * in its paired text colour, so readable-or-not is visible before the operator
 * ever enlarges a preview.
 */
const PALETTE_RAIL_ROLES: Array<{ bg: string; text: string; label: string }> = [
  { bg: "header", text: "headerText", label: "Header" },
  { bg: "surface", text: "surfaceText", label: "Sections" },
  { bg: "band", text: "bandText", label: "Soft band" },
  { bg: "inverse", text: "inverseText", label: "Dark band" },
  { bg: "button", text: "buttonText", label: "Button" }
];

function PaletteRail({ patch }: { patch: Record<string, unknown> | null | undefined }) {
  const palette = patch && typeof patch === "object"
    ? (patch as { palette?: Record<string, string> }).palette
    : undefined;
  if (!palette || typeof palette !== "object") return null;
  const chips = PALETTE_RAIL_ROLES.filter((role) => palette[role.bg]);
  if (!chips.length) return null;
  return (
    <div className="tw-palette-rail" aria-label="Colour roles in this look">
      {chips.map((role) => (
        <div
          key={role.bg}
          className="tw-palette-chip"
          title={`${role.label}: ${palette[role.bg]}${palette[role.text] ? ` with ${palette[role.text]} text` : ""}`}
        >
          <span
            className="tw-palette-chip-swatch"
            style={{ background: palette[role.bg], color: palette[role.text] || undefined }}
            aria-hidden="true"
          >
            Aa
          </span>
          <span className="tw-palette-chip-name">{role.label}</span>
        </div>
      ))}
    </div>
  );
}

const SEED_LABELS: Record<string, string> = {
  current_pages: "From this site",
  external_url: "From another website",
  brand_kit: "From a brand image",
  brief: "From a typed description"
};

/** One line that tells past runs apart at a glance. */
function describeRun(run: ThemeWizardSession) {
  const when = run.createdAt ? new Date(run.createdAt) : null;
  const date = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";
  const seed = run.seedType === "brief" && run.seedPayload?.text
    ? `"${run.seedPayload.text.slice(0, 60)}${run.seedPayload.text.length > 60 ? "…" : ""}"`
    : run.seedType === "external_url" && run.seedPayload?.url
      ? `From ${run.seedPayload.url}`
      : SEED_LABELS[run.seedType] || run.seedType;
  const rounds = run.roundCount
    ? `${run.roundCount} round${run.roundCount === 1 ? "" : "s"}`
    : "never finished a round";
  return { date, seed, rounds };
}

/**
 * The run's starting point, shown in full on an opened run. The description
 * that seeded a run is something operators come back for ("give me that same
 * prompt again") — it is stored with the session, so hiding it behind a
 * 60-character teaser in the runs list was withholding data we already had.
 */
function SeedSummary({ session }: { session: ThemeWizardSession }) {
  const [copied, setCopied] = useState(false);
  const seed = session.seedPayload || {};
  const fullText =
    session.seedType === "brief" ? (seed.text || "")
      : session.seedType === "external_url" ? (seed.url || "")
        : "";

  const intro =
    session.seedType === "brief" ? "Based on this description:"
      : session.seedType === "external_url" ? "Based on this website:"
        : session.seedType === "brand_kit" ? "Based on a logo or brand image from Assets."
          : "Based on this site as it was when the run started.";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be denied; the text is selectable either way.
    }
  }

  return (
    <div className="tw-seed">
      <span className="tw-muted">{intro}</span>
      {fullText ? (
        <>
          <blockquote className="tw-seed-text">{fullText}</blockquote>
          <button type="button" className="tw-link" onClick={handleCopy}>
            {copied ? "Copied" : "Copy it"}
          </button>
        </>
      ) : null}
    </div>
  );
}

export function BuilderThemeWizard({ onClose }: { onClose?: () => void }) {
  const [step, setStep] = useState<Step>("start");
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [previewPageId, setPreviewPageId] = useState("");
  const [session, setSession] = useState<ThemeWizardSession | null>(null);
  const [candidates, setCandidates] = useState<ThemeWizardCandidate[]>([]);
  const [progress, setProgress] = useState<ThemeWizardProgress | null>(null);
  const [ranks, setRanks] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [seedType, setSeedType] = useState<ThemeWizardSeedType>("current_pages");
  const [seedUrl, setSeedUrl] = useState("");
  const [seedText, setSeedText] = useState("");
  const [seedAssetId, setSeedAssetId] = useState("");
  const [heroBannerUrls, setHeroBannerUrls] = useState<string[]>(["", "", ""]);
  const [heroNote, setHeroNote] = useState("");
  const [heroReferenceUrl, setHeroReferenceUrl] = useState("");
  const [images, setImages] = useState<Array<{ id: string; assetName: string }>>([]);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [applyResult, setApplyResult] = useState<{ applied: number; failed: number } | null>(null);
  const [confirmingApply, setConfirmingApply] = useState<ThemeWizardCandidate | null>(null);
  const [expanded, setExpanded] = useState<ThemeWizardCandidate | null>(null);
  const [pastSessions, setPastSessions] = useState<ThemeWizardSession[]>([]);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState("");

  // Cleared on unmount so a round in flight stops instead of billing three more
  // model calls against a screen that is gone.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Escape closes the full-size preview. An overlay with no keyboard exit is a
  // trap for anyone not using a mouse.
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  useEffect(() => {
    (async () => {
      try {
        const list = (await client.loadPages()) as PageRecord[];
        setPages(list);
        if (list.length && !previewPageId) setPreviewPageId(String(list[0].id));

        // Images for the brand-kit seed. A failure here is not fatal — the
        // other three starting points still work — so it does not surface as
        // an error, only as an empty picker that says so.
        try {
          setImages(await client.loadBrandImages());
        } catch {
          setImages([]);
        }

        // Past runs. Same deal — the wizard is fully usable without the list.
        try {
          setPastSessions(await client.listSessions());
        } catch {
          setPastSessions([]);
        }

        // Prefill the banner slots from the theme's saved options, so key
        // images chosen once (Themes → Hero & Treatments) carry over. Only
        // when untouched — never overwrite something the operator typed.
        try {
          const saved = await client.loadThemeHeroBanners();
          if (saved.length) {
            setHeroBannerUrls((prev) =>
              prev.some(Boolean) ? prev : [0, 1, 2].map((i) => saved[i] || ""));
          }
        } catch {
          // The panel still works empty.
        }
      } catch (err) {
        // Pass the server's own words through. "Could not load this project's
        // pages" is true of every failure and useful for none — the actual
        // message here is usually "Active project is required", which tells the
        // operator exactly what to go and do.
        const detail = err instanceof Error ? err.message : "";
        setError(
          detail
            ? `Could not load this project's pages: ${detail}`
            : "Could not load this project's pages."
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewPage = pages.find((p) => String(p.id) === previewPageId) || pages[0] || null;
  const currentRound = session?.roundCount || 0;
  const roundCandidates = candidates.filter((c) => c.round === (currentRound || 1));
  const winner = roundCandidates.find((c) => ranks[c.id] === 1) || null;
  const lockedCount = Object.keys(session?.lockedValues || {}).length;

  const runRound = useCallback(async (sessionId: string, parentCandidateId = "", feedback = "") => {
    setIsBusy(true);
    setError("");
    setWarnings([]);
    setStep("generating");
    try {
      const queued = await client.queueRound(sessionId, { parentCandidateId, feedback });
      setProgress(queued.progress);
      const result = await client.advanceUntilDone(queued.job.id, {
        onProgress: (p) => { if (aliveRef.current) setProgress(p); },
        onCandidate: (c) => { if (aliveRef.current) setCandidates((prev) => [...prev, c]); },
        shouldContinue: () => aliveRef.current
      });
      if (!aliveRef.current) return;
      if (result.stopped) return;
      setWarnings(result.warnings);
      const fresh = await client.loadSession(sessionId);
      setSession(fresh.session);
      setCandidates(fresh.candidates);
      setStep("compare");
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : "Generation failed.");
      setStep(candidates.length ? "compare" : "start");
    } finally {
      if (aliveRef.current) setIsBusy(false);
    }
  }, [candidates.length]);

  const seedPayload: ThemeWizardSeedPayload = {
    ...(seedType === "external_url" ? { url: seedUrl.trim() } : {}),
    ...(seedType === "brief" ? { text: seedText.trim() } : {}),
    ...(seedType === "brand_kit" ? { assetId: seedAssetId } : {}),
    heroBannerUrls: heroBannerUrls.map((u) => u.trim()).filter(Boolean),
    heroNote: heroNote.trim(),
    heroReferenceUrl: heroReferenceUrl.trim()
  };

  // Each starting point needs its own input before it can run. Disabling Start
  // with a reason beats letting it fail three model calls later.
  const seedReady =
    seedType === "current_pages" ? pages.length > 0
      : seedType === "external_url" ? seedUrl.trim().length > 0
        : seedType === "brief" ? seedText.trim().length > 0
          : seedAssetId.length > 0;

  /**
   * Reopen a past run exactly where it left off. Everything a run produced is
   * already on the server — this exists because a page refresh used to lose
   * the screen state and look like the run itself was gone.
   */
  async function handleResume(sessionId: string) {
    setIsBusy(true);
    setError("");
    setWarnings([]);
    try {
      const fresh = await client.loadSession(sessionId);
      setSession(fresh.session);
      setCandidates(fresh.candidates);
      if (fresh.session.previewPageId && pages.some((p) => String(p.id) === fresh.session.previewPageId)) {
        setPreviewPageId(fresh.session.previewPageId);
      }
      const savedRanks: Record<string, number> = {};
      const savedNotes: Record<string, string> = {};
      for (const c of fresh.candidates) {
        if (c.rank) savedRanks[c.id] = c.rank;
        if (c.feedback) savedNotes[c.id] = c.feedback;
      }
      setRanks(savedRanks);
      setNotes(savedNotes);
      setApplyResult(null);
      if (fresh.session.status === "applied") {
        setStep("applied");
      } else if (fresh.candidates.length) {
        setStep("compare");
      } else {
        // The run never produced an option (a round that failed on step one).
        // Put its inputs back in the form so Start simply tries again.
        setSeedType((fresh.session.seedType as ThemeWizardSeedType) || "current_pages");
        const seed = fresh.session.seedPayload || {};
        if (seed.url) setSeedUrl(seed.url);
        if (seed.text) setSeedText(seed.text);
        if (seed.assetId) setSeedAssetId(seed.assetId);
        if (Array.isArray(seed.heroBannerUrls) && seed.heroBannerUrls.length) {
          setHeroBannerUrls([0, 1, 2].map((i) => seed.heroBannerUrls?.[i] || ""));
        }
        if (seed.heroNote) setHeroNote(seed.heroNote);
        if (seed.heroReferenceUrl) setHeroReferenceUrl(seed.heroReferenceUrl);
        setStep("start");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that run.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteRun(sessionId: string) {
    setIsBusy(true);
    setError("");
    try {
      await client.deleteSession(sessionId);
      setPastSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (session?.id === sessionId) {
        setSession(null);
        setCandidates([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that run.");
    } finally {
      setIsBusy(false);
      setConfirmingDeleteId("");
    }
  }

  async function handleStart() {
    setIsBusy(true);
    setError("");
    try {
      const created = await client.startSession({ previewPageId, seedType, seedPayload });
      setSession(created);
      await runRound(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start.");
      setIsBusy(false);
    }
  }

  async function handleNextRound() {
    if (!session || !winner) return;
    // Ranking and notes are saved before the next round so the generator can
    // actually use them — this is the whole mechanism behind rounds improving.
    const rankings = roundCandidates
      .filter((c) => ranks[c.id])
      .map((c) => ({ candidateId: c.id, rank: ranks[c.id], feedback: notes[c.id] || "" }));
    try {
      if (rankings.length) await client.rank(session.id, rankings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your ranking.");
      return;
    }
    const combined = roundCandidates
      .map((c) => (notes[c.id] ? `About "${c.direction}": ${notes[c.id]}` : ""))
      .filter(Boolean)
      .join("\n");
    await runRound(session.id, winner.id, combined);
  }

  /**
   * Pin or unpin one value (spec §6.4). Saved immediately rather than on the
   * next Generate: a pin is a statement about the whole session, and losing it
   * because the operator closed the panel would be worse than the extra call.
   */
  async function clearLocks() {
    if (!session) return;
    try {
      setSession(await client.setLocks(session.id, {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear the pins.");
    }
  }

  async function toggleLock(path: string, value: string) {
    if (!session) return;
    const next = { ...(session.lockedValues || {}) };
    if (next[path] === value) delete next[path];
    else next[path] = value;
    try {
      const updated = await client.setLocks(session.id, next);
      setSession(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that pin.");
    }
  }

  async function handleApply(candidate: ThemeWizardCandidate) {
    setIsBusy(true);
    setError("");
    try {
      const result = await client.apply(candidate.id);
      setApplyResult({ applied: result.applied, failed: result.failed });
      if (result.failed > 0) {
        setError(
          `${result.failed} page${result.failed === 1 ? "" : "s"} did not update: `
          + result.failures.map((f) => f.name || f.id).join(", ")
          + ". You can undo the whole change below."
        );
      }
      setStep("applied");
      if (session) {
        const fresh = await client.loadSession(session.id);
        setSession(fresh.session);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the theme.");
    } finally {
      setIsBusy(false);
      setConfirmingApply(null);
    }
  }

  async function handleUndo() {
    if (!session) return;
    setIsBusy(true);
    setError("");
    try {
      const result = await client.revert(session.id);
      if (result.failed > 0) {
        setError(
          `Undo restored ${result.restored} page${result.restored === 1 ? "" : "s"} but `
          + `${result.failed} did not come back: ${result.failures.map((f) => f.name || f.id).join(", ")}. `
          + "The site is part-way between the two themes — do not apply another until this is sorted."
        );
        return;
      }
      setApplyResult(null);
      setStep("compare");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo.");
    } finally {
      setIsBusy(false);
    }
  }

  /**
   * A thumbnail is a real page at quarter scale. The inner content keeps
   * pointer-events: none so a click cannot land on a link inside the page being
   * previewed; the click belongs to the button wrapping it, which opens the
   * full-size view (spec §8 screen 3).
   */
  function renderPreview(candidate: ThemeWizardCandidate, expandable = true) {
    if (!previewPage) return <div className="tw-preview-empty">No page to preview</div>;
    const { theme, themeStyles } = splitThemePatch(candidate.themePatch);
    // Without themeShellBackground the candidate's backgroundColor never
    // reaches the shell, and every look renders on the page's own (usually
    // white) ground — the single most visible part of a palette.
    const shellBackground =
      typeof themeStyles.backgroundColor === "string" && themeStyles.backgroundColor
        ? { backgroundColor: themeStyles.backgroundColor }
        : null;
    const content = (
      <div className={expandable ? "tw-preview-scale" : "tw-preview-full"}>
        <BuilderTemplatePreview
          layoutSections={(previewPage.layoutSections ?? []) as never}
          pageBackground={(previewPage.pageBackground ?? {}) as never}
          theme={theme as never}
          themeStyles={themeStyles as never}
          themeShellBackground={shellBackground as never}
          previewMode
        />
      </div>
    );

    if (!expandable) return content;

    return (
      <button
        type="button"
        className="tw-preview-frame"
        onClick={() => setExpanded(candidate)}
        title="See this one full size"
        aria-label={`See "${candidate.direction}" full size`}
      >
        {content}
        <span className="tw-preview-hint" aria-hidden="true">Click to enlarge</span>
      </button>
    );
  }

  return (
    <div className="tw-wizard">
      <header className="tw-wizard-header">
        <h2>Theme Wizard</h2>
        {onClose ? <button type="button" className="tw-link" onClick={onClose}>Close</button> : null}
      </header>

      {error ? <div className="tw-error" role="alert">{error}</div> : null}

      {step === "start" ? (
        <section className="tw-panel">
          <p>
            This proposes three complete looks for your site, you say which you like,
            and it makes three more from the winner. Nothing on the site changes until
            you choose to apply one.
          </p>
          {pages.length ? (
            <>
              <label className="tw-field">
                <span>Base the looks on</span>
                <select value={seedType} onChange={(e) => setSeedType(e.target.value as ThemeWizardSeedType)}>
                  <option value="current_pages">This site as it is now</option>
                  <option value="external_url">Another website — paste the address</option>
                  <option value="brand_kit">A logo or brand image from Assets</option>
                  <option value="brief">A description I&apos;ll type</option>
                </select>
              </label>

              {seedType === "external_url" ? (
                <label className="tw-field">
                  <span>Website address to read</span>
                  <input
                    type="text"
                    value={seedUrl}
                    placeholder="example.com"
                    onChange={(e) => setSeedUrl(e.target.value)}
                  />
                  <span className="tw-muted">
                    The site is read for what the organisation is and who it talks to — it is not copied.
                  </span>
                </label>
              ) : null}

              {seedType === "brief" ? (
                <label className="tw-field">
                  <span>Describe the organisation</span>
                  <textarea
                    rows={4}
                    value={seedText}
                    placeholder="A family-run tennis club in Delray Beach. Members are local families and serious adult players. Warm but not casual."
                    onChange={(e) => setSeedText(e.target.value)}
                  />
                </label>
              ) : null}

              {seedType === "brand_kit" ? (
                <label className="tw-field">
                  <span>Logo or brand image</span>
                  <select value={seedAssetId} onChange={(e) => setSeedAssetId(e.target.value)}>
                    <option value="">— Choose an image —</option>
                    {images.map((asset) => (
                      <option key={asset.id} value={asset.id}>{asset.assetName || asset.id}</option>
                    ))}
                  </select>
                  {!images.length ? (
                    <span className="tw-muted">No images found in Assets for this project.</span>
                  ) : null}
                </label>
              ) : null}

              <label className="tw-field">
                <span>Preview the looks on this page</span>
                <select value={previewPageId} onChange={(e) => setPreviewPageId(e.target.value)}>
                  {pages.map((page) => (
                    <option key={page.id} value={page.id}>{page.name || page.slug || page.id}</option>
                  ))}
                </select>
              </label>

              <fieldset className="tw-hero-panel">
                <legend>Hero banners <span className="tw-muted">(optional, up to three)</span></legend>
                <p className="tw-muted">
                  The big image at the top of the site. Give up to three and each look is
                  designed around its own — colours pulled from the actual photo. Pick from
                  your gallery or upload right here.
                </p>
                {[0, 1, 2].map((slot) => (
                  <div key={slot} className="tw-hero-slot">
                    <span className="tw-hero-slot-label">Banner {slot + 1}</span>
                    <BuilderImagePickerField
                      value={heroBannerUrls[slot] || ""}
                      onChange={(url) =>
                        setHeroBannerUrls((prev) => [0, 1, 2].map((i) => (i === slot ? url : prev[i] || "")))}
                    />
                  </div>
                ))}
                <label className="tw-field">
                  <span>Describe the banner area <span className="tw-muted">(optional)</span></span>
                  <textarea
                    rows={2}
                    value={heroNote}
                    placeholder="Full-width photo with a dark wash, big headline over it, two buttons."
                    onChange={(e) => setHeroNote(e.target.value)}
                  />
                </label>
                <label className="tw-field">
                  <span>Reference website for the banner look <span className="tw-muted">(optional)</span></span>
                  <input
                    type="text"
                    value={heroReferenceUrl}
                    placeholder="example.com"
                    onChange={(e) => setHeroReferenceUrl(e.target.value)}
                  />
                  <span className="tw-muted">
                    Its hero area is read for how it treats imagery and headlines — nothing is copied.
                  </span>
                </label>
              </fieldset>

              <button type="button" className="tw-primary" onClick={handleStart} disabled={isBusy || !seedReady}>
                {isBusy ? "Starting…" : "Start"}
              </button>
            </>
          ) : (
            // A disabled button next to an empty dropdown tells the operator
            // nothing about what to do next. Say it.
            <p className="tw-muted">
              No pages loaded, so there is nothing to preview a theme on yet. If this
              project should have pages, check that a project is selected on the
              Settings page — the wizard reads pages from whichever project is active.
            </p>
          )}
        </section>
      ) : null}

      {step === "start" && pastSessions.length ? (
        <section className="tw-panel">
          <h3 className="tw-runs-title">Past runs</h3>
          <p className="tw-muted">
            Every run is saved, including its three looks and your rankings. Open one
            to pick up where you left off, or delete the ones you are done with.
          </p>
          <ul className="tw-runs">
            {pastSessions.map((run) => {
              const { date, seed, rounds } = describeRun(run);
              return (
                <li key={run.id} className="tw-run-row">
                  <div className="tw-run-info">
                    <strong>{seed}</strong>
                    <span className="tw-muted">
                      {date ? ` — ${date}` : ""} · {rounds}
                      {run.status === "applied" ? " · applied to the site" : ""}
                    </span>
                  </div>
                  <div className="tw-run-actions">
                    <button
                      type="button"
                      className="tw-secondary"
                      onClick={() => handleResume(run.id)}
                      disabled={isBusy}
                    >
                      Open
                    </button>
                    {confirmingDeleteId === run.id ? (
                      <>
                        <span className="tw-muted">Delete this run and its looks?</span>
                        <button type="button" className="tw-link" onClick={() => handleDeleteRun(run.id)} disabled={isBusy}>
                          Yes, delete
                        </button>
                        <button type="button" className="tw-link" onClick={() => setConfirmingDeleteId("")} disabled={isBusy}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="tw-link"
                        onClick={() => setConfirmingDeleteId(run.id)}
                        disabled={isBusy || run.status === "applied"}
                        title={run.status === "applied"
                          ? "This run's theme is on the site and this run holds its undo — it can't be deleted while applied"
                          : "Delete this run"}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {step === "generating" ? (
        <section className="tw-panel tw-generating">
          <p className="tw-progress-label">{progress?.label || "Working…"}</p>
          <div className="tw-progress-track">
            <div
              className="tw-progress-bar"
              style={{ width: `${Math.round(((progress?.current ?? 0) / (progress?.total || 1)) * 100)}%` }}
            />
          </div>
          <p className="tw-muted">
            This takes a couple of minutes. Options appear below as they finish.
          </p>
          <div className="tw-candidate-grid">
            {candidates.filter((c) => c.round === (session?.roundCount || 0) + 1).map((c) => (
              <article key={c.id} className="tw-candidate">
                <h3>{c.direction}</h3>
                {renderPreview(c)}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {step === "compare" ? (
        <section className="tw-panel">
          <p className="tw-muted">
            Round {currentRound}. Rank these, say what did and didn&apos;t work, then either
            make three more from your favourite or apply it.
            {session?.tokensSpent
              ? ` So far this session has used ${session.tokensSpent.toLocaleString()} tokens.`
              : ""}
          </p>

          {session ? <SeedSummary session={session} /> : null}

          {lockedCount ? (
            <div className="tw-locked-summary">
              <strong>{lockedCount} value{lockedCount === 1 ? "" : "s"} kept</strong>
              {" — later rounds will not change "}
              {Object.keys(session?.lockedValues || {}).map((path, i, all) => (
                <span key={path}>
                  {LOCK_LABELS[path] || path}{i < all.length - 1 ? ", " : ""}
                </span>
              ))}
              {". "}
              <button type="button" className="tw-link" onClick={() => clearLocks()}>
                Clear all
              </button>
            </div>
          ) : null}
          {warnings.length ? (
            <details className="tw-warnings">
              <summary>{warnings.length} value{warnings.length === 1 ? " was" : "s were"} adjusted</summary>
              <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          ) : null}

          <div className="tw-candidate-grid">
            {roundCandidates.map((candidate) => (
              <article key={candidate.id} className="tw-candidate">
                <h3>{candidate.direction}</h3>
                {renderPreview(candidate)}
                <PaletteRail patch={candidate.themePatch} />
                <p className="tw-rationale">{candidate.rationale}</p>

                <div className="tw-pins">
                  <span className="tw-muted">Keep any of these in every later round:</span>
                  <div className="tw-pin-row">
                    {lockableValuesFrom(candidate.themePatch).map((item) => {
                      const isPinned = (session?.lockedValues || {})[item.path] === item.value;
                      return (
                        <button
                          key={item.path}
                          type="button"
                          className={`tw-pin${isPinned ? " is-pinned" : ""}`}
                          onClick={() => toggleLock(item.path, item.value)}
                          aria-pressed={isPinned}
                          title={isPinned ? `Stop keeping this ${item.label.toLowerCase()}` : `Keep this ${item.label.toLowerCase()}`}
                        >
                          {item.kind === "colour" ? (
                            <span className="tw-pin-swatch" style={{ background: item.value }} aria-hidden="true" />
                          ) : null}
                          <span>{item.label}</span>
                          {item.kind === "font" ? <span className="tw-muted">{item.value}</span> : null}
                          <span aria-hidden="true">{isPinned ? "📌" : "＋"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="tw-field">
                  <span>Rank</span>
                  <select
                    value={ranks[candidate.id] || ""}
                    onChange={(e) => setRanks((prev) => ({ ...prev, [candidate.id]: Number(e.target.value) }))}
                  >
                    <option value="">—</option>
                    <option value="1">1 — favourite</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </label>
                <label className="tw-field">
                  <span>What worked, what didn&apos;t</span>
                  <textarea
                    rows={3}
                    value={notes[candidate.id] || ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [candidate.id]: e.target.value }))}
                  />
                </label>
              </article>
            ))}
          </div>

          <div className="tw-actions">
            <button type="button" className="tw-primary" onClick={handleNextRound} disabled={isBusy || !winner}>
              Make three more from my favourite
            </button>
            <button
              type="button"
              className="tw-secondary"
              onClick={() => winner && setConfirmingApply(winner)}
              disabled={isBusy || !winner}
            >
              Apply my favourite to the site
            </button>
            {!winner ? <span className="tw-muted">Pick a favourite (rank 1) to continue.</span> : null}
            <button
              type="button"
              className="tw-link"
              onClick={async () => {
                setStep("start");
                // The list may have gained this very run since it loaded.
                try { setPastSessions(await client.listSessions()); } catch { /* list is optional */ }
              }}
              disabled={isBusy}
            >
              Back to the start screen
            </button>
          </div>
        </section>
      ) : null}

      {expanded ? (
        <div
          className="tw-expand"
          role="dialog"
          aria-modal="true"
          aria-label={`${expanded.direction}, full size`}
          onClick={(e) => { if (e.target === e.currentTarget) setExpanded(null); }}
        >
          <div className="tw-expand-bar">
            <div>
              <strong>{expanded.direction}</strong>
              <span className="tw-muted">
                {" "}on {previewPage?.name || previewPage?.slug || "this page"}
              </span>
            </div>
            <div className="tw-actions">
              {/* Ranking from here too — the full-size view is where the
                  decision actually gets made, so making them close it first
                  would be busywork. */}
              <label className="tw-inline-field">
                <span>Rank</span>
                <select
                  value={ranks[expanded.id] || ""}
                  onChange={(e) => setRanks((prev) => ({ ...prev, [expanded.id]: Number(e.target.value) }))}
                >
                  <option value="">—</option>
                  <option value="1">1 — favourite</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
              <button type="button" className="tw-secondary" onClick={() => setExpanded(null)}>
                Close
              </button>
            </div>
          </div>
          <div className="tw-expand-body">{renderPreview(expanded, false)}</div>
        </div>
      ) : null}

      {confirmingApply ? (
        <div className="tw-confirm" role="dialog" aria-label="Confirm applying this theme">
          <div className="tw-confirm-body">
            <h3>Apply &ldquo;{confirmingApply.direction}&rdquo;?</h3>
            <p>
              This changes the colours and type on <strong>all {pages.length} page
              {pages.length === 1 ? "" : "s"}</strong> in this project.
            </p>
            <p>
              A snapshot is taken first, so you can undo it in one click. If the snapshot
              fails, nothing is changed at all.
            </p>
            <div className="tw-actions">
              <button type="button" className="tw-primary" onClick={() => handleApply(confirmingApply)} disabled={isBusy}>
                {isBusy ? "Applying…" : `Apply to all ${pages.length} pages`}
              </button>
              <button type="button" className="tw-link" onClick={() => setConfirmingApply(null)} disabled={isBusy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {step === "applied" ? (
        <section className="tw-panel">
          <h3>Applied</h3>
          <p>
            {/* applyResult only exists in the sitting where Apply was clicked;
                a reopened run knows it is applied but not the page count. */}
            {applyResult
              ? `${applyResult.applied} page${applyResult.applied === 1 ? "" : "s"} updated.`
              : "This run's theme is applied to the site."}
            {" "}The theme is saved in Themes, so you can keep editing it there.
          </p>
          <div className="tw-actions">
            <button type="button" className="tw-secondary" onClick={handleUndo} disabled={isBusy}>
              {isBusy ? "Undoing…" : "Undo — put every page back"}
            </button>
            {roundCandidates.length ? (
              <button type="button" className="tw-link" onClick={() => setStep("compare")} disabled={isBusy}>
                See this run&apos;s looks
              </button>
            ) : null}
            {onClose ? <button type="button" className="tw-link" onClick={onClose}>Done</button> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
