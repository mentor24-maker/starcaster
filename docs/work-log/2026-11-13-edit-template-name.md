## 2026-11-13 — Add the ability to edit template name (#1011)

**Save as Template asks what to call it.** In the Builder, pressing Save as
Template on a page used to make a template called "‹page name› Template"
without saying so. Now a small box pops up with that name already filled in
and highlighted, so you can type a better one, or press Cancel and nothing is
made. A blank name is refused with a plain message.

**Renaming a template.** On a local copy, renaming a saved template in
Template Details already stuck: the new name was still there after a reload.
Two things made it feel broken, and both are fixed. First, the green Save
Template button sits far from the name box, so pressing Enter after typing a
name now saves too. Second, the built-in "Standard Right-Form" template is
not stored in the database at all, so any name typed into it could never be
saved. Its box is now locked, with a line underneath explaining why.

Nothing on any client's public site changes. These are Builder admin screens
only.

**Second round (after review).** The reviewer found the real reason a rename
looked like it didn't work: the Templates screen shows the templates twice —
the "Saved Page Templates" table at the top, drawn by the older admin code, and
the newer Template Details editor below it. Saving a new name worked, but only
the editor refreshed; the table above kept the old name until the whole browser
page was reloaded. Now the editor sends a "templates changed" signal after
every save, create and delete, and the table re-draws itself when it hears it.
Checked on a local copy: renamed a template and the table showed the new name
straight away, no reload.
