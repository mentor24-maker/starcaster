## 2026-11-19 — Add Read now to Substack's Find conversations, and stop a normal wait looking like a fault (#1084)

After you approved writers in the Substack Miner, Find conversations showed a
red "Cannot tell … Substack refused it or the schedule is not running" until
the two-hourly read got to them, and there was no way to read sooner. Nothing
was actually wrong; the screen just made a normal wait look like a fault. It
was the same problem you hit on YouTube.

Now:

- There is a **Read now** button. It reads your approved writers straight away
  and says "Reading…" while it works, so you cannot start it twice. Then the
  list refreshes and one line says what it read.
- If it is outside the Substack account's active hours, it tells you the hours
  calmly instead of showing an error.
- A writer you approved in the last day and who has not been read yet now
  reads as a wait: "not read yet, the next scheduled read is at 8:07am, or
  press Read now". The time is in Mountain time and skips the hours the
  account is asleep.
- The red wording is kept for real trouble: a writer approved over a day ago
  and still never read, or one not read for over 8 days.
