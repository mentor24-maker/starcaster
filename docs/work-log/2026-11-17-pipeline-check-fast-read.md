## 2026-11-17 — Merging from the MacBook is blocked: the pause-switch check times out there and reports the pipeline paused when it is not (#1031)

Before anything merges, `npm run ship` asks one question: has Dane paused the
pipeline? Asked from the MacBook, that question never got an answer. To find
the pause switch, the check read every ticket StarCaster has ever closed (849
of them), one request each. On the Mini that takes two seconds. From the
MacBook each request has to find the Mini on the network again, about a third
of a second each, so the whole read took over three minutes and was cut off.
A check that can't read the switch counts the pipeline as paused, on purpose,
so every merge from the MacBook stopped, even though nothing was paused.

Now the check asks the tracker for the one ticket with the switch's name, and
then reads that ticket's comments: two requests instead of 851. Measured over
the MacBook's own network path, it answers in about two seconds where it used
to give up after three minutes. The safety rule is unchanged: if the switch
really can't be read, the pipeline still counts as paused.
