'use strict';

/**
 * Put a weekly report edition in Google Drive — Projects › Starcaster ›
 * Weekly Reports — and READ IT BACK before calling that a success.
 *
 * WHY (task 86bc0nbwq). The report used to publish itself by committing into
 * docs/reports/ and opening a pull request, which meant every run dirtied the
 * checkout it ran from and switched off that machine's self-update. Dane,
 * 2026-09-14: "It shouldn't be saved to the Mini. It should either be saved to
 * the MacBook and/or Google Drive in the Projects/Starcaster folder in a
 * dedicated sub-folder."
 *
 * THE READ-BACK IS THE POINT, not decoration. Every other silent-success
 * incident in this repo has the same shape — a write that reported 200 and
 * changed nothing (CLAUDE.md landmine 15, DOCTRINE §5.21). An upload is exactly
 * that shape: Drive answers 200 with a file id, and the id alone does not say
 * the bytes arrived. So after every upload this asks Drive for the file it just
 * wrote and compares the size Drive reports with the size on disk. A mismatch
 * is a FAILURE, not a warning.
 *
 * THE CLIENT IS INJECTED so the whole thing is testable without a network, a
 * token, or Dane's Google account. `uploadEdition({ ... }, fakeDrive)` drives
 * every branch below; the default is the real lib/googleDrive.js.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Projects › Starcaster on the mentor24@gmail.com account.
 * https://drive.google.com/drive/folders/1cnnlchiXlFQj_D_iv-x0mj1P1TGqP8KC
 *
 * A folder id is not a secret — it is in the ticket, and it names a place
 * rather than granting access to it — so it is committed rather than being a
 * Doppler value nobody can see. A SECOND folder called "Starcaster" exists on
 * mentorofaio@gmail.com and is not under Projects: not this one.
 */
const DEFAULT_PARENT_FOLDER_ID = '1cnnlchiXlFQj_D_iv-x0mj1P1TGqP8KC';
const DEFAULT_SUBFOLDER = 'Weekly Reports';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function mimeTypeFor(filePath) {
  if (/\.html?$/i.test(filePath)) return 'text/html';
  if (/\.json$/i.test(filePath)) return 'application/json';
  return 'application/octet-stream';
}

function driveConfig(env = process.env) {
  return {
    parentFolderId: String(env.WEEKLY_REPORT_DRIVE_FOLDER_ID || '').trim() || DEFAULT_PARENT_FOLDER_ID,
    subfolder: String(env.WEEKLY_REPORT_DRIVE_SUBFOLDER || '').trim() || DEFAULT_SUBFOLDER,
  };
}

/**
 * Turn a failed step into the sentence the Monday log and the bus will carry.
 *
 * Kept separate, and pure, because the ONE message an unattended job produces
 * is the whole of what a person gets to act on. `invalid_grant` on its own has
 * cost this repo hours; "the sign-in has expired and only Dane can renew it"
 * has not.
 */
function explainFailure(step, error) {
  const raw = String(error || 'no reason given');
  if (/invalid_grant|Token has been expired|revoked/i.test(raw)) {
    return `Google has stopped accepting the saved Drive sign-in (${raw}). Nothing this `
      + 'machine can do renews it: it takes a browser login on the mentor24@gmail.com '
      + 'account to mint a new refresh token (scripts/get_google_drive_refresh_token.cjs), '
      + 'which is Dane\'s step.';
  }
  if (/not configured/i.test(raw)) {
    return `Google Drive is not set up on this machine (${raw}). The report was written `
      + 'locally and uploaded nowhere.';
  }
  return `${step} failed: ${raw}`;
}

/**
 * Upload one edition.
 *
 * files  — absolute paths. Missing ones are skipped and NAMED in the result;
 *          a file that silently was not there is how "uploaded" starts meaning
 *          less than it says.
 *
 * Returns { ok, folderId, folderLink, uploaded: [{ name, id, link, bytes }],
 *           skipped: [...], error }.
 */
