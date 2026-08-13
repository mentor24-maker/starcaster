import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderSiteSearchModuleSettings } from "./builder-site-search-module-settings";
import { BuilderBlogSearchResultsModuleSettings } from "./builder-blog-search-results-module-settings";
import { createEmptyModule } from "@/lib/builder-template";
import { modulePaletteItems } from "./builder-types";

function optionsFor(html: string, labelText: string) {
  // Grab the <select> that follows the given field label.
  const at = html.indexOf(labelText);
  if (at < 0) return null;
  const sel = html.indexOf("<select", at);
  const end = html.indexOf("</select>", sel);
  const chunk = html.slice(sel, end);
  const opts = [...chunk.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
  // React server-renders a controlled <select> by marking the chosen <option>.
  const selected = /<option[^>]*selected[^>]*>([^<]*)<\/option>/.exec(chunk)?.[1];
  return { count: opts.length, first: opts.slice(0, 4), selected, has: (v: string) => opts.includes(v) };
}

/**
 * Operator, 2026-08-12: "update any dropdown that lets you set the field
 * width of something that would typically be more than 100px to increment by
 * 5px instead of 1px."
 *
 * Asserted on the RENDERED panel rather than on the schema, because the step
 * has to survive the whole trip — schema field, BuilderSchemaModuleSettings,
 * BuilderNumberSelectControl — and a step declared but not passed through
 * looks identical in the source to one that works.
 */
describe("width dropdowns count in fives", () => {
  it("Site Search Field Width", () => {
    const m = { ...createEmptyModule("site-search"), settings: { fieldWidth: "400" } };
    const html = renderToStaticMarkup(
      <BuilderSiteSearchModuleSettings module={m as never} onUpdateModule={() => {}} />
    );
    const o = optionsFor(html, "Field Width")!;
    console.log("Field Width  ->", o.count, "options, first:", o.first.join(","), "selected:", o.selected);
    expect(o.count).toBe(241);
    expect(o.selected).toBe("400");
    expect(o.has("405")).toBe(true);
    expect(o.has("401")).toBe(false);
  });

  it("Blog Thumb Width", () => {
    const m = { ...createEmptyModule("blog-search-results"), settings: {} };
    const html = renderToStaticMarkup(
      <BuilderBlogSearchResultsModuleSettings module={m as never} onUpdateModule={() => {}} />
    );
    const o = optionsFor(html, "Thumb Width")!;
    console.log("Thumb Width  ->", o.count, "options, first:", o.first.join(","), "selected:", o.selected);
    expect(o.count).toBe(37);
    expect(o.selected).toBe("120");
  });

  it("an off-grid saved width drops to the next five down", () => {
    // Reversed on 2026-08-12: 403 used to be injected into the list and shown
    // as-is, so the panel could not disagree with the page. The operator asked
    // for clean lists instead — "change it to the next lowest number that is"
    // divisible by five — and the control writes 400 back as it mounts, so
    // the document follows the panel rather than drifting from it.
    const m = { ...createEmptyModule("site-search"), settings: { fieldWidth: "403" } };
    const html = renderToStaticMarkup(
      <BuilderSiteSearchModuleSettings module={m as never} onUpdateModule={() => {}} />
    );
    const o = optionsFor(html, "Field Width")!;
    console.log("off-grid 403 ->", o.count, "options, selected:", o.selected);
    expect(o.selected).toBe("400");
    expect(o.has("403")).toBe(false);
    expect(o.count).toBe(241);
  });
});

describe("a new Site Search Results module does not bring a second search box", () => {
  it("ships with the form off, so pairing it with a Site Search box gives one form", () => {
    // Operator, 2026-08-12: his /search page ended up with two identical forms —
    // one in the header, one inside the results — because the results module
    // defaulted to carrying its own.
    const item = modulePaletteItems.find((i) => i.type === "site-search-results");
    expect(item?.settings?.showSearchField).toBe("false");
  });

  it("leaves the standalone Site Search box alone — it IS the form", () => {
    const item = modulePaletteItems.find((i) => i.type === "site-search");
    expect(item?.settings?.showButton).toBe("true");
  });
});
