// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SubstackWriterDetails,
  WriterImage,
  allPosts,
  alsoMentionsAll,
  candidateFromHash,
  candidateHash,
  isNotFound,
} from "./substack-writer-details";
import type { Candidate, RecentPost } from "./substack-miner-panel";

/**
 * Substack Miner upgrade 4/4 (86bcuxwq2): the parts of one writer's page that
 * do not need the whole screen — reading the address, a picture that cannot
 * load, and each empty section saying why. The View button, Back, deep links
 * and approving from the page are driven through the real screen in
 * substack-miner-panel.test.tsx.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
}

function writer(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "w1",
    handle: "ada",
    publicationUrl: "https://ada.substack.com",
    name: "Ada",
    description: "",
    subscriberText: "",
    keywordsHit: [],
    foundVia: "seed",
    recommendedBy: [],
    lastSeenAt: "2026-10-20T12:00:00Z",
    status: "candidate",
    contactId: "",
    note: "",
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
    ...overrides,
  };
}

function post(title: string, postedAt: string, extra: Partial<RecentPost> = {}): RecentPost {
  return { title, url: `https://ada.substack.com/p/${title.length}`, postedAt, subtitle: "", excerpt: "", coverImage: "", paid: false, ...extra };
}

const noop = () => {};
function page(c: Candidate | null, extra: Record<string, unknown> = {}) {
  return (
    <SubstackWriterDetails
      writerId={c?.id || "w1"}
      writer={c}
      loading={false}
      loadError=""
      all={c ? [c] : []}
      settings={{ keywords: ["tennis"], widerKeywords: ["chess"], maxResultsPerKeyword: null, pauseMsBetweenFetches: null, saved: true, updatedAt: "" }}
      busy={false}
      rowError=""
      rereadBusy={false}
      rereadLines={[]}
      onBack={noop}
      onView={noop}
      onDecide={noop}
      onThinkAgain={noop}
      onAgree={noop}
      onReread={noop}
      onOpenContact={noop}
      {...extra}
    />
  );
}

describe("the writer page's address", () => {
  it("reads the writer id only from this screen's address", () => {
    expect(candidateFromHash("#page=acquireSubstackPage&candidate=abc")).toBe("abc");
    expect(candidateFromHash("#candidate=abc&page=acquireSubstackPage")).toBe("abc");
    expect(candidateFromHash(candidateHash("a b/c"))).toBe("a b/c");
    expect(candidateFromHash("#page=acquireSubstackPage")).toBe("");
    expect(candidateFromHash("#page=contactsPage&candidate=abc")).toBe("");
    expect(candidateFromHash("")).toBe("");
  });

  it("recognises the server's not-found refusal", () => {
    expect(isNotFound("Writer not found in this project")).toBe(true);
    expect(isNotFound('invalid input syntax for type uuid: "does-not-exist"')).toBe(true);
    expect(isNotFound("database unavailable")).toBe(false);
  });
});

describe("pictures", () => {
  it("a picture that fails to load removes itself rather than showing a broken icon", () => {
    render(<WriterImage src="https://broken/x.png" alt="x" className="substack-writer-cover" size={96} />);
    const img = container!.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBe("96");
    act(() => { img.dispatchEvent(new Event("error")); });
    expect(container!.querySelector("img")).toBeNull();
  });

  it("no address means no picture at all", () => {
    render(<WriterImage src="" alt="x" className="substack-writer-cover" size={96} />);
    expect(container!.querySelector("img")).toBeNull();
  });

  it("each article shows its cover, title, date, subtitle and excerpt, newest first, with paid posts marked", () => {
    const c = writer({
      postsReadAt: "2026-10-29T00:00:00Z",
      recentPosts: [
        post("Older", "2026-10-01T09:00:00Z", { coverImage: "https://img/older.jpg" }),
        post("Newer", "2026-10-20T09:00:00Z", { subtitle: "a subtitle", excerpt: "an excerpt", paid: true }),
      ],
    });
    render(page(c));
    const items = [...container!.querySelectorAll(".substack-writer-article")];
    expect(items.map((li) => li.querySelector(".substack-writer-article-title")!.textContent)).toEqual(["Newer", "Older"]);
    expect(items[0].textContent).toContain("Paid");
    expect(items[0].textContent).toContain("a subtitle");
    expect(items[0].textContent).toContain("an excerpt");
    expect(items[1].querySelector("img")!.getAttribute("src")).toBe("https://img/older.jpg");
  });
});

describe("empty sections say why", () => {
  it("posts not read, nobody recommending, no Notes, no suggestion", () => {
    render(page(writer()));
    const t = container!.textContent || "";
    expect(t).toContain("Posts not read yet — click Re-read posts.");
    expect(t).toContain("Not recommended by anyone in your list.");
    expect(t).toContain("No Notes read yet");
    expect(t).toContain("No suggestion yet — Run tab, Suggest decisions.");
    expect(t).toContain("Not decided yet.");
  });

  it("a missing writer says there is no writer with that id, with a link back", () => {
    const onBack = vi.fn();
    render(page(null, { loadError: "Writer not found in this project", onBack }));
    expect(container!.textContent).toContain("No writer with that id in this project.");
    act(() => { container!.querySelector("a")!.click(); });
    expect(onBack).toHaveBeenCalled();
  });

  it("any other failure says what went wrong, not that the writer is missing", () => {
    render(page(null, { loadError: "database unavailable" }));
    expect(container!.textContent).toContain("This writer could not be read: database unavailable");
    expect(container!.textContent).not.toContain("No writer with that id");
  });
});

describe("Also mentions looks in every stored post", () => {
  it("finds a keyword in the oldest post the list's three-post column would not read", () => {
    const c = writer({
      keywordsHit: ["tennis"],
      postsReadAt: "2026-10-29T00:00:00Z",
      recentPosts: [
        post("a", "2026-10-20T09:00:00Z", { excerpt: "tennis again" }),
        post("b", "2026-10-19T09:00:00Z"),
        post("c", "2026-10-18T09:00:00Z"),
        post("d", "2026-09-01T09:00:00Z", { subtitle: "all about chess" }),
      ],
    });
    expect(allPosts(c)).toHaveLength(4);
    expect(alsoMentionsAll(c, { keywords: ["tennis"], widerKeywords: ["chess"] })).toEqual(["chess"]);
  });
});
