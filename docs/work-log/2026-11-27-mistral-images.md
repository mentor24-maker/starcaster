## 2026-11-27 — Let the AI door send images to Mistral once its picture format is checked (#1114)

When a feature asked the AI door about a picture, Mistral was always skipped,
because nobody had checked how Mistral wants pictures sent. Mistral's own
documentation now settles it. Mistral wants the picture's address written as
plain text, where OpenAI wraps it in one more layer. The door now sends Mistral
pictures that way. It sends JPEG, PNG and WEBP, either as the file itself or as
a web address.

GIFs are left out on purpose. Mistral accepts only GIFs that don't move, and
the door can't tell which kind it has. A moving GIF would make Mistral refuse
the whole request, and the call would stop there instead of going on to the
next service. PDFs are still not sent to Mistral either, because Mistral reads
documents through a separate service. Nothing changes for any other AI
service. What the docs said, and the date they were read, is written beside
Mistral's entry in the code.
