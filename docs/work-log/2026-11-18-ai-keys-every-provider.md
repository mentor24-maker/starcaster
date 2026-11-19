## 2026-11-18 — Check every provider on the switch, Kimi included (AI switch 6) (#1056)

The AI keys check — `npm run ai-keys` on the Mini, and the AI keys panel on
Settings › APIs — used to look at three AI companies only. Now that the
website can switch between providers, the check follows the switch: every
provider in the order it is tried, Kimi and any added service included, with
switched-off ones listed and marked.

The alarm got smarter too. One company running out of credit while another
still answers is now a plain notice that says where the calls went
("Anthropic is out of credit; calls are using OpenAI"). Only when *no*
switched-on provider can answer does it raise an `ALARM:` — the kind that
texts Dane — because that is the moment every AI feature stops.

Its first real run found exactly that first case live: Anthropic's account
is out of credit, and the website's AI calls are being answered by OpenAI.
