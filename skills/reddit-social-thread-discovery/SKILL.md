---
name: reddit-social-thread-discovery
description: Discover and rank Reddit threads or comments worth engaging with for a campaign or topic. Use when the task is to find candidate subreddits, posts, or comment threads before drafting or posting a reply.
---

# Reddit Social Thread Discovery

Use this skill when the goal is to find Reddit conversations worth engaging with. Do not draft replies or post anything from this skill.

## Inputs

Expect some or all of:

- target topic, brand, category, or campaign goal
- subreddit list or subreddit hints
- keywords or phrases
- start and end date
- sort mode
- minimum score or minimum comment count
- include or exclude NSFW
- include or exclude already-engaged threads

If key filters are missing, make conservative assumptions and state them.

## Outputs

Return a compact JSON object with this shape:

```json
{
  "candidates": [
    {
      "subreddit": "example",
      "post_url": "https://reddit.com/...",
      "post_id": "abc123",
      "title": "Post title",
      "author": "user123",
      "score": 42,
      "comment_count": 18,
      "created_utc": 0,
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
2. Gather candidate subreddits or posts using the safest available method.
3. Exclude bad targets before ranking:
   - locked or archived posts
   - NSFW content unless explicitly allowed
   - threads already engaged by the managed account
   - low-context or low-signal posts
4. Score remaining candidates by:
   - topical relevance
   - freshness
   - engagement level
   - presence of good reply opportunities
   - account and brand safety
5. Return a short ranked list with reasons.

## Safety Rules

- Never post or draft a final reply.
- Never recommend brigading, vote manipulation, or spam behavior.
- Avoid subreddits or threads with obvious policy or reputation risk unless explicitly requested.
- Prefer threads where a thoughtful, context-aware reply would add value.

## Data Sources

Prefer official API-based retrieval when available and sufficient. Use OpenClaw browser workflows only when the API path is missing context or blocked.

## Refusal Conditions

Return no candidates and explain why when:

- the requested behavior would be spammy or manipulative
- no relevant threads meet safety thresholds
- the inputs are too vague to discover responsibly

## Handoff

This skill hands off selected thread candidates to `reddit-reply-candidate-generator`.
