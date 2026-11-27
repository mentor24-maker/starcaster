## 2026-11-26 — Let the AI door read a web page and hold an answer to an exact JSON shape (#1110)

The AI door is the single place StarCaster's features send AI requests through, so that when one AI company runs out of credit the next one answers. The Theme Wizard still goes straight to Anthropic, because it needs two things the door could not do: read a website before answering, and give its answer in an exact shape. This adds both. The wizard moves onto the door in the next ticket (SC-898).

- **An exact shape.** A feature can now describe exactly what the answer must look like. Claude, OpenAI and Gemini are each told this in their own way. Any other provider is told it in words. The door checks every answer itself, and one that does not fit is refused, naming the part that was wrong.
- **Reading a page.** Claude reads the page itself. For any other provider, our server reads the page and sends along its words. A page that cannot be read stops the request with a clear message. A blank page is never sent as if it had been read.

Because our server now fetches an address it was given, it only fetches public web pages. It refuses anything on a private network, checks again at the moment it connects, checks every redirect, and stops at 2 MB or 15 seconds. Every feature already using the door sends exactly the same requests as before.

**Fixed after review.** When Claude reads a page with its own page reader, it
usually says a sentence first ("I'll read the page first.") and gives its
answer after the page comes back. The door was gluing that sentence onto the
answer, so every request asking for a page *and* a JSON answer failed. It now
takes only what Claude wrote after it finished reading. A new test reproduces
the chatty reply and fails if the fix is removed.
