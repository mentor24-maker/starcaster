import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * `projectId` has to reach a module in an ORDINARY row, not only in the
 * page-overlay layer.
 *
 * `renderMainSection` built every main-body section without the prop while the
 * overlay path passed it, so the SAME module got the real id in an overlay row
 * and an empty string in a normal one. Found in review round 5 of the Bug
 * Report module (PR #365), where it fired `?projectId=` with nothing after the
 * equals sign.
 *
 * It had not bitten because on a custom domain the server resolves the project
 * from the request host, which covers the empty value. It only surfaces where
 * the host binds no project — previews, system hosts, local dev — and there the
 * request 400s.
 */

const PROJECT_ID = "proj_1234567890";

/** A page with one ordinary row and one overlay row, both holding a module
 *  that reads projectId. The pair is the point: they must agree. */
function makePage() {
  return normalizeLayoutSections([
    {
      id: "ordinary-row",
      title: "Ordinary",
      layout: "single",
      modules: [{ id: "m1", type: "contact-form", column: "main" }],
    },
    {
      id: "overlay-row",
      title: "Overlay",
      layout: "single",
      pageOverlay: true,
      modules: [{ id: "m2", type: "contact-form", column: "main" }],
    },
  ]);
}

function render(projectId: string) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={makePage()}
      pageBackground={createDefaultBackgroundSettings()}
      projectId={projectId}
      liveSite
      showShell={false}
    />
  );
}

describe("projectId reaching modules in the page body", () => {
  it("renders the ordinary row's module when an id is supplied", () => {
    // A first draft looked for the section TITLE in the markup — titles are not
    // rendered to a visitor, so it asserted on nothing and failed immediately.
    // The section element is what proves the ordinary row was drawn.
    const html = render(PROJECT_ID);
    expect(html).toContain("builder-preview-section");
    expect(html).toContain("builder-preview-shell");
  });

  it("passes the id to ordinary rows, not only to the overlay layer", () => {
    // Read the wiring rather than the markup: a contact form does not print
    // its projectId anywhere a visitor could see, so asserting on rendered
    // HTML would be asserting on nothing. The prop flow IS the behaviour here,
    // and the browser check on a live tenant page is what covers the rest.
    const source = readSource();
    const renderMain = source.slice(
      source.indexOf("const renderMainSection ="),
      source.indexOf("const renderMainSection =") + 1400
    );
    expect(renderMain).toContain("projectId={projectId}");
  });

  it("the overlay path still passes it too — this is additive", () => {
    const source = readSource();
    const overlay = source.slice(source.indexOf("builder-preview-overlay-layer"));
    expect(overlay.slice(0, 700)).toContain("projectId={projectId}");
  });

  it("an absent id still renders — the host fallback stays the belt to this braces", () => {
    // Non-goal in the ticket: the server's host resolution is unchanged. A page
    // rendered with no id must keep working exactly as it does today.
    expect(() => render("")).not.toThrow();
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  return fs.readFileSync(path.join(__dirname, "builder-template-preview.tsx"), "utf8");
}
