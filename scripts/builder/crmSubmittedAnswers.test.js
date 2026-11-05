'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { flattenSubmittedAnswers } = require('../../lib/crmFormHandling.js');

/**
 * Task 86bcynjv7. A "Choose several" answer can arrive as a list. Contacts,
 * the alert email and the visitor confirmation all print answers as text, so
 * the submit route joins a list into "Writing, Music" before storing or
 * sending anything.
 */

test('a list answer becomes one readable value', () => {
  assert.deepEqual(
    flattenSubmittedAnswers({ interests: ['Writing', 'Music'], skill: 'Acting', agree: 'true' }),
    { interests: 'Writing, Music', skill: 'Acting', agree: 'true' }
  );
});

test('blank entries in a list are dropped, and a non-object body is empty', () => {
  assert.deepEqual(flattenSubmittedAnswers({ x: ['  ', 'Film', null] }), { x: 'Film' });
  assert.deepEqual(flattenSubmittedAnswers(null), {});
  assert.deepEqual(flattenSubmittedAnswers(['a']), {});
});

test('the public submit route flattens before it stores anything', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'crm.js'), 'utf8');
  const submit = src.slice(src.indexOf("'/api/crm/contact-submit'"), src.indexOf("'/api/crm/contacts' && method === 'GET'"));
  assert.match(submit, /const submittedData = flattenSubmittedAnswers\(/);
});

test('the field editor offers both types and shows their Options box', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'crm.js'), 'utf8');
  assert.match(src, /\{ value: 'radio', label: 'Choose one' \}/);
  assert.match(src, /\{ value: 'checkboxes', label: 'Choose several' \}/);
  assert.match(src, /row\.type === 'select' \|\| row\.type === 'radio' \|\| row\.type === 'checkboxes'/);
});
