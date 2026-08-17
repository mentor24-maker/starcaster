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
