import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderCodeEmbed } from "./builder/builder-code-embed";

const MAP_SRC = "https://www.google.com/maps/embed?pb=!1m18!1m12";
const MAP = `<iframe src="${MAP_SRC}" width="600" height="450" loading="lazy"></iframe>`;
const CHART_SRC = "https://dexscreener.com/solana/abc?embed=1";
const CHART = `<iframe id="dexscreener-embed" src="${CHART_SRC}"></iframe>`;

function render(props: { html: string; activation?: string; requireActivation?: boolean }) {
  return renderToStaticMarkup(<BuilderCodeEmbed {...props} />);
}

describe("BuilderCodeEmbed on a published page", () => {
  it("renders a map live on first paint, with no shield and a real src", () => {
    const html = render({ html: MAP });

    expect(html).toContain(` src="${MAP_SRC}"`);
    expect(html).not.toContain("data-deferred-src");
    expect(html).not.toContain("builder-code-embed-shield");
  });

  it("still shields a focus-stealing chart widget with nothing stored", () => {
    const html = render({ html: CHART });

    expect(html).toContain(`data-deferred-src="${CHART_SRC}"`);
    // The live src is gone — only the parked copy remains, so nothing loads.
    expect(html).not.toContain(` src="${CHART_SRC}"`);
    expect(html).toContain("builder-code-embed-shield");
  });

  it("calls the shielded thing what it is, never a chart by default", () => {
    expect(render({ html: CHART })).toContain("Load chart");

    const shieldedMap = render({ html: MAP, activation: "click" });
    expect(shieldedMap).toContain("Load map");
    expect(shieldedMap).not.toContain("Load Chart");
    expect(shieldedMap).toContain('aria-label="Load interactive map"');
  });

  it("lets the module's own setting override the detection both ways", () => {
    expect(render({ html: MAP, activation: "click" })).toContain("data-deferred-src");
    expect(render({ html: CHART, activation: "immediate" })).toContain(` src="${CHART_SRC}"`);
  });

  it("keeps the Builder canvas showing every embed immediately", () => {
    const html = render({ html: CHART, requireActivation: false });

    expect(html).toContain(` src="${CHART_SRC}"`);
    expect(html).not.toContain("builder-code-embed-shield");
  });
});
