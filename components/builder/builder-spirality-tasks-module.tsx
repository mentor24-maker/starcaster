"use client";

/**
 * Spirality Tasks (ticket 86bczt5t4): a page where a teammate signs in to
 * Spirality and works a project's tasks — the queue, a task's thread with a
 * reply box, and Submit Task. Everything they do is authored as them in
 * Spirality, because it travels on their own session.
 *
 * Deliberately small: no board, search, editing, status changes or admin.
 * Those stay on Spirality's own page.
 *
 * The live module talks only to StarCaster's /api/spirality/* through
 * lib/builder-client/spirality-tasks.ts. Off the live site (the Builder
 * canvas, its preview) it draws `SpiralityTasksSample`, a still Tasks page
 * with sample tasks, and asks no server anything.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  SPIRALITY_NO_PROJECT,
  SPIRALITY_SAMPLE_BOARD,
  addressWithoutLink,
  chooseProject,
  createSpiralityApi,
  linkPurposeTitle,
  nonEmptyColumns,
  readEmailedLink,
  readSpiralityTasksSettings,
  type SpiralityApi,
  type SpiralityBoard,
  type SpiralityLink,
  type SpiralityPerson,
  type SpiralityProject,
  type SpiralityThread,
} from "@/lib/spirality-tasks";

type Props = {
  settings: Record<string, string>;
  liveSite?: boolean;
  projectId?: string;
  /** Test seam; defaults to window.fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam; defaults to window.location. */
  location?: { search: string; href: string };
};

type View =
  | { name: "loading" }
  | { name: "signin"; notice?: string }
  | { name: "forgot" }
  | { name: "link"; link: string; info: SpiralityLink }
  | { name: "tasks" }
  | { name: "task"; taskId: string }
  | { name: "submit" };

export function SpiralityTasksModule({ settings, liveSite = false, projectId = "", fetchImpl, location }: Props) {
  if (!liveSite) return <SpiralityTasksSample settings={settings} />;
  return <SpiralityTasksLive settings={settings} projectId={projectId} fetchImpl={fetchImpl} location={location} />;
}

