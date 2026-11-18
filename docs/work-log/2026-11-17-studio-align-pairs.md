## 2026-11-17 — Line up iPhone and Zoom recordings of one session on the Mac Mini (Reel Spinner 3b) (#1038)

When Dane films a session on his iPhone while Zoom records it too, the Mac Mini
now notices the two belong together, works out how many seconds apart they
start, and picks the one with the cleaner sound, using the rules written in 3a.
It does this by itself whenever a new recording finishes processing, and a
one-off catch-up command (`npm run studio:backfill-align`) covers the
recordings that were already there.

On Assets › Footage, each such file now says "Recorded together with …, sound
from … (cleaner)", with a button to use the other recording's sound. That
button is Dane's choice and the Mini never overrides it later. When two
recordings were made at the same time but could not be matched, the screen
says so and gives the reason in plain words, instead of showing nothing.

Checked on the Mini the same day: none of the 32 recordings so far were made
at overlapping times, so there is no real pair yet, and the database table
these answers are saved in (from 2b) has not been set up on the live site.
Both are needed before the first real pair appears.
