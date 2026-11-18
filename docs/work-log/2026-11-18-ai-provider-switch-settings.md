## 2026-11-18 — Add an AI provider switch to Settings › APIs (AI switch 2) (#1048)

Until now, which AI company StarCaster used was decided by a hidden setting. Changing it meant editing Doppler and redeploying. Settings › APIs now has an **AI provider** section where an owner or admin can put the providers in order, switch any off, choose each one's fast and strong model, and add another OpenAI-style service. The website and the Mac Mini pick up a change within about a minute, with no redeploy.

Key values never go near this screen. Each provider shows only the *name* of the setting its key lives in, and says plainly when that key is missing ("no key: add MOONSHOT_API_KEY to Doppler production"). A save only reports success after the database has been read back.

If the saved setting is missing or can't be read, everything carries on exactly as it does today, and the screen says which order is in charge and why. Production needs one new table (docs/SQL/ai_provider_settings_setup.sql) before the screen can save there.
