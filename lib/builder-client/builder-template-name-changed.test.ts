// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PAGE_TEMPLATES_CHANGED_EVENT, announcePageTemplatesChanged } from "./builder-template-name";

/**
 * SC-803 (found on review): Builder › Templates shows the saved templates
 * twice — React's Template Details, and the "Saved Page Templates" table above
 * it drawn by the vanilla code in public/js/builder.js. A rename saved fine,
 * but nothing told that table, so it kept the OLD name (and left out a template
 * just made with Save as Template) until a full browser reload.
 *
 * The fix is a window event: React announces every template write, and
 * builder.js re-loads and re-draws its table when it hears it. Neither file is
 * mountable here as a whole (the editor is thousands of lines; builder.js is a
 * plain <script>), so the wiring is checked against the sources and the
 * listener itself is run for real.
 */

const repo = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(repo, path), "utf8");

/** The text of one `function <name>(` up to the next function at the same indent. */
function functionBody(source: string, name: string, indent = "  "): string {
  const start = source.search(new RegExp(`\\n${indent}(async )?function ${name}\\(`));
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.slice(1).search(new RegExp(`\\n${indent}(// |/\\*\\*|(async )?function |let |const )`));
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("announcePageTemplatesChanged", () => {
  it("fires the event builder.js listens for", () => {
    const heard = vi.fn();
    window.addEventListener(PAGE_TEMPLATES_CHANGED_EVENT, heard);
    announcePageTemplatesChanged();
    window.removeEventListener(PAGE_TEMPLATES_CHANGED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("the React editor announces every template write", () => {
  const editor = read("components/admin-builder-editor.tsx");

  it.each(["saveTemplate", "makeTemplateFromPage", "deleteTemplateById"])(
    "%s announces after it reloads its own list",
    (name) => {
      const body = functionBody(editor, name);
      const reload = body.indexOf("await loadPageTemplates()");
      const announce = body.indexOf("announcePageTemplatesChanged()");
      expect(reload, `${name} reloads templates`).toBeGreaterThan(-1);
      expect(announce, `${name} must announce the change`).toBeGreaterThan(reload);
    }
  );
});

describe("public/js/builder.js re-draws its table when it hears the event", () => {
  const builder = read("public/js/builder.js");

  it("listens for the same event name", () => {
    expect(builder).toContain(`'${PAGE_TEMPLATES_CHANGED_EVENT}'`);
  });

  it("init() binds the listener", () => {
    expect(functionBody(builder, "init")).toContain("bindPageTemplatesChangedListener()");
  });

  it("re-loads the templates and re-draws the table, once per event even if bound twice", async () => {
    const bind = functionBody(builder, "bindPageTemplatesChangedListener");
    const flag = "let pageTemplatesChangedListenerBound = false;";
    expect(builder).toContain(flag);
    const calls: string[] = [];
    const loadSavedPageTemplates = vi.fn(async () => { calls.push("load"); });
    const renderPageTemplateRecordsTable = vi.fn(() => { calls.push("render"); });
    // Run the real listener code from builder.js with its two collaborators stubbed.
    const make = new Function(
      "loadSavedPageTemplates",
      "renderPageTemplateRecordsTable",
      `${flag}\n${bind}\nreturn bindPageTemplatesChangedListener;`
    );
    const bindListener = make(loadSavedPageTemplates, renderPageTemplateRecordsTable) as () => void;
    bindListener();
    bindListener();

    announcePageTemplatesChanged();
    await vi.waitFor(() => expect(renderPageTemplateRecordsTable).toHaveBeenCalled());

    expect(loadSavedPageTemplates).toHaveBeenCalledTimes(1);
    expect(renderPageTemplateRecordsTable).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["load", "render"]);
  });
});
