## 2026-11-18 — Write the rules that turn cut marks into an edit list (Reel Spinner 4a) (#1046)

Reel Spinner already knows what to take out of a recording (the "um"s, repeats
and long pauses) and which short stretches are worth sharing. This adds the
step that turns those decisions into an edit list: exactly which seconds to
keep, and whose sound to use. The rough cut and the finished video will both
be made from this one list, so they can never disagree about what was cut.

Every recording gets one full edit (the whole thing minus the cuts) and up to
three shorts, one per moment scoring 60 or more. Both numbers are settings,
not fixed in the code. When an iPhone take and a Zoom recording of the same
session have been lined up, the edit uses the cleaner recording's sound,
shifted by exactly how far apart the two started. If the other recording does
not cover the whole edit, the edit uses its own sound and says why.

One thing learned on the real recording: the transcriber stretches a word's
time over the pause after it, so by its raw times most cut edges looked like
they fell mid-word. They do not. They fall in silence. The edit list measures
a word by where it actually sounds, and the tests check every edge that way.

On the test recording (835.65 s) the full edit keeps 752.4 s and cuts 83.3 s;
the three shorts run 43.5, 51.2 and 33.8 s. No rendering, no database yet.
