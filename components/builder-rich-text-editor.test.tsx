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
import { act } from "react";
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
