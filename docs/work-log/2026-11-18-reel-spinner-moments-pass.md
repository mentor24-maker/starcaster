## 2026-11-18 — Score every recording's best moments on the Mac Mini (Reel Spinner 2d) (#1053)

The Mini now picks out each recording's best moments by itself. Once a
recording's "um"s and long pauses have been found, the Studio worker reads the
transcript and Dane's Reel Spinner notes and asks the AI which 20-to-60-second
stretches are worth sharing on their own. It checks every answer against the
rules (each clip starts and ends on a word and never inside an "um") and saves
the result, then reads it back to be sure it stuck.

It asks the AI through the door that picks whichever provider can pay. On the
first real try today Anthropic's account could not pay, so OpenAI answered by
itself. A 14-minute recording took about a minute and came back with ten
moments. An hour of recording costs roughly 9 cents at Anthropic's rates.

If no AI provider can pay at all, the worker does not quietly fail every
recording. It waits an hour, writes nothing, and tells the bus once every six
hours which accounts are empty. Editing the notes does not re-score anything
on its own, because that costs money each time. A rescore happens only when
Dane asks for one.

The 34 recordings that already have their cuts are queued with
`npm run studio:backfill-moments -- --apply` once this is merged.

After review, three things were tightened. A rescore that keeps hitting
temporary AI errors (rate limits, timeouts) now leaves the recording's good
moments alone instead of replacing them with an empty "failed" result. Finding
a recording's cuts again no longer quietly buys a new scoring for a recording
that already has moments, since rescoring is Dane's call. And the catch-up
command now lists a recording whose job is stuck separately, with the reason,
instead of counting it as "waiting".
