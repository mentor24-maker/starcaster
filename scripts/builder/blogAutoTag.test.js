'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  tokenize, singular, stripHtml, collapseKey, normalizeTags,
  buildTagProfiles, canonicalSpelling, suggestTags,
} = require('../../lib/blogAutoTag.js');

/**
 * Deterministic, meaning-based tag suggestions (ticket 86bbw4dcd).
 * The fixture is small on purpose: three subjects, one of them tagged with two
 * spellings, and one post whose subject is clear from words the tag never uses.
 */
const POSTS = [
  { id: 'p1', title: 'Summer Junior Camp Registration Open', excerpt: 'Kids ages 8 to 14 train all week.', body: '<p>Our <b>junior</b> camp welcomes kids and teens. Coaches run drills, match play and fun games every morning.</p>', tags: ['junior tennis', 'tennis camp'] },
  { id: 'p2', title: 'Junior Clinics Return This Fall', excerpt: '', body: '<p>After-school clinics for kids and teens: footwork, rallying and match play with our junior coaches.</p>', tags: ['junior tennis', 'tennis clinic'] },
  { id: 'p3', title: 'Pickleball Round Robin Every Friday', excerpt: 'Paddles ready.', body: '<p>Bring a paddle. Round robin play on the pickleball courts, all levels, prizes for the winners.</p>', tags: ['pickleball', 'round robin'] },
  { id: 'p4', title: 'Friday Pickleball Roundrobin Results', excerpt: '', body: '<p>Paddles down: the pickleball round robin crowned three winners this Friday. Prizes went to the top pairs.</p>', tags: ['pickleball', 'roundrobin'] },
  { id: 'p5', title: 'Pickleball Social Night', excerpt: '', body: '<p>Paddles, music and open play on the pickleball courts. All levels welcome.</p>', tags: ['pickleball'] },
  { id: 'p6', title: 'What To Do After An Arrest', excerpt: '', body: '<p>You have the right to remain silent. Ask for an attorney before any police questioning begins.</p>', tags: ['criminal defense', 'know your rights'] },
];

test('tokenize strips HTML, drops stop words, singularises the plural but leaves "tennis" alone', () => {
  assert.deepEqual(tokenize('<p>The <b>lessons</b> &amp; the tennis classes</p>'), ['lesson', 'tennis', 'class']);
  assert.equal(singular('lessons'), 'lesson');
  assert.equal(singular('tennis'), 'tennis');
  assert.equal(singular('classes'), 'class');
  assert.equal(singular('categories'), 'category');
  assert.equal(singular('campus'), 'campus');
  assert.equal(stripHtml('<script>x()</script>a &nbsp; b'), 'a b');
});

test('near-duplicate spellings collapse to one key', () => {
  assert.equal(collapseKey('Round Robin'), collapseKey('roundrobin'));
  assert.equal(collapseKey('round robins'), collapseKey('round robin'));
  assert.equal(collapseKey('pickle ball'), collapseKey('Pickleball'));
  assert.notEqual(collapseKey('tennis clinic'), collapseKey('tennis camp'));
  assert.deepEqual(normalizeTags(['A', 'a', ' b ', '']), ['A', 'b']);
});

test('the canonical spelling is the one on the most posts', () => {
  const model = buildTagProfiles(POSTS);
  assert.equal(canonicalSpelling('roundrobin', model), 'round robin', 'one post each: the spaced form wins the tie');
  const rr = model.profiles.find((p) => p.collapseKey === collapseKey('round robin'));
  assert.equal(rr.count, 2, 'both spellings feed one profile');
  const more = buildTagProfiles([...POSTS, { id: 'p7', title: 'Roundrobin again', body: 'roundrobin play', tags: ['roundrobin'] }]);
  assert.equal(canonicalSpelling('round robin', more), 'roundrobin', 'two posts beat one');
});

test('a post is matched on the words other posts with the tag use, not only the tag words', () => {
  const model = buildTagProfiles(POSTS);
  // No "junior", no "tennis": kids, teens, coaches, drills, match play.
  const post = { id: 'x', title: 'Kids and Teens Train With Our Coaches', body: '<p>Drills, match play and games for kids and teens every morning with the coaches.</p>', tags: [] };
  const got = suggestTags(post, model, { threshold: 0.1 });
  assert.ok(got.some((s) => s.tag === 'junior tennis'), `expected junior tennis in ${JSON.stringify(got)}`);
  const junior = got.find((s) => s.tag === 'junior tennis');
  assert.ok(junior.evidence.length >= 1 && junior.evidence.every((w) => tokenize(post.title + ' ' + post.body).includes(w)), 'every evidence word is in the post');
  assert.ok(!got.some((s) => s.tag === 'criminal defense'), 'an unrelated tag is not suggested');
});

test('never a tag the post already carries, never more than max, sorted by score', () => {
  const model = buildTagProfiles(POSTS);
  const post = { id: 'y', title: 'Pickleball round robin paddles winners prizes', body: 'pickleball pickleball round robin', tags: ['Pickle Ball'] };
  const got = suggestTags(post, model, { threshold: 0, max: 2 });
  assert.ok(!got.some((s) => collapseKey(s.tag) === collapseKey('pickleball')), 'carried tag (by near-duplicate key) is excluded');
  assert.ok(got.length <= 2);
  for (let i = 1; i < got.length; i++) assert.ok(got[i - 1].score >= got[i].score);
});

test('a tag in the vocabulary that no post carries still exists as an own-words profile', () => {
  const model = buildTagProfiles(POSTS, { vocabulary: ['tennis workout'] });
  const post = { id: 'z', title: 'A Tennis Workout For Busy Weeks', body: 'workout workout tennis', tags: [] };
  const got = suggestTags(post, model, { threshold: 0.1 });
  assert.ok(got.some((s) => s.tag === 'tennis workout'), JSON.stringify(got));
});

test('a post with no words yields nothing, and below threshold yields nothing', () => {
  const model = buildTagProfiles(POSTS);
  assert.deepEqual(suggestTags({ id: 'e', title: '', body: '', tags: [] }, model), []);
  assert.deepEqual(suggestTags({ id: 'f', title: 'Quarterly accounting memo', body: 'invoices ledgers', tags: [] }, model, { threshold: 0.99 }), []);
});

test('deterministic: the same input gives byte-identical output twice', () => {
  const run = () => JSON.stringify(POSTS.map((p) => suggestTags({ ...p, tags: [] }, buildTagProfiles(POSTS), { threshold: 0 })));
  assert.equal(run(), run());
});
