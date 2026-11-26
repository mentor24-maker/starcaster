## 2026-11-25 — Let the AI door read images and PDFs so the Theme Wizard and flyer upload keep working when Anthropic is out of credit (#1106)

Every AI question is meant to go through one "door", which tries the AI
companies in the order set on Settings › APIs and moves on when one is out of
credit. The door could only send words, so the features that show the AI a
picture or a PDF (the flyer upload, the Would You Rather import, the Theme
Wizard's logo) still called one company directly, and stopped whenever that
company ran out of credit.

Now the door can send a picture or a PDF with the question, wrapped the way
each company wants it. A company that cannot read that kind of file is skipped
with a plain reason, such as "Kimi cannot read PDFs", and the next one is
asked. If none can, the error lists each one and why. Questions with only
words are sent exactly as before.

Nothing uses this yet, so no screen changed. The next tickets move the flyer
upload and the Would You Rather import (SC-896) and the Theme Wizard (SC-897,
SC-898) onto it.

**Fixed after review:** if one company could not read the PDF and another
was really out of credit in the same call, the bus message called both of
them "out of credit" — wrong about the first, and it also silenced a genuine
outage of the first for six hours. Now only a real credit or key problem is
ever announced, and a test sends exactly that mix to prove it.
