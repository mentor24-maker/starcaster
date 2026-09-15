'use strict';

/**
 * The Studio's eye on Google Drive (Studio Phase 1 · 3 of 8).
 *
 * It watches two folders that mean different things, and turns a new file in
 * either of them into exactly one job on the local queue. It downloads
 * nothing — that is 4 of 8.
 *
 * THE CHANGES FEED, NOT A FOLDER LISTING. Listing a folder returns everything
 * that has ever been put in it, so the cost of "is there anything new?" grows
 * with the size of the archive and eventually stops answering at all. The
 * changes feed answers with what has moved since a token, so a quiet hour
 * costs one request whether the folder holds ten files or ten thousand. The
 * token is kept in the queue's `drive_cursor` table, which is what makes a
 * restart cheap AND silent: the watcher resumes where it left off instead of
 * re-emitting every file it has ever seen.
 *
 * THE FEED IS ACCOUNT-WIDE. There is one changes stream per account (or per
 * shared drive), not one per folder, so both watched folders are read out of
 * the same stream and told apart by each file's `parents`. One stream means
 * one cursor; two cursors over one stream would each advance past the other's
 * changes and both would miss files.
 *
 * WHAT THE WATCHER DOES AND DOES NOT KNOW ABOUT A FILE. A file in
 * `/Studio/Plates/` is a plate — that is what the folder MEANS, so the role is
 * known for certain and is stamped on the job. A file in `/Studio/Inbox/` is
 * footage, and whether it is the wide shot or the person on camera is NOT
 * knowable from the folder; Studio 5/8 infers that from container metadata.
 * So the inbox lane deliberately emits NO role rather than a plausible guess.
 * An unmeasured value stated confidently is the mistake `sync_offset_ms` was
 * redesigned to avoid in 1/8, and it is the same mistake here.
 *
 * NEVER A RETRY STORM. An expired token and a quota refusal are not transient
 * and do not get better by being asked again ninety seconds later; they get
 * better when a person fixes the credential. Both raise ONE blocked job that
 * keeps its reason and is refreshed rather than duplicated on each pass, and
 * the pass stops. A clean pass afterwards clears it and says so — an alarm
 * that cannot stand down is an alarm that gets ignored.
 *
 * NO `setInterval` AT MODULE SCOPE (DOCTRINE 5.2). This module never schedules
 * anything; the daemon that runs it on a timer is Studio 7/8's problem.
 */

const googleDrive = require('../../lib/googleDrive.js');

/** The stage a watched file is queued for. Ingest (4/8) claims these. */
const STAGE_INGEST = 'ingest';
const SUBJECT_DRIVE_FILE = 'drive_file';

/**
 * The watcher's own health flag lives on the queue as a job like any other, so
 * one place answers "what is wrong with the pipeline?".
 */
const STAGE_WATCH = 'drive.watch';
const SUBJECT_WATCH = 'drive_watch';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * The two folders, and what each one MEANS.
 *
 * `layerRole: null` on the inbox lane is a deliberate blank, not an oversight
 * — see the note at the top of the file. `transcribe: false` on plates is the
 * half of this that protects real money: a plate is a screen recording with no
 * speech in it, and transcribing every one of them would spend an AI budget on
 * silence.
 */
const LANES = Object.freeze({
  inbox: Object.freeze({
    key: 'inbox',
    path: '/Studio/Inbox/',
    layerRole: null,
    transcribe: true,
  }),
  plates: Object.freeze({
    key: 'plates',
    path: '/Studio/Plates/',
    layerRole: 'plate',
    transcribe: false,
  }),
});

/**
 * What the pipeline can actually work with. Anything else in a watched folder
 * is skipped WITH A REASON rather than ignored — a stray PDF in the Inbox is a
 * perfectly ordinary thing for somebody to drop there, and the run report has
 * to be able to say "I saw it and here is why I left it alone" (DOCTRINE 3.11).
 */
function isMediaMimeType(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  return mime.startsWith('video/') || mime.startsWith('audio/');
}

