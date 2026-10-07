// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections, normalizeTheme } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "../builder-template-preview";
import { BuilderFontSelect } from "./builder-font-select";
import { getHeadingFontStack } from "./builder-utils";

/** Task 86bce9wwv: a page whose theme names a Google font loads that font. */
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.head.querySelectorAll("link[data-builder-google-font]").forEach((el) => el.remove());
});

const fontLinks = () =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>("link[data-builder-google-font]")).map(
    (el) => el.getAttribute("data-builder-google-font")
  );

describe("a rendered page loads the Google fonts it uses", () => {
  it("theme font → one stylesheet link and the font on the page root", () => {
    const theme = normalizeTheme({ typography: { fonts: { heading: "gf:Open Sans", body: "gf:Open Sans", mono: "" } } });
    mount(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          { id: "r", title: "r", layout: "single", modules: [{ id: "t", type: "text", column: "main", text: "<p>Hi</p>", settings: {} }] },
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        theme={theme}
        showShell={false}
      />
    );
    expect(fontLinks()).toEqual(["Open Sans"]);
    expect(container!.innerHTML).toContain("Open Sans");
  });

  it("a page with only built-in fonts adds no link", () => {
    mount(
      <BuilderTemplatePreview
        layoutSections={[]}
        pageBackground={createDefaultBackgroundSettings()}
        theme={normalizeTheme({ typography: { fonts: { heading: "lora", body: "inter", mono: "" } } })}
        showShell={false}
      />
    );
    expect(fontLinks()).toEqual([]);
  });

  it("the heading font stack resolves a Google font", () => {
    expect(getHeadingFontStack("gf:Open Sans")).toBe("'Open Sans', system-ui, sans-serif");
    expect(getHeadingFontStack("lora")).toContain("Lora");
  });
});

describe("the font picker", () => {
  it("takes a Google font by name and refuses a bad one", () => {
    const onChange = vi.fn();
    mount(<BuilderFontSelect ariaLabel="Heading font" value="inter" onChange={onChange} />);
    const select = container!.querySelector("select")!;
    act(() => {
      select.value = "__google__";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const input = container!.querySelector<HTMLInputElement>("input.builder-font-select-google")!;
    expect(input).toBeTruthy();

    const type = (text: string) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const enter = () =>
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });

    type("Open/Sans");
    enter();
    expect(onChange).not.toHaveBeenCalled();
    expect(container!.querySelector("[role=alert]")?.textContent).toContain("not a font name");

    type("Open Sans");
    enter();
    expect(onChange).toHaveBeenCalledWith("gf:Open Sans");
  });

  it("shows a saved Google font as chosen", () => {
    mount(<BuilderFontSelect value="gf:Open Sans" onChange={() => {}} />);
    expect(container!.querySelector("select")!.value).toBe("__google__");
    expect(container!.querySelector<HTMLInputElement>("input")!.value).toBe("Open Sans");
  });
});
