# The Approvals surface — before/after sign-offs (Charter Q5)

The one place Dane approves **visual and content changes** at a glance: a
change that alters what a page renders arrives here as a task with a
**before** and an **after** image, and he approves or rejects it in one move.
This is distinct from the other two surfaces he already has, and it must not
duplicate them:

| Surface | For | Where |
|---|---|---|
| **Ready to launch** (Loop Queue) | a verified PR waiting for the go to MERGE | Loop Queue list |
| **Agent Response / Needs your input** | a QUESTION only a human can answer | Agent Response list / Loop Queue |
| **Approvals** (this) | a rendered change to LOOK AT and approve/reject | Approvals list |

A merge decision reads code and tests; an approval decision reads two
pictures. Keeping them apart is the point — the Approvals list is scannable
precisely because every item is "here is what changed, yes or no".

> **Shape first, UI later.** Custom UI comes after we have lived with this
> shape (Charter). This document IS the shape; adjust it in a PR as the
> convention proves itself, rather than building screens around an unproven
> one.

## The list (one-time setup)

A list named **Approvals** in the Starcaster space (`90146476303`). The
ClickUp API can create it, but it is Dane's daily surface, so it is created
once, deliberately, not by an autonomous pass — the same footing as the
"Loop note" field. Create it with these statuses, in order:

1. **Awaiting approval** (open) — filed by an agent, not yet decided.
2. **Approved** (done) — Dane accepted the change.
3. **Rejected** (done) — Dane declined it; the filing agent/PR acts on that.

Put its id in `CLICKUP_APPROVALS_LIST` (Doppler) so the tooling can file to
it. Until it exists, an agent that would file an approval says so plainly and
does not silently skip it (DOCTRINE §3.11).

## What every approval task carries — so agents file the same way

- **Title:** `Approve: <what changed> — <page/module>` (e.g.
  `Approve: hero headline copy — Home`).
- **Status:** `Awaiting approval`.
- **Assignee:** Dane (`48012725`) — assignment is his "what needs me" signal
  (same rule as the Loop Queue).
- **Priority:** the human lane — `Urgent` only when Dane asked; agents file at
  `High` or below (same doctrine as the Loop Queue).
- **Two attached images, named `before.*` and `after.*`**, from the
  check:render browser harness (the producer is task 86bbgcy0y). No pair, no
  approval task — a "change" with nothing to look at belongs on another
  surface.
- **Body:** one plain-language line of what changed and why, the PR link, and
  the page/preview URL.

## One-click approve / reject

Dane decides with a **comment** — `approve` or `reject` (case-insensitive,
exact word) — or by moving the status. The bus relay already turns an operator
comment on a watched list into an action (see `scripts/builder/busRelayPlan.js`
and the comment-driven handback); Approvals joins that watch:

- **approve** → status `Approved`; the filing PR/agent proceeds (merge, apply,
  publish — whatever the task's body says the approval gates).
- **reject** → status `Rejected` with the operator's comment as the reason;
  the filing agent picks it up and revises.

Same guarantees as everywhere else: every write is verified by read-back, and
a status move carries `--if-status` so a stale decision cannot clobber a newer
one (the loop-review race lesson, 2026-08-22).

## What this is NOT

- Not a merge queue — that is `Ready to launch`.
- Not a question inbox — that is `Needs your input`.
- Not automatic: nothing an agent files here ships without Dane's approve.
