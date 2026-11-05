'use strict';

/**
 * Reading an imported form's source HTML (lib/site-import/forms.ts, task
 * 86bcynjvc). Site Import kept only a screenshot of each form plus its
 * original markup; readSourceForm works out what the form actually asks.
 *
 * strands-mailpoet.html is saved verbatim from https://strandsmovie.com/
 * (2026-11-04). The others are representative markup for each plugin.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const { readSourceForm } = require('../../lib/site-import/dist/forms.js');

const DIR = path.join(__dirname, 'fixtures', 'forms');
const fixture = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
const read = (name) => readSourceForm(fixture(name));
const shape = (r) => r.fields.map((f) => [f.key, f.type, f.required]);

/** Every form control in the first form, counted independently of the reader. */
function countControls(html) {
  const $ = cheerio.load(html);
  const form = $('form').first();
  return form.find('input, select, textarea').toArray()
    .filter((el) => !/^(submit|button|reset|image)$/i.test($(el).attr('type') || ''))
    .length;
}

function accounted(r) {
  return r.fields.reduce((n, f) => n + f.controls, 0)
    + r.kept.length
    + r.dropped.filter((d) => !d.widget).reduce((n, d) => n + (d.controls || 1), 0);
}

test('Strands MailPoet form reads as 4 questions', () => {
  const r = read('strands-mailpoet.html');
  assert.equal(r.kind, 'data-capture');
  assert.deepEqual(shape(r), [
    ['email', 'email', true],
    ['first_name', 'text', false],
    ['last_name', 'text', false],
    [r.fields[3].key, 'radio', false],
  ]);
  assert.equal(r.fields[0].label, 'Email Address');
  assert.equal(r.fields[3].label, 'What is the main skill you bring to the team?');
  assert.deepEqual(r.fields[3].options, [
    'Writing', 'Graphic Design', 'Cinematography', 'Music', 'Filmmaking', 'Film Industry',
    'Crypto Investing', 'Crypto Development', 'AI Query Prompting', 'Marketing/Promotion', 'Acting',
  ]);
  assert.equal(r.submitLabel, 'Join the Crew!');
  assert.deepEqual(r.kept, []);
  // The spam trap and the five plugin plumbing fields, each named.
  assert.deepEqual(r.dropped.map((d) => d.name).sort(), [
    'api_version', 'data[email]', 'data[form_id]', 'endpoint', 'mailpoet_method', 'token',
  ]);
  assert.match(r.dropped.find((d) => d.name === 'data[email]').why, /spam trap/);
  assert.match(r.dropped.find((d) => d.name === 'token').why, /security token/);
  for (const d of r.dropped) assert.ok(d.what && d.why, 'every dropped item says what and why');
});

test('search and login forms are not data capture, and say why', () => {
  const search = read('search.html');
  assert.equal(search.kind, 'not-data-capture');
  assert.match(search.reason, /search/);
  const login = read('login.html');
  assert.equal(login.kind, 'not-data-capture');
  assert.match(login.reason, /sign-in/);
  // A lone "s" box with no role=search is still a search box.
  const bare = readSourceForm('<form action="/"><input name="s" type="text"><button>Go</button></form>');
  assert.equal(bare.kind, 'not-data-capture');
  // A payment form stays as it is.
  const pay = readSourceForm('<form><label>Card<input name="card_number" autocomplete="cc-number"></label><input name="email" type="email"></form>');
  assert.equal(pay.kind, 'not-data-capture');
  assert.match(pay.reason, /payment/);
});

test('a <select multiple> is a multiselect; a placeholder option is not a choice', () => {
  const r = read('select-multiple.html');
  assert.deepEqual(shape(r), [['which_topics_interest_you', 'multiselect', true], ['your_level', 'select', false]]);
  assert.deepEqual(r.fields[0].options, ['Tennis', 'Pickleball', 'Fitness', 'Junior programs']);
  assert.deepEqual(r.fields[1].options, ['Beginner', 'Intermediate', 'Advanced']);
  assert.equal(r.submitLabel, 'Save my interests');
});

test('tick boxes sharing a name are one checkboxes question; a lone tick box is boolean', () => {
  const r = read('checkbox-group.html');
  assert.deepEqual(shape(r), [['email', 'email', true], ['how_can_you_help', 'checkboxes', true], ['i_am_over_18', 'boolean', true]]);
  assert.deepEqual(r.fields[1].options, ['Events', 'Coaching', 'Fundraising']);
  assert.equal(r.fields[1].label, 'How can you help?');
});

test('Contact Form 7: wrapping labels, aria-required, plumbing dropped', () => {
  const r = read('contact-form-7.html');
  assert.deepEqual(shape(r), [
    ['your_name', 'text', true], ['email', 'email', true], ['subject', 'text', false],
    ['your_message_optional', 'textarea', false], ['i_agree_to_be_contacted_about_my_enquiry', 'boolean', true],
  ]);
  assert.equal(r.submitLabel, 'Send');
  assert.deepEqual(r.kept, [], '_wpcf7_unit_tag is plumbing even though it says "tag"');
  assert.equal(r.dropped.length, 6);
});

