## 2026-11-17 — Site Import turns a list of icon-beside-text rows into a row of tall cards: Bayside's Services came out as four squeezed cards (#1036)

Bayside Partners' Services section is a simple list: four rows, each a small
round icon with a heading and a paragraph beside it. When we imported the site,
the importer saw the same pattern four times (picture, heading, words) and
guessed "a row of feature cards". So the live page showed four tall, narrow
cards side by side, with huge icons and the text squeezed into a strip.

The guess never looked at where the blocks actually sat. A real row of cards
always has cards next to each other on the same line. Now, if every block sits
underneath the one before it, the importer treats it as a list instead: each
entry becomes its own two-column row, icon on the left at its real size and the
words on the right, all on the same background as the Services heading. Sites
whose cards really are side by side (Alphire, Strands, Blaze Fish) import
exactly as before. Bayside's page will show the fix the next time it is
re-imported.
