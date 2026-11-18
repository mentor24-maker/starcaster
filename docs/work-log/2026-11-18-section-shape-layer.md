## 2026-11-18 — Section backgrounds can't have a curve or wave shape over the photo, so imported Divi and Elementor sections lose theirs (Bayside's Contact) (#1042)

**What was wrong.** On Bayside's original site, the Contact Us band has a big
white curve laid over the city photo. The address sits on the white and the
photo shows on the right. Divi draws that curve as a "background mask". A
StarCaster section had nowhere to keep a shape like that, so the import threw
it away, and the address ended up sitting right on top of the photo.

**What changed.**

- **Sections can have a shape now.** In a section's settings, a new **Shape**
  group sits beside Overlay. You pick Curve, Wave or Slant, which side it grows
  from (left, right, top or bottom), a colour and an opacity. It is drawn over
  the background photo and any tint, and under the text. A section with no
  shape saves and looks exactly the same as before.
- **The importer keeps the shape.** When the original page has a mask that
  covers a whole band, the import reads its outline, picks the closest of the
  three shapes, and copies its colour and strength. Bayside's comes through as
  a white curve at 71%. The import report lists each shape it carried over.
  It also names each one it couldn't match, and why (for example "it is a
  divider along an edge, and only full-band shapes are matched").
- **The capture now records flips.** Divi draws Bayside's curve on the right
  and then mirrors it to the left. Until now the capture never wrote mirrors
  down, so the importer couldn't tell which side the curve was really on. It
  records them now.
- **A browser test checks the shape is really drawn.** It looks at the
  screen's pixels: white near the chosen edge, the background still showing on
  the other side.

**Still to do.** Bayside's live page only shows the curve after it is
imported
again with a fresh capture, because the capture it was built from never
recorded the flip. Divider strips along a band's top or bottom edge, and
Elementor shapes whose colour comes from the site's stylesheet, are named in
the report but not carried over yet.
