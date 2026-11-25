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
