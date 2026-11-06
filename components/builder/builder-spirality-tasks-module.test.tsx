// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SpiralityTasksModule } from "./builder-spirality-tasks-module";
import {
  SPIRALITY_NO_PROJECT,
  SPIRALITY_UNREACHABLE,
  addressWithoutLink,
  chooseProject,
  readEmailedLink,
  readSpiralityTasksSettings,
} from "@/lib/spirality-tasks";

/**
 * Spirality Tasks (86bczt5t4): every view, driven against a fake of
 * StarCaster's own /api/spirality/* — the only thing the module ever calls.
 */

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
  act(() => root!.render(node));
}

async function flushUntil(check: () => boolean, tries = 30) {
  for (let i = 0; i < tries; i += 1) {
    if (check()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const $ = (sel: string) => container!.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => Array.from(container!.querySelectorAll(sel)) as HTMLElement[];
const text = () => container!.textContent || "";
const view = () => $(".builder-spirality-tasks")?.getAttribute("data-spirality-view");

function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function click(el: HTMLElement) {
  act(() => el.click());
}

const ok = (data: unknown, status = 200) => ({ status, body: { ok: true, data } });
const err = (status: number, message: string, code: string) => ({ status, body: { ok: false, error: { message, code } } });

const BOARD = {
  project: "spirality",
  projectName: "Spirality",
  columns: [
    { status: "Requested", tasks: [{ id: "SP-9", name: "A new one" }] },
    { status: "Rework", tasks: [] },
    { status: "In review", tasks: [{ id: "SP-7", name: "Reviewing" }] },
  ],
};
const THREAD = {
  id: "SP-9", name: "A new one", description: "The words", project: "spirality", projectName: "Spirality",
  comments: [{ id: 1, parent: null, author: { name: "loop-build", machine: true }, machine: true, body: "Built it.", createdAt: "2026-11-06T10:00:00Z" }],
};

type Answer = { status: number; body: unknown };

/** A fake /api/spirality: `routes` maps "METHOD /path" to an answer (or a function of the body). */
function fakeApi(routes: Record<string, Answer | ((body: any) => Answer)>) {
  const calls: Array<{ method: string; path: string; body: any; headers: Record<string, string>; credentials?: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method || "GET";
    const path = String(url).replace("/api/spirality", "");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, headers: init.headers as Record<string, string>, credentials: init.credentials });
    const route = routes[`${method} ${path}`];
    if (route === "unreachable" as unknown) throw new TypeError("fetch failed");
    const answer = typeof route === "function" ? route(body) : route || err(404, "Not found", "NOT_FOUND");
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const SIGNED_IN = {
  "GET /me": ok({ signedIn: true, person: { id: 7, name: "Pat" } }),
  "GET /projects": ok({ projects: [{ slug: "spirality", name: "Spirality", open: 2 }], default: "spirality" }),
  "GET /projects/spirality/tasks": ok(BOARD),
};

const where = (search = "") => ({ search, href: `https://tasks.example.com/team${search}` });

describe("settings", () => {
  it("defaults: heading Tasks, no default project, Submit Task on", () => {
    expect(readSpiralityTasksSettings({})).toEqual({ heading: "Tasks", defaultProject: "", showSubmitTask: true });
    expect(readSpiralityTasksSettings({ heading: "", defaultProject: " Spirality ", showSubmitTask: "false" })).toEqual({ heading: "", defaultProject: "spirality", showSubmitTask: false });
  });

  it("chooses the module's project, then the tracker's, then the first; none when there are none", () => {
    const ps = [{ slug: "a", name: "A" }, { slug: "b", name: "B" }];
    expect(chooseProject(ps, "b", "a")).toBe("b");
    expect(chooseProject(ps, "zzz", "a")).toBe("a");
    expect(chooseProject(ps, "", null)).toBe("a");
    expect(chooseProject([], "a", "a")).toBeNull();
  });

  it("reads ?link= and takes it back out of the address", () => {
    expect(readEmailedLink("?link=abc&x=1")).toBe("abc");
    expect(readEmailedLink("")).toBe("");
    expect(addressWithoutLink("https://x.com/team?link=abc&x=1#top")).toBe("/team?x=1#top");
  });
});

describe("off the live site", () => {
  it("draws a still sample and asks no server anything", () => {
    const { fetchImpl, calls } = fakeApi({});
    render(<SpiralityTasksModule settings={{}} fetchImpl={fetchImpl} />);
    expect(view()).toBe("sample");
    expect($$(".builder-spirality-tasks__status").map((h) => h.firstChild?.textContent?.trim())).toEqual(["Requested", "Queued", "In review", "Live"]);
    expect(text()).toContain("Submit Task");
    expect(calls).toEqual([]);
  });

  it("the sample follows the heading and Submit Task settings", () => {
    render(<SpiralityTasksModule settings={{ heading: "Our work", showSubmitTask: "false" }} />);
    expect($(".builder-spirality-tasks__heading")?.textContent).toBe("Our work");
    expect(text()).not.toContain("Submit Task");
  });
});

describe("signed out", () => {
  it("signs in, sending the email and password to StarCaster only, then shows the tasks", async () => {
    const { fetchImpl, calls } = fakeApi({
      ...SIGNED_IN,
      "GET /me": ok({ signedIn: false }),
      "POST /signin": ok({ signedIn: true, person: { id: 7, name: "Pat" } }),
    });
    render(<SpiralityTasksModule settings={{}} liveSite projectId="proj-1" fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => view() === "signin");
    type($("input[type=email]") as HTMLInputElement, " pat@example.com ");
    type($("input[type=password]") as HTMLInputElement, "secret");
    await submit($("form") as HTMLFormElement);
    await flushUntil(() => $$(".builder-spirality-tasks__group").length > 0);
    expect(calls.find((c) => c.path === "/signin")!.body).toEqual({ email: "pat@example.com", password: "secret" });
    expect(calls.every((c) => c.credentials === "include" && c.headers["x-project-id"] === "proj-1")).toBe(true);
    expect(text()).toContain("Signed in as Pat");
  });

  it("shows the tracker's own refusal, the 15-minute lock included", async () => {
    const { fetchImpl } = fakeApi({
      "GET /me": ok({ signedIn: false }),
      "POST /signin": err(429, "Too many tries for that email. Wait 15 minutes, then try again.", "locked"),
    });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => view() === "signin");
    type($("input[type=email]") as HTMLInputElement, "pat@example.com");
    type($("input[type=password]") as HTMLInputElement, "x");
    await submit($("form") as HTMLFormElement);
    await flushUntil(() => !!$("[role=alert]"));
    expect($("[role=alert]")!.textContent).toBe("Too many tries for that email. Wait 15 minutes, then try again.");
  });

  it("Forgot password? gives the same neutral answer", async () => {
    const sent = "If that email has an account, a link to set a new password is on its way. It works for 1 hour.";
    const { fetchImpl, calls } = fakeApi({ "GET /me": ok({ signedIn: false }), "POST /forgot": ok({ sent }) });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => view() === "signin");
    click(Array.from(container!.querySelectorAll("button")).find((b) => b.textContent === "Forgot password?") as HTMLElement);
    expect(view()).toBe("forgot");
    type($("input[type=email]") as HTMLInputElement, "who@example.com");
    await submit($("form") as HTMLFormElement);
    await flushUntil(() => !!$("[role=status]"));
    expect($("[role=status]")!.textContent).toBe(sent);
    expect(calls.find((c) => c.path === "/forgot")!.body).toEqual({ email: "who@example.com" });
  });

  it("offers no Register form: Spirality is invite-only", async () => {
    const { fetchImpl } = fakeApi({ "GET /me": ok({ signedIn: false }) });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => view() === "signin");
    expect(text()).not.toMatch(/register/i);
  });

  it("Spirality unreachable says so in plain words, and still offers sign-in", async () => {
    const { fetchImpl } = fakeApi({ "GET /me": "unreachable" as unknown as Answer });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => view() === "signin");
    expect(text()).toContain(SPIRALITY_UNREACHABLE);
  });
});

