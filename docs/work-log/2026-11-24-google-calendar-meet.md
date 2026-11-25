## 2026-11-24 — Connect Google Calendar to add Google Meet links and hide busy times (#1100)

The booking calendar can now be connected to the site owner's own Google
Calendar. They press "Connect Google Calendar" on the Booking Manager, sign in
to Google once, and from then on every meeting a visitor books lands on their
Google Calendar with a Google Meet video link. The same link is in the
confirmation email to the visitor, the alert email to the owner, and the
add-to-calendar file. Times the owner is already busy on Google are hidden
from visitors, and checked again at the moment someone books, so nobody can
grab a time the owner just filled. Moving or cancelling a meeting moves or
removes it on Google too.

If Google is down at the moment someone books, the booking still goes through
and the emails still go out. The Booking Manager then shows "No Meet link yet"
with the reason and a Retry button, so nothing is lost and nothing fails
quietly.

The Google sign-in is stored scrambled (encrypted) in the same safe place as
the Facebook and X connections, and never shown on a screen, in an email or in
a log. Disconnect tells Google to withdraw access and deletes it.

Before it works on the live site, two things are needed from Dane: running
one database file that adds five fields to bookings, and setting up the
Google app that the sign-in goes through (a Google Cloud screen and two secret
values). Until then the Booking Manager says plainly that Google Calendar
cannot be connected yet.

**Fixes after review (same day).** Review found six real problems, all fixed
with a test for each that was broken on purpose and watched fail:

- A visitor moving their meeting by a little was told the new time was taken,
  because Google reported the meeting's own slot as "busy" in a trimmed or
  merged shape. Now only the meeting's own time is taken out of Google's busy
  list; anything either side stays busy.
- If Google hung instead of answering, the client's booking page hung with
  it. Every Google call now gives up after five seconds and the booking goes
  ahead without the Meet link (and says so).
- Signing in from the Connections screen, or with pop-ups blocked, used to end
  on a "you can close this window" page with the app gone. It now comes back
  to the page the sign-in started from (or the Connections screen) and shows
  how it went.
- A visitor could put a web address in their name or note and it showed as a
  clickable link in the owner's alert email. Now only the Meet link is a link.
- When Google refuses to renew the sign-in, bookings now say "connect Google
  Calendar again" instead of Google's vague "Invalid Credentials".
- If the owner deleted the meeting on Google and the visitor then moved it,
  the email went out with the dead Meet link. Now a fresh event and link are
  made, and a dead link is never emailed.
