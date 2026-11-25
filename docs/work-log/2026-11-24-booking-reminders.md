## 2026-11-24 — Send reminder emails before each booked meeting (#1101)

The last slice of the booking calendar. Visitors who book a meeting now get a
reminder email before it: a day before and an hour before unless the site
owner picks other times on the Booking Manager. The owner can also ask for a
reminder of their own, or switch reminders off.

A job runs every five minutes and sends whatever is due. The hard part was
making sure nobody gets the same reminder twice: before sending, the job
writes a "claimed" note in the database, and the database refuses a second
note for the same reminder. So a job that runs twice, or two that run at
once, still sends one email. A cancelled meeting gets no reminder; each
meeting is checked again just before its email goes out.

If an email fails, the job tries again five minutes later. After three failed
tries it stops, and the Booking Manager lists it under "Reminders Not Sent"
with who, which meeting and why, so the owner can contact that person.

It needs one new SQL file run in the database (`docs/SQL/booking_reminders.sql`).
Until then reminders do not send and the job's log says so, while booking
meetings keeps working.
