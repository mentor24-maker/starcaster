## 2026-11-24 — Add booking calendar module that lets visitors book a meeting into the CRM (#1098)

Slice 3 of 6 of the booking calendar (SC-911). This is the part visitors see.

**What changed.** A new Builder module, **Booking Calendar**, can go on any page.
A visitor sees a month with the bookable days marked, picks a day, picks a free
time, fills in name, email and (optionally) phone and a note, and presses Book.
They then see the confirmation wording set on the Booking Manager. Every time is
shown on the visitor's own clock, and the screen names their time zone ("Times
are shown in your time zone: Mountain Standard Time (America/Denver)").

Each booking files the visitor in the project's CRM: a new contact, or the
existing one when that email is already there. The booking is linked to the
contact by its id, so the Booking Manager's "Open CRM Contact" link finds them.

**No double booking.** If two people press Book on the same time at the same
moment, exactly one gets it; the other is told "That time was just taken, please
pick another" and is sent back to the refreshed times. The database itself is
what decides the tie, and the visitor who lost is not added to the CRM.

**A new public door, and why it is safe.** Visitors have no login, so the
calendar reads and books through `/api/public/booking/...`, which the site
already lets through for public pages (no new security exemption). The site's
own domain decides which project it is; it only ever sends visitor wording and
free times (never anyone's booking or the email wording); it has a hidden
anti-spam field and per-visitor rate limits, the same as the CRM contact form.

**What visitors never see.** A project with no calendar shows nothing on its
live page. A calendar with nothing free says "No times available in the next N
days." Hints meant for whoever is building the page appear only in the Builder,
and in the Builder the Book button is switched off so trying the module never
creates a real meeting.

**Settings:** which calendar (blank = the project's first), a heading (blank =
the calendar's own), which day a week starts on, and an accent colour (blank =
the theme's primary colour).

Not in this slice: emails (slice 4), Google Meet links (slice 5), reminders
(slice 6).
