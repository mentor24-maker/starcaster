'use strict';

/**
 * The weekly report, minus the writing.
 *
 * WHY THIS EXISTS (task 86bbkw1mn). The first edition, on 2026-08-24, was
 * assembled by hand and took most of an afternoon. Every FIGURE in it came out
 * of a command — merges, diffstat, test counts, CI durations, ticket stages —
 * so the gathering was always scriptable. The writing was not: the ranked five,
 * the plain-language summaries and the incident write-ups are judgement, and a
 * generated paragraph would be worse than no paragraph.
 *
 * So this module draws the line deliberately. It produces a COMPLETE figures
 * page and a machine-readable copy of every number on it, and stops. A person
 * (or an agent in a short pass) writes the narrative on top. Ten minutes of
 * writing instead of an afternoon of gathering.
 *
 * WHAT LIVES HERE vs IN THE SCRIPT. Everything in this file is pure: data in,
 * string or object out, no network, no filesystem, no clock. That is what makes
 * it testable without a fixture server, and it is why `scripts/weekly_report.mjs`
 * is a thin gatherer that shells out and then calls in here.
 *
 * THE HONESTY RULE, which is the whole point of the ticket. A figure the
 * gatherer could not read is rendered as "not available" WITH ITS REASON. It is
 * never omitted and never guessed. A report that silently drops a metric reads
 * as though the metric was fine, which is worse than an obvious gap — the
 * reader cannot tell the difference between "zero" and "we didn't look"
 * (DOCTRINE §3.11: say what you could not check).
 *
 * AND ONLY MERGED WORK COUNTS. The first edition initially credited PR #373 as
 * shipped while it was still open. A subject line in `git log` is not evidence
 * a PR merged; the PR's own state is. `mergedOnly()` is that check, and the
 * tests pin it with a fixture that contains an open PR.
 */

/** Where a PR number turns into something a reader can click. */
function prUrl(repo, number) {
  return `https://github.com/${repo}/pull/${number}`;
}

// ── Figures: the shape that makes "not available" impossible to forget ──────
//
// Every figure is one of these two, never a bare number. A caller that wants
// to print a value has to go past `ok` to reach it, so the failed case cannot
// be skipped by accident — it has to be skipped on purpose.

/** A figure that was read successfully. */
function ok(value, extra = {}) {
  return { ok: true, value, ...extra };
}

/** A figure that could not be read, and why. The reason reaches the page. */
function notAvailable(reason) {
  return { ok: false, value: null, reason: String(reason || 'no reason given') };
}

/**
 * How a figure reads on the page. One place, so the wording cannot drift
 * between the metric tiles and the prose.
 */
function figureText(figure, format = (v) => String(v)) {
  if (!figure || typeof figure !== 'object') return 'not available — the figure is missing entirely';
  if (!figure.ok) return `not available — ${figure.reason}`;
  return format(figure.value);
}

/**
 * Where the machine-readable copy of a report goes, given the page's path.
 *
 * `path.replace(/\.html$/, '.data.json')` looks equivalent and is not: given
 * `--out notes.txt` it changes nothing, both files get the SAME path, and the
 * HTML written second silently destroys the JSON written first. Every figure
 * on the page is supposed to be traceable to that JSON (acceptance criterion
 * 2), so losing it quietly is the worst available outcome.
 *
 * The suffix is therefore always ADDED, and only a real `.html` is taken off
 * first. The answer can never equal the input.
 */
function dataPathFor(htmlPath) {
  const p = String(htmlPath == null ? '' : htmlPath);
  return `${p.replace(/\.html?$/i, '')}.data.json`;
}

/**
 * What the merges tile has to admit underneath its number.
 *
 * A count of merges is only honest if the reader can tell it apart from a
 * count of merges WE MANAGED TO CHECK. Those two were the same number until
 * GitHub could not vouch for 41 of the 43 merges in the week of 2026-08-04 and
 * the page printed a confident "2". So anything the gatherer could not confirm
 * is said out loud, next to the figure, rather than living only in the JSON.
 */
function mergesNote(figure) {
  if (!figure || figure.ok !== true) return null;
  const parts = [];
  const unconfirmed = Number(figure.couldNotConfirm || 0);
  const notMerged = Number(figure.notCountedBecauseNotMerged || 0);
  if (unconfirmed > 0) {
    parts.push(`${unconfirmed} more could not be confirmed with GitHub and are NOT in this count`);
  }
  if (notMerged > 0) parts.push(`${notMerged} not merged`);
  return parts.length ? parts.join('; ') : null;
}

// ── Only merged work counts ────────────────────────────────────────────────

