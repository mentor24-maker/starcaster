# Three merges in `main` are named after housekeeping, not their work

`git log` cannot answer "when did that ship?" for the three commits below.
Each one is titled **"Re-pin asset hashes from a clean build"** and each one
actually carries a feature. The real message is intact — it is the *body* of
the commit — but nothing about the one-line summary says so, and one-line
summaries are what everybody reads.

| Commit | Titled | Actually shipped |
|---|---|---|
| `b99b0a2` (#258) | Re-pin asset hashes from a clean build | Builder: refuse to save over a change you have not seen, and say who made it |
| `75550a5` (#259) | Re-pin asset hashes from a clean build | Row panel: fold the settings behind a Settings and Styles bar |
| `2552f7c` (#261) | Re-pin asset hashes from a clean build | Builder: Pages CRUD gets a Slug search, next to the three it already had |

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

## The fix, so the list stops growing

`scripts/builder/pullRequestCommit.js` picks the newest commit on the branch
that `ship` did *not* generate — merges excluded by `--no-merges`, the re-pin
excluded by its exact subject — and names the pull request after that. It
falls back to the newest commit if a branch somehow carries nothing else, so a
PR can never be opened with an empty title.

`scripts/builder/pullRequestCommit.test.js` covers it against a real temporary
repository, and all three assertions fail if the old behaviour comes back.
