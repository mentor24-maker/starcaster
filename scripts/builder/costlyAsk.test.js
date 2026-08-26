'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRIGGERS,
  INNOCENT_PHRASES,
  costlyTriggers,
  isCostlyAsk,
  describeTriggers,
} = require('./costlyAsk.js');

// ------------------------------------------------- the asks that must fire

test('the ask that started this fires', () => {
  // Verbatim option A from the 2026-08-23 escalation.
  assert.ok(isCostlyAsk('Put the workspace back on a paid plan.'));
});

test('each class of costly ask fires', () => {
  assert.ok(isCostlyAsk('Approve the $29/month spend and I will re-enable it.'), 'money');
  assert.ok(isCostlyAsk('Upgrade the workspace and tell me when it is done.'), 'plan');
  assert.ok(isCostlyAsk('Delete the 550 untenanted rows so the backfill can run.'), 'irreversible');
  assert.ok(isCostlyAsk('Rotate CHANNELS_ENCRYPTION_KEY when you get a minute.'), 'credential');
});

test('a dollar figure fires however it is phrased', () => {
  // There is no word to list for this one, so it is matched on its own.
  assert.ok(isCostlyAsk('It comes to $4.50 a day at current volume — your call.'));
  assert.equal(costlyTriggers('$25')[0].word, '$ amount');
});

test('every listed trigger word actually fires on its own', () => {
  // Otherwise a word could sit in the list looking protective while matching
  // nothing — the shape of a check that silently does not run (DOCTRINE 3.11).
  for (const trigger of TRIGGERS) {
    assert.ok(
      isCostlyAsk(`Please ${trigger.word} it.`),
      `"${trigger.word}" is in the list but does not fire`,
    );
  }
});

test('third-person forms fire — the natural way to phrase an approval', () => {
  // Found by review, 2026-08-26. The list carried `delete`/`deleting`/
  // `deletion` but not `deletes`, so every one of these posted with no
  // evidence at all — and describing what the operator's YES will do is the
  // most natural phrasing there is.
  assert.ok(isCostlyAsk('This deletes all 550 untenanted rows.'), 'deletes');
  assert.ok(isCostlyAsk('It rotates CHANNELS_ENCRYPTION_KEY.'), 'rotates');
  assert.ok(isCostlyAsk('Approving this upgrades the workspace to Business.'), 'upgrades');
  assert.ok(isCostlyAsk('This migrates every page to the new schema.'), 'migrates');
  assert.ok(isCostlyAsk('Approving this purchases another seat.'), 'purchases');
});

test('every verb carries its base, gerund and third-person form together', () => {
  // Criterion 4 in the shape that actually protects it: the gap review found
  // was one missing form on verbs whose other forms were all present, and
  // nothing was watching for that.
  const listed = new Set(TRIGGERS.map((t) => t.word));
  for (const [base, gerund, third] of [
    ['spend', 'spending', 'spends'],
    ['buy', 'buying', 'buys'],
    ['pay', 'paying', 'pays'],
    ['upgrade', 'upgrading', 'upgrades'],
    ['delete', 'deleting', 'deletes'],
    ['rotate', 'rotating', 'rotates'],
  ]) {
    for (const form of [base, gerund, third]) {
      assert.ok(listed.has(form), `"${form}" is missing from TRIGGERS`);
    }
  }
});

// -------------------------------------------- the asks that must NOT fire

test('"costs" fires on a price but not on "costs nothing"', () => {
  // The word earns its place on "it costs $29 a month", and the same word is
  // how an agent says an option is free.
  assert.ok(isCostlyAsk('Running it hourly costs about $6 a month.'));
  assert.equal(isCostlyAsk('Leaving it as it is costs nothing.'), false);
});

test('an ordinary ask is untouched', () => {
  // Criterion 3, and the whole value of the gate: one that fires on everything
  // gets routed around, and then it protects nothing.
  assert.equal(isCostlyAsk('Should the chip show the count or the label?'), false);
  assert.equal(isCostlyAsk('A or B — I have no preference, but you might.'), false);
  assert.equal(isCostlyAsk('Nothing right now. Flagging it so you know it landed.'), false);
  assert.equal(isCostlyAsk('Confirm the scope: pages only, or posts as well?'), false);
});

test('innocent phrases that contain a trigger word do not fire', () => {
  for (const phrase of INNOCENT_PHRASES) {
    assert.equal(isCostlyAsk(`Please ${phrase} to the second column.`), false, phrase);
  }
});

test('a trigger word inside a longer word does not fire', () => {
  // Whole-word matching: "buy" must not fire on "buyer", "pay" on "payload".
  assert.equal(isCostlyAsk('Delete the payload from the buyer feed.'), true,
    'the same sentence with a real trigger in it — proof the sample is not inert');
  assert.equal(isCostlyAsk('The payload came back from the buyer feed.'), false);
});

// ------------------------------------------------------------- reporting

test('describeTriggers names the words and their classes', () => {
  const described = describeTriggers(costlyTriggers('spend to upgrade'));
  assert.match(described, /spend/);
  assert.match(described, /upgrade/);
  assert.match(described, /money/);
  assert.match(described, /plan/);
});

test('every trigger carries its reasoning, so adding one means saying why', () => {
  for (const trigger of TRIGGERS) {
    assert.ok(trigger.why && trigger.why.length > 15, `${trigger.word} has no reasoning`);
    assert.ok(['money', 'plan', 'irreversible'].includes(trigger.class), `${trigger.word} has an unknown class`);
  }
});
