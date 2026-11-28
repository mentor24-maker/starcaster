## 2026-11-27 — Email sent to admin@alphire.agency bounces: receive mail for our domains through Resend and forward it to a real inbox (#1116)

StarCaster could send email but never receive it, so anything sent to
admin@alphire.agency (now the contact address on our privacy policies) bounced.
This adds the receiving half: Resend, which already sends our mail, can now hand
us each email that arrives for one of our domains, and StarCaster passes it on
to a real inbox, attachments included, with Reply going back to the person who
wrote.

It only believes calls that carry Resend's signature, so a stranger cannot push
fake mail through it. It remembers every email it has handled, so Resend
re-sending one never makes a duplicate. If passing an email on fails, it says so
on the bus and lets Resend try again instead of losing the email.

This is slice 1 of 3. Nothing receives mail yet: SC-927 points alphire.agency's
mail at Resend, sets the secret and runs the new database file
(`docs/SQL/inbound_email_setup.sql`), and SC-928 adds a screen for choosing
which addresses forward where.
