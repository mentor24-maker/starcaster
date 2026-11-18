import { fidelityView } from "./site-import-fidelity-model";

/**
 * The import's difference report on the Imports screen (SC-862): a link to
 * the side-by-side report the build makes as its last step, and how much it
 * found per category. It files nothing — the report is the list an agent
 * session or Dane files tickets from (DOCTRINE §6.25).
 */
export function SiteImportFidelityPanel({ checkpoints }: { checkpoints: Record<string, unknown> | undefined }) {
  const view = fidelityView(checkpoints);
  if (!view) return null;
  return (
    <div className="site-import-fidelity">
      <h4>Difference report</h4>
      {view.kind === "none" ? <p className="meta">{view.text}</p> : null}
      {view.kind === "failed" ? <p className="site-import-status is-error">{view.text}</p> : null}
      {view.kind === "report" ? (
        <>
          <p>
            {view.reportUrl ? (
              <a href={view.reportUrl} target="_blank" rel="noreferrer">
                Open the side-by-side report
              </a>
            ) : (
              <span className="is-error-text">The report was not uploaded, so there is no link to open.</span>
            )}
            {view.stale ? <span className="meta"> — made before the latest build, so it may be out of date</span> : null}
          </p>
          <p>
            <strong>Things lost:</strong> {view.counts}
          </p>
          {view.blind ? (
            <p className="site-import-status is-error">
              CANNOT TELL on part of this import — it could not be looked at, which is not the same as nothing lost.
            </p>
          ) : null}
          {view.cannotTell.length ? (
            <ul className="site-import-fidelity-blind">
              {view.cannotTell.map((p) => (
                <li key={p.path}>
                  <code>{p.path}</code> — {p.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {view.notes.length ? (
            <ul className="site-import-fidelity-notes">
              {view.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
