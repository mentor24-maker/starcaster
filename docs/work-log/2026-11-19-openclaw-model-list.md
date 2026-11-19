## 2026-11-19 — OpenClaw on the Mini can only use Anthropic, so outreach posting stops whenever that one key runs dry: let it use any working AI key (#1068)

OpenClaw is the program on the Mini that signs in and posts for outreach. Its installer told it to use one Anthropic model and copied the Anthropic key once. When that key ran out of credit on November 18, outreach stopped, and the fix that day was typed by hand on the Mini, where nothing in the code knew about it.

Now one small file in the code lists the AI OpenClaw uses, in order: OpenAI first, Anthropic as the backup. The installer writes that list into OpenClaw's settings and copies every key it needs fresh from Doppler each time it runs. So a rebuilt Mini comes back the same, and a key changed in Doppler reaches OpenClaw on the next run. If Doppler cannot supply a key, the installer stops, says which key, and changes nothing. Running it twice changes nothing the second time. Its status report now names the order and each key, never a key's value.

Still to do on the Mini: run the installer once for real, and prove the backup takes over when a key runs out of credit. OpenClaw's own manual says it does. This pass was not allowed to restart the live program or copy the keys to test it.
