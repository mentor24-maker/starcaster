#!/usr/bin/env node
/**
 * review_gate — the merge gate the repository enforces, run as a status check.
 *
 * WHY (2026-08-25, task 86bbmfbkv): PR #432 reached production with no review
 * verdict on its ticket, merged by an ordinary Claude Code session that had no
 * way to know a review lane was waiting for it. "Loops never merge" only binds
 * actors that know they are loops. This is the version of that rule a fresh
 * session cannot walk past.
 *
 * All the judgement lives in scripts/builder/reviewGate.js, as pure functions
 * over data. This file is only the plumbing that fetches that data, prints the
 * answer where GitHub will show it, and announces a waiver on the bus.
 *
 *   node scripts/review_gate.mjs --pr <number> [--repo owner/name]
 *
 * Needs `gh` (for the PR) and CLICKUP_API_TOKEN (for the ticket). Without the
 * ClickUp token the answer is CANNOT TELL — never a pass.
 *
 * Every message this file prints begins with `gate.GATE_LABEL`, never the word
 * REVIEW. That is not cosmetic: `mergeOnComment.isReviewVerdict` reads any line
 * starting with REVIEW as a ticket verdict, so the gate's own output pasted onto
 * a ticket used to register as a send-back nobody wrote (task 86bbmmv7t).
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const gate = require('./builder/reviewGate.js');

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '90141423066';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** GitHub's own annotation form, so a failure is visible on the Files tab. */
function annotate(level, message) {
  const oneLine = String(message).replace(/\r?\n/g, '%0A');
  console.log(`::${level}::${oneLine}`);
}

/** The job summary — the roomy place a person actually reads. */
function summarize(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try { appendFileSync(path, `${markdown}\n`); } catch { /* summaries are a nicety, never a failure */ }
}

function gh(args) {
  const out = spawnSync('gh', args, { encoding: 'utf8' });
  if (out.error) {
    const why = out.error.code === 'ENOENT'
      ? 'the `gh` command is not installed'
      : String(out.error.message);
    return { ok: false, stdout: '', stderr: why };
  }
  return {
    ok: out.status === 0,
    stdout: String(out.stdout || ''),
    stderr: String(out.stderr || '').trim(),
  };
}

/**
 * The ticket's comments, or null if they could not be read. Null and an empty
 * array mean very different things here — "I could not look" versus "I looked
 * and there is nothing" — so the two are never collapsed.
 */