/**
 * Is this failure the credential being wrong, rather than the network having a
 * bad moment?
 *
 * Asked from the status AND Google's own `reason`, because Drive answers 403
 * both for "this credential may not do that" and for "you are going too fast",
 * and those want opposite handling.
 */
function classifyDriveFailure(res) {
  const status = Number(res && res.status) || 0;
  const reason = String((res && res.reason) || '').trim();
  const message = String((res && res.error) || '').trim();

  const quotaReasons = new Set([
    'userRateLimitExceeded', 'rateLimitExceeded', 'quotaExceeded',
    'storageQuotaExceeded', 'dailyLimitExceeded', 'backendError',
  ]);
  if (status === 429 || quotaReasons.has(reason)) {
    return { kind: 'quota', status, reason, message };
  }
  if (status === 401 || reason === 'authError' || reason === 'invalid_grant') {
    return { kind: 'auth', status, reason, message };
  }
  if (status === 403) {
    // 403 with no quota reason is a permission answer: the credential is
    // valid and is not allowed to see this.
    return { kind: 'permission', status, reason, message };
  }
  if (status === 404) return { kind: 'missing', status, reason, message };
  return { kind: 'transient', status, reason, message };
}

/**
 * Does this failure mean "stop and wait for a person", rather than "try later"?
 *
 * `wrong_drive` and `same_folder` never come out of `classifyDriveFailure` —
 * they are configuration, not something Drive said — but they are named here
 * because they are the most person-shaped failures in the file, and a future
 * caller asking this question about one of them must not be told "try later".
 */
function needsAPerson(kind) {
  return kind === 'auth' || kind === 'quota' || kind === 'permission' || kind === 'missing'
    || kind === 'wrong_drive' || kind === 'same_folder';
}

/**
 * The plain-English fix for each way this can go wrong.
 *
 * A blocked job whose reason is "403" tells whoever reads it nothing they can
 * act on. Each of these names the actual next move, and the account ones name
 * BOTH accounts, because the Studio folders and the OAuth token have belonged
 * to different Google accounts from the beginning: the footage lives on
 * `mentorofaio`, the token is `mentor24`'s, and a folder the token cannot see
 * looks exactly like a folder that does not exist.
 */
function fixFor(kind, { account = '', folderPath = '', folderId = '', message = '' } = {}) {
  const who = account ? `The Drive token belongs to ${account}` : 'The Drive token\'s account could not be read';
  switch (kind) {
    case 'auth':
      return 'The Google Drive token is expired or has been revoked, so nothing can be read. '
        + 'Fix: re-mint the refresh token for the account that owns /Studio/ and put it in '
        + 'Settings > APIs (or GOOGLE_DRIVE_REFRESH_TOKEN). '
        + `Drive said: ${message || 'no message'}`;
    case 'quota':
      return 'Google Drive refused the request for quota or rate reasons, so this pass read nothing. '
        + 'Fix: nothing to change — this clears on its own once the quota window resets. '
        + 'If it keeps happening, the watch interval is too tight for the account. '
        + `Drive said: ${message || 'no message'}`;
    case 'permission':
      return `The Drive token may not see ${folderPath || 'the watched folder'} (id ${folderId || 'unknown'}), so no footage can be picked up. `
        + `${who}. If /Studio/ lives on a different account, either share that folder with the token's account or re-mint the token for the account that owns it. `
        + `Drive said: ${message || 'no message'}`;
    case 'missing':
      return `The watched folder ${folderPath || ''} (id ${folderId || 'unknown'}) does not exist, or is invisible to this credential. `
        + `${who}. Check the folder id in the Studio settings, and check it against the account that actually owns /Studio/. `
        + `Drive said: ${message || 'no message'}`;
    case 'wrong_drive':
      // THE WATCHER IS READING A FEED THE FOLDER IS NOT IN. There is one
      // changes stream per drive, so a folder on a shared drive is invisible
      // to My Drive's stream and vice versa. Nothing fails, nothing is
      // skipped, and the pass reports a clean zero for ever — which is the
      // shape landmine 17 is about, and the ticket's own Account trap.
      return `${folderPath || 'the watched folder'} (id ${folderId || 'unknown'}) is on a different Google drive `
        + 'from the changes feed this watcher is reading, so nothing in it will ever be picked up. '
        + `${message}. `
        + 'Fix: set STUDIO_DRIVE_ID to the drive the Studio folders actually live on (blank means My Drive), '
        + 'or move /Studio/ onto that drive. Both watched folders must be on the SAME drive.';
    case 'same_folder':
      return 'The Inbox and Plates folder ids are the same, so every file would be filed as a plate '
        + 'and never transcribed. '
        + `${message}. `
        + 'Fix: point STUDIO_DRIVE_INBOX_FOLDER_ID and STUDIO_DRIVE_PLATES_FOLDER_ID at the two different folders.';
    default:
      return `Google Drive could not be read: ${message || 'no message'}`;
  }
}