function SpiralityTasksLive({ settings, projectId, fetchImpl, location }: Required<Pick<Props, "settings" | "projectId">> & Pick<Props, "fetchImpl" | "location">) {
  const s = readSpiralityTasksSettings(settings);
  const api = useMemo(() => createSpiralityApi(projectId, fetchImpl), [projectId, fetchImpl]);
  const [view, setView] = useState<View>({ name: "loading" });
  const [person, setPerson] = useState<SpiralityPerson | null>(null);
  const [error, setError] = useState("");
  // The project the Tasks page shows, kept across opening a task and coming back.
  const [project, setProject] = useState("");

  const where = location ?? (typeof window !== "undefined" ? window.location : { search: "", href: "http://localhost/" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const link = readEmailedLink(where.search);
      if (link) {
        const r = await api.link(link);
        if (cancelled) return;
        if (r.ok) setView({ name: "link", link, info: r.data });
        else {
          setError(r.message);
          setView({ name: "signin" });
        }
        return;
      }
      const r = await api.me();
      if (cancelled) return;
      if (r.ok && r.data.signedIn && r.data.person) {
        setPerson(r.data.person);
        setView({ name: "tasks" });
      } else {
        if (!r.ok) setError(r.message);
        setView({ name: "signin" });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const signedIn = (p: SpiralityPerson) => {
    setPerson(p);
    setError("");
    setView({ name: "tasks" });
  };

  /** A signed-in call that found the session over sends them back to sign in. */
  const onSignedOut = useCallback((code: string) => {
    if (code !== "SIGNED_OUT") return false;
    setPerson(null);
    setView({ name: "signin", notice: "Your Spirality sign-in has ended. Sign in again." });
    return true;
  }, []);

  async function signOut() {
    await api.signOut();
    setPerson(null);
    setView({ name: "signin" });
  }

  return (
    <div className="builder-spirality-tasks" data-spirality-view={view.name}>
      <div className="builder-spirality-tasks__header">
        {s.heading ? <h2 className="builder-spirality-tasks__heading">{s.heading}</h2> : null}
        {person ? (
          <div className="builder-spirality-tasks__who">
            <span>Signed in as {person.name}</span>
            <button type="button" className="builder-spirality-tasks__link-button" onClick={signOut}>Sign out</button>
          </div>
        ) : null}
      </div>
      {error && view.name !== "loading" ? <p className="builder-spirality-tasks__error" role="alert">{error}</p> : null}
      {view.name === "loading" ? <p className="builder-spirality-tasks__muted">Loading…</p> : null}
      {view.name === "signin" ? (
        <SignInForm api={api} notice={view.notice} onSignedIn={signedIn} onForgot={() => { setError(""); setView({ name: "forgot" }); }} />
      ) : null}
      {view.name === "forgot" ? <ForgotForm api={api} onBack={() => setView({ name: "signin" })} /> : null}
      {view.name === "link" ? (
        <SetPasswordForm
          api={api}
          link={view.link}
          info={view.info}
          onDone={(p) => {
            if (typeof window !== "undefined" && !location) window.history.replaceState(null, "", addressWithoutLink(where.href));
            signedIn(p);
          }}
        />
      ) : null}
      {view.name === "tasks" ? (
        <TasksPage
          api={api}
          moduleDefault={s.defaultProject}
          project={project}
          onProject={setProject}
          showSubmitTask={s.showSubmitTask}
          onOpen={(taskId) => setView({ name: "task", taskId })}
          onSubmit={() => setView({ name: "submit" })}
          onSignedOut={onSignedOut}
        />
      ) : null}
      {view.name === "task" ? (
        <TaskThread api={api} taskId={view.taskId} onBack={() => setView({ name: "tasks" })} onSignedOut={onSignedOut} />
      ) : null}
      {view.name === "submit" ? (
        <SubmitTaskForm
          api={api}
          project={project}
          onBack={() => setView({ name: "tasks" })}
          onFiled={(t) => setView({ name: "task", taskId: t.id })}
          onSignedOut={onSignedOut}
        />
      ) : null}
    </div>
  );
}

function Field({ label, children, id }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="builder-spirality-tasks__field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

function SignInForm({ api, notice, onSignedIn, onForgot }: { api: SpiralityApi; notice?: string; onSignedIn: (p: SpiralityPerson) => void; onForgot: () => void }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await api.signIn(email.trim(), password);
    setBusy(false);
    if (r.ok) onSignedIn(r.data.person);
    else setError(r.message);
  }

  return (
    <form className="builder-spirality-tasks__form" onSubmit={submit}>
      <h3 className="builder-spirality-tasks__title">Sign in to Spirality</h3>
      {notice ? <p className="builder-spirality-tasks__muted">{notice}</p> : null}
      <Field label="Email" id={`${id}-email`}>
        <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" id={`${id}-password`}>
        <input id={`${id}-password`} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error ? <p className="builder-spirality-tasks__error" role="alert">{error}</p> : null}
      <div className="builder-spirality-tasks__actions">
        <button type="submit" className="builder-spirality-tasks__button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <button type="button" className="builder-spirality-tasks__link-button" onClick={onForgot}>Forgot password?</button>
      </div>
    </form>
  );
}

function ForgotForm({ api, onBack }: { api: SpiralityApi; onBack: () => void }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await api.forgot(email.trim());
    setBusy(false);
    if (r.ok) setSent(r.data.sent);
    else setError(r.message);
  }

  return (
    <form className="builder-spirality-tasks__form" onSubmit={submit}>
      <h3 className="builder-spirality-tasks__title">Forgot password?</h3>
      {sent ? (
        <p className="builder-spirality-tasks__notice" role="status">{sent}</p>
      ) : (
        <>
          <Field label="Email" id={`${id}-email`}>
            <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error ? <p className="builder-spirality-tasks__error" role="alert">{error}</p> : null}
        </>
      )}
      <div className="builder-spirality-tasks__actions">
        {sent ? null : <button type="submit" className="builder-spirality-tasks__button" disabled={busy}>{busy ? "Sending…" : "Send me a link"}</button>}
        <button type="button" className="builder-spirality-tasks__link-button" onClick={onBack}>Back to sign in</button>
      </div>
    </form>
  );
}

function SetPasswordForm({ api, link, info, onDone }: { api: SpiralityApi; link: string; info: SpiralityLink; onDone: (p: SpiralityPerson) => void }) {
  const id = useId();
  const invite = info.purpose === "invite";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const r = await api.setPassword(link, password, invite ? name.trim() : undefined);
    setBusy(false);
    if (r.ok) onDone(r.data.person);
    else setError(r.message);
  }

  return (
    <form className="builder-spirality-tasks__form" onSubmit={submit}>
      <h3 className="builder-spirality-tasks__title">{linkPurposeTitle(info.purpose)}</h3>
      <p className="builder-spirality-tasks__muted">For {info.email}</p>
      {invite ? (
        <Field label="Your name" id={`${id}-name`}>
          <input id={`${id}-name`} type="text" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      ) : null}
      <Field label="New password" id={`${id}-password`}>
        <input id={`${id}-password`} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Type it again" id={`${id}-confirm`}>
        <input id={`${id}-confirm`} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {error ? <p className="builder-spirality-tasks__error" role="alert">{error}</p> : null}
      <div className="builder-spirality-tasks__actions">
        <button type="submit" className="builder-spirality-tasks__button" disabled={busy}>{busy ? "Saving…" : "Set password and sign in"}</button>
      </div>
    </form>
  );
}