async function readTicketComments(taskId) {
  if (!CLICKUP_TOKEN) {
    return { comments: null, why: 'CLICKUP_API_TOKEN is not set in this job — the CI secret is missing' };
  }
  try {
    const res = await fetch(`https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}/comment`, {
      headers: { Authorization: CLICKUP_TOKEN, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { comments: null, why: `ClickUp answered HTTP ${res.status}` };
    const json = await res.json();
    if (!Array.isArray(json?.comments)) return { comments: null, why: 'ClickUp returned no comment list' };
    return { comments: json.comments, why: '' };
  } catch (err) {
    return { comments: null, why: `ClickUp is unreachable: ${err?.message || err}` };
  }
}

/** Announce an override. Returns ok/why so a failure is reported, not assumed. */
async function announceWaiver(content) {
  if (!CLICKUP_TOKEN) return { ok: false, why: 'no ClickUp token in this job' };
  try {
    const res = await fetch(
      `https://api.clickup.com/api/v3/workspaces/${WORKSPACE}/chat/channels/${BUS_CHANNEL}/messages`,
      {
        method: 'POST',
        headers: { Authorization: CLICKUP_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'message', content, content_format: 'text/md' }),
      },
    );
    return { ok: res.ok, why: res.ok ? '' : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, why: String(err?.message || err) };
  }
}

async function main() {
  const prNumber = arg('pr', process.env.PR_NUMBER || '');
  const repo = arg('repo', process.env.GITHUB_REPOSITORY || '');
  const enforcing = gate.isEnforcing(process.env.REVIEW_GATE_ENFORCING);

  if (!prNumber) {
    console.error('review_gate: no PR number. Pass --pr <number> or set PR_NUMBER.');
    process.exit(2);
  }

  const view = gh([
    'pr', 'view', String(prNumber),
    ...(repo ? ['--repo', repo] : []),
    '--json', 'body,number,url,commits',
  ]);
  if (!view.ok) {
    // Cannot read the PR at all. Same rule as an unreachable ClickUp: this is
    // a CANNOT TELL, and it is never a pass.
    const message = `${gate.GATE_LABEL} CANNOT TELL — could not read PR #${prNumber} from GitHub: ${view.stderr || 'unknown error'}`;
    console.error(message);
    annotate('error', message);
    summarize(`### Review gate\n\n\`\`\`\n${message}\n\`\`\``);
    process.exit(gate.exitCodeFor(gate.CANNOT_TELL, enforcing));
  }

  const pr = JSON.parse(view.stdout);

  // The freshness rule needs to know which commits are catch-up MERGES, and
  // `gh pr view --json commits` does not report parents. The REST commit list
  // does, so it is the source of truth here; `gh pr view`'s list is the
  // fallback, where every commit counts (the strictest reading) rather than
  // the rule silently going away.
  // `:owner/:repo` is gh's own placeholder for "the repo I am in", which is
  // correct under actions/checkout; an explicit --repo wins when given.
  const slug = repo || ':owner/:repo';
  const commitsApi = gh([
    'api', `repos/${slug}/pulls/${prNumber}/commits`,
    '--paginate',
    '-q', '.[] | {committedDate: .commit.committer.date, parents: (.parents|length)}',
  ]);

  let commits;
  if (commitsApi.ok && commitsApi.stdout.trim()) {
    commits = commitsApi.stdout.trim().split('\n').map((line) => JSON.parse(line));
  } else {
    // No parent information available — treat every commit as its own work.
    commits = (pr.commits || []).map((c) => ({
      committedDate: c.committedDate || c.authoredDate,
      parents: 1,
    }));
    if (!commitsApi.ok) {
      annotate('warning', `review-gate: could not read commit parents (${commitsApi.stderr || 'unknown'}); catch-up merges will count against freshness.`);
    }
  }

  const headCommittedAt = gate.newestSubstantiveCommitAt(commits);

  const ticketId = gate.findTicketId(pr.body);
  const waiver = gate.findWaiver(pr.body);

  // Only fetch the ticket when the answer could depend on it: a waived PR and
  // a PR with no ticket link are both decided from the body alone.
  let comments = null;
  let clickupError = '';
  if (ticketId && !waiver) {
    const read = await readTicketComments(ticketId);
    comments = read.comments;
    clickupError = read.why;
  }

  const decision = gate.reviewGateDecision({
    prBody: pr.body,
    // Which PR this is, so the gate can confirm the ticket the body points at
    // is actually this PR's own rather than a related one cited above it
    // (task 86bbmmv7t, finding 1). Without it the answer is CANNOT TELL.
    prNumber: pr.number,
    headCommittedAt,
    comments,
    clickupError,
  });

  const message = gate.gateMessage(decision, { prNumber: pr.number });
  const passing = gate.allowsMerge(decision.verdict);

  if (decision.verdict === gate.WAIVED) {
    const announced = await announceWaiver(gate.waiverAnnouncement({
      prNumber: pr.number,
      prUrl: pr.url,
      reason: decision.waiverReason,
      actor: process.env.GITHUB_ACTOR || '',
    }));
    if (!announced.ok) {
      // A waiver that could not be announced is an override nobody can see —
      // the exact hole the announcement exists to close. Say so loudly; do
      // not fail the gate over it, because the PR itself is not the problem.
      annotate('warning', `Review gate waiver could NOT be announced on the bus (${announced.why}). Say it on the party line by hand: PR #${pr.number} waived — ${decision.waiverReason}`);
    }
  }

  console.log(message);
  annotate(passing ? 'notice' : (enforcing ? 'error' : 'warning'), message);

  const modeNote = enforcing
    ? '**Enforcing** — this check blocks the merge.'
    : '**Advisory** — this check does not block a merge yet. It goes live when the branch-protection box is ticked and the repository variable `REVIEW_GATE_ENFORCING` is set to `true` (see `docs/LOOP_ENGINEERING.md`).';
  summarize([
    '### Review gate',
    '',
    modeNote,
    '',
    `**Verdict: ${decision.verdict}**`,
    '',
    '```',
    message,
    '```',
  ].join('\n'));

  if (!passing && !enforcing) {
    console.log('\n(Advisory mode: exiting 0 so this does not block anything yet.)');
  }
  process.exit(gate.exitCodeFor(decision.verdict, enforcing));
}

main().catch((err) => {
  // An unexpected crash is a CANNOT TELL too. It must never read as a pass.
  const message = `${gate.GATE_LABEL} CANNOT TELL — the gate itself crashed: ${err?.stack || err}`;
  console.error(message);
  annotate('error', message);
  process.exit(gate.exitCodeFor(gate.CANNOT_TELL, gate.isEnforcing(process.env.REVIEW_GATE_ENFORCING)));
});
