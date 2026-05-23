# TikTok (IZZIT) Pilot & Related Work — Conversation Summary

**Date:** 2026-05-20  
**Thread focus:** TikTok integration planning for ISITAS/ISIT Game, Settings UI fixes, TikTok domain verification  
**Repository:** `~/WebApps/starcaster`  
**TikTok developer app:** **IZZIT** (branding for ISIT Game)  
**Pilot project:** ISITAS (StarCaster workspace)

---

## 1. Context & Goals

- **X (Twitter)** integration is partially in place but **deferred** — account flagged; not the pilot platform for now.
- **TikTok** is the **pilot platform** for social posting; X will be revisited when access is restored.
- Work targets the **ISITAS** StarCaster project, with TikTok app **IZZIT** on [developers.tiktok.com](https://developers.tiktok.com/).
- Canonical project docs: [`AI_AGENT_HANDOFF.md`](AI_AGENT_HANDOFF.md), [`.cursorrules`](../../.cursorrules).

---

## 2. StarCaster — TikTok Integration Status (Codebase)

### Already present

| Area | Status |
|------|--------|
| **Settings → APIs schema** | `tiktok` in `lib/apiSettings.js` — `client_key`, `client_secret`, `access_token`, `open_id` |
| **Env convention** | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, etc. |
| **Contacts / Acquire** | TikTok URLs as contact fields; Acquire TikTok page is a **placeholder** |
| **Engage: Social** | UI hardcodes `channel: 'x'`; no TikTok publish path |

### Not implemented yet

- `lib/tiktokClient.js` (OAuth 2 + PKCE, token refresh, Content Posting API)
- OAuth routes (`/api/auth/tiktok/start`, `/api/auth/tiktok/callback`)
- `'tiktok'` in `PUBLISH_NOW_CHANNELS` (`routes/engage.js`)
- `publishStoredPost()` branch for TikTok (video upload is async vs text posts)
- Connection Ops platform spec for `tiktok` in `lib/connectionOpsStore.js`
- Engage: Social channel selector (stop defaulting to X only)

### Reference pattern

Mirror **X** (`lib/xClient.js`) + **Bluesky/Meta** auth-test routes in `routes/engage.js`, and Connection Ops gates for X/Facebook/etc.

### Recommended implementation order

1. TikTok OAuth + `tiktokClient` + auth-test endpoint  
2. Engage publish + channel UI + Connection Ops spec  
3. Private smoke post (unaudited apps often **private-only** until TikTok app audit)  
4. TikTok app audit when public posts are required  

### TikTok external setup (operator)

- **Content Posting API** + **Login Kit**; scopes e.g. `video.publish` / `video.upload`  
- **Redirect URI** must match StarCaster callback exactly (prod + local)  
- **Domain / URL verification** required before app save (see §4)  
- Unaudited limits: private posts, user/post caps — see [Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)

---

## 3. Settings: APIs — Channel Connections Table (Done)

**Request:** Show channel name next to icon in Channel column; fix missing LinkedIn icon.

**Root cause (LinkedIn):** `https://cdn.simpleicons.org/linkedin/0a66c2` returns **HTTP 404** (slug removed/blocked on that CDN). Other remote icons (Instagram, etc.) still work.

**Changes made:**

- `public/js/settings.js` — append `channel-connection-label` with `row.label` beside logo; move LinkedIn to `CHANNEL_LOGO_LOCAL`; provider help uses `/images/logos/linkedin.svg`
- `public/images/logos/linkedin.svg` — new local asset
- `src/css/_forms.css` — wider left-aligned Channel column, flex row for icon + label  
- `npm run build` — updates `public/styles.css`

---

## 4. TikTok Domain Verification — Problem & Resolution

### Symptom

TikTok Developer Portal (IZZIT app, Web URL `https://isitgame.org`):

> Your property could not be verified — We couldn't find your verification signature.

### What TikTok expects

**Domain verification:** TXT at apex of the domain in the app config:

```text
tiktok-developers-site-verification=<token from TikTok portal>
```

**URL prefix verification** (alternate mode): download a signature **file** and host at `https://isitgame.org/<filename>` — DNS TXT will not work for that mode.

### DNS findings (during troubleshooting)

| Domain | Nameservers | TikTok TXT visible publicly? |
|--------|-------------|------------------------------|
| **isitgame.org** | Vercel (`ns1.vercel-dns.com`) | **No** (only `google-site-verification` at time of check) |
| **isitas.org** | Hostinger (`dns-parking.com`) | **No** (only SPF); Vercel UI records not authoritative |

Authoritative check:

```bash
dig TXT isitgame.org +short @ns1.vercel-dns.com
```

### Misleading paths (ruled out or secondary)

- **Wrong domain:** TXT on `isitas.org` while TikTok verifies `isitgame.org` — **primary confusion**
- **Wrong Vercel project:** TXT added under **ISITAS** domain/project instead of **isitgame.org**
- **Not propagation alone:** If authoritative Vercel NS does not return the TXT, waiting hours will not help until the record is published on the correct domain zone
- **Registrar:** Namecheap → Custom DNS → Vercel for `isitgame.org` was **correct** once pointed at `isitgame.org`

### Resolution (operator)

TXT record added to the correct domain (**isitgame.org**) in Vercel DNS (not ISITAS / `isitas.org`). Verification succeeded; **IZZIT** app established on TikTok with Client Key and Client Secret available.

### Gate before clicking Verify in TikTok

```bash
dig TXT isitgame.org +short @ns1.vercel-dns.com
```

Must show **both** Google (if present) and `tiktok-developers-site-verification=...` lines.

---

## 5. Brand / Domain Map (Avoid Future Confusion)

| Brand / product | Typical domain | DNS notes |
|-----------------|----------------|-----------|
| **ISITAS** | `isitas.org`, `app.isitas.org` | Often Hostinger NS; StarCaster legal URLs reference `app.isitas.org` |
| **ISIT Game** | `isitgame.org` | Namecheap registrar → **Vercel** nameservers; TikTok IZZIT Web URL |
| **TikTok app name** | **IZZIT** | Tied to ISIT Game / `isitgame.org` for URL verification |

---

## 6. Next Steps (When Resuming Implementation)

1. Save **Client Key** / **Client Secret** in StarCaster Settings → APIs → TikTok (or Vercel env for ISITAS project).
2. Register **redirect URI(s)** in TikTok app matching future StarCaster routes.
3. Implement OAuth + `tiktokClient` + Engage publish (see §2).
4. Connection Ops gates for TikTok (copy X/Facebook pattern).
5. Smoke test: auth check → private test post → plan TikTok app audit for public visibility.

---

## 7. Paste-Ready Prompt for a Follow-Up Thread

```text
Continue TikTok pilot for StarCaster (ISITAS project).

Done:
- IZZIT app on developers.tiktok.com; domain isitgame.org verified
- Client Key + Client Secret available
- X deferred (account flagged)
- Channel Connections table: channel labels + LinkedIn local icon (settings.js)

Implement next:
1. lib/tiktokClient.js — OAuth 2 PKCE, refresh, creator_info, video publish (Content Posting API)
2. routes for /api/auth/tiktok/start and callback; store tokens project-scoped
3. Engage: add tiktok to PUBLISH_NOW_CHANNELS, publish branch, auth-test route
4. engageSocial.js — channel selector, not hardcoded channel: 'x'
5. connectionOpsStore — tiktok platform spec

Read: docs/Markdown Files/TikTok_IZZIT_Integration_Conversation_2026-05-20.md
       docs/Markdown Files/AI_AGENT_HANDOFF.md
```

---

## 8. Key Files Referenced

| File | Relevance |
|------|-----------|
| `lib/apiSettings.js` | TikTok API schema |
| `lib/xClient.js` | Pattern for social client |
| `routes/engage.js` | `PUBLISH_NOW_CHANNELS`, `publishStoredPost` |
| `public/js/engageSocial.js` | Hardcoded `channel: 'x'` |
| `public/js/settings.js` | Channel Connections table, logos |
| `lib/connectionOpsStore.js` | Platform playbooks (no `tiktok` yet) |
| `docs/Markdown Files/AI_AGENT_HANDOFF.md` | Canonical architecture |

---

*Saved from Cursor conversation, 2026-05-20.*
