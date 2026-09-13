'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

const LANES = ['loop-spec', 'loop-build', 'loop-review'];
const skill = (lane) => read(`.claude/skills/${lane}/SKILL.md`);

// These rules are prose, and prose re-wraps. Matching the raw file makes a
// tripwire that fires on a reflow and passes on a deletion; match the words.
const flat = (s) => s.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// The stopping rule (2026-09-06, Dane's decision; task 86bbvtnfn). Pipeline
// self-maintenance tickets went from ~6/day to ~16/day, faster than the queue
// drains; 31 were parked and the six that stayed all named a real incident.
// The rule is prose in five files, so these tripwires are what keep it from
// eroding — the same pattern premiseDiscipline.test.js uses.
// ---------------------------------------------------------------------------

test('every lane gates filing on a COST, not on the finding being real', () => {
  for (const lane of LANES) {
    const s = skill(lane);
    assert.match(flat(s), /actually cost something observable/,
      `${lane} must state the gate itself`);
    assert.match(flat(s), /lost work, a dead lane, a silent outage, a wrong merge/i,
      `${lane} must name what "a cost" means, or the gate is a mood`);
  }
});

test('every lane says where a parked finding goes instead', () => {
  for (const lane of LANES) {
    assert.match(skill(lane), /2kydhxeu-814/,
      `${lane} must name the parked-backlog doc — a rule that only says "do not file" `
      + 'loses the finding entirely');
  }
});

test('a headless pass is told what to do when it cannot reach the doc', () => {
  // Measured while building this: scripts/clickup_direct.mjs has no doc
  // command, so a loop pass genuinely cannot write there. A rule whose only
  // destination is unreachable is a rule to drop findings on the floor.
  for (const lane of ['loop-build', 'loop-review']) {
    assert.match(skill(lane), /run report/,
      `${lane} must give the pass a destination it can actually reach`);
  }
});

test('every lane exempts product defects, which are filed on sight', () => {
  for (const lane of LANES) {
    const s = skill(lane);
    assert.match(flat(s), /filed on sight/,
      `${lane} must carve out client-facing bugs`);
    assert.match(s, /tenant|client-facing|admin app/i,
      `${lane} must name whose defects are exempt`);
  }
  assert.match(flat(read('CLAUDE.md')), /Client-facing bugs are unaffected/,
    'the exemption belongs in canon too — over-applying this rule is how a '
    + "client's live bug goes unfiled");
});

test('all three lanes cite one root, so the rule cannot fork', () => {
  for (const lane of LANES) {
    assert.match(flat(skill(lane)), /DOCTRINE\.md.{0,4} ?§6\.24/,
      `${lane} must trace to the canonical section`);
  }
});

test('canon carries the measurement that justifies the rule', () => {
  const doctrine = read('docs/DOCTRINE.md');
  assert.match(doctrine, /### 6\.24 /, 'the section exists');
  assert.match(doctrine, /86bbvtnfn/, 'the decision record is named');
  assert.match(flat(doctrine), /6 a day in mid-August to roughly 16 a day in early September/,
    'the filing-rate numbers ARE the Why — a rule without its story gets deleted');
  assert.match(flat(doctrine), /31 tickets were parked that day\. Six stayed/,
    'the ratio is the argument');
  assert.match(doctrine, /"is this a real finding\?" is the wrong gate|is the wrong gate/,
    'the point that all 31 were genuine findings');
  for (const id of ['86bbuzyra', '86bbvr5zv', '86bbvr5ym', '86bbvr4w3', '86bbvqkr1', '86bbvj44f']) {
    assert.ok(doctrine.includes(id), `the six that stayed are named (${id} missing)`);
  }
});

test('canon distinguishes a parked ticket from a killed one', () => {
  const doctrine = read('docs/DOCTRINE.md');
  assert.match(doctrine, /`deferred`/, 'the tag that means parked');
  assert.match(flat(doctrine), /never `wont-do`|\*not\* `wont-do`/,
    'wont-do means decided against; conflating them loses 31 real findings');
  assert.match(doctrine, /set its status back to `Queued`/, 'reviving one is stated');
});

test('canon exempts the tickets the machinery files for itself', () => {
  // Verified 2026-09-07 by grepping every POST to /list/<id>/task: the
  // merge-conflict filer plus three tickets that are places to write, not
  // work. A rule that swept those up would stop the pause switch from ever
  // being created.
  const doctrine = read('docs/DOCTRINE.md');
  assert.match(doctrine, /merge-conflict tickets/, 'a blocked PR is a dead lane, which is a cost');
  for (const script of ['scripts/pipeline\\.mjs', 'scripts/node_heartbeat\\.mjs', 'scripts/pulse_publish\\.mjs']) {
    assert.match(doctrine, new RegExp(script),
      `${script} creates a record ticket, not a finding — it must be named as exempt`);
  }
});

test('title guidance sits where tickets actually get created', () => {
  assert.match(flat(skill('loop-spec')), /what breaks and who feels it/,
    'the spec lane names every ticket it files');
  assert.match(flat(skill('loop-spec')), /cryptic and full of fanciful turns of phrases/,
    "the operator's own words, so the rule survives a rewrite");
  assert.match(flat(read('scripts/clickup_direct.mjs')), /PLAIN WORDS what breaks and who feels it/,
    'the `task` command prints it at the moment of creation — the one place a '
    + 'pass filing by hand is guaranteed to look');
});