/** The real Drive, behind the same small interface a test hands in. */
function realDriveClient() {
  return {
    getAccessToken: () => googleDrive.getAccessToken(),
    getAccount: (token) => googleDrive.getDriveAccount(token),
    getFolder: (token, folderId) => googleDrive.getDriveFolder(token, folderId),
    getStartPageToken: (token, opts) => googleDrive.getDriveStartPageToken(token, opts),
    listChanges: (token, opts) => googleDrive.listDriveChanges(token, opts),
  };
}

/** Folder ids come from settings/env — never from a path guessed at runtime. */
function resolveFolders(options = {}, env = process.env) {
  const inbox = String(options.inboxFolderId || env.STUDIO_DRIVE_INBOX_FOLDER_ID || '').trim();
  const plates = String(options.platesFolderId || env.STUDIO_DRIVE_PLATES_FOLDER_ID || '').trim();
  return { inbox, plates };
}

/**
 * The cursor's name. One per drive, because one changes feed is one drive.
 *
 * Keyed by the drive rather than by the folder on purpose: two cursors over
 * one feed would each advance past the other's changes, and each would miss
 * every file the other consumed.
 */
function cursorResource(driveId) {
  return `changes:${String(driveId || '').trim() || 'my-drive'}`;
}

/**
 * Look at Drive once and queue whatever is new.
 *
 * Returns a REPORT, always — processed, skipped and failed, each entry with a
 * reason, plus anything the pass could not check at all. It does not throw for
 * an ordinary Drive failure: a watcher that dies on a bad afternoon is a
 * watcher that has to be restarted by somebody who is asleep.
 */
