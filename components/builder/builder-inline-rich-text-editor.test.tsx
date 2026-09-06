// @vitest-environment jsdom
/**
 * The heading editor must show what the draft holds, and must not throw away
 * an edit made in its HTML view.
 *
 * Task 86bbq2y78 covers two reports that are the same pair of components.
 * This file mounts the REAL heading editor, because the sync helper's own
 * unit test pins an expression (`a !== b`) that was never wrong — the defect
 * was in which two strings the component fed it, and reverting the component
 * has to fail something.
 *
 * The heading is also the module whose text was emptied on the Delray site
 * header on 2026-08-29: it is the only one in that section edited through a
 * ProseMirror document rather than a plain <input>.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BuilderInlineRichTextEditor } from "@/components/builder/builder-inline-rich-text-editor";

// React only suppresses its "not configured to support act" warning when the
// environment says so. Without this the real output is buried in noise.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

/** How the Builder actually uses it: the page owns the value. */
function ControlledHeading({
  initialValue,
  onValue
}: {
  initialValue: string;
  onValue: (next: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <BuilderInlineRichTextEditor
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
    root.render(<ControlledHeading initialValue={initialValue} onValue={onValue} />);
  });

  return container;
}

/** An uncontrolled mount, so a value can be pushed in from outside. */
async function mountDriven(value: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });

  async function render(nextValue: string) {
    await act(async () => {
      root.render(<BuilderInlineRichTextEditor onChange={() => {}} value={nextValue} />);
    });
  }

  await render(value);

  return { container, render };
}

function codeViewButton(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>('button[title="Edit the HTML"]');

  if (!button) {
    throw new Error("the HTML-view button is not in the toolbar");
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

describe("BuilderInlineRichTextEditor showing the value it is given", () => {
  it("shows text that arrives after it mounted empty", async () => {
    const { container, render } = await mountDriven("");

    expect(container.textContent).not.toContain("Blog");

    await render("Blog");

    expect(container.textContent).toContain("Blog");
  });

  it("shows a value that changes while it sits idle holding its own last emission", async () => {
    const { container, render } = await mountDriven("Blog");

    expect(container.textContent).toContain("Blog");

    await render("News");

    expect(container.textContent).toContain("News");
    expect(container.textContent).not.toContain("Blog");
  });
});

describe("BuilderInlineRichTextEditor HTML view", () => {
  it("keeps an edit made in HTML view when the operator switches back", async () => {
    const { emitted, onValue } = track();
    const container = await mountControlled("Blog", onValue);

    await click(codeViewButton(container));

    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe("Blog");

    await typeInto(textarea as HTMLTextAreaElement, "<b>Blogging</b>");

    await click(codeViewButton(container));

    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Blogging");

    // The page must end up holding what the editor is SHOWING. Switching back
    // re-parses the markup, which can legally change it — `<b>` becomes
    // `<strong>` here — so the raw text the textarea emitted is not what the
    // operator is now looking at. Whichever reading the editor settles on,
    // onChange has to have carried it out, or the page saves something else.
    const displayed = container.querySelector(".builder-inline-rich-text-content > *")?.innerHTML ?? "";
    const lastEmitted = emitted.at(-1) ?? "";

    expect(displayed).toBe("<p><strong>Blogging</strong></p>");
    expect(lastEmitted).toBe("<strong>Blogging</strong>");
  });

  it("announces the edit even when the page never fed the value back", async () => {
    // The uncontrolled case: nothing re-rendered the editor with the typed
    // value, so the sync effect never ran and the document is still the old
    // heading when the operator switches back. This is the path where the
    // toggle is the ONLY thing that can tell the page what was typed.
    const emitted: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });

    await act(async () => {
      root.render(
        <BuilderInlineRichTextEditor onChange={(next) => emitted.push(next)} value="Blog" />
      );
    });

    await click(codeViewButton(container));
    await typeInto(container.querySelector("textarea") as HTMLTextAreaElement, "<b>Blogging</b>");
    await click(codeViewButton(container));

    expect(container.textContent).toContain("Blogging");
    expect(emitted.at(-1)).toBe("<strong>Blogging</strong>");
  });
});
