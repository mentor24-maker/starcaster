/**
 * The Spirality Tasks module's data side (ticket 86bczt5t4): its settings,
 * the calls it makes, and the choices it makes from their answers. The
 * component (components/builder/builder-spirality-tasks-module.tsx) only
 * draws what this decides.
 *
 * Every call goes to StarCaster's own /api/spirality/* (routes/spirality.js),
 * never to the Spirality tracker: the tracker has no CORS on purpose, and its
 * session token lives in an HttpOnly cookie this code cannot read.
 */

export const SPIRALITY_API = "/api/spirality";

export const SPIRALITY_UNREACHABLE = "Spirality can't be reached right now. Try again in a few minutes.";
export const SPIRALITY_NO_PROJECT = "You have not been added to a project yet.";

export type SpiralityTasksSettings = {
  heading: string;
  defaultProject: string;
  showSubmitTask: boolean;
};

export function readSpiralityTasksSettings(settings: Record<string, string> | undefined): SpiralityTasksSettings {
  const s = settings || {};
  return {
    heading: typeof s.heading === "string" ? s.heading : "Tasks",
    defaultProject: String(s.defaultProject || "").trim().toLowerCase(),
    showSubmitTask: s.showSubmitTask !== "false",
  };
}

export type SpiralityPerson = { id: number; name: string };
export type SpiralityProject = { slug: string; name: string; open?: number };
export type SpiralityTask = { id: string; name: string; updatedAt?: string };
export type SpiralityColumn = { status: string; tasks: SpiralityTask[] };
export type SpiralityBoard = { project: string; projectName: string; columns: SpiralityColumn[] };
export type SpiralityComment = {
  id: number;
  parent: number | null;
  author: { name: string; machine: boolean } | null;
  machine: boolean;
  body: string;
  createdAt: string;
};
export type SpiralityThread = {
  id: string;
  name: string;
  description: string;
  project: string;
  projectName: string;
  createdAt?: string;
  comments: SpiralityComment[];
};
/**
 * What a write (Submit Task, Post reply) answers. The write always happened;
 * `threadUnavailable` means only the read-back of the thread failed, so the
 * page loads the task itself rather than reporting a failure — which would
 * invite a resubmit and file a duplicate.
 */
export type SpiralityWritten = SpiralityThread | { id: string; threadUnavailable: true };

export function writtenThread(w: SpiralityWritten): SpiralityThread | null {
  return "threadUnavailable" in w ? null : w;
}

/**
 * A ?link= the tracker refused. An invite-only team: whoever lands here may
 * have no password at all, so the answer names both ways forward.
 */
export const SPIRALITY_LINK_SPENT =
  "This link has expired or was already used. Ask your team for a new invite, or use Forgot password if you already have an account.";

/**
 * Whether a failed /link means the link itself is spent. Only the server's
 * LINK_SPENT code says so — it is the tracker's own refusal of the link. A
 * status range cannot: our catch-all, an unknown site and a wrong tracker
 * address are all 4xx too, and each leaves a perfectly good link.
 */
export function linkIsSpent(code: string): boolean {
  return code === "LINK_SPENT";
}

export type SpiralityLink = { purpose: string; email: string; expiresAt?: string };

export type SpiralityResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

type Fetch = typeof fetch;

/**
 * The module's calls. `projectId` names the page's project; on a client's
 * own domain the server takes it from the host instead, and only uses it to
 * name the cookie.
 */
