## 2026-11-26 — Move the flyer upload onto the AI door so it keeps working when Anthropic is out of credit (#1108)

Uploading Delray's weekly program flyer to turn it into events used to talk to Anthropic directly. So when Anthropic's credit ran out, no flyer could be read, even though OpenAI was paid for and first in line on Settings › APIs. Now the flyer goes through the AI door, the one place every AI request is meant to pass through. The door sends it to the first provider that can read a PDF or picture and has credit. If none can, the upload names each provider it tried and why, instead of blaming a missing Anthropic key.

The Would You Rather import's image reader moved the same way. It had been using Gemini alone, with a model Google has retired. Both are off the door check's waiting list now, so the Theme Wizard is the only feature still calling an AI provider directly.
