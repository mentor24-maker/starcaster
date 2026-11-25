## 2026-11-24 — Add Booking Manager admin panel for availability, messaging and bookings (#1097)

The booking calendar now has its admin screen, the Booking Manager. On it the
site owner sets when people can book (opening hours per weekday, more than one
time range a day, days off, and single blocked dates like holidays), how long a
meeting is and how much gap to leave between meetings, how much notice they need
and how far ahead people may book, and the wording visitors will see, including
the wording of the confirmation and reminder emails that later updates will
send. Below that is the list of bookings: each one can be cancelled, which frees
the time again, and each one links straight to that visitor's contact in the
CRM. When a list is empty it says why, so an empty screen never looks broken.

Every project with the CRM switched on now gets a Booking Manager page in its
admin area, with a menu link to it. Visitors cannot book yet; that is the next
slice (SC-911).
