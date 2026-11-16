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
