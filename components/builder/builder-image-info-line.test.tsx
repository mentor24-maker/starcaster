// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderImageInfoLine, imageFileNameFromUrl } from "./builder-image-info-line";

/**
 * The Carousel editor's Image field showed only a Vercel Blob address, so a
 * slide could not be told apart without opening the page (Delray, task
 * 86bc0n59x). These drive the real line: its name, its size once the picture
 * loads, the "could not load" text, and the pop-up the name opens.
 */

type FakeImage = { onload?: () => void; onerror?: () => void; naturalWidth: number; naturalHeight: number; src: string };
const created: FakeImage[] = [];
const RealImage = globalThis.Image;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  created.length = 0;
  (globalThis as unknown as { Image: unknown }).Image = function FakeImageCtor(this: FakeImage) {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.src = "";
    created.push(this);
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  globalThis.Image = RealImage;
});

const BLOB = "https://abc123.public.blob.vercel-storage.com/uploads/court%20sunset-Xy12.jpg?download=1";

describe("imageFileNameFromUrl", () => {
  it("takes the decoded last segment without query or hash", () => {
    expect(imageFileNameFromUrl(BLOB)).toBe("court sunset-Xy12.jpg");
    expect(imageFileNameFromUrl("/uploads/a.png#top")).toBe("a.png");
    expect(imageFileNameFromUrl("")).toBe("");
  });
});

describe("BuilderImageInfoLine", () => {
  it("renders nothing for an empty field", () => {
    act(() => root.render(<BuilderImageInfoLine url="" />));
    expect(host.innerHTML).toBe("");
  });

  it("shows the name and the pixel size once the image loads", () => {
    act(() => root.render(<BuilderImageInfoLine url={BLOB} />));
    expect(host.querySelector(".builder-image-info-name")?.textContent).toBe("court sunset-Xy12.jpg");
    const image = created[created.length - 1];
    expect(image.src).toBe(BLOB);
    act(() => {
      image.naturalWidth = 1920;
      image.naturalHeight = 1080;
      image.onload?.();
    });
    expect(host.querySelector(".builder-image-info-size")?.textContent).toBe("1920 × 1080");
  });

  it("says so when the image will not load", () => {
    act(() => root.render(<BuilderImageInfoLine url={BLOB} />));
    act(() => created[created.length - 1].onerror?.());
    expect(host.querySelector(".builder-image-info-size")?.textContent).toBe("could not load this image");
  });

  it("opens the picture when the name is clicked and closes on Escape", () => {
    act(() => root.render(<BuilderImageInfoLine url={BLOB} />));
    expect(document.querySelector(".builder-image-info-dialog")).toBeNull();
    act(() => (host.querySelector(".builder-image-info-name") as HTMLButtonElement).click());
    const dialogImage = document.querySelector(".builder-image-info-dialog img") as HTMLImageElement;
    expect(dialogImage?.getAttribute("src")).toBe(BLOB);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector(".builder-image-info-dialog")).toBeNull();
  });
});
