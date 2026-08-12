# ClickUp setup for the loop — statuses and the "My Turn" view

Everything here is done once, by hand, in the ClickUp web app. None of it can
be done from the API: ClickUp exposes no endpoint for editing a list's status
set or creating a saved view, so this is the one part of the loop system that
needs a human at a browser.

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

Right now `merged` is an *Active* status. That means every task you have ever
shipped still counts as open work, forever, and your list only grows.

**Drag `Live` into the Closed group.** That one change is what makes finished
work disappear from your view. Leave the other five where they are: `Queued`
in Not started, the rest in Active.

### Colors worth setting

Only two statuses need to catch your eye across a room. Give the four machine
statuses muted greys and blues, and make yours loud:

- `Needs your input` — red
- `Ready to launch` — green

---

## 2. The **My Turn** view

Work waits on you in two different lists, in two different spaces:

| List | Space | The status that means "yours" |
|---|---|---|
| Loop Queue | Starcaster | `Needs your input`, `Ready to launch` |
| Agent Response | Dane of Earth | `pending response` |

Because they are in different spaces, a Space-level view cannot span them. The
view has to be built at the **Everything** level.

**Where:** click **Everything** at the top of the left sidebar → **`+`** next
to the view tabs → **List** → name it **My Turn**.

Then set a filter:

```
Status  is any of  [ Needs your input, Ready to launch, pending response ]
```

Group by **Status**, sort by **Date created**, oldest first — so the thing
that has been waiting longest is at the top, which is usually the one that
matters.

Pin it (click the view tab → **Pin**) so it is the first thing you see.

That is the only view you need to check. If nothing is in it, nothing is
waiting on you, and the loops are working. Everything in the other four
statuses is machines talking to each other.

### A note on `responding`

The Agent Response list also has a `responding` status, which the channel
steward uses while a reply is being drafted. It is deliberately **not** in the
filter — it means an agent is mid-answer, not that you are needed. Add it only
if you find things getting stuck there.

---

## 3. After you finish

Tell CC the rename is done. The three loop skills key off these exact names
(matched case-insensitively), so a loop started before the rename will not
find its queue. Nothing breaks permanently — the loop reports an empty queue
and stops — but a build pass started mid-rename will sit idle.
