// @vitest-environment jsdom
/**
 * Where Intro Copy and Caption editors are actually mounted (86bczr7x7).
 *
 * The theme's Base size reaches a rich text editor only when it is marked
 * `builder-rich-text-content-theme-body`. The live page applies Base size to
 * Paragraph text and leaves Intro Copy and Caption at their own size, so the
 * editor must do the same — or the operator edits one size and publishes
 * another.
 *
 * `lib/builder-client/text-body-size.test.ts` pins the rule and
 * `components/builder-rich-text-editor.test.tsx` pins the editor's prop. This
 * file pins the ONE line that joins them: the module card passing the rule to
 * the editor. The review pass on round 2 proved that line could be replaced
 * with a bare `followsThemeBaseSize` (every editor at Base size) and every
 * other test still passed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BuilderModuleCard } from "@/components/builder/builder-module-card";
import type { BuilderTemplateModule } from "@/lib/builder-template";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const emptyRect = () => new DOMRect(0, 0, 0, 0);
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= emptyRect;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

const noop = () => {};

async function editorFor(settings: Record<string, string>) {
  const module = {
    id: "m1",
    type: "text",
    column: "main",
    text: "<p>Body copy</p>",
    settings
  } as unknown as BuilderTemplateModule;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <BuilderModuleCard
        module={module}
        sectionId="s1"
        isExpanded
        onToggleExpanded={noop}
        onUpdateModule={noop}
        onUpdateModuleBackground={noop}
        onMoveUp={noop}
        onMoveDown={noop}
        onRemove={noop}
        onOpenGallery={noop}
        onOpenSocialIconGallery={noop}
        onUploadMedia={noop}
        onClone={noop}
        themeStyle={{ ["--bx-size-base" as string]: "20px" }}
      />
    );
  });
  const editor = container.querySelector(".builder-rich-text-content");
  expect(editor, `a rich text editor for variant ${JSON.stringify(settings.variant)}`).not.toBeNull();
  return editor as Element;
}

const followsBaseSize = (editor: Element) => editor.classList.contains("builder-rich-text-content-theme-body");

describe("BuilderModuleCard: which text editors follow the theme's Base size", () => {
  it("Intro Copy keeps its own size in the editor, as it does on the live page", async () => {
    expect(followsBaseSize(await editorFor({ variant: "intro" }))).toBe(false);
  });

  it("Caption keeps its own size in the editor, as it does on the live page", async () => {
    expect(followsBaseSize(await editorFor({ variant: "caption" }))).toBe(false);
  });

  it("Paragraph text follows the Base size in the editor", async () => {
    expect(followsBaseSize(await editorFor({ variant: "paragraph" }))).toBe(true);
  });

  it("a text module with no variant set is Paragraph text, and follows the Base size", async () => {
    expect(followsBaseSize(await editorFor({}))).toBe(true);
  });
});
