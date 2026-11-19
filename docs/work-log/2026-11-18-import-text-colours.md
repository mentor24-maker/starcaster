## 2026-11-18 — Imported text loses its own colours and weights: Bayside's Contact headings turned blue and its LinkedIn link stopped looking like a link (#1050)

On Bayside's live site the Contact headings were blue, the LinkedIn link looked like
plain grey text, and some headings were heavier than on the original. The cause was
not the colour rules. Every page the import created was left with **no theme chosen**.
A StarCaster page takes its text colours, fonts and heading weights only from a theme
it names, so these pages fell back to the app's built-in blue and grey.

Now the import picks its theme first and names it on every page it writes. A page
somebody pointed at a different theme on purpose is left alone. The import also does
four smaller things better:

- it takes the site's link colour from links inside its text, not from its menu;
- it keeps a heading's or paragraph's own colour when that colour is readable;
- links take the colour of the text around them when they matched it on the original;
- medium-weight text keeps its weight even when it had no tag around it.

The difference report used to assume a page with no theme still got the theme's
text settings, which is why it never caught this. It now judges pages the way the
live site paints them. On Bayside, measured from the real capture, text-styling
differences drop from 19 to 5.

Bayside's live pages themselves are unchanged until they are rebuilt. That rebuild
is Dane's decision, because it will also make his theme edits from 2026-11-17 show
for the first time.
