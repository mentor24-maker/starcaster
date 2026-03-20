---
name: bluesky-channel-posting-operator
description: Execute a Bluesky reply safely using an approved candidate and a verified target post. Use when discovery and reply generation are complete and the final step is dry-run validation or live posting.
---

# Bluesky Channel Posting Operator

Use this skill only after a target post has been selected and a reply has been approved. This skill is the execution layer.

## Inputs

Expect:

- target post URL or at:// URI
- approved reply text
- account or channel identity
- execution mode: `dry_run` or `live_post`
- optional thread-specific constraints

Default to `dry_run` unless live posting is explicitly authorized.

## Outputs

Return a compact JSON object with this shape:

```json
{
  "ok": true,
  "mode": "dry_run",
  "target_url": "https://bsky.app/profile/example/post/abc123",
  "posted": false,
  "remote_id": "",
  "permalink": "",
  "evidence": [],
  "error": ""
}
```

## Workflow

1. Validate the target and reply text.
2. Check session or API auth health.
3. Confirm the target is still available and replyable.
4. In `dry_run`, stop after validation and report readiness.
5. In `live_post`, submit the reply and capture evidence.
6. Return a structured success or failure result.

## Preflight Checks

Before live posting, verify:

- account is authenticated
- target post still exists
- duplicate-post risk is low
- rate-limit risk is acceptable
- the reply does not violate safety or platform constraints

## Safety Rules

- Never invent a success result.
- Never retry blindly in a loop.
- Never switch from `dry_run` to `live_post` without explicit authorization.
- Abort cleanly when validation fails.

## Evidence

When possible, return:

- permalink
- remote id or URI
- timestamp
- short execution log
- screenshot reference if browser automation is used

## Refusal Conditions

Refuse to post when:

- the session is invalid
- the target post is unavailable
- the reply violates safety or channel rules
- execution mode is unclear

## Handoff

This skill is the terminal step for the Bluesky reply workflow.
