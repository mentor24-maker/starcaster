## 2026-11-17 — Write the rules that line up an iPhone take with its Zoom recording (Reel Spinner 3a) (#1027)

Dane chose "better sound" as Reel Spinner's third step: when the iPhone and
Zoom both recorded the same session, keep one's picture and use the other's
sound. This is the part that works out whether that is possible. It finds
the two recordings made at the same time, measures how far apart in time
they are by matching their loudness, checks that again near the end so a
pair whose clocks drift (and would slide out of lip sync) is refused, and
says which one sounds cleaner by comparing speech against the quiet between
words.

There is no real iPhone + Zoom pair among the 33 recordings yet, so it was
tested on a real Zoom call against copies of itself with noise mixed in. It
found a 12.345-second shift exactly, refused a drifting copy and an
unrelated clip, and picked the clean original over the noisy copy by 9 dB.
Along the way it turned out Zoom stamps a file with the time it finished
writing it, not when the recording began; the rules allow for that.

Nothing runs on its own yet and nothing is saved; a later step does that.
