## 2026-11-22 — Build a meeting booking calendar module with Google Meet integration (#1095)

The first of six pieces of the booking calendar, so visitors to a client's site can book a meeting with them. Nothing shows on screen yet; this is the groundwork the other five pieces stand on.

**What changed.** There is now a place in the database to keep each calendar's settings (opening hours, days off, how long a meeting is, the break between meetings, how much notice a visitor must give, how far ahead they can book, and the words they see) and the meetings people book. There is also one piece of code that answers "which times can a visitor book?". It works across time zones and gets the two daylight-saving days right: in spring it does not offer the hour the clocks skip, and in autumn it offers the repeated hour only once. The operator's side of the system can now save and read the settings, list bookings, see the free times and cancel a booking, always for the current client only.

**Why it matters.** The admin screen, the visitor's calendar, the emails and the Google Meet connection all depend on answering "is this time free?" the same way. Having one tested answer from the start means they cannot disagree with each other later.

**Worth knowing.** The ticket put the operator's API under an `/api/admin/...` address. On the server, those addresses skip the step that works out which client a request is for, so the API lives at `/api/booking/...` instead, and the Builder translates the admin address to it. The database file still has to be run on production before slice 2 can use it.
