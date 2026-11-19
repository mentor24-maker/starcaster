## 2026-11-19 — Make title and end cards for each video (Reel Spinner 5b) (#1078)

Reel Spinner's videos now have their opening and closing pictures. Each video
gets a title card with its title, and an end card that invites the viewer to
the project it is about: WaveCenter, the DEO movement, Alphire, StarCaster or
Spirality. That invitation is the reason the channel exists.

The wording on the end cards is not written into the code. It sits in a note
on the Dane of Earth project's Context page, called "Reel Spinner — end
cards", one line per project, so Dane can change it without anyone touching
the program. The note was created today with the three web addresses that
were already confirmed (wavecenter.com, alphire.agency, starcaster.pro). The
DEO and Spirality addresses were asked of Dane rather than guessed; he
answered the same afternoon (DEO goes to wavecenter.com, Spirality to
daneofearth.org/spirality), so all five end cards now exist.

A short gets the card for its own moment's project. A full video gets the
project it mentions most. A personal story gets the WaveCenter card. When a
card cannot be made (no note, or no line for that project), the program stops
and says why instead of making a blank card. A long title is wrapped and
shrunk to fit. The finished picture is also measured, and one with text
running off the edge is never saved.

Putting the cards into the videos is the next step (5c).

Review found one real defect before merge: a dollar sign in a video title could
quietly change the words on the title card ("How I made $$$" came out as
"How I made $$"), because of how JavaScript treats "$" when it fills in a
template. The fill-in now passes the text through untouched, and a test proves
titles with "$$", "$&" and "$'" arrive exactly as written.
