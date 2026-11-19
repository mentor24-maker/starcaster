## 2026-11-18 — After approving YouTube channels, Find conversations says "Cannot tell" for up to 3 hours and there is no way to read them now (#1062)

When Dane approved some YouTube channels, the Outreach wizard's Find conversations step went red with "Cannot tell" and a sentence suggesting YouTube had refused or the schedule had broken. Nothing was wrong. The channels were just waiting for the next three-hourly read, and the screen gave him no way to skip that wait.

Two changes:

- **A Read now button.** It reads the current project's approved channels straight away, using the same code as the scheduled read, so a press gets exactly what the schedule would have fetched later. It cannot be pressed twice while it runs, and when it finishes it says how many channels and comments it read, or names what went wrong.
- **Calm wording for a normal wait.** A channel approved in the last 12 hours and not read yet now shows "Waiting for the next read" in grey, with the time of the next scheduled read in Mountain time. The warning about YouTube refusing or the schedule not running now appears only when something really is wrong.

This is slice 1 of 4. The others read a channel the moment it is approved (SC-881) and give Substack (SC-882) and Reddit (SC-883) the same treatment.

**After review:** the line Read now leaves behind was wrong in two cases, both fixed. If the list of approved channels itself could not be read, it used to say "there are no approved channels"; it now says the list could not be read and why. And when YouTube's daily quota ran out, it counted one channel too few as unread; the count is now right. Two smaller fixes rode along: a refused Read now (for example, no YouTube key on the server) now leaves a line in the server log, and a next read that falls after midnight says "tomorrow".
