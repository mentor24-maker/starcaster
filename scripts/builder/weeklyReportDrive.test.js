'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = require('../../lib/weeklyReportHome.js');
const drive = require('../../lib/weeklyReportDrive.js');

/**
 * Task 86bc0nbwq. The weekly report wrote into the Mini's own code checkout,
 * which made `git status` non-empty, which stopped the Mini updating itself —
 * so it silently ran a week-old pipeline. On 2026-09-14 that cost 7 merges,
 * including the same day's pipeline fixes.
 *
 * Two things are under test here and they fail in opposite directions. The
 * home guard fails LOUDLY by design (a report in a checkout is the incident).
 * The uploader's danger is the other one: reporting success for bytes that
 * never landed, which is the shape of CLAUDE.md landmine 15 and DOCTRINE §5.21.
 *
 * Everything below runs with no network and no Google account: the Drive client
 * is injected, so a test can make Drive answer 200 with the wrong size, which
 * is the case that matters and the one a live test could never stage.
 */

// ── Where the report is allowed to write ──────────────────────────────────

test('the default home is outside every git checkout', () => {
  const verdict = home.checkReportHome({ HOME: os.homedir() });
  assert.equal(verdict.ok, true, verdict.message);
  assert.equal(verdict.checkout, null);
});

test('a home inside a checkout is REFUSED, and says which checkout', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-home-'));
  try {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const inside = path.join(repo, 'docs', 'reports');

    const verdict = home.checkReportHome({ WEEKLY_REPORT_DIR: inside });
    assert.equal(verdict.ok, false, 'a folder inside a repo must not be accepted');
    assert.equal(verdict.checkout, fs.realpathSync(repo), 'and it names the repo it found');
    assert.match(verdict.message, /stops that machine updating itself/,
      'the message says what it costs, not just that it refused');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a WORKTREE counts as a checkout — .git is a file there, not a directory', () => {
  // This is the case the guard most needs to catch and the easiest to miss: a
  // linked worktree carries `.git` as a FILE. A guard that only looked for a
  // directory would call every worktree "outside a checkout", and a worktree is
  // deleted the moment its thread ships.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-home-wt-'));
  try {
    const wt = path.join(tmp, 'worktree');
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');

    const verdict = home.checkReportHome({ WEEKLY_REPORT_DIR: path.join(wt, 'out') });
    assert.equal(verdict.ok, false, 'a worktree is a checkout');
    assert.equal(verdict.checkout, fs.realpathSync(wt));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a SYMLINK into a repo is caught too — the easiest way for this guard to fail open', () => {
  // ~/Documents/Starcaster made as a tidy shortcut into the checkout reads as
  // "outside every repo" to anything that only calls path.resolve, and the
  // report lands back in the checkout with the guard reporting all clear.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-home-link-'));
  try {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const link = path.join(tmp, 'Starcaster');
    fs.symlinkSync(path.join(repo, 'docs'), link);

    const verdict = home.checkReportHome({ WEEKLY_REPORT_DIR: path.join(link, 'Weekly Reports') });
    assert.equal(verdict.ok, false, 'the symlink hid the repo from the guard');
    assert.equal(verdict.checkout, fs.realpathSync(repo));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('WEEKLY_REPORT_DIR overrides the default, and the default is under HOME', () => {
  assert.equal(home.reportHome({ WEEKLY_REPORT_DIR: '/tmp/somewhere' }), '/tmp/somewhere');
  assert.equal(home.reportHome({ HOME: '/Users/x' }), path.join('/Users/x', home.DEFAULT_HOME));
});

// ── The uploader ──────────────────────────────────────────────────────────

/**
 * A Drive that works. `sizes` lets a test lie about what Drive stored, which is
 * the whole reason the read-back exists.
 */
function fakeDrive(overrides = {}) {
  const state = { files: new Map(), folders: new Map(), calls: [] };
  const base = {
    state,
    async getAccessToken() { state.calls.push('token'); return { ok: true, data: { accessToken: 't' } }; },
    async getFileMetadata(token, id) {
      state.calls.push(`meta:${id}`);
      if (id === 'PARENT') return { ok: true, data: { id, name: 'Starcaster', mimeType: 'application/vnd.google-apps.folder' } };
      const f = state.files.get(id);
      if (!f) return { ok: false, error: `no such file ${id}` };
      return { ok: true, data: { id, name: f.name, size: String(f.bytes), webViewLink: `https://drive/${id}` } };
    },
    async findFolderByName(token, parentId, name) {
      state.calls.push(`findFolder:${name}`);
      const hit = [...state.folders.entries()].find(([, f]) => f.name === name && f.parent === parentId);
      return { ok: true, data: hit ? { id: hit[0], name } : null };
    },
    async createFolder(token, parentId, name) {
      state.calls.push(`createFolder:${name}`);
      const id = `folder-${state.folders.size + 1}`;
      state.folders.set(id, { name, parent: parentId });
      return { ok: true, data: { id, name } };
    },
    async findFileByName(token, parentId, name) {
      state.calls.push(`findFile:${name}`);
      const hit = [...state.files.entries()].find(([, f]) => f.name === name && f.parent === parentId);
      return { ok: true, data: hit ? { id: hit[0], name } : null };
    },
    async uploadFile({ folderId, fileName, fileBuffer }) {
      state.calls.push(`upload:${fileName}`);
      const id = `file-${state.files.size + 1}`;
      state.files.set(id, { name: fileName, parent: folderId, bytes: fileBuffer.length });
      return { ok: true, data: { id } };
    },
    async updateFileMedia({ fileId, fileBuffer }) {
      state.calls.push(`update:${fileId}`);
      const f = state.files.get(fileId);
      f.bytes = fileBuffer.length;
      return { ok: true, data: { id: fileId } };
    },
  };
  return Object.assign(base, overrides);
}

function edition(tmp, name = '2026-09-14') {
  fs.mkdirSync(tmp, { recursive: true });
  const html = path.join(tmp, `${name}.html`);
  const json = path.join(tmp, `${name}.data.json`);
  const index = path.join(tmp, 'index.html');
  fs.writeFileSync(html, '<!doctype html>the figures\n');
  fs.writeFileSync(json, '{"window":{}}\n');
  fs.writeFileSync(index, '<!doctype html>the editions\n');
  return [html, json, index];
}

const ENV = { WEEKLY_REPORT_DRIVE_FOLDER_ID: 'PARENT', WEEKLY_REPORT_DRIVE_SUBFOLDER: 'Weekly Reports' };

test('an edition lands in Projects › Starcaster › Weekly Reports, creating the sub-folder once', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-up-'));
  try {
    const files = edition(tmp);
    const d = fakeDrive();

    const first = await drive.uploadEdition({ files, env: ENV }, d);
    assert.equal(first.ok, true, first.error);
    assert.deepEqual(first.uploaded.map((f) => f.name).sort(),
      ['2026-09-14.data.json', '2026-09-14.html', 'index.html']);
    assert.equal(d.state.calls.filter((c) => c.startsWith('createFolder')).length, 1);

    // Run it again — a Monday that failed halfway does get run again. The same
    // three names must be UPDATED, not duplicated: Drive has no unique-name
    // rule, so two files called 2026-09-14.html would sit side by side with
    // nothing saying which is current.
    const second = await drive.uploadEdition({ files, env: ENV }, d);
    assert.equal(second.ok, true, second.error);
    assert.equal(d.state.files.size, 3, 'the second run duplicated files in the folder');
    assert.equal(d.state.calls.filter((c) => c.startsWith('createFolder')).length, 1,
      'and it found the existing folder instead of making a second one');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('bytes that did not land are a FAILURE, however cheerful Drive was about it', async () => {
  // The break test for the read-back. Drive answers 200 with a file id, and the
  // stored size is wrong — the exact shape of a write that reports success and
  // changes nothing (CLAUDE.md landmine 15).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-up-short-'));
  try {
    const files = edition(tmp);
    const d = fakeDrive();
    const honest = d.uploadFile;
    d.uploadFile = async (args) => {
      const res = await honest(args);
      d.state.files.get(res.data.id).bytes = 0;   // "stored", empty
      return res;
    };

    const result = await drive.uploadEdition({ files, env: ENV }, d);
    assert.equal(result.ok, false, 'an empty file in Drive was reported as a success');
    assert.match(result.error, /did not land whole/);
    assert.match(result.error, /bytes here and Drive reports/, 'and it prints both numbers');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Drive reporting no size at all is also a failure, not a pass by default', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-up-nosize-'));
  try {
    const files = edition(tmp);
    const d = fakeDrive({
      async getFileMetadata(token, id) {
        if (id === 'PARENT') return { ok: true, data: { id, mimeType: 'application/vnd.google-apps.folder' } };
        return { ok: true, data: { id, name: 'x', webViewLink: 'https://drive/x' } };  // no size
      },
    });
    const result = await drive.uploadEdition({ files, env: ENV }, d);
    assert.equal(result.ok, false, 'an unreadable size must not count as a match');
    assert.match(result.error, /no size at all/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an expired Google sign-in says it needs a browser login, and whose', async () => {
  // This is the live state of the credential as of 2026-09-14 — Google answers
  // `invalid_grant` — so it is the message the first real run will produce.
  // "invalid_grant" on its own has cost this repo hours.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-up-auth-'));
  try {
    const files = edition(tmp);
    // THE EXACT STRING THE LIVE CREDENTIAL PRODUCED on 2026-09-14. Google's
    // error_description for a dead refresh token is the words "Bad Request",
    // which names nothing — the cause is in `error`. lib/googleDrive.js used to
    // prefer the description and drop the code, so this message was unreachable
    // in real life while passing a test written against a tidier fixture.
    const d = fakeDrive({ async getAccessToken() { return { ok: false, error: 'invalid_grant: Bad Request' }; } });
    const result = await drive.uploadEdition({ files, env: ENV }, d);
    assert.equal(result.ok, false);
    assert.match(result.error, /browser login/);
    assert.match(result.error, /mentor24@gmail\.com/, 'and names the account it has to be');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a parent folder that cannot be opened is reported before anything is written', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-up-parent-'));
  try {
    const files = edition(tmp);
    const d = fakeDrive({ async getFileMetadata() { return { ok: false, error: 'File not found: PARENT.' }; } });
    const result = await drive.uploadEdition({ files, env: ENV }, d);
    assert.equal(result.ok, false);
    assert.match(result.error, /could not be opened by the account/);
    assert.ok(!d.state.calls.some((c) => c.startsWith('createFolder')), 'and it made no folder on the way');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('nothing on disk is a failure, not an empty success', async () => {
  const result = await drive.uploadEdition(
    { files: ['/nowhere/2026-09-14.html'], env: ENV },
    fakeDrive(),
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /nothing on disk/);
  assert.deepEqual(result.skipped, ['2026-09-14.html']);
});

test('the committed folder id is the one under Projects on mentor24, not the other Starcaster', () => {
  assert.equal(drive.DEFAULT_PARENT_FOLDER_ID, '1cnnlchiXlFQj_D_iv-x0mj1P1TGqP8KC');
  assert.equal(drive.driveConfig({}).subfolder, 'Weekly Reports');
  assert.equal(drive.driveConfig({ WEEKLY_REPORT_DRIVE_SUBFOLDER: 'Other' }).subfolder, 'Other');
});

test('a failed Google sign-in keeps the error CODE, not just the description', () => {
  // The other half of the test above, at the source. `invalid_grant` is the
  // only actionable word Google sends back; "Bad Request" is the description
  // that accompanies it and says nothing at all.
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'lib', 'googleDrive.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function getAccessToken('), src.indexOf('async function fetchDriveFileMedia('));
  assert.match(fn, /\[code, detail\]/, 'both halves are reported');
  assert.ok(!/payload\.error_description \|\| payload\.error/.test(fn),
    'the description must not be preferred over the code — that is what hid invalid_grant');
});