async function watchDrive(options = {}) {
  const {
    queue,
    drive = realDriveClient(),
    env = process.env,
    driveId = String(options.driveId || (options.env || process.env).STUDIO_DRIVE_ID || '').trim(),
    pageSize = 100,
    maxPages = 50,
  } = options;

  if (!queue) throw new Error('watchDrive needs a queue (workers/studio/queue.js)');

  const resource = cursorResource(driveId);
  const report = {
    ok: false,
    account: null,
    resource,
    cursor: { before: '', after: '', initialised: false },
    processed: [],
    skipped: [],
    failed: [],
    // NOT the same thing as `skipped`, and the difference is what keeps this
    // report readable on a real account. The changes feed is account-wide, so
    // the overwhelming majority of what arrives is somebody's holiday video
    // that has nothing to do with the Studio. Listing each one by name would
    // bury the three lines that matter under five thousand that do not — and a
    // report nobody can read is a report nobody reads. They are COUNTED, by
    // category, with a handful of examples kept so a "why did it not pick up
    // my file?" question is still answerable. `skipped` stays reserved for a
    // file that really was in a watched folder and was declined anyway.
    ignored: { count: 0, byReason: {}, sample: [] },
    unchecked: [],
    // THE SUBSET OF `unchecked` THAT MAKES THE VERDICT A CANNOT-TELL.
    //
    // Not everything in `unchecked` is a failed reading. "Plates is not
    // configured" and "stopped after 50 pages, the cursor is saved" are both
    // stated, self-correcting facts about a pass that worked; gating the
    // verdict on the whole list would wedge a one-lane install at
    // FINISHED WITH FAILURES for ever, which is its own permanent false alarm.
    // What goes in HERE is the other kind: a check this pass needed and could
    // not take. Those are the ones that must not be reported as a clean pass
    // and must never stand an alarm down (DOCTRINE 3.11, CLAUDE.md §"Read the
    // exit code": a 2 is not a 0).
    blind: [],
    blocked: null,
    recovered: false,
    // Set when a page was READ but deliberately not stepped over, because
    // something on it could not be queued. See the paging loop.
    cursorHeld: false,
    pagesRead: 0,
  };

  /** Something this pass needed to check and could not. Says so in both lists. */
  const cannotTell = (note) => {
    report.blind.push(note);
    report.unchecked.push(note);
  };

  /** Raise the one blocked job, refresh its reason, and stop the pass. */
  const stopBlocked = (kind, detail) => {
    const reason = fixFor(kind, detail);
    const { job, created } = queue.block({
      stage: STAGE_WATCH,
      subjectKind: SUBJECT_WATCH,
      subjectId: resource,
      reason,
      payload: {
        kind,
        driveId: driveId || null,
        account: report.account,
        folderId: detail.folderId || null,
        folderPath: detail.folderPath || null,
      },
    });
    report.blocked = { jobId: job.id, kind, reason, firstTime: created };
    report.ok = false;
    return report;
  };

  const folders = resolveFolders(options, env);
  // TWO LANES, ONE FOLDER ID, NO NOISE AT ALL. `watched` below is a Map keyed
  // by folder id, so the second lane written wins — and the second lane is
  // plates, whose whole meaning is "never transcribe this". Point both
  // settings at the same folder by accident and every interview in the Inbox
  // is filed as a plate and silently never transcribed, with a clean green
  // report and nothing in NOT CHECKED. Caught here, before any Drive call.
  if (folders.inbox && folders.plates && folders.inbox === folders.plates) {
    return stopBlocked('same_folder', {
      folderPath: '/Studio/Inbox/ and /Studio/Plates/',
      folderId: folders.inbox,
      message: `both are set to ${folders.inbox}`,
    });
  }
  if (!folders.inbox && !folders.plates) {
    return stopBlocked('missing', {
      folderPath: '/Studio/Inbox/ and /Studio/Plates/',
      message: 'neither STUDIO_DRIVE_INBOX_FOLDER_ID nor STUDIO_DRIVE_PLATES_FOLDER_ID is set, '
        + 'so there is nothing to watch',
    });
  }

  // --- the credential ------------------------------------------------------
  const tokenRes = await drive.getAccessToken();
  if (!tokenRes || !tokenRes.ok) {
    const failure = classifyDriveFailure(tokenRes || {});
    // A token exchange that fails for ANY reason leaves the watcher blind, so
    // a transient one still stops the pass — but it is filed as WHAT IT IS.
    // Until round 2 this line read `failure.kind === 'transient' ? 'auth' : ...`,
    // which did the exact opposite of the sentence above it: an unreachable
    // OAuth host told Dane to re-mint a refresh token that was perfectly fine.
    // `fixFor`'s default branch already writes the honest version, which is
    // "Google Drive could not be read: <what happened>" and no errand.
    return stopBlocked(failure.kind, {
      message: (tokenRes && tokenRes.error) || 'no message',
    });
  }
  const token = tokenRes.data.accessToken;

  // --- WHICH ACCOUNT IS THIS? (the account trap, named on the ticket) ------
  // The footage lives on one Google account and the OAuth token has always
  // belonged to another. Every folder failure below reads identically to "that
  // folder does not exist", so the run report says whose credential it is
  // whether or not anything went wrong — that one line is what turns a
  // baffling 404 into an obvious account mismatch.
  const accountRes = await drive.getAccount(token);
  if (accountRes && accountRes.ok) {
    report.account = String(accountRes.data?.user?.emailAddress || '').trim() || null;
  } else {
    report.unchecked.push(
      'which Google account this token belongs to could not be read '
      + `(${(accountRes && accountRes.error) || 'no message'}) — a folder error below cannot be `
      + 'attributed to an account mismatch'
    );
  }

  // --- can this credential actually see the folders? -----------------------
  const watched = new Map();
  for (const lane of Object.values(LANES)) {
    const folderId = folders[lane.key];
    if (!folderId) {
      // A NOTE, NOT A BLIND SPOT. This is a stated, permanent fact about how
      // the watcher is configured, not a reading that failed — running one
      // lane on purpose is legitimate, and making it a blind spot would hold
      // the verdict at "could not tell" on every pass for ever.
      report.unchecked.push(
        `${lane.path} is not configured (STUDIO_DRIVE_${lane.key.toUpperCase()}_FOLDER_ID is unset), `
        + 'so nothing in it will ever be picked up'
      );
      continue;
    }
    const folderRes = await drive.getFolder(token, folderId);
    if (!folderRes || !folderRes.ok) {
      const failure = classifyDriveFailure(folderRes || {});
      if (needsAPerson(failure.kind)) {
        return stopBlocked(failure.kind, {
          account: report.account,
          folderPath: lane.path,
          folderId,
          message: failure.message,
        });
      }
      // A FOLDER THIS PASS COULD NOT CONFIRM IS A BLIND SPOT, not a note.
      // Round 2 measured the cost: a real 403 raised the alarm on pass 1, a
      // 502 on `getFolder` left pass 2 unable to confirm anything, and the
      // pass cleared the alarm and said "Drive is readable again" — on the
      // strength of a check that did not run. `cannotTell` is what keeps the
      // verdict honest and the recovery locked.
      cannotTell(
        `${lane.path} (id ${folderId}) could not be confirmed this pass (${failure.message || 'no message'}); `
        + 'files in it are still read from the changes feed'
      );
      watched.set(folderId, lane);
      continue;
    }

    // WHICH DRIVE IS THIS FOLDER ON? `getDriveFolder` already asks for
    // `driveId` and the answer was being thrown away. There is one changes
    // feed per drive, so a /Studio/ that lives on a SHARED drive is simply not
    // in My Drive's feed: the watcher reads the wrong stream, finds nothing,
    // for ever, and reports a clean pass every time with nothing in NOT
    // CHECKED. That is landmine 17 exactly, and it is the ticket's own Account
    // trap paragraph coming true. Absent means My Drive, which is what Drive
    // returns for an ordinary folder — so "" and "" match and the common case
    // is untouched.
    const folderDrive = String(folderRes.data?.driveId || '').trim();
    if (folderDrive !== driveId) {
      return stopBlocked('wrong_drive', {
        account: report.account,
        folderPath: lane.path,
        folderId,
        message: `the folder reports drive ${folderDrive || 'My Drive'}, `
          + `the watcher is reading ${resource}`,
      });
    }
    watched.set(folderId, lane);
  }

  if (!watched.size) {
    return stopBlocked('missing', {
      account: report.account,
      folderPath: '/Studio/Inbox/ and /Studio/Plates/',
      message: 'no watched folder could be resolved, so the pass has nothing to look at',
    });
  }

  // --- the cursor ----------------------------------------------------------
  const existing = String(queue.getCursor(resource) || '').trim();
  report.cursor.before = existing;

  if (!existing) {
    // FIRST EVER RUN. The starting token means "changes from this moment on",
    // which is exactly right: the alternative is replaying the entire history
    // of the account and queueing every file that has ever existed. Nothing is
    // emitted on this pass, and that is the correct outcome, not a miss.
    const startRes = await drive.getStartPageToken(token, { driveId });
    if (!startRes || !startRes.ok) {
      const failure = classifyDriveFailure(startRes || {});
      if (needsAPerson(failure.kind)) {
        return stopBlocked(failure.kind, { account: report.account, message: failure.message });
      }
      report.failed.push({
        fileId: null,
        name: resource,
        reason: `the starting page token could not be fetched: ${failure.message || 'no message'}`,
      });
      return report;
    }
    const startToken = String(startRes.data?.startPageToken || '').trim();
    if (!startToken) {
      report.failed.push({
        fileId: null,
        name: resource,
        reason: 'Drive returned no startPageToken, so there is no point to watch from',
      });
      return report;
    }
    queue.setCursor(resource, startToken);
    report.cursor.after = startToken;
    report.cursor.initialised = true;
    // Same gate as the end of a normal pass: a first run whose folder checks
    // could not be taken has not proved Drive is readable, so it does not get
    // to stand an existing alarm down.
    report.ok = report.blind.length === 0;
    if (report.ok) report.recovered = clearAnyBlock(queue, resource);
    return report;
  }

  // --- page through what has changed --------------------------------------
  let cursor = existing;
  let pages = 0;

  while (cursor && pages < maxPages) {
    const pageRes = await drive.listChanges(token, { pageToken: cursor, driveId, pageSize });
    if (!pageRes || !pageRes.ok) {
      const failure = classifyDriveFailure(pageRes || {});
      if (needsAPerson(failure.kind)) {
        return stopBlocked(failure.kind, { account: report.account, message: failure.message });
      }
      // A transient failure keeps the cursor where it is, so the next pass
      // re-reads this page rather than stepping over it.
      report.failed.push({
        fileId: null,
        name: resource,
        reason: `a page of changes could not be read: ${failure.message || 'no message'}`,
      });
      break;
    }
    pages += 1;
    report.pagesRead = pages;

    const changes = Array.isArray(pageRes.data?.changes) ? pageRes.data.changes : [];
    const failedBefore = report.failed.length;
    for (const change of changes) {
      consumeChange(change, { queue, watched, report });
    }

    // A FILE THAT COULD NOT BE QUEUED MUST NOT BE STEPPED OVER.
    //
    // Drive never re-reports an unchanged file, so a cursor advanced past a
    // page whose `enqueue` threw takes that footage out of reach of
    // everything, permanently — the report names it and no pass can ever pick
    // it up again. Round 2 measured it: one SQLITE_BUSY on a change, and pass
    // B queued nothing because the file was already behind the cursor.
    //
    // This is the same move the transient page-read failure above makes, for
    // the same reason, and it is safe for the same reason the crash case is:
    // re-reading the page re-offers everything that DID queue, and the
    // queue's dedupe turns each of those back into the job it already made.
    if (report.failed.length > failedBefore) {
      report.cursorHeld = true;
      break;
    }

    const next = String(pageRes.data?.nextPageToken || '').trim();
    const newStart = String(pageRes.data?.newStartPageToken || '').trim();

    // SAVE AFTER PROCESSING, NEVER BEFORE. A crash between the enqueue and the
    // save costs a re-read of this page next time, and the queue's own
    // idempotency turns that back into one job. Saving first would lose the
    // page outright, which nothing downstream could recover from.
    if (next) {
      queue.setCursor(resource, next);
      report.cursor.after = next;
      cursor = next;
      continue;
    }
    if (newStart) {
      // Caught up. This is the token to resume from next time.
      queue.setCursor(resource, newStart);
      report.cursor.after = newStart;
      cursor = '';
      break;
    }
    // Neither token came back, which should not happen. Leave the cursor alone
    // rather than guessing, and say so. A blind spot rather than a note: Drive
    // answered in a shape this code does not understand, so whether the pass
    // saw everything is exactly what cannot be told.
    cannotTell(
      'Drive returned a page with neither nextPageToken nor newStartPageToken, '
      + 'so the cursor was left where it was and this page will be read again'
    );
    break;
  }

  if (pages >= maxPages && cursor) {
    report.unchecked.push(
      `stopped after ${maxPages} pages with more changes waiting — the cursor is saved, `
      + 'so the next pass picks up exactly where this one stopped'
    );
  }

  // THREE OUTCOMES, NOT TWO. `failed` is "this pass looked and something went
  // wrong"; `blind` is "this pass could not look". Until round 2 only the
  // first was consulted, so a pass that confirmed nothing reported OK and
  // cleared a live alarm. Neither one may say Drive is readable again.
  report.ok = report.failed.length === 0 && report.blind.length === 0;
  if (report.ok) report.recovered = clearAnyBlock(queue, resource);
  return report;
}

