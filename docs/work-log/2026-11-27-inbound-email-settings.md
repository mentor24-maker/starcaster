## 2026-11-27 — Add a settings screen for which email addresses a project receives and where each one forwards (#1117)

Each project's settings page now has an **Email** card. It lists every address
on the project's domain that StarCaster receives mail for, where each one
forwards, whether it is switched on, and what arrived recently: who sent it,
the subject, and whether it was forwarded or, if not, why. Addresses can be
added, changed, switched off and deleted right there. Until now the only way
to set one up (admin@alphire.agency was the first) was an agent session
writing to the database.

Two rules keep it safe. An address has to be on a domain the project owns,
and one project can never see or change another project's addresses. A test
tries every read and write from the wrong project to prove it.

One behaviour changed on purpose. Mail sent to a switched-off address used
to be logged as "no route", which looked the same as an address nobody had
set up. It is now logged as "refused: the route is switched off", under that
project, so the card can show it.
