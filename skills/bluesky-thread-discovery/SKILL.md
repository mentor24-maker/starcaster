---
name: bluesky-thread-discovery
description: Discover and rank Bluesky posts or threads worth engaging with for a campaign, topic, or account. Use when the task is to find candidate Bluesky conversations before drafting or posting a reply.
---

# Bluesky Thread Discovery

Use this skill when the goal is to find Bluesky conversations worth engaging with. Do not draft replies or post anything from this skill.

## Inputs

Expect some or all of:

- target topic, brand, category, or campaign goal
- handle list or handle hints
- keywords or phrases
- feed or list hints
- start and end date
- sort mode
- minimum like, repost, quote, or reply thresholds
- include or exclude already-engaged posts

If key filters are missing, make conservative assumptions and state them.

## Outputs

Return a compact JSON object with this shape:

```json
{
  "candidates": [
    {
      "post_uri": "at://did:plc:example/app.bsky.feed.post/abc123",
      "post_url": "https://bsky.app/profile/example/post/abc123",
      "author_handle": "example.bsky.social",
      "author_display_name": "Example",
      "text": "Post text",
      "created_at": "",
      "reply_count": 0,
      "like_count": 0,
      "repost_count": 0,
      "quote_count": 0,
      "why_relevant": "Short reason",
      "risk_flags": [],
      "reply_opportunity": "high"
    }
  ],
  "assumptions": [],
  "errors": []
}
```

Return only the strongest candidates. Prefer quality over volume.

## Workflow

1. Resolve the discovery scope.
2. Gather candidate posts using the safest available method.
3. Exclude bad targets before ranking:
   - deleted or unavailable posts
   - low-context or low-signal posts
   - posts already engaged by the managed account
   - obvious reputation-risk or pile-on situations unless explicitly requested
4. Score remaining candidates by:
   - topical relevance
   - freshness
   - engagement level
   - presence of good reply opportunities
   - account and brand safety
5. Return a short ranked list with reasons.

## Safety Rules

- Never post or draft a final reply.
- Never recommend brigading, dogpiling, or spam behavior.
- Avoid high-conflict posts unless explicitly requested.
- Prefer threads where a thoughtful, context-aware reply would add value.

## Data Sources

Prefer official API-based retrieval when available and sufficient. Use OpenClaw browser workflows only when the API path is missing context or blocked.

## Refusal Conditions

Return no candidates and explain why when:

- the requested behavior would be spammy or manipulative
- no relevant posts meet safety thresholds
- the inputs are too vague to discover responsibly

## Handoff

This skill hands off selected post candidates to `bluesky-reply-candidate-generator`.