async function uploadEdition({ files = [], env = process.env } = {}, drive = require('./googleDrive.js')) {
  const cfg = driveConfig(env);

  const present = [];
  const skipped = [];
  for (const file of files) {
    if (file && fs.existsSync(file)) present.push(file);
    else if (file) skipped.push(path.basename(file));
  }
  if (!present.length) {
    return { ok: false, uploaded: [], skipped, error: 'there was nothing on disk to upload' };
  }

  const auth = await drive.getAccessToken();
  if (!auth.ok) return { ok: false, uploaded: [], skipped, error: explainFailure('signing in to Google Drive', auth.error) };
  const token = auth.data.accessToken;

  // THE PARENT IS CONFIRMED BEFORE ANYTHING IS WRITTEN. A folder id that has
  // been deleted, renamed away or never shared with this account would
  // otherwise surface as a create-folder failure halfway through, and "could
  // not create Weekly Reports" sends whoever reads it to the wrong question.
  const parent = await drive.getFileMetadata(token, cfg.parentFolderId);
  if (!parent.ok) {
    return {
      ok: false,
      uploaded: [],
      skipped,
      error: `the Drive folder this report is meant to live in (${cfg.parentFolderId}) could not be `
        + `opened by the account this machine signs in as: ${parent.error}`,
    };
  }
  if (parent.data.mimeType !== FOLDER_MIME) {
    return {
      ok: false,
      uploaded: [],
      skipped,
      error: `${cfg.parentFolderId} is not a folder — Drive calls it a ${parent.data.mimeType}`,
    };
  }

  let folderId;
  const existing = await drive.findFolderByName(token, cfg.parentFolderId, cfg.subfolder);
  if (!existing.ok) return { ok: false, uploaded: [], skipped, error: explainFailure(`looking for "${cfg.subfolder}"`, existing.error) };
  if (existing.data) {
    folderId = existing.data.id;
  } else {
    const made = await drive.createFolder(token, cfg.parentFolderId, cfg.subfolder);
    if (!made.ok) return { ok: false, uploaded: [], skipped, error: explainFailure(`creating "${cfg.subfolder}"`, made.error) };
    folderId = made.data.id;
  }

  const uploaded = [];
  for (const file of present) {
    const name = path.basename(file);
    const buffer = fs.readFileSync(file);
    const mimeType = mimeTypeFor(file);

    // Same name, same file. Re-running a Monday — which happens, because a run
    // that failed halfway gets run again — must not leave two editions side by
    // side with no way to tell which is current.
    const found = await drive.findFileByName(token, folderId, name);
    if (!found.ok) return { ok: false, uploaded, skipped, error: explainFailure(`looking for ${name} in Drive`, found.error) };

    const written = found.data
      ? await drive.updateFileMedia({ token, fileId: found.data.id, mimeType, fileBuffer: buffer })
      : await drive.uploadFile({ token, folderId, fileName: name, mimeType, fileBuffer: buffer });
    if (!written.ok) return { ok: false, uploaded, skipped, error: explainFailure(`uploading ${name}`, written.error) };

    const id = written.data && written.data.id;
    if (!id) {
      return { ok: false, uploaded, skipped, error: `Drive accepted ${name} but named no file id, so there is nothing to check` };
    }

    // READ IT BACK. See the header: a 200 is not evidence the bytes landed.
    const back = await drive.getFileMetadata(token, id);
    if (!back.ok) return { ok: false, uploaded, skipped, error: `${name} was uploaded but could not be read back: ${back.error}` };
    const reported = Number(back.data.size);
    if (!Number.isFinite(reported) || reported !== buffer.length) {
      return {
        ok: false,
        uploaded,
        skipped,
        error: `${name} is ${buffer.length} bytes here and Drive reports ${back.data.size === undefined ? 'no size at all' : `${back.data.size} bytes`} `
          + 'for the file it says it stored — the upload did not land whole',
      };
    }

    uploaded.push({ name, id, link: back.data.webViewLink || null, bytes: buffer.length });
  }

  return {
    ok: true,
    folderId,
    folderLink: `https://drive.google.com/drive/folders/${folderId}`,
    uploaded,
    skipped,
    error: null,
  };
}

module.exports = {
  DEFAULT_PARENT_FOLDER_ID,
  DEFAULT_SUBFOLDER,
  driveConfig,
  explainFailure,
  mimeTypeFor,
  uploadEdition,
};
