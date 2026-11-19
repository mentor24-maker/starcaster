## 2026-11-15 — Write every StarCaster form field label in Title Case (#1019)

The labels beside form fields — on the admin screens and in the Builder's
settings panels — were written two ways. Most said "Form Name" or "Background
Color", but plenty said "Theme name", "Icon size" or "Link underline". Dane
picked Title Case for both StarCaster and Spirality, so every field label now
capitalises each word except small ones like "a", "of" and "the".

About two hundred labels across fifty files changed. Nothing else did: only
the words on the screen, never what a field does.

So it does not drift back, the standard test run now reads every field label
in the code (about 1,560 of them) and fails if one is not Title Case, naming
the file, the line and the word. It knows the exceptions: a label that is a
full sentence, units like "px", names like "YouTube", and the choices inside a
dropdown, which are not labels.

One honest gap: a few screens build their labels from lists the check cannot
read. The Themes screen was one of them; it was found by opening it in a
browser and fixed by hand.

**After review sent it back:** the check was blind to three ways labels are
written, and about seventy sentence-case labels were hiding there — a label
whose words sit in a `<span>` (the Headline Rotator's "Font size (px)"), the
old Builder's field lists in plain JavaScript ("Posts per page"), and a label
picked by a condition ("Their Note, pasted" next to its already-fixed twin).
The check now reads all three, each was proved by switching it off and
watching the test fail, and every label it found is fixed. Error messages that
quote a label ("Most Actions per Day must be…") and the Theme Wizard's colour
names were brought in line by hand. What the check still cannot see is listed
in UI_RULES L10, so nobody mistakes a green run for full coverage.

**Second send-back.** Review found five checkbox captions that had been given
a full stop so the check would treat them as sentences and let them through.
They are now short Title Case captions ("Replace Existing Titles", "Never
Comment Twice on a Video"), with the explanation moved into the help text
under them, and the check now refuses a full stop on any checkbox caption.
The check also learned to read four more shapes it used to skip quietly (a
caption beside a required-field star, a label holding an apostrophe, HTML
comments, and components whose `label` is not a field), and the page names in
the Builder › Pages delete warning and the broken-links ticket now match what
each panel shows ("Blog Manager Page", "Redirect Path").

**Third send-back.** One checkbox still had a whole sentence for its caption —
the Publish box in the dialog for saving a shared section. The check missed it
because it stopped reading the checkbox's tag at the first `>`, and the `=>`
inside the box's click handler came first. It now reads each `<input>` tag
whole, a test with exactly that shape proves it, and the box says "Publish the
Rewritten Pages" with the explanation as help text underneath. Second, the
Builder › Pages delete warning used one name per setting, but the same setting
is called different things in different modules' panels ("Results Page" on
Site Search, "Target Page" on Blog Post Tags). It now uses each module's own
name, and a new test reads every module's panel and fails if the two ever
drift apart again.
