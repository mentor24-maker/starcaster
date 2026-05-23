# Starcaster Social Posting Foundation

Last updated: 2026-05-22

## Purpose

Starcaster social posting is now moving from a single-platform send button toward a channel-aware publishing system. The core idea is:

- A **Channel** is a platform account, such as `X: Normie765714` or `TikTok: normiepolls`.
- A **Campaign** is the assembled promotion package: copy, CTA, hashtags, media, destination, default URL, and selected channel.
- **Promote: Social** is the execution layer that turns a campaign into a queued or published social post.
- **Buffer** is the current external scheduler for supported social platforms, beginning with X and TikTok.

The current breakthrough is that Starcaster no longer treats "X" as a hardcoded publisher. It reads the campaign channel, recognizes when that platform/account should route through Buffer, and passes the account identity into the Buffer bridge.

## Current End-To-End Flow

1. Channels stores platform account records.
   - Example: channel `X`, user name `Normie765714`.
   - The Campaign UI displays this as `X: Normie765714`.

2. Campaigns stores the selected channel id inside the campaign-v1 content JSON.
   - The selected channel remains a Starcaster channel row id.
   - Campaigns still owns content assembly and channel-specific field rules.
   - The default outbound URL comes from the active project details, not the deprecated global profile page.

3. Promote: Social loads campaigns and channels.
   - Eligible campaigns are currently `ready`, `active`, `complete`, or `scheduled`.
   - When the selected campaign channel is X or TikTok, Engage sends the social post to Starcaster as `channel: "buffer"`.
   - The request includes delivery intent:
     - `starcasterChannelId`
     - `targetPlatform`
     - `targetAccount`

4. The backend stores the post in `engage_social_posts`.
   - For Buffer posts, diagnostics include `bufferTarget`.
   - This gives scheduled retries enough context to resolve the correct external Buffer channel later.

5. The Buffer publisher resolves the target Buffer channel.
   - It lists Buffer channels for the configured organization.
   - It matches `targetPlatform` to Buffer service, for example `x` maps to Buffer `twitter`.
   - It matches `targetAccount` to Buffer `name` or `displayName`.
   - If no specific match is found, it falls back to `BUFFER_DEFAULT_CHANNEL_ID`.

6. Buffer queues the post.
   - `lib/bufferClient.js` uses Buffer GraphQL `createPost` with `schedulingType: "automatic"` and `mode: "addToQueue"`.
   - Buffer returns the external post id, due date, status, channel id, and assets.
   - Starcaster records the remote id and Buffer due date in diagnostics.

## Queue Governor

Buffer's free plan only allows a limited number of queued posts per platform account. Starcaster now includes a capacity guard.

Behavior:

- Before pushing to Buffer, Starcaster queries Buffer scheduled posts for the resolved channel.
- The default queue limit is `10`.
- The limit can be overridden with `BUFFER_QUEUE_LIMIT`.
- If Buffer has room, Starcaster pushes the post to Buffer.
- If Buffer is full, Starcaster keeps the post in its own queue instead of marking it failed.
- Held posts are scheduled for retry 15 minutes later.
- The existing publish-due path retries held posts, giving Starcaster a push-pull drip mechanism.

This means Starcaster can maintain a deeper internal backlog while Buffer remains the short external execution queue.

## Important Endpoints

- `GET /api/promote/social/buffer/status`
  - Checks Buffer credential presence and authentication.
  - Includes default channel queue status when configured.

- `GET /api/promote/social/buffer/channels`
  - Lists Buffer channels for the configured organization.
  - Used to discover Buffer channel ids and verify account mappings.

- `POST /api/promote/social/posts`
  - Creates Starcaster social posts.
  - With `publishNow: true`, supported channels publish immediately.
  - With `channel: "buffer"`, the backend uses Buffer and records external queue diagnostics.

- `POST /api/promote/social/posts/publish-due`
  - Publishes due Starcaster posts.
  - Production cron calls this endpoint.
  - Also handles retrying posts held because Buffer was previously full.

## Key Files

- `lib/projectsStore.js`
  - Project-level default URL and timezone persistence.

- `public/js/campaigns.js`
  - Campaign channel labels and channel-specific campaign field rules.
  - Campaign preview URL resolution from the active project.

- `public/js/promoteSocial.js`
  - Campaign-to-social-post assembly.
  - Maps selected campaign channel to Buffer delivery intent.
  - Uses the active project default URL as the fallback share URL.

- `routes/engage.js`
  - Social post API routes.
  - Buffer target resolution.
  - Queue-full handling and retry scheduling.

- `lib/bufferClient.js`
  - Buffer GraphQL client.
  - Auth checks, channel listing, queue status, and create-post mutation.

- `lib/promoteSocialStore.js`
  - Starcaster social queue persistence.
  - Stores diagnostics so queued retries retain delivery intent.

## Current Limitations

- The Promote social composer still builds tweet-style text and enforces the X character limit.
- TikTok routing through Buffer is structurally ready, but content assembly rules for TikTok-specific media/caption requirements still need product work.
- Queue-full retry delay is a fixed 15 minutes.
- Buffer queue capacity is read per target channel at publish time, not continuously mirrored in a separate local table.
- Account matching currently uses Buffer `service`, `name`, and `displayName`; richer mapping may eventually belong on the Starcaster Channel record.
- Existing projects need their Project Details default URL set before campaign links are fully project-scoped.

## Near-Term Roadmap

1. Add a visible queue/capacity panel in Promote: Social.
   - Show Starcaster backlog.
   - Show Buffer count per connected account.
   - Show waiting-for-capacity status.

2. Add explicit Channel delivery settings.
   - Publisher: direct, Buffer, future providers.
   - External channel id override.
   - Platform capability flags.

3. Build platform-specific campaign outputs.
   - X copy.
   - TikTok caption/media requirements.
   - LinkedIn, Bluesky, Threads, Instagram, and YouTube variants.

4. Improve drip scheduling.
   - Retry based on Buffer queue due times when available.
   - Per-channel pacing rules.
   - Backoff when external APIs fail.

5. Add observability.
   - Queue health dashboard.
   - Last successful push per channel.
   - External queue fullness trend.
   - Failure taxonomy for auth, media, validation, and capacity.