/**
 * One change from the feed -> at most one job.
 *
 * Every branch that declines to queue something RECORDS WHY. A watcher whose
 * report says "0 processed" and nothing else is indistinguishable from a
 * broken one, and the operator cannot read the database to find out which it
 * is (CLAUDE.md landmine 17).
 */
function consumeChange(change, { queue, watched, report }) {
  const fileId = String(change?.fileId || change?.file?.id || '').trim();
  const file = change?.file || null;
  const name = String(file?.name || '').trim() || fileId || '(unnamed)';

  /** Not Studio business — counted by category, never listed one by one. */
  const ignore = (reason) => {
    report.ignored.count += 1;
    report.ignored.byReason[reason] = (report.ignored.byReason[reason] || 0) + 1;
    if (report.ignored.sample.length < 5) report.ignored.sample.push({ fileId, name, reason });
  };

  if (!fileId) {
    ignore('the change carried no file id');
    return;
  }
  if (change?.removed || !file) {
    // There is no file object on a removal, so which folder it USED to be in
    // cannot be determined — claiming it was or was not ours would be a guess.
    ignore('it was removed from Drive, so which folder it was in can no longer be read');
    return;
  }

  const parents = Array.isArray(file.parents) ? file.parents.map((p) => String(p)) : [];
  const parentId = parents.find((p) => watched.has(p));
  if (!parentId) {
    ignore(parents.length
      ? 'it is elsewhere in the account, not directly inside a watched folder '
        + '(a nested sub-folder is not followed)'
      : 'it has no parent folder this credential can see');
    return;
  }

  // From here down the file IS in a watched folder, so every outcome is named
  // individually: this is the handful of lines somebody actually reads.
  const lane = watched.get(parentId);

  if (file.trashed) {
    report.skipped.push({ fileId, name, lane: lane.key, reason: 'the file is in the Drive trash' });
    return;
  }
  if (String(file.mimeType || '') === FOLDER_MIME) {
    report.skipped.push({ fileId, name, lane: lane.key, reason: 'it is a folder, not a file' });
    return;
  }
  if (!isMediaMimeType(file.mimeType)) {
    report.skipped.push({
      fileId,
      name,
      lane: lane.key,
      reason: `it is in ${lane.path} but is not video or audio (${file.mimeType || 'unknown type'})`,
    });
    return;
  }

  // "EXACTLY ONE JOB" IS SCOPED TO A LIVE ONE, AND THAT IS DELIBERATE.
  // `jobs_live_subject_idx` covers only pending and running, so once an ingest
  // job reaches `done` a later Drive change on the same file — a rename, a
  // move, a re-upload — files a fresh ingest job rather than being swallowed.
  // That is the behaviour we want here: a file that has genuinely changed
  // should be re-ingested, and the watcher cannot tell a rename from a
  // re-upload. Cheap duplicate work is 4/8's to refuse, on the `md5Checksum`
  // this payload already carries. Stated out loud because AC1 reads as
  // "exactly one job, ever", and it means "never two waiting at once".
  let result;
  try {
    result = queue.enqueue({
      stage: STAGE_INGEST,
      subjectKind: SUBJECT_DRIVE_FILE,
      subjectId: fileId,
      payload: {
        driveFileId: fileId,
        name: file.name || '',
        mimeType: file.mimeType || '',
        sizeBytes: Number(file.size) || null,
        md5Checksum: file.md5Checksum || null,
        createdTime: file.createdTime || null,
        modifiedTime: file.modifiedTime || null,
        lane: lane.key,
        folderPath: lane.path,
        folderId: parentId,
        // The two facts the rest of the pipeline reads off this job. The role
        // is null for inbox footage on purpose — 5/8 works it out.
        layerRole: lane.layerRole,
        transcribe: lane.transcribe,
      },
    });
  } catch (err) {
    report.failed.push({ fileId, name, lane: lane.key, reason: `the job could not be queued: ${err.message}` });
    return;
  }

  if (!result.created) {
    report.skipped.push({
      fileId,
      name,
      lane: lane.key,
      reason: `a job for this file is already waiting (job ${result.job.id}), so no second one was made`,
    });
    return;
  }

  report.processed.push({
    fileId,
    name,
    lane: lane.key,
    layerRole: lane.layerRole,
    transcribe: lane.transcribe,
    jobId: result.job.id,
  });
}

