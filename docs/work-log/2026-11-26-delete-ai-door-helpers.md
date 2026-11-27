## 2026-11-26 — Delete the AI door's unused one-provider helpers from lib/aiClient.js (#1112)

The file every AI call goes through still held three old shortcuts, each wired
to one AI company by name. If that company ran out of credit, anything using
the shortcut simply stopped, which is the exact problem the "door" was built to
fix. Every feature has now moved onto the door, so nothing used them. They are
deleted, so they cannot be picked up again by mistake, and the automatic check
still refuses their names if anyone tries.

The notes were brought up to date too: the file's own description, a comment in
the AI spending meter, and the rulebook (DOCTRINE 5.37), which still said three
features were waiting to move. None are waiting now; the Theme Wizard was the
last, earlier today.

Nothing a client or Dane sees changes.
