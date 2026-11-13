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
