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

The second review found three more things, all fixed:

- **A page Claude could not read was reported as read.** Asked for two pages,
  if Claude read one and its reader was refused on the other, the door still
  said "success, both pages read". It now checks every page it asked for
  against what actually came back, and fails naming the page that was not
  read — the same rule the door already applies when it reads pages itself.
- **One way of writing a loopback address got past the safety guard.** An
  address like `[::127.0.0.1]` (the server's own machine, written the IPv6
  way) looked public to the check. Every IPv6 spelling that hides an IPv4
  address is now caught.
- **A correct answer was refused when the shape refers to itself** (a tree,
  say, where each child has the same shape as its parent). The checker now
  follows those references, and one it cannot follow is left unchecked
  rather than failing a good answer.

Three small ones came along: a slow page now says "no answer within 15s"
instead of "the operation was aborted", a description with an apostrophe in
it is no longer cut off, and a page can no longer end its own quoted text
early to slip instructions to the AI. Each fix was broken on purpose and its
test watched to fail.

**Third review round.** When Claude's page reader fails, Anthropic labels the
result `web_fetch_tool_result_error`, but the door was looking for a
different name, so a real failure still counted as "page read" and a made-up
answer could come back as a success. The door now counts a page as read only
when the result says plainly that the page came back; anything else, including
a label it has never seen, is a failure. Four smaller fixes came with it: if
our server is refused a page, the door now passes the job on to a provider
later in the order that reads pages itself instead of giving up; each page has
one 15-second limit in total, rather than 15 seconds per redirect; a failed
page read no longer blames a provider that was never asked, and keeps the
pages it did read; and the "now using another provider" message is only sent
once the pages are known to have been read.