describe("arriving from an emailed link", () => {
  it("an invite asks for a name and a password, then signs them in", async () => {
    const { fetchImpl, calls } = fakeApi({
      ...SIGNED_IN,
      "POST /link": ok({ purpose: "invite", email: "new@example.com" }),
      "POST /set-password": ok({ signedIn: true, person: { id: 9, name: "New Person" } }),
    });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where("?link=tok123")} />);
    await flushUntil(() => view() === "link");
    expect($(".builder-spirality-tasks__title")!.textContent).toBe("Finish joining");
    expect(text()).toContain("new@example.com");
    expect(calls.find((c) => c.path === "/link")!.body).toEqual({ link: "tok123" });
    type($("input[autocomplete=name]") as HTMLInputElement, "New Person");
    const pw = $$("input[type=password]") as HTMLInputElement[];
    type(pw[0], "longpassword");
    type(pw[1], "longpassword");
    await submit($("form") as HTMLFormElement);
    await flushUntil(() => view() === "tasks");
    expect(calls.find((c) => c.path === "/set-password")!.body).toEqual({ link: "tok123", password: "longpassword", name: "New Person" });
    expect(text()).toContain("Signed in as New Person");
  });

  it("a reset asks only for the password, and refuses two that differ before asking anything", async () => {
    const { fetchImpl, calls } = fakeApi({ "POST /link": ok({ purpose: "reset", email: "pat@example.com" }) });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where("?link=r1")} />);
    await flushUntil(() => view() === "link");
    expect($(".builder-spirality-tasks__title")!.textContent).toBe("Set your password");
    expect($("input[autocomplete=name]")).toBeNull();
    const pw = $$("input[type=password]") as HTMLInputElement[];
    type(pw[0], "one");
    type(pw[1], "two");
    await submit($("form") as HTMLFormElement);
    expect($("[role=alert]")!.textContent).toBe("The two passwords do not match.");
    expect(calls.some((c) => c.path === "/set-password")).toBe(false);
  });

  it("a spent link shows the tracker's reason and the sign-in", async () => {
    const { fetchImpl } = fakeApi({ "POST /link": err(400, "That link has been used.", "used-link") });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where("?link=old")} />);
    await flushUntil(() => view() === "signin");
    expect(text()).toContain("That link has been used.");
  });
});

