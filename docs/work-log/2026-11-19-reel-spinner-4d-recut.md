## 2026-11-19 — Re-cut a sent-back rough cut from Dane's note (Reel Spinner 4d) (#1073)

Until now, sending a rough cut back with a note did nothing: the note sat
on the row and the Mac Mini never looked at it. Now the Mini checks once a
minute. For each rough cut sent back, it asks the AI to change the edit the
way the note says, checks the answer against the same rules the first cut
followed (stay inside the recording, never cut a word in half, keep the
"um"s and long pauses out), makes the new rough cut and puts it back under
"waiting for you" with the line *Re-cut from your note: "…"*.

If the note cannot be turned into an edit (asking for music, say), the cut
comes back unchanged and the card says why, instead of the note quietly
going nowhere. After three re-cuts of the same video the Mini stops and
says so, so it can never loop and keep spending on AI calls. If the problem
is the machine (no AI credit, a full disk, ffmpeg missing), nothing changes
on the card. The Mini waits and tries again, and it checks all of that
before paying for an answer.