export function createSpiralityApi(projectId: string, fetchImpl?: Fetch) {
  const doFetch: Fetch = fetchImpl ?? ((...args) => fetch(...args));

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<SpiralityResult<T>> {
    let response: Response;
    try {
      response = await doFetch(`${SPIRALITY_API}${path}`, {
        method,
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          ...(projectId ? { "x-project-id": projectId } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: "UNREACHABLE", message: SPIRALITY_UNREACHABLE };
    }
    const json = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: T; error?: { message?: string; code?: string } }
      | null;
    if (!response.ok || !json || json.ok === false) {
      const message = json?.error?.message || (response.status >= 500 ? SPIRALITY_UNREACHABLE : `That did not work (${response.status}).`);
      return { ok: false, status: response.status, code: json?.error?.code || "ERROR", message };
    }
    return { ok: true, data: json.data as T };
  }

  const id = encodeURIComponent;
  return {
    me: () => call<{ signedIn: boolean; person?: SpiralityPerson }>("GET", "/me"),
    signIn: (email: string, password: string) =>
      call<{ signedIn: true; person: SpiralityPerson }>("POST", "/signin", { email, password }),
    signOut: () => call<{ signedIn: false }>("POST", "/signout", {}),
    forgot: (email: string) => call<{ sent: string }>("POST", "/forgot", { email }),
    link: (link: string) => call<SpiralityLink>("POST", "/link", { link }),
    setPassword: (link: string, password: string, name?: string) =>
      call<{ signedIn: true; person: SpiralityPerson }>("POST", "/set-password", name ? { link, password, name } : { link, password }),
    projects: () => call<{ projects: SpiralityProject[]; default: string | null }>("GET", "/projects"),
    board: (slug: string) => call<SpiralityBoard>("GET", `/projects/${id(slug)}/tasks`),
    submit: (slug: string, name: string, description: string) =>
      call<SpiralityWritten>("POST", `/projects/${id(slug)}/tasks`, { name, description }),
    thread: (taskId: string) => call<SpiralityThread>("GET", `/tasks/${id(taskId)}`),
    reply: (taskId: string, body: string) => call<SpiralityWritten>("POST", `/tasks/${id(taskId)}/comments`, { body }),
  };
}

export type SpiralityApi = ReturnType<typeof createSpiralityApi>;

/**
 * Which project the Tasks page opens on: the module's default when the person
 * can see it, else the tracker's own default, else the first. Null when they
 * can see none, which is the "not added to a project yet" answer.
 */
export function chooseProject(projects: SpiralityProject[], moduleDefault: string, trackerDefault: string | null): string | null {
  if (!projects.length) return null;
  const has = (slug: string | null) => Boolean(slug) && projects.some((p) => p.slug === slug);
  if (has(moduleDefault)) return moduleDefault;
  if (has(trackerDefault)) return trackerDefault;
  return projects[0].slug;
}

/** The statuses that hold a task, in the tracker's order and with its names. */
export function nonEmptyColumns(board: SpiralityBoard | null): SpiralityColumn[] {
  return (board?.columns || []).filter((c) => c.tasks.length > 0);
}

/** The `?link=` an emailed invite or reset brought the person here with, or "". */
export function readEmailedLink(search: string): string {
  try {
    return new URLSearchParams(search).get("link")?.trim() || "";
  } catch {
    return "";
  }
}

/** The address without `?link=`, so a reload does not reuse a spent link. */
export function addressWithoutLink(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("link");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** What the set-password view is for, in the person's words. */
export function linkPurposeTitle(purpose: string): string {
  return purpose === "invite" ? "Finish joining" : "Set your password";
}

/** The still sample the Builder shows: a signed-in Tasks page with sample tasks. */
export const SPIRALITY_SAMPLE_BOARD: SpiralityBoard = {
  project: "sample",
  projectName: "Sample project",
  columns: [
    { status: "Requested", tasks: [{ id: "SP-21", name: "Add a sign-up link to the footer" }] },
    { status: "Queued", tasks: [{ id: "SP-19", name: "Show the event dates on the home page" }, { id: "SP-18", name: "Fix the menu on phones" }] },
    { status: "In review", tasks: [{ id: "SP-16", name: "New photo gallery page" }] },
    { status: "Live", tasks: [{ id: "SP-12", name: "Contact form sends a copy to the visitor" }] },
  ],
};
