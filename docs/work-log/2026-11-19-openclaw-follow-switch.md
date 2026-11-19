## 2026-11-19 — Make OpenClaw follow the AI provider switch on Settings › APIs (OpenClaw keys 3) (#1080)

Dane asked for OpenClaw on the Mini to "point at any active API in the system". Until now the AI provider switch on Settings › APIs steered every AI feature on the website, but OpenClaw, the program on the Mini that does outreach posting, kept using whatever order its installer had written. Changing the switch changed nothing on the Mini.

Now a short check runs every ten minutes on the Mini (it rides the same wake as the other watchdogs). It reads the switch from the live database, using Outreach's own order once that exists (SC-872) and the main order until then. It turns each switched-on provider into the model OpenClaw uses for it (a small committed list: OpenAI, Anthropic and Google Gemini), and if that differs from what OpenClaw is set to, it rewrites OpenClaw's model order and restarts it.

The safety rails:

- **No change, no restart.** If the switch says what OpenClaw already uses, nothing happens.
- **Never mid-task.** If something is talking to OpenClaw at that moment (an outreach pass in progress), the change waits ten minutes for the next check. If it has waited over an hour, the bus hears about it.
- **Nothing silently dropped.** A provider switched on for Outreach that OpenClaw cannot use (no key for it on the Mini, or no OpenClaw model for it, like Kimi today) is left out of the order and named on the bus, and OpenClaw keeps a working order.
- **Can't read it, don't touch it.** If the switch cannot be read, OpenClaw stays exactly as it is and the check says CANNOT TELL; the bus hears of it once it has lasted an hour.

The installer now writes the order the check last applied, so running it again does not quietly undo the switch, and it also copies the Google Gemini key from Doppler when Doppler has one, so switching Outreach to Gemini finds its key already there. Today production has nothing saved on Settings › APIs yet, so the check reports exactly that and leaves OpenClaw on OpenAI first, Anthropic second.
