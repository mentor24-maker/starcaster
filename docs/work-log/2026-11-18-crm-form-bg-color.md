## 2026-11-18 — Fix CRM Background color (#1052)

On CRM › Edit Form, the Background Color setting looked like it had no
control at all. It did: the colour picker was there, opened, and saved. But
its button was a white square with an almost invisible outline, sitting on a
white page — so with a white background (the default, and Bayside's), there
was nothing to see or click.

Every colour square on that screen now has a clear outline, and shows the
colour the way the form will: a half-see-through colour looks half
see-through, and "no background" shows a grey-and-white checkerboard instead
of plain white.

While in there, one quiet trap was closed: an opacity of exactly 0 could be
read as "nothing was set" and turned back into 100% solid. Now 0 stays 0, on
the editor and on the live site. Forms nobody has touched look exactly as they
did. Bayside's form is unchanged; its colour is Dane's to pick.
