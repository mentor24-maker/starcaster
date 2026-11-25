## 2026-11-24 — Send booking emails with an add-to-calendar file and a cancel or reschedule link (#1099)

Slice 4 of 6 of the booking calendar (SC-912).

When a visitor books a meeting, two emails now go out: a confirmation to the
visitor, in their own time zone and using the wording the site owner wrote in
the Booking Manager, and an alert to the site owner saying who booked, when,
their note, and a link to their CRM contact. Each email has an "add to
calendar" file attached that opens in Apple Calendar and Google Calendar.

The visitor's email also carries a private link to a small page where they can
cancel or move their meeting. Moving changes the one booking in a single step,
so the old time is freed and the new one taken at the same moment, and the
calendar file updates the existing calendar entry instead of adding a second.
Cancelling twice just says "already cancelled".

If an email cannot be sent, the meeting still stands, and the Booking Manager
says "Email not sent" with the reason, so the site owner can contact the
visitor themselves. Before this, nothing told either side a booking existed.

It needs `docs/SQL/booking_notifications.sql` run in production, after slice
1's `booking_setup.sql`.