test('Gravity Forms: "(Required)" labels, per-box names grouped, honeypot and reCAPTCHA dropped', () => {
  const r = read('gravity-forms.html');
  assert.equal(r.heading, 'Book a Lesson');
  assert.deepEqual(shape(r), [
    ['full_name', 'text', true], ['email', 'email', true], ['phone', 'tel', false],
    ['lesson_type', 'select', false], ['days_that_suit_you', 'checkboxes', false], ['preferred_start_date', 'date', false],
  ]);
  assert.deepEqual(r.fields[3].options, ['Private', 'Semi-private', 'Group clinic']);
  assert.deepEqual(r.fields[4].options, ['Weekdays', 'Weekends']);
  assert.equal(r.submitLabel, 'Request a Lesson');
  assert.ok(r.dropped.some((d) => d.name === 'input_7' && /spam trap/.test(d.why)));
  assert.ok(r.dropped.some((d) => d.widget && /reCAPTCHA/.test(d.what)));
});

test('Mailchimp embed: EMAIL/FNAME/LNAME keys, off-screen honeypot dropped, tags kept', () => {
  const r = read('mailchimp.html');
  assert.equal(r.heading, 'Subscribe to our newsletter');
  assert.deepEqual(shape(r), [['email', 'email', true], ['first_name', 'text', false], ['last_name', 'text', false], ['birthday', 'text', false]]);
  assert.deepEqual(r.kept.map((k) => [k.name, k.value]), [['tags', 'Website signup']]);
  assert.match(r.dropped[0].why, /spam trap/);
  assert.equal(r.submitLabel, 'Subscribe');
});

test('HubSpot embed: label spans, starred required, disabled placeholder option skipped', () => {
  const r = read('hubspot.html');
  assert.deepEqual(shape(r), [['first_name', 'text', true], ['email', 'email', true], ['company_name', 'text', false], ['how_did_you_hear_about_us', 'select', false]]);
  assert.deepEqual(r.fields[3].options, ['Search', 'A friend', 'Social media']);
  assert.equal(r.submitLabel, 'Get in touch');
  assert.deepEqual(r.dropped.map((d) => d.name), ['hs_context']);
});

test('plain HTML contact form: every type, a kept source, Turnstile + CSRF dropped, unknown type noted', () => {
  const r = read('plain-contact.html');
  assert.equal(r.heading, 'Get in touch');
  assert.deepEqual(shape(r), [
    ['name', 'text', true], ['phone', 'tel', false], ['email', 'email', true], ['website', 'url', false],
    ['number_of_guests', 'number', false], ['favourite_colour', 'text', false],
    ['send_me_the_newsletter', 'boolean', false], ['message', 'textarea', true],
  ]);
  assert.deepEqual(r.kept.map((k) => [k.name, k.value]), [['source', 'Homepage contact box']]);
  assert.ok(r.dropped.some((d) => d.name === 'csrf_token'));
  assert.ok(r.dropped.some((d) => d.widget && /Turnstile/.test(d.what)));
  // The colour picker became text AND says so — nothing vanishes silently.
  assert.ok(r.notes.some((n) => /colour/.test(n.what) && /color/.test(n.why)));
  assert.equal(r.submitLabel, 'Send message');
});

test('every input in every fixture is a field, a kept item or a dropped item', () => {
  for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith('.html'))) {
    const html = fixture(name);
    const r = readSourceForm(html);
    if (r.kind !== 'data-capture') continue;
    assert.equal(accounted(r), countControls(html), `${name}: fields + kept + dropped must cover every input`);
  }
});

test('keys stay unique when labels repeat', () => {
  const r = readSourceForm('<form><label>Name<input name="a"></label><label>Name<input name="b"></label><input type="email" name="e1"><input type="email" name="e2" aria-label="Other email"></form>');
  assert.deepEqual(r.fields.map((f) => f.key), ['name', 'name_2', 'email', 'other_email']);
});

test('separately named tick boxes in one fieldset stay separate yes/no questions', () => {
  // Round-1 review of PR #965: a shared <fieldset> used to merge these into one
  // optional multi-choice question, so a required "I agree" box lost its meaning.
  const r = readSourceForm('<form><fieldset><legend>Consent</legend>'
    + '<label><input type="checkbox" name="terms" required> I agree to the terms</label>'
    + '<label><input type="checkbox" name="marketing"> Send me news</label>'
    + '</fieldset><button>Go</button></form>');
  assert.deepEqual(shape(r), [['i_agree_to_the_terms', 'boolean', true], ['send_me_news', 'boolean', false]]);
});

test('a bare data-parsley-required marks a field required; ="false" does not', () => {
  const r = readSourceForm('<form><input type="email" name="e" data-parsley-required>'
    + '<input type="text" name="n" aria-label="Nickname" data-parsley-required="false"><button>Go</button></form>');
  assert.deepEqual(r.fields.map((f) => f.required), [true, false]);
});
