## 2026-11-17 — Mark Context notes for Reel Spinner to read (Reel Spinner 2a) (#1024)

Reel Spinner is going to pick the best moments from Dane's recordings, and to do
that it needs to know what his channel is *for*. Rather than hard-code that, it
reads it from the Context page Dane already has.

Every note on **Assets › Context** now has a **Reel Spinner reads this**
switch. Reel Spinner reads only the notes switched on, nothing else, and never
another project's notes. If a file is switched on that it cannot read (a PDF,
say), the page says so right next to the switch instead of quietly skipping it.

Each time Reel Spinner reads its notes it also gets a "fingerprint", a short
code that changes whenever one of those notes is edited, added or switched off.
Scores will store it, so later we can tell which scores were made under the old
wording. Flipping a switch on or off does not count as editing the note, so the
"Last updated" date stays put.

Production still needs two SQL files run (the Context table itself from
SC-808, then the new column). Until then the page keeps working; the switch
explains which file is missing.