/**
 * Stand the alarm down after a clean pass, and say whether there was one.
 *
 * A blocked job that keeps saying "the token expired" after the token has been
 * fixed is worse than no alarm at all — it trains whoever reads the board to
 * ignore the one place the pipeline reports its own health.
 */
function clearAnyBlock(queue, resource) {
  if (typeof queue.clearBlock !== 'function') return false;
  return queue.clearBlock({
    stage: STAGE_WATCH,
    subjectKind: SUBJECT_WATCH,
    subjectId: resource,
  });
}

/**
 * The run report as something a person can read.
 *
 * Counts alone cannot tell "nothing was in the folder" from "everything in the
 * folder was rejected", and those want completely different reactions.
 */
function formatReport(report) {
  const lines = [];
  // FOUR HEADLINES, BECAUSE THERE ARE FOUR ANSWERS. "could not tell" is its
  // own line and never reads as either of the other two — the same three-verdict
  // discipline the browser gates use (CLAUDE.md §"Read the exit code").
  let headline = 'OK';
  if (!report.ok) headline = report.failed.length ? 'FINISHED WITH FAILURES' : 'COULD NOT TELL';
  lines.push(
    report.blocked
      ? `Studio Drive watch BLOCKED — ${report.blocked.kind}`
      : `Studio Drive watch ${headline}`
  );
  lines.push(`  account: ${report.account || 'could not be read'}`);
  lines.push(`  cursor:  ${report.resource}${report.cursor.initialised ? ' (started watching from now — nothing replayed)' : ''}`);
  lines.push(
    `  ${report.processed.length} queued, ${report.skipped.length} skipped, ${report.failed.length} failed, `
    + `${report.ignored.count} not Studio files, ${report.pagesRead} page(s) read`
  );

  for (const item of report.processed) {
    lines.push(`  queued   ${item.name} -> job ${item.jobId} (${item.lane}${item.layerRole ? `, ${item.layerRole}` : ''}${item.transcribe ? '' : ', never transcribed'})`);
  }
  for (const item of report.skipped) {
    lines.push(`  skipped  ${item.name} — ${item.reason}`);
  }
  for (const item of report.failed) {
    lines.push(`  FAILED   ${item.name} — ${item.reason}`);
  }
  // Counted, not listed. The categories are printed because "2,481 ignored"
  // on its own cannot tell a healthy busy account from a watcher pointed at
  // the wrong folder, and those need very different reactions.
  for (const [reason, n] of Object.entries(report.ignored.byReason)) {
    lines.push(`  ignored  ${n} change(s) — ${reason}`);
  }
  for (const note of report.unchecked) {
    lines.push(`  NOT CHECKED: ${note}`);
  }
  if (report.cursorHeld) {
    lines.push(
      '  the cursor was NOT advanced past this page, because something on it could not be '
      + 'queued — the next pass reads it again rather than losing the file'
    );
  }
  if (report.blocked) {
    lines.push(`  blocked job ${report.blocked.jobId}: ${report.blocked.reason}`);
  }
  if (report.recovered) {
    lines.push('  the previous block has cleared — Drive is readable again');
  }
  return lines.join('\n');
}

module.exports = {
  watchDrive,
  formatReport,
  consumeChange,
  classifyDriveFailure,
  needsAPerson,
  isMediaMimeType,
  fixFor,
  cursorResource,
  resolveFolders,
  realDriveClient,
  LANES,
  STAGE_INGEST,
  SUBJECT_DRIVE_FILE,
  STAGE_WATCH,
  SUBJECT_WATCH,
};
