// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderPageDeleteModal } from "./builder-page-delete-modal";

/**
 * The warning before deleting a page that something still links to (task
 * 86bcxn69z). What must not regress: every link is named BEFORE the click,
 * the destructive button says it deletes anyway, and Escape cancels.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function render(ui: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

const buttonNamed = (label: string) =>
  [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === label);

describe("BuilderPageDeleteModal", () => {
  it("names each link to a single page, and Delete Anyway confirms", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <BuilderPageDeleteModal
        pages={[{ pageId: "3", pageName: "About", links: ["Saved section \"Header\" › Menu › Menu item \"About\"", "Home page › Hero › Button \"Learn more\""] }]}
        deleteCount={1}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(document.querySelector("#builder-page-delete-title")?.textContent).toBe("2 links still point to \"About\"");
    const items = [...document.querySelectorAll("[data-page-delete-links='3'] li")].map((li) => li.textContent);
    expect(items).toEqual(["Saved section \"Header\" › Menu › Menu item \"About\"", "Home page › Hero › Button \"Learn more\""]);
    act(() => buttonNamed("Delete Anyway")!.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("lists links per page on a bulk delete, and Escape cancels", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <BuilderPageDeleteModal
        pages={[
          { pageId: "3", pageName: "About", links: ["Header › Menu item \"About\""] },
          { pageId: "5", pageName: "Contact", links: ["CRM form \"Request White Paper\" › After submit"] }
        ]}
        deleteCount={4}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(document.querySelector("#builder-page-delete-title")?.textContent).toBe("2 links still point to pages you are deleting");
    const headings = [...document.querySelectorAll(".builder-choice-dialog-detail-title")].map((p) => p.textContent);
    expect(headings).toEqual(["\"About\" — 1 link", "\"Contact\" — 1 link"]);
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
