## 2026-11-26 — Move the Theme Wizard onto the AI door so it keeps working when Anthropic is out of credit (#1111)

The Theme Wizard was the last feature still calling an AI company by hand. It
talked straight to Anthropic and asked for one model, Claude Fable, by name.
When Anthropic's credit ran out (it did from 2026-10-30), the wizard simply
stopped, even though OpenAI was paid for and first in line.

Now every step of the wizard (reading a website, looking at a logo, choosing
three directions, designing each theme) goes through the AI door, the one
route every other AI feature already uses. Dane chose option B: the designs
come from whichever provider is first on Settings › APIs › AI provider, and if
that one cannot pay, the next one answers. Both Anthropic and OpenAI were run
for real and both made working themes.

With this, the door check's waiting list is empty: no part of the app talks to
an AI company except through the door.