/**
 * Keep only the pull requests GitHub says are MERGED.
 *
 * Deliberately strict: anything whose state is missing, misspelled or
 * unreadable is dropped rather than assumed shipped. Over-reporting is the
 * failure that actually happened; under-reporting one PR is visible and
 * harmless by comparison.
 */
function mergedOnly(prs) {
  if (!Array.isArray(prs)) return [];
  return prs.filter((pr) => pr && String(pr.state || '').toUpperCase() === 'MERGED');
}

/**
 * The `(#123)` GitHub leaves on the end of a squash-merge subject.
 *
 * Returns the number and the subject with the marker removed, or null when the
 * subject carries no PR reference at all — a direct commit to main, which the
 * report should not pretend was a pull request.
 */
function parseMergeSubject(subject) {
  const text = String(subject == null ? '' : subject).trim();
  const m = text.match(/^(.*?)\s*\(#(\d+)\)$/);
  if (!m) return null;
  const title = m[1].trim();
  if (!title) return null;
  return { number: Number(m[2]), title };
}

// ── Which part of the system a merge touched ───────────────────────────────

/**
 * Ordered, first match wins. Order is the whole design here: `lib/builder-client/`
 * has to be tested before `lib/`, and `src/css/` before `src/`, or the broader
 * rule swallows the narrower one and every styling change reads as "the admin
 * app". Adding a rule means deciding where it goes, not just what it matches.
 */
const AREA_RULES = Object.freeze([
  { area: 'The Builder', test: (p) => p.startsWith('components/') || p.startsWith('lib/builder-client/') || p.startsWith('builder-react-entry') },
  { area: 'Styling', test: (p) => p.startsWith('src/css/') || p === 'public/styles.css' },
  { area: 'The pipeline', test: (p) => p.startsWith('scripts/') || p.startsWith('.github/') || p.startsWith('.claude/') },
  { area: 'Server and data', test: (p) => p.startsWith('routes/') || p.startsWith('api/') || p.startsWith('lib/') },
  { area: 'The admin app', test: (p) => p.startsWith('src/') || p.startsWith('public/') },
  { area: 'Documentation', test: (p) => p.startsWith('docs/') },
]);

const AREA_ORDER = Object.freeze([...AREA_RULES.map((r) => r.area), 'Elsewhere']);

/** The area a single changed path belongs to. */
function areaForPath(path) {
  const p = String(path || '').trim();
  for (const rule of AREA_RULES) {
    if (rule.test(p)) return rule.area;
  }
  return 'Elsewhere';
}

/**
 * The area a whole merge belongs to: whichever area most of its changed files
 * are in. A tie goes to the earlier rule, so a change that touches one
 * component and one script files under the Builder rather than flipping about
 * depending on which path git happened to list first.
 *
 * A merge with no readable paths is 'Elsewhere' — an honest shrug, not a guess.
 */
function areaForMerge(paths) {
  const counts = new Map();
  for (const p of Array.isArray(paths) ? paths : []) {
    const area = areaForPath(p);
    counts.set(area, (counts.get(area) || 0) + 1);
  }
  if (counts.size === 0) return 'Elsewhere';
  let best = null;
  for (const area of AREA_ORDER) {
    const n = counts.get(area) || 0;
    if (n > 0 && (best === null || n > best.n)) best = { area, n };
  }
  return best ? best.area : 'Elsewhere';
}

/**
 * Group merges into the sections the report prints, in AREA_ORDER, dropping
 * areas nothing touched this week. Within a group, newest first — the same
 * order `git log` gave them, which is the order the reader expects.
 */
function groupMergesByArea(merges) {
  const list = Array.isArray(merges) ? merges : [];
  const groups = [];
  for (const area of AREA_ORDER) {
    const entries = list.filter((m) => m && m.area === area);
    if (entries.length) groups.push({ area, entries });
  }
  return groups;
}

// ── Small numbers ──────────────────────────────────────────────────────────

/** Median, or null for an empty set — never 0, which would read as "instant". */
function median(values) {
  const nums = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/** `1h 04m`, `7m 12s`, `43s` — durations a person reads, not raw seconds. */
function formatDuration(seconds) {
  const s = Math.round(Number(seconds));
  if (!Number.isFinite(s) || s < 0) return 'not available — the duration did not parse';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${String(rem).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Every date from `from` to `to` inclusive, as YYYY-MM-DD. */
function daysBetween(from, to) {
  const out = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Merges per day across the window, with EVERY day present including the ones
 * with none. A chart that omits its empty days silently rescales itself and a
 * quiet week looks exactly like a busy one.
 */
function perDay(dates, from, to) {
  const counts = new Map(daysBetween(from, to).map((d) => [d, 0]));
  for (const raw of Array.isArray(dates) ? dates : []) {
    const day = String(raw || '').slice(0, 10);
    if (counts.has(day)) counts.set(day, counts.get(day) + 1);
  }
  return [...counts.entries()].map(([date, count]) => ({ date, count }));
}

/** The window a report covers: `days` days ending on `to`, inclusive. */
function windowRange(to, days) {
  const n = Math.max(1, Math.round(Number(days) || 7));
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) throw new Error(`windowRange: "${to}" is not a YYYY-MM-DD date`);
  const start = new Date(end.getTime() - (n - 1) * 86400000);
  return { from: start.toISOString().slice(0, 10), to, days: n };
}

// ── Rendering ──────────────────────────────────────────────────────────────

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One metric tile. `figure` is the {ok,...} shape above, so a tile physically
 * cannot be rendered without deciding what the unreadable case says.
 */
function tile(label, figure, format, note, partial = false) {
  const unread = figure && figure.ok === false;
  const value = figureText(figure, format || ((v) => String(v)));
  // `partial` is the middle case the page had no way to say: a figure that WAS
  // read and is known to be short. It keeps the big number — the number is a
  // real floor — but tints the card, because a reader who only skims the tiles
  // must not come away with a total.
  const cls = unread ? ' tile--unread' : (partial ? ' tile--partial' : '');
  return [
    `      <div class="tile${cls}">`,
    `        <div class="tile-label">${esc(label)}</div>`,
    `        <div class="tile-value">${esc(value)}</div>`,
    note ? `        <div class="tile-note">${esc(note)}</div>` : '',
    '      </div>',
  ].filter(Boolean).join('\n');
}

/**
 * A visible warning when the merge count is known to be short.
 *
 * The tile note alone is small print. This is the same amber box an unreadable
 * figure gets, because a count that quietly excludes work IS an unreadable
 * figure wearing a number.
 */
function renderConfirmationCaution(figure) {
  const unconfirmed = figure && figure.ok === true ? Number(figure.couldNotConfirm || 0) : 0;
  if (!unconfirmed) return '';
  return [
    '    <p class="unread">',
    `      This merge count is incomplete. ${esc(unconfirmed)} pull request(s) that landed on`,
    '      <code>main</code> in this window could not be confirmed with GitHub, so they are',
    '      NOT counted above — and every figure derived from the merge list is short by the',
    '      same amount. Treat the number as a floor, not a total.',
    '    </p>',
  ].join('\n');
}

/** The per-day bar chart, as plain divs — no script, no library, no network. */
function renderChart(days) {
  const rows = Array.isArray(days) ? days : [];
  const max = rows.reduce((m, d) => Math.max(m, Number(d.count) || 0), 0);
  if (!rows.length) return '      <p class="unread">not available — the window produced no days to chart</p>';
  const bars = rows.map((d) => {
    const count = Number(d.count) || 0;
    const pct = max > 0 ? Math.round((count / max) * 100) : 0;
    return [
      '        <div class="bar-row">',
      `          <div class="bar-day">${esc(d.date)}</div>`,
      `          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>`,
      `          <div class="bar-count">${count}</div>`,
      '        </div>',
    ].join('\n');
  });
  return ['      <div class="chart">', ...bars, '      </div>'].join('\n');
}

/** The ticket-stage line-up, in the order the pipeline actually moves. */
const STAGE_ORDER = Object.freeze(['Queued', 'Building', 'In review', 'Needs your input', 'Ready to launch', 'Live']);

function renderStages(stages) {
  if (!stages || !stages.ok) {
    return `      <p class="unread">not available — ${esc(stages && stages.reason ? stages.reason : 'the figure is missing entirely')}</p>`;
  }
  const counts = stages.value || {};
  const cells = STAGE_ORDER.map((stage) => {
    const n = Number(counts[stage.toLowerCase()] ?? counts[stage] ?? 0);
    return [
      '        <div class="stage">',
      `          <div class="stage-count">${n}</div>`,
      `          <div class="stage-name">${esc(stage)}</div>`,
      '        </div>',
    ].join('\n');
  });
  return ['      <div class="stages">', cells.join('\n        <div class="stage-arrow">&rarr;</div>\n'), '      </div>'].join('\n');
}

function renderMergeGroups(groups, repo) {
  const list = Array.isArray(groups) ? groups : [];
  if (!list.length) return '      <p class="unread">No pull requests merged in this window.</p>';
  return list.map((g) => {
    const items = g.entries.map((m) => [
      '          <li>',
      `            <a href="${esc(prUrl(repo, m.number))}">#${esc(m.number)}</a>`,
      `            <span class="merge-title">${esc(m.title)}</span>`,
      '          </li>',
    ].join('\n'));
    return [
      '      <section class="area">',
      `        <h3>${esc(g.area)} <span class="area-count">${g.entries.length}</span></h3>`,
      '        <ul class="merges">',
      ...items,
      '        </ul>',
      '      </section>',
    ].join('\n');
  }).join('\n');
}

const STYLES = `    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 2.5rem 1.5rem 4rem;
      font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: #1a1a1a; background: #fbfbfa;
    }
    main { max-width: 60rem; margin: 0 auto; }
    h1 { font-size: 1.9rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
    h2 { font-size: 1.15rem; margin: 2.5rem 0 .9rem; padding-bottom: .4rem; border-bottom: 1px solid #e4e2dd; }
    h3 { font-size: .95rem; margin: 1.4rem 0 .5rem; }
    .window { color: #6b6b6b; margin: 0 0 .35rem; }
    .provenance { color: #6b6b6b; font-size: .85rem; margin: 0 0 2rem; }
    .provenance code { background: #efeee9; padding: .1rem .35rem; border-radius: 3px; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .75rem; }
    .tile { background: #fff; border: 1px solid #e4e2dd; border-radius: 8px; padding: .9rem 1rem; }
    .tile--unread { background: #fdf6ec; border-color: #e8d4b0; }
    .tile--partial { background: #fdf6ec; border-color: #e8d4b0; }
    .tile--partial .tile-value { color: #8a6a2f; }
    .tile--partial .tile-note { color: #8a6a2f; }
    .tile-label { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: #7a7a7a; }
    .tile-value { font-size: 1.5rem; font-weight: 600; margin-top: .25rem; line-height: 1.25; }
    .tile--unread .tile-value { font-size: .9rem; font-weight: 500; color: #8a6a2f; }
    .tile-note { font-size: .78rem; color: #7a7a7a; margin-top: .3rem; }
    .stages { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
    .stage { background: #fff; border: 1px solid #e4e2dd; border-radius: 8px; padding: .6rem .9rem; text-align: center; min-width: 5.5rem; }
    .stage-count { font-size: 1.35rem; font-weight: 600; }
    .stage-name { font-size: .72rem; color: #7a7a7a; text-transform: uppercase; letter-spacing: .04em; }
    .stage-arrow { color: #b9b6ae; }
    .chart { display: flex; flex-direction: column; gap: .3rem; }
    .bar-row { display: grid; grid-template-columns: 6.5rem 1fr 2rem; align-items: center; gap: .6rem; }
    .bar-day { font-size: .8rem; color: #6b6b6b; font-variant-numeric: tabular-nums; }
    .bar-track { background: #eceae4; border-radius: 4px; height: 1.1rem; overflow: hidden; }
    .bar-fill { background: #4a7c59; height: 100%; border-radius: 4px; }
    .bar-count { font-size: .82rem; text-align: right; font-variant-numeric: tabular-nums; color: #4a4a4a; }
    .area-count { color: #7a7a7a; font-weight: 400; font-size: .8rem; }
    ul.merges { list-style: none; margin: 0; padding: 0; }
    ul.merges li { padding: .3rem 0; border-bottom: 1px solid #efeee9; display: flex; gap: .6rem; align-items: baseline; }
    ul.merges a { color: #2f6f4f; text-decoration: none; font-variant-numeric: tabular-nums; min-width: 3.5rem; }
    ul.merges a:hover { text-decoration: underline; }
    .merge-title { flex: 1; }
    .unread { background: #fdf6ec; border: 1px solid #e8d4b0; border-radius: 8px; padding: .75rem 1rem; color: #8a6a2f; }
    .narrative { background: #fff; border: 1px dashed #cfcdc6; border-radius: 8px; padding: 1rem 1.2rem; color: #5a5a5a; }
    footer { margin-top: 3rem; color: #8a8a8a; font-size: .82rem; }
    @media (prefers-color-scheme: dark) {
      body { background: #16171a; color: #e8e6e1; }
      .tile, .stage, .narrative { background: #1e2024; border-color: #34363c; }
      h2 { border-color: #34363c; }
      .tile--unread, .tile--partial, .unread { background: #2a2317; border-color: #5a4a26; color: #d8b877; }
      .tile--partial .tile-value, .tile--partial .tile-note { color: #d8b877; }
      .bar-track { background: #2a2d33; }
      ul.merges li { border-color: #26282d; }
      .provenance code { background: #26282d; }
    }`;

/**
 * The figures page.
 *
 * Deterministic by construction: every character comes out of `data`. There is
 * no clock reading and no random id in here, which is what makes "run it twice,
 * diff it, expect nothing" a property of the renderer rather than luck
 * (acceptance criterion 6).
 *
 * It also deliberately leaves a visible, empty slot where the narrative goes,
 * rather than closing over the gap. A page that looks finished is a page nobody
 * writes the prose onto.
 */
function renderReportHtml(data) {
  const d = data || {};
  const w = d.window || { from: '?', to: '?', days: 0 };
  const f = d.figures || {};
  const repo = d.repo || 'mentor24-maker/starcaster';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Starcaster weekly figures — ${esc(w.from)} to ${esc(w.to)}</title>
  <style>
${STYLES}
  </style>
</head>
<body>
  <main>
    <h1>Starcaster weekly figures</h1>
    <p class="window">${esc(w.from)} to ${esc(w.to)} &middot; ${esc(w.days)} days</p>
    <p class="provenance">
      Generated by <code>scripts/weekly_report.mjs</code>. Every number here is also in
      <code>${esc(d.dataFile || `${w.to}.data.json`)}</code> beside this file.
      Figures only — the writing is a person's job.
    </p>

    <h2>The week in numbers</h2>
    <div class="tiles">
${tile('Pull requests merged', f.merges, (v) => String(v), mergesNote(f.merges), Boolean(f.merges && f.merges.ok && f.merges.couldNotConfirm))}
${tile('Files touched', f.diffstat, (v) => String(v.filesChanged))}
${tile('Lines added', f.diffstat, (v) => `+${v.insertions}`)}
${tile('Lines removed', f.diffstat, (v) => `-${v.deletions}`)}
${tile('Tests passing', f.tests, (v) => (v.fail ? `${v.pass} pass, ${v.fail} fail` : String(v.pass)), 'npm run test:builder')}
${tile('Median CI run', f.ciMedianSeconds, (v) => formatDuration(v))}
${tile('Pull requests open now', f.openPrs, (v) => String(v))}
${tile('Unattended loop passes', f.loopPasses, (v) => String(v.total), 'a labelled proxy for machine time — quota itself is unreadable from the repo')}
    </div>
${renderConfirmationCaution(f.merges)}

    <h2>Where the tickets are</h2>
${renderStages(f.stages)}

    <h2>Merges per day</h2>
${renderChart(f.merges && f.merges.ok ? f.merges.perDay : [])}

    <h2>What shipped, by area</h2>
${renderMergeGroups(d.groups, repo)}

    <h2>The narrative</h2>
    <div class="narrative">
      <p>Not written yet. This page is the figures; the ranked five, the plain-language
      summaries, the &ldquo;your inputs&rdquo; section and any incident write-ups are judgement
      and belong to a person.</p>
      <p>Everything needed to write them is in
      <code>${esc(d.dataFile || `${w.to}.data.json`)}</code> — no re-gathering required.</p>
    </div>

    <footer>
      Only pull requests GitHub reports as <strong>MERGED</strong> are counted. A figure the
      gatherer could not read says &ldquo;not available&rdquo; and gives its reason; it is never
      omitted and never estimated.
    </footer>
  </main>
</body>
</html>
`;
}

/** The index: every edition, newest first. */
function renderIndexHtml(editions) {
  const list = [...(Array.isArray(editions) ? editions : [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const items = list.length
    ? list.map((e) => [
      '        <li>',
      `          <a href="${esc(e.file)}">${esc(e.date)}</a>`,
      `          <span class="merge-title">${esc(e.window || '')}</span>`,
      '        </li>',
    ].join('\n')).join('\n')
    : '        <li class="unread">No editions yet.</li>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Starcaster weekly figures — every edition</title>
  <style>
${STYLES}
  </style>
</head>
<body>
  <main>
    <h1>Starcaster weekly figures</h1>
    <p class="provenance">Newest first. Each edition is the figures for the seven days ending on its date.</p>
    <h2>Editions</h2>
    <ul class="merges">
${items}
    </ul>
  </main>
</body>
</html>
`;
}

module.exports = {
  AREA_ORDER,
  AREA_RULES,
  STAGE_ORDER,
  areaForMerge,
  areaForPath,
  dataPathFor,
  daysBetween,
  esc,
  figureText,
  formatDuration,
  groupMergesByArea,
  median,
  mergedOnly,
  mergesNote,
  notAvailable,
  ok,
  parseMergeSubject,
  perDay,
  prUrl,
  renderChart,
  renderConfirmationCaution,
  renderIndexHtml,
  renderReportHtml,
  renderStages,
  windowRange,
};
