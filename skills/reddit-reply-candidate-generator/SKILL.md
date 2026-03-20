---
name: reddit-reply-candidate-generator
description: Generate multiple safe, context-aware Reddit reply options for a selected post or comment. Use when a target Reddit thread has already been chosen and the next step is to draft candidate replies for review.
---

# Reddit Reply Candidate Generator

Use this skill after a Reddit thread or comment has already been selected. Do not post directly from this skill.

## Inputs

Expect:

- target post URL or comment URL
- target text
- thread title
- subreddit
- campaign or category context
- optional tone or style constraints
- optional banned phrases or safety constraints
- optional previously used replies to avoid repetition

If the thread context is thin, request or derive enough context before generating.

## Outputs

Return a compact JSON object with this shape:

```json
{
  "replies": [
    {
      "text": "Candidate reply",
      "tone": "curious",
      "why": "Short explanation",
      "risk_flags": []
    }
  ],
  "assumptions": [],
  "errors": []
}
```

Generate 3 to 5 distinct replies.

## Workflow

1. Read the target post and nearby context.
2. Identify what kind of reply would be helpful:
   - answer
   - clarification
   - thoughtful agreement
   - respectful disagreement
   - follow-up question
3. Generate several distinct candidates.
4. Validate each candidate before returning it.

## Validation Rules

Reject any candidate that is:

- generic or obviously templated
- too promotional
- repetitive with prior replies
- hostile, combative, or baiting unless explicitly requested
- malformed, markdown-heavy, or artifact-ridden
- too short to be meaningful

Return plain text only.

## Safety Rules

- No spam, fake familiarity, or manipulative engagement bait.
- No unverifiable claims stated as fact.
- No calls to action unless explicitly permitted.
- Avoid replies that make the account sound automated.

## Style Guidance

- Sound like a thoughtful participant, not a marketer.
- Match the tone of the thread without mirroring toxicity.
- Prefer specificity over slogans.
- If uncertain, choose calm, useful, low-ego phrasing.

## Refusal Conditions

Return no candidates when:

- the target content is too risky to engage
- the requested tone would violate safety rules
- there is not enough context to produce a responsible reply

## Handoff

This skill hands off one approved reply to `reddit-channel-posting-operator`.