describe("signed in", () => {
  it("groups the tasks by status in the tracker's order and names, leaving empty statuses out", async () => {
    const { fetchImpl } = fakeApi(SIGNED_IN);
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => $$(".builder-spirality-tasks__group").length > 0);
    expect($$(".builder-spirality-tasks__group").map((g) => g.getAttribute("data-spirality-status"))).toEqual(["Requested", "In review"]);
    expect($("select")).toBeNull();
    expect($(".builder-spirality-tasks__project-name")!.textContent).toBe("Spirality");
  });

  it("several projects get a picker that opens on the module's default project", async () => {
    const { fetchImpl, calls } = fakeApi({
      ...SIGNED_IN,
      "GET /projects": ok({ projects: [{ slug: "alpha", name: "Alpha" }, { slug: "spirality", name: "Spirality" }], default: "alpha" }),
      "GET /projects/alpha/tasks": ok({ ...BOARD, project: "alpha", projectName: "Alpha" }),
    });
    render(<SpiralityTasksModule settings={{ defaultProject: "spirality" }} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => $$(".builder-spirality-tasks__group").length > 0);
    expect(($("select") as HTMLSelectElement).value).toBe("spirality");
    act(() => type($("select") as HTMLSelectElement, "alpha"));
    await flushUntil(() => calls.some((c) => c.path === "/projects/alpha/tasks"));
    expect(calls.some((c) => c.path === "/projects/alpha/tasks")).toBe(true);
  });

  it("a person with no project is told so plainly", async () => {
    const { fetchImpl } = fakeApi({ ...SIGNED_IN, "GET /projects": ok({ projects: [], default: null }) });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => text().includes(SPIRALITY_NO_PROJECT));
    expect(text()).toContain(SPIRALITY_NO_PROJECT);
  });

  it("a task opens its thread with who wrote each comment, and a reply posts and shows", async () => {
    let replied = false;
    const { fetchImpl, calls } = fakeApi({
      ...SIGNED_IN,
      "GET /tasks/SP-9": ok(THREAD),
      "POST /tasks/SP-9/comments": () => {
        replied = true;
        return ok({ ...THREAD, comments: [...THREAD.comments, { id: 2, parent: null, author: { name: "Pat", machine: false }, machine: false, body: "Thanks", createdAt: "2026-11-06T11:00:00Z" }] }, 201);
      },
    });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => $$(".builder-spirality-tasks__task").length > 0);
    click($(".builder-spirality-tasks__task") as HTMLElement);
    await flushUntil(() => $$(".builder-spirality-tasks__comment").length > 0);
    expect(text()).toContain("The words");
    expect($(".builder-spirality-tasks__comment")!.textContent).toContain("loop-build");
    expect($(".builder-spirality-tasks__comment")!.textContent).toContain("automated");
    type($("textarea") as HTMLTextAreaElement, "Thanks");
    await submit($("form") as HTMLFormElement);
    await flushUntil(() => $$(".builder-spirality-tasks__comment").length === 2);
    expect(replied).toBe(true);
    expect(calls.find((c) => c.path === "/tasks/SP-9/comments")!.body).toEqual({ body: "Thanks" });
    expect($$(".builder-spirality-tasks__comment")[1].textContent).toContain("Pat");
  });

  it("Submit Task files name and description to the chosen project, then shows the new task", async () => {
    const { fetchImpl, calls } = fakeApi({
      ...SIGNED_IN,
      "POST /projects/spirality/tasks": ok({ ...THREAD, id: "SP-10", name: "Fix it", comments: [] }, 201),
      "GET /tasks/SP-10": ok({ ...THREAD, id: "SP-10", name: "Fix it", comments: [] }),
    });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => $$(".builder-spirality-tasks__group").length > 0);
    click(Array.from(container!.querySelectorAll("button")).find((b) => b.textContent === "Submit Task") as HTMLElement);
    expect(view()).toBe("submit");
    type($("input[type=text]") as HTMLInputElement, "Fix it");
    type($("textarea") as HTMLTextAreaElement, "Please");
    await submit($("form") as HTMLFormElement);
    await flushUntil(() => view() === "task" && text().includes("SP-10"));
    expect(calls.find((c) => c.method === "POST" && c.path === "/projects/spirality/tasks")!.body).toEqual({ name: "Fix it", description: "Please" });
    expect(text()).toContain("Fix it");
  });

  it("Submit Task off means no button", async () => {
    const { fetchImpl } = fakeApi(SIGNED_IN);
    render(<SpiralityTasksModule settings={{ showSubmitTask: "false" }} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => $$(".builder-spirality-tasks__group").length > 0);
    expect(text()).not.toContain("Submit Task");
  });

  it("a session that has ended goes back to sign-in and says why", async () => {
    const { fetchImpl } = fakeApi({ ...SIGNED_IN, "GET /projects": err(401, "Your Spirality sign-in has ended. Sign in again.", "SIGNED_OUT") });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => view() === "signin");
    expect(text()).toContain("Your Spirality sign-in has ended. Sign in again.");
  });

  it("Sign out ends the session and returns to sign-in", async () => {
    const { fetchImpl, calls } = fakeApi({ ...SIGNED_IN, "POST /signout": ok({ signedIn: false }) });
    render(<SpiralityTasksModule settings={{}} liveSite fetchImpl={fetchImpl} location={where()} />);
    await flushUntil(() => text().includes("Signed in as Pat"));
    await act(async () => {
      (Array.from(container!.querySelectorAll("button")).find((b) => b.textContent === "Sign out") as HTMLElement).click();
    });
    await flushUntil(() => view() === "signin");
    expect(calls.some((c) => c.path === "/signout")).toBe(true);
    expect(text()).not.toContain("Signed in as Pat");
  });
});
