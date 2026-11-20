## 2026-11-19 — Render the finished video at full quality on the Mac Mini (Reel Spinner 5c) (#1087)

When Dane approves a rough cut, the Mac Mini now makes the real video. It uses
the same cuts, but from the original recording at full quality, with the
chosen sound, background music under the speech, a title card at the start
and an end card inviting viewers to the project. The file waits on the Mini
for the YouTube upload step, which comes next.

Before downloading anything, it checks that the disk has room and says exactly
how much is missing if not. It always deletes the downloaded original
afterwards, even when something goes wrong, so the Mini's disk does not fill
up. A trial on a real 47-second short took about 10 seconds to render. The
first trial showed the music was nearly as loud as a quiet Zoom voice, so both
are now evened out first and the music is set 20 dB lower.

Review sent it back with five fixes, all made: a long render now keeps its
claim on the job for the whole render (before, the download quietly cut it back
to five minutes, so a second copy could start on the same video); a video Dane
sends back mid-render no longer leaves its finished file on the disk forever; a
video that fails every try stops re-downloading its original every six hours
and waits until the edit changes; and two smaller cases no longer delete
another worker's files or blame the video for a network hiccup.
