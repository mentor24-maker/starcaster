# ClickUp setup for the loop — statuses, and finding what needs you

Section 1 is done once, by hand, in the ClickUp web app; it cannot be done from
the API, since ClickUp exposes no endpoint for editing a list's status set.
Section 2 needs no setup at all — it explains why, and what was tried first.

The Loop Queue was set up this way on 2026-08-12. These steps are here for the
next list, or the next machine.

ClickUp moves its menu labels around between releases. The paths below are
what to look for, not a guarantee of exact wording — if a label has changed,
the nearby option that does the same job is the right one.

---

## 1. The six statuses on **Loop Queue**

**Where:** in the left sidebar, hover the **Loop Queue** list (Starcaster
space) → click the **`...`** → **List settings** → **Statuses**. If it offers
to inherit statuses from the Space, choose the option to use **custom** ones
for this list.

You are editing an existing set, not building a new one. **Rename in place —
never delete a status and re-create it.** Renaming carries the existing
tickets across untouched; deleting forces every ticket in that status into
some other one, and you lose which stage each was at.

Rename these five:

| Rename this | To this |
|---|---|
| `to do` | `Queued` |
| `building` | `Building` |
| `review` | `In review` |
| `blocked` | `Needs your input` |
| `approved` | `Ready to launch` |
| `merged` | `Live` |

Then **delete** these two — they are ClickUp defaults nobody uses, and they
are only clutter in a board view. Confirm each is empty first (filter the list
by that status and check the count is zero):

- `in progress`
- `complete`

Put them in this order, top to bottom:

```
Queued
Building
In review
Needs your input
Ready to launch
Live
```

### The one setting that matters most

ClickUp sorts statuses into groups — **Not started**, **Active**, **Done**,
**Closed**. A ticket only stops counting as open when its status sits in the
Done or Closed group.

The original `merged` was an *Active* status. Left that way, every task ever
shipped keeps counting as open work, forever, and the list only grows.

**`Live` must sit in the Closed group.** That one setting is what makes
finished work disappear from the open view. Leave the other five where they
are: `Queued` in Not started, the rest in Active.

Dragging into Closed can be fiddly — the drop tends to snap into *Done*, which
looks the same but is not (Done-group tasks still show in the list by default).
The reliable move is to rename the list's existing Closed status into `Live`:
delete the `Live` you dragged into Done, choosing the old Closed status as the
destination for its tasks, then rename that Closed status to `Live`.

### Colors worth setting

Only two statuses need to catch your eye across a room. Give the four machine
statuses muted greys and blues, and make yours loud:

- `Needs your input` — red
- `Ready to launch` — green

---

## 2. Finding what needs you

Work waits on Dane in two different lists, in two different spaces:

| List | Space | What "yours" looks like |
|---|---|---|
| Loop Queue | Starcaster | status `Needs your input` or `Ready to launch` |
| Agent Response | Dane of Earth | status `pending response` |

**There is nothing to build here.** Use ClickUp's own **Assigned to me**
(sidebar → **My Tasks** → *Assigned to me*). The loops assign Dane when they
hand a ticket over and clear the assignee when they take it back, so that
built-in view is already the complete picture.

### Why not a saved "My Turn" view

This was tried on 2026-08-12 and abandoned. Recording it so nobody rebuilds it:

- A ClickUp **view is scoped to one space.** A view built on the Starcaster
  space cannot see Agent Response in Dane of Earth, and vice versa. The two
  lists that matter are deliberately in different spaces.
- The workspace-wide level (**More → All Tasks**, formerly "Everything") can
  span spaces, but its status filter offers *every status in the workspace* —
  three groups deep, with near-duplicate names like `TO DO` / `TODO` /
  `NEW REQUEST` from unrelated lists. It is a filter you have to maintain
  forever, and it silently goes stale the moment a list adds a status.
- **Assignment crosses spaces for free**, drives ClickUp's notifications and
  Inbox, and needs no configuration that can drift.

The one cost: a loop that forgets to clear an assignee leaves noise in the
view. That is why "clear assignees when moving to a machine status" is written
into `loop-build` and `loop-review` as a rule, not a nicety.

### A note on `responding`

The Agent Response list has a `responding` status, which the channel steward
uses while a reply is being drafted. The steward assigns Dane's seat on rows it
routes, so those already reach him. `responding` means an agent is mid-answer,
not that Dane is needed.

---

## 3. After you finish

Tell CC the rename is done. The three loop skills key off these exact names
(matched case-insensitively), so a loop started before the rename will not
find its queue. Nothing breaks permanently — the loop reports an empty queue
and stops — but a build pass started mid-rename will sit idle.
