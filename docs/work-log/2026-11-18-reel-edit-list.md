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
shifted by exactly how far apart the two started. Where the other recording
had not started yet (or had already stopped) and nothing is being said, that
bit of silence is simply trimmed. Only when real speech would lose its sound
does the edit fall back to its own recording, and it says why. (Review caught
that the first version gave up the cleaner sound on every full edit, because
every recording opens on a quarter second of kept silence. A second review caught
that two cameras started almost together could leave a hundredth-of-a-second
scrap of silence in the edit; that is now dropped like any other sliver.)

One thing learned on the real recording: the transcriber stretches a word's
time over the pause after it, so by its raw times most cut edges looked like
they fell mid-word. They do not. They fall in silence. The edit list measures
a word by where it actually sounds, and the tests check every edge that way.

On the test recording (835.65 s) the full edit keeps 752.4 s and cuts 83.3 s;
the three shorts (scores 88, 84, 80) span 43.5, 51.2 and 33.8 s and keep 40.9,
50.2 and 33.8 s once their own cuts are out. Paired with a second recording
that started 2.345 s later, the full edit still uses that recording's sound,
losing only the 0.25 s of opening silence. No rendering, no database yet.
