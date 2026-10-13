'use strict';

/**
 * lib/canonSync.js — the logic behind `npm run canon:sync` (task 86bch3jmr),
 * driven with a fake vault in a temp folder and an in-memory store. The real
 * vault is never touched.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CANON_FILES, docKeyFor, runSync } = require('../../lib/canonSync');
const { hashCanon } = require('../../lib/canonStore');

const SCOPE = { projectId: 'proj_doe', userId: 'usr_dane' };

function makeVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-vault-'));
  for (const rel of CANON_FILES) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `# ${path.basename(rel, '.md')}\n\nBody of ${rel}.\n`);
  }
  return dir;
}

/** A store that behaves like the table: keyed on doc_key, stamps both tenant columns. */
function memoryStore({ refuse = new Set() } = {}) {
  const rows = new Map();
  let writes = 0;
  return {
    rows,
    get writes() { return writes; },
    async listCanon(limit, scope) {
      return { ok: true, status: 200, data: [...rows.values()].filter((r) => r.projectId === scope.projectId) };
    },
    async upsertCanonDocument(doc, scope) {
      if (refuse.has(doc.docKey)) return { ok: false, status: 409, error: 'refused by test' };
      writes += 1;
      const row = { docKey: doc.docKey, projectId: scope.projectId, ownerUserId: scope.userId, contentHash: hashCanon(doc.body), syncedAt: 'now' };
      rows.set(doc.docKey, row);
      return { ok: true, status: 201, data: row };
    },
  };
}

function capture() {
  const lines = [];
  return { lines, log: (l) => lines.push(l), text: () => lines.join('\n') };
}

test('the list is the seven documents Dane chose, with stable keys', () => {
  assert.equal(CANON_FILES.length, 7);
  assert.deepEqual(CANON_FILES.map(docKeyFor), [
    'DANE-OF-EARTH', 'VOICE', 'AIISM-BLOCKLIST', 'DEO', 'DEO-CHARACTERISTICS', 'DEO-DATA-THESIS', 'ECOSYSTEM',
  ]);
});

test('a dry run lists all 7 and writes nothing', async () => {
  const vaultDir = makeVault();
  const store = memoryStore();
  const out = capture();
  const { exitCode, results } = await runSync({ vaultDir, apply: false, scope: SCOPE }, { store, log: out.log });
  assert.equal(exitCode, 0);
  assert.equal(results.length, 7);
  assert.ok(results.every((r) => r.outcome === 'would update'));
  assert.equal(store.writes, 0);
  assert.match(out.text(), /DRY RUN/);
});

test('--apply writes 7 rows, each read back with both tenant columns; a second run is all unchanged', async () => {
  const vaultDir = makeVault();
  const store = memoryStore();
  const first = await runSync({ vaultDir, apply: true, scope: SCOPE }, { store, log: () => {} });
  assert.equal(first.exitCode, 0);
  assert.equal(store.writes, 7);
  for (const row of store.rows.values()) {
    assert.equal(row.projectId, 'proj_doe');
    assert.equal(row.ownerUserId, 'usr_dane');
  }

  const out = capture();
  const second = await runSync({ vaultDir, apply: true, scope: SCOPE }, { store, log: out.log });
  assert.equal(second.exitCode, 0);
  assert.ok(second.results.every((r) => r.outcome === 'unchanged'), out.text());
  assert.equal(store.writes, 7, 'an unchanged document is not rewritten');
});

test('an edited vault file is the only one updated', async () => {
  const vaultDir = makeVault();
  const store = memoryStore();
  await runSync({ vaultDir, apply: true, scope: SCOPE }, { store, log: () => {} });
  fs.appendFileSync(path.join(vaultDir, 'doctrine/VOICE.md'), '\nA new line.\n');
  const { results } = await runSync({ vaultDir, apply: true, scope: SCOPE }, { store, log: () => {} });
  assert.deepEqual(results.filter((r) => r.outcome === 'updated').map((r) => r.docKey), ['VOICE']);
});

test('BREAK TEST: a renamed vault file fails the run (exit 1), names the file, and writes nothing', async () => {
  const vaultDir = makeVault();
  fs.renameSync(path.join(vaultDir, 'doctrine/DEO.md'), path.join(vaultDir, 'doctrine/DEO-renamed.md'));
  const store = memoryStore();
  const out = capture();
  const { exitCode } = await runSync({ vaultDir, apply: true, scope: SCOPE }, { store, log: out.log });
  assert.equal(exitCode, 1);
  assert.match(out.text(), /MISSING\s+doctrine\/DEO\.md/);
  assert.equal(store.writes, 0, 'nothing is written when any file is missing');
});

test('an empty vault file counts as missing, not as a blank canon document', async () => {
  const vaultDir = makeVault();
  fs.writeFileSync(path.join(vaultDir, 'doctrine/VOICE.md'), '  \n');
  const out = capture();
  const { exitCode } = await runSync({ vaultDir, apply: true, scope: SCOPE }, { store: memoryStore(), log: out.log });
  assert.equal(exitCode, 1);
  assert.match(out.text(), /MISSING\s+doctrine\/VOICE\.md.*empty/);
});

test('a write the database refuses fails the run', async () => {
  const vaultDir = makeVault();
  const out = capture();
  const { exitCode } = await runSync({ vaultDir, apply: true, scope: SCOPE }, { store: memoryStore({ refuse: new Set(['ECOSYSTEM']) }), log: out.log });
  assert.equal(exitCode, 1);
  assert.match(out.text(), /FAILED\s+ECOSYSTEM/);
});

test('a row that reads back without its owner fails the run (check the rows, not the insert)', async () => {
  const vaultDir = makeVault();
  const store = memoryStore();
  const realUpsert = store.upsertCanonDocument;
  store.upsertCanonDocument = async (doc, scope) => {
    const res = await realUpsert(doc, scope);
    if (doc.docKey === 'DEO') store.rows.get('DEO').ownerUserId = '';
    return res;
  };
  const out = capture();
  const { exitCode } = await runSync({ vaultDir, apply: true, scope: SCOPE }, { store, log: out.log });
  assert.equal(exitCode, 1);
  assert.match(out.text(), /DEO\s.*BAD — owner_user_id/);
});