function TasksPage({ api, moduleDefault, project, onProject, showSubmitTask, onOpen, onSubmit, onSignedOut }: {
  api: SpiralityApi;
  moduleDefault: string;
  project: string;
  onProject: (slug: string) => void;
  showSubmitTask: boolean;
  onOpen: (taskId: string) => void;
  onSubmit: () => void;
  onSignedOut: (code: string) => boolean;
}) {
  const id = useId();
  const [projects, setProjects] = useState<SpiralityProject[] | null>(null);
  const slug = project || null;
  const [board, setBoard] = useState<SpiralityBoard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await api.projects();
      if (cancelled) return;
      if (!r.ok) {
        if (!onSignedOut(r.code)) setError(r.message);
        return;
      }
      setProjects(r.data.projects);
      const kept = r.data.projects.some((p) => p.slug === project) ? project : "";
      onProject(kept || chooseProject(r.data.projects, moduleDefault, r.data.default) || "");
    })();
    return () => { cancelled = true; };
    // `project` is read once, to keep the one already chosen; changing it reloads the board below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, moduleDefault, onSignedOut]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setBoard(null);
    (async () => {
      const r = await api.board(slug);
      if (cancelled) return;
      if (r.ok) setBoard(r.data);
      else if (!onSignedOut(r.code)) setError(r.message);
    })();
    return () => { cancelled = true; };
  }, [api, slug, onSignedOut]);

  if (error) return <p className="builder-spirality-tasks__error" role="alert">{error}</p>;
  if (!projects) return <p className="builder-spirality-tasks__muted">Loading your projects…</p>;
  if (!projects.length) return <p className="builder-spirality-tasks__notice">{SPIRALITY_NO_PROJECT}</p>;

  return (
    <div className="builder-spirality-tasks__page">
      <div className="builder-spirality-tasks__toolbar">
        {projects.length > 1 ? (
          <div className="builder-spirality-tasks__field builder-spirality-tasks__field--inline">
            <label htmlFor={`${id}-project`}>Project</label>
            <select id={`${id}-project`} value={slug || ""} onChange={(e) => onProject(e.target.value)}>
              {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          </div>
        ) : (
          <p className="builder-spirality-tasks__project-name">{projects[0].name}</p>
        )}
        {showSubmitTask ? <button type="button" className="builder-spirality-tasks__button" onClick={onSubmit}>Submit Task</button> : null}
      </div>
      {board ? <TaskColumns board={board} onOpen={onOpen} /> : <p className="builder-spirality-tasks__muted">Loading tasks…</p>}
    </div>
  );
}

