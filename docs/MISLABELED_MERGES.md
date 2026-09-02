# Four merges in `main` are named after housekeeping, not their work

`git log` cannot answer "when did that ship?" for the four commits below.
Each one is titled after a chore and each one actually carries a feature. The
real message is intact — it is the *body* of the commit — but nothing about
the one-line summary says so, and one-line summaries are what everybody reads.

| Commit | Titled | Actually shipped |
|---|---|---|
| `b99b0a2` (#258) | Re-pin asset hashes from a clean build | Builder: refuse to save over a change you have not seen, and say who made it |
| `75550a5` (#259) | Re-pin asset hashes from a clean build | Row panel: fold the settings behind a Settings and Styles bar |
| `2552f7c` (#261) | Re-pin asset hashes from a clean build | Builder: Pages CRUD gets a Slug search, next to the three it already had |
| `ff80abb` (#304) | Register public/explore.html with the asset-pin merge driver | Explore link: Orbitron, electric blue, centred, with a halo on hover |

To read what one of them really says:

```
git log -1 --format=%B 2552f7c
```

## Why it happened

`npm run ship` writes one commit of its own. Its verify step runs a clean
build, the build re-stamps the `?v=` asset pins in the committed HTML, and
those get committed as "Re-pin asset hashes from a clean build" so they travel
with the branch. Catching up with `main` can leave a merge commit too.

The script then titled the pull request from `git log -1` — the newest commit
on the branch, which by that point was very often one of those two. And since
every PR here is squash-merged, the borrowed title is what lands in `main`
permanently.

## Why they are not being renamed

Fixing the titles means rewriting commits that are already on `main`, which
means a force-push to a shared branch. That is on the operator's deny list and
it is the right call (`DOCTRINE.md` §6.6): rewriting shared history breaks
every clone and every open branch that has already pulled it. Three
mislabeled commits and a note are cheaper than that, by a lot.

## The fix, which stopped the first three

`scripts/builder/pullRequestCommit.js` picks the newest commit on the branch
that `ship` did *not* generate — merges excluded by `--no-merges`, the re-pin
excluded by its exact subject — and names the pull request after that. It
falls back to the newest commit if a branch somehow carries nothing else, so a
PR can never be opened with an empty title.

`scripts/builder/pullRequestCommit.test.js` covers it against a real temporary
repository, and all three assertions fail if the old behaviour comes back.

## #304 is a different cause, and the fix cannot see it

The three above were stolen by a commit the *script* wrote. #304 was stolen by
a commit **a person wrote**, and no rule can tell those apart.

The branch carried the Explore link restyle. Shipping it hit a merge conflict,
the cause turned out to be a missing `.gitattributes` line, and that fix was
committed second — so it was the newest hand-authored commit, and the newest
hand-authored commit is exactly what the rule is designed to pick. It worked
as written. It had no way to know that of two real commits, the older one was
the work and the newer one was a chore discovered while shipping.

So the standing practice, which is the actual fix:

> **When shipping turns up an unrelated fix, commit that fix *before* the
> feature, or fold it into the feature commit.** The last real commit on the
> branch is the one the PR gets named after — make sure it is the work.

If this recurs often enough to be worth automating, the cheap move is a
`--title` flag on `npm run ship` so the shipper can state the name outright
rather than having it inferred. Not built yet: one occurrence is a practice
problem, not a tooling problem, and a flag nobody remembers to pass fixes
nothing.

## 2026-09-01: the title now comes from the ticket, not from a commit

Task `86bbqwupk`. The practice above — "commit the chore before the feature" —
is the right instinct and it is still what an unstamped branch relies on. But
it is a rule a human has to remember at the exact moment they are distracted by
a conflict, which is the shape of rule that fails. And it only ever addressed
half the problem: even a perfectly-chosen commit subject is a sentence somebody
typed freehand, and the operator pairs the ClickUp Closed list against the
GitHub/Vercel deploy list **by name**. Two freehand names for the same piece of
work do not pair up.

Measured across the ten most recently merged PRs on 2026-08-31, two did not
match their ticket:

| PR | PR title | Ticket title |
|---|---|---|
| #482 | Builder: put the Overlay Screen editor into the React section panel | Builder: the Overlay Screen editor never made it into the React section panel |
| #481 | Builder: parallax — a background image or video that drifts slower than the page | Builder: parallax — a background image or video that scrolls slower than the page |

#481 is the dangerous one: a single word apart ("drifts" against "scrolls"), so
it reads as a match until you look twice. A near-match is worse than an obvious
mismatch, because nobody checks it.

So `npm run ship` no longer infers the title at all when it does not have to.
It reads the branch's `clickup-task` stamp, asks ClickUp for the task name
(`npm run clickup -- task-name --task <id>`, which prints the name on stdout and
nothing else) and uses it verbatim. GitHub appends `(#NNN)` on squash-merge,
which is expected.

The flag suggested above — "a `--title` flag so the shipper can state the name
outright" — was deliberately not built, for the reason given there: a flag
nobody remembers to pass fixes nothing. Reading the stamp needs nobody to
remember anything.

**`pickPullRequestCommit` is untouched and is still the fallback**, on three
paths, each of which says out loud which one it took and why:

- the branch carries no `clickup-task` stamp (a legitimate thing to have);
- ClickUp cannot be reached, or the token is bad;
- ClickUp answers with no usable name.

A silent fallback would be how this rule gets quietly lost again — "the title
came from the ticket" and "the fetch failed and nobody looked" print the same
nothing — so every fallback names the reason and prints the `gh pr edit` command
that renames the PR by hand. None of them stops the ship: a ClickUp outage is
not a reason to abandon a green, mergeable branch.

The `#304` shape — a chore committed second, after the work — therefore cannot
recur on a stamped branch. On an unstamped one the practice above still stands.

Rules in `scripts/builder/pullRequestTitle.js`, tested in
`scripts/builder/pullRequestTitle.test.js`. The loop lane never calls `ship`, so
the same rule is written into `.claude/skills/loop-build/SKILL.md` step 7.
