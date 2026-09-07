// @vitest-environment jsdom
/**
 * The block editor must show what the draft actually holds.
 *
 * Task 86bbq2y78: a paragraph reading "Wut?" was in the draft row of the
 * Delray home page — verified in the database — and the Builder showed the
 * module with no text at all.
 *
 * The cause was the guard in the value-sync effect. It compared the incoming
 * value to a remembered "last emitted" string, which is what the editor holds
 * every moment the operator is not mid-keystroke — so a value arriving from
 * anywhere else was dropped almost always.
 *
 * `lib/builder-client/editor-content-sync.test.ts` pins the helper's
 * expression. These tests mount the REAL component and read the DOM, because
 * the defect was never in the expression: it was in which two strings the
 * component fed it. Reverting the component's guard has to fail something,
 * and before this file it did not.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";

// React only suppresses its "not configured to support act" warning when the
// environment says so. Without this the real output is buried in noise.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

async function mountEditor(value: string, onChange: (next: string) => void = () => {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });

  async function render(nextValue: string) {
    await act(async () => {
      root.render(<BuilderRichTextEditor onChange={onChange} value={nextValue} />);
    });
  }

  await render(value);

  return { container, render };
}

/** How the Builder actually uses it: the page owns the value. */
function ControlledEditor({
  initialValue,
  onValue
}: {
  initialValue: string;
  onValue: (next: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <BuilderRichTextEditor
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
      value={value}
    />
  );
}

function track() {
  const emitted: string[] = [];
  return { emitted, onValue: (next: string) => emitted.push(next) };
}

async function mountControlled(initialValue: string, onValue: (next: string) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });

  await act(async () => {
    root.render(<ControlledEditor initialValue={initialValue} onValue={onValue} />);
  });

  return container;
}

function codeViewButton(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>('button[title="Code view"]');

  if (!button) {
    throw new Error("the code-view button is not in the toolbar");
  }

  return button;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Type into a React-controlled textarea the way a browser would. */
async function typeInto(textarea: HTMLTextAreaElement, next: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  setValue?.call(textarea, next);

  await act(async () => {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

describe("BuilderRichTextEditor showing the value it is given", () => {
  it("shows text that arrives after it mounted empty", async () => {
    const { container, render } = await mountEditor("");

    expect(container.textContent).not.toContain("Wut?");

    await render("<h1>Wut?</h1>");

    // The reported defect: this stayed empty, so the module looked blank
    // while the draft row held the text.
    expect(container.textContent).toContain("Wut?");
  });

  it("shows a value that changes while it sits idle holding its own last emission", async () => {
    const { container, render } = await mountEditor("<p>One</p>");

    expect(container.textContent).toContain("One");

    // Nothing has been typed, so the document IS the editor's last emission —
    // the state the old guard treated as "already up to date, skip".
    await render("<p>Two</p>");

    expect(container.textContent).toContain("Two");
    expect(container.textContent).not.toContain("One");
  });
});

describe("BuilderRichTextEditor HTML view", () => {
  it("keeps an edit made in HTML view when the operator switches back", async () => {
    // Round 2 of task 86bbq2y78: the guard fix above made the sync effect
    // write the document on every code-view keystroke, so by the time the
    // operator switched back `setContent`'s `emitUpdate` had no transaction
    // to fire on — the page kept the textarea's RAW text while the editor
    // showed the re-parsed reading. Two spellings of one module, and the one
    // that saves is not the one on screen. Both halves are asserted here:
    // asserting only the display passes with the bug present.
    const { emitted, onValue } = track();
    const container = await mountControlled("<p>Blog</p>", onValue);

    await click(codeViewButton(container));

    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();

    await typeInto(textarea as HTMLTextAreaElement, "<p><b>Blogging</b></p>");

    await click(codeViewButton(container));

    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Blogging");

    const displayed = container.querySelector(".builder-rich-text-content .ProseMirror")?.innerHTML ?? "";

    expect(displayed).toBe("<p><strong>Blogging</strong></p>");
    expect(emitted.at(-1)).toBe("<p><strong>Blogging</strong></p>");
  });

  it("announces the editor's reading when the markup cannot survive the schema", async () => {
    // The sharper form of the same defect: a <div> the module's schema cannot
    // hold is re-parsed into a paragraph. If the page keeps the raw text it
    // holds markup that will never render the way the operator saw it.
    const { emitted, onValue } = track();
    const container = await mountControlled("<p>Blog</p>", onValue);

    await click(codeViewButton(container));
    await typeInto(
      container.querySelector("textarea") as HTMLTextAreaElement,
      '<p>Kept</p><div data-x="1">Recast by the editor</div>'
    );
    await click(codeViewButton(container));

    const displayed = container.querySelector(".builder-rich-text-content .ProseMirror")?.innerHTML ?? "";

    expect(displayed).toBe("<p>Kept</p><p>Recast by the editor</p>");
    expect(emitted.at(-1)).toBe(displayed);
  });

  it("emits nothing when the HTML view is opened and closed without typing", async () => {
    // Looking at the markup is a read-only action. Round 2 measured the
    // heading editor firing onChange on one click in and one click out, which
    // dirties the draft and — on a saved-section master — propagates.
    const { emitted, onValue } = track();
    const container = await mountControlled("<p><b>Blog</b></p>", onValue);

    const before = emitted.length;

    await click(codeViewButton(container));
    await click(codeViewButton(container));

    expect(container.querySelector("textarea")).toBeNull();
    expect(emitted.slice(before)).toEqual([]);
  });

  it("keeps a value that arrived while the HTML view was open", async () => {
    // Nothing was typed, so the code view's opening snapshot is stale: writing
    // it back over the document would throw away what the page sent in.
    const { container, render } = await mountEditor("<p>One</p>");

    await click(codeViewButton(container));
    await render("<p>Two</p>");
    await click(codeViewButton(container));

    expect(container.textContent).toContain("Two");
    expect(container.textContent).not.toContain("One");
  });
});
