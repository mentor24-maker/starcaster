# Spirality Tasks module

A builder module that lets a teammate sign in to **Spirality** on a StarCaster
page and work a project's tasks: see the queue, open a task and reply, and
submit a new one. Asked for by Dane on 2026-11-06; tickets 86bczt5kf (server
calls, PR #1000) and 86bczt5t4 (the module). First page: one in StarCaster's
Spirality project.

It is deliberately small. There is no board, search, reporting, editing, status
change or admin here. Those stay on Spirality's own page.

## How it fits together

```
visitor's browser ──► StarCaster /api/spirality/*  ──► Spirality tracker
  (the module)          (routes/spirality.js)            (tracker/server.mjs)
```

- **The browser never calls the tracker.** The tracker has no CORS on purpose.
  The module calls StarCaster's own routes; StarCaster's server calls the
  tracker (`lib/spiralityTracker.js`).
- **The tracker's session token never reaches page script.** On sign-in the
  server takes `tracker_session` off the tracker's `set-cookie` and keeps it in
  a StarCaster cookie of its own: `sc_spirality_<projectId>`, HttpOnly,
  SameSite=Lax, Secure on https, `Path=/api/spirality`. Every later call
  forwards it as `cookie: tracker_session=…`. No answer body carries it.
- **Everything a person does is authored as them in Spirality**, because it
  travels on their own session.
- `/api/spirality/*` is a **public route prefix** (exempt from the StarCaster
  login in `routes/index.js`). StarCaster grants nothing there; the tracker
  checks the person's own session on every call.

## Joining is by invite only

Spirality is team-only (SP-153; Dane, 2026-11-06: *"My team only. This is not
intended as a public service at this point."*). So there is **no Register form**.

1. An admin invites someone from the tracker's Users page and chooses to send
   the link to the StarCaster site.
2. The email brings them to this page with `?link=<token>`.
3. The module asks what the link is for (`/account/link`). An invite shows
   **Finish joining** (name + password); a reset shows **Set your password**.
   Then it signs them in and removes `?link=` from the address.

**Forgot password?** sends the email to the tracker with StarCaster's site
token, so the reset link opens this page. It always gives the same neutral answer.

## Settings

| Where | Setting | What it does |
|---|---|---|
| Doppler (starcaster) | `SPIRALITY_TRACKER_URL` | The tracker's address. Without it every call answers "Spirality is not connected to this site yet." |
| Doppler (starcaster) | `SPIRALITY_SITE_TOKEN` | StarCaster's site token, from `node tracker/admin.mjs create-actor --kind machine --name starcaster-site --site-url <the page's https address>` on the Mini. Sent only on forgot-password. |
| Module | Heading | The heading above it (default "Tasks"). |
| Module | Opens on project | A project slug to open on, when the person can see it. |
| Module | Submit Task | Whether the Submit Task button appears. |

Neither Doppler value is ever in the repo or in a browser bundle (a test checks).

## What it shows

- **Signed out:** sign in, and Forgot password?. The tracker's own error text is
  shown as written, including the 15-minute lock after 5 failed tries.
- **Signed in:** a project picker when there is more than one project; the
  project's tasks grouped by status in **the tracker's own order and names**
  (from `/projects/:slug/board`, so StarCaster keeps no copy of the status
  list), with empty statuses left out. No project at all: "You have not been
  added to a project yet."
- **A task:** its description, each comment with who wrote it (automated ones
  marked), and a reply box.
- **Submit Task:** name and description, filed as `Requested`, then the new task opens.
- **In the Builder**, and anywhere that is not the live site, it draws a still
  sample of the signed-in Tasks page and asks no server anything.

## Before it goes on a live page

- Spirality's **SP-152**: the tracker's public https address. It is planned as
  a Tailscale Funnel address; set it as `SPIRALITY_TRACKER_URL` and never
  hard-code it.
- The Spirality project's page domain, and a site token made with that address.
- Spirality's **SP-145** narrows `/projects` to the projects a person belongs to.
  Until then everyone sees every project, and the "not added to a project yet"
  message never shows.

StarCaster previews have no database, so a preview link cannot sign in. Test
locally against `node tracker/demo.mjs` in the spirality repo (it prints its
address and a sign-in), or on the Mini.

## Files

- `routes/spirality.js`, `lib/spiralityTracker.js`: server calls; tests in
  `scripts/builder/spiralityRoute.test.js`
- `lib/builder-client/spirality-tasks.ts`: settings, calls, choices
- `components/builder/builder-spirality-tasks-module.tsx`: the views; tests in
  `builder-spirality-tasks-module.test.tsx`
- `components/builder/builder-spirality-tasks-module-settings.tsx`: the panel
- Render contracts `spirality-tasks-*` in `scripts/ui/render-contracts.mjs`
- Email: skipped (Standard 11, reason in `builder-email-render.ts`). Site
  search: never indexed. Site Import: not applicable, since no source site has
  one of these.