/** The queue, grouped by status in the tracker's order and named as the tracker names them. */
function TaskColumns({ board, onOpen }: { board: SpiralityBoard; onOpen?: (taskId: string) => void }) {
  const columns = nonEmptyColumns(board);
  if (!columns.length) return <p className="builder-spirality-tasks__notice">{board.projectName} has no tasks yet.</p>;
  return (
    <div className="builder-spirality-tasks__groups">
      {columns.map((column) => (
        <section key={column.status} className="builder-spirality-tasks__group" data-spirality-status={column.status}>
          <h3 className="builder-spirality-tasks__status">
            {column.status} <span className="builder-spirality-tasks__count">{column.tasks.length}</span>
          </h3>
          <ul className="builder-spirality-tasks__list">
            {column.tasks.map((task) => (
              <li key={task.id}>
                <button type="button" className="builder-spirality-tasks__task" onClick={onOpen ? () => onOpen(task.id) : undefined} tabIndex={onOpen ? undefined : -1}>
                  <span className="builder-spirality-tasks__task-id">{task.id}</span>
                  <span className="builder-spirality-tasks__task-name">{task.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function formatWhen(iso: string) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function TaskThread({ api, taskId, onBack, onSignedOut }: { api: SpiralityApi; taskId: string; onBack: () => void; onSignedOut: (code: string) => boolean }) {
  const id = useId();
  const [thread, setThread] = useState<SpiralityThread | null>(null);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyError, setReplyError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await api.thread(taskId);
      if (cancelled) return;
      if (r.ok) setThread(r.data);
      else if (!onSignedOut(r.code)) setError(r.message);
    })();
    return () => { cancelled = true; };
  }, [api, taskId, onSignedOut]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setReplyError("");
    const r = await api.reply(taskId, reply.trim());
    setBusy(false);
    if (r.ok) {
      setThread(r.data);
      setReply("");
    } else if (!onSignedOut(r.code)) setReplyError(r.message);
  }

  return (
    <div className="builder-spirality-tasks__thread">
      <button type="button" className="builder-spirality-tasks__link-button" onClick={onBack}>← All tasks</button>
      {error ? <p className="builder-spirality-tasks__error" role="alert">{error}</p> : null}
      {!thread && !error ? <p className="builder-spirality-tasks__muted">Loading the task…</p> : null}
      {thread ? (
        <>
          <h3 className="builder-spirality-tasks__title">
            <span className="builder-spirality-tasks__task-id">{thread.id}</span> {thread.name}
          </h3>
          {thread.description ? (
            <p className="builder-spirality-tasks__description">{thread.description}</p>
          ) : (
            <p className="builder-spirality-tasks__muted">This task has no description.</p>
          )}
          {thread.comments.length ? (
            <ol className="builder-spirality-tasks__comments">
              {thread.comments.map((c) => (
                <li key={c.id} className={`builder-spirality-tasks__comment${c.machine ? " is-machine" : ""}`}>
                  <p className="builder-spirality-tasks__comment-meta">
                    <strong>{c.author?.name || "Someone"}</strong>
                    {c.machine ? <span className="builder-spirality-tasks__badge">automated</span> : null}
                    <span className="builder-spirality-tasks__muted">{formatWhen(c.createdAt)}</span>
                  </p>
                  <p className="builder-spirality-tasks__comment-body">{c.body}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="builder-spirality-tasks__muted">No comments yet.</p>
          )}
          <form className="builder-spirality-tasks__form" onSubmit={send}>
            <Field label="Reply" id={`${id}-reply`}>
              <textarea id={`${id}-reply`} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
            </Field>
            {replyError ? <p className="builder-spirality-tasks__error" role="alert">{replyError}</p> : null}
            <div className="builder-spirality-tasks__actions">
              <button type="submit" className="builder-spirality-tasks__button" disabled={busy || !reply.trim()}>{busy ? "Posting…" : "Post reply"}</button>
            </div>
          </form>
        </>
      ) : null}
    </div>
  );
}

function SubmitTaskForm({ api, project, onBack, onFiled, onSignedOut }: { api: SpiralityApi; project: string; onBack: () => void; onFiled: (t: SpiralityThread) => void; onSignedOut: (code: string) => boolean }) {
  const id = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slug = project;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) {
      setError(SPIRALITY_NO_PROJECT);
      return;
    }
    setBusy(true);
    setError("");
    const r = await api.submit(slug, name.trim(), description.trim());
    setBusy(false);
    if (r.ok) onFiled(r.data);
    else if (!onSignedOut(r.code)) setError(r.message);
  }

  return (
    <form className="builder-spirality-tasks__form" onSubmit={submit}>
      <h3 className="builder-spirality-tasks__title">Submit Task</h3>
      <Field label="Name" id={`${id}-name`}>
        <input id={`${id}-name`} type="text" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" id={`${id}-description`}>
        <textarea id={`${id}-description`} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {error ? <p className="builder-spirality-tasks__error" role="alert">{error}</p> : null}
      <div className="builder-spirality-tasks__actions">
        <button type="submit" className="builder-spirality-tasks__button" disabled={busy || !name.trim()}>{busy ? "Submitting…" : "Submit Task"}</button>
        <button type="button" className="builder-spirality-tasks__link-button" onClick={onBack}>Cancel</button>
      </div>
    </form>
  );
}

/** A still, signed-in Tasks page with sample tasks: what the Builder shows instead of asking Spirality. */
export function SpiralityTasksSample({ settings }: { settings: Record<string, string> }) {
  const s = readSpiralityTasksSettings(settings);
  return (
    <div className="builder-spirality-tasks is-sample" data-spirality-view="sample" aria-hidden="true">
      <div className="builder-spirality-tasks__header">
        {s.heading ? <h2 className="builder-spirality-tasks__heading">{s.heading}</h2> : null}
        <div className="builder-spirality-tasks__who"><span>Signed in as Sample Person</span></div>
      </div>
      <div className="builder-spirality-tasks__page">
        <div className="builder-spirality-tasks__toolbar">
          <p className="builder-spirality-tasks__project-name">{SPIRALITY_SAMPLE_BOARD.projectName}</p>
          {s.showSubmitTask ? <span className="builder-spirality-tasks__button">Submit Task</span> : null}
        </div>
        <TaskColumns board={SPIRALITY_SAMPLE_BOARD} />
      </div>
    </div>
  );
}
