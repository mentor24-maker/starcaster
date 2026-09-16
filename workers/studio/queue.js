'use strict';

/**
 * The Studio pipeline's work queue.
 *
 * LOCAL SQLITE ON THE MINI, DELIBERATELY NOT SUPABASE. The queue churns
 * thousands of writes per video, and on 2026-08-16 exhausted Supabase disk IO
 * took every client site down for two and a half hours (DOCTRINE 1.5). Nothing
 * durable lives here: if this file were deleted the pipeline rebuilds its work
 * list from the catalog and loses nothing. That is what makes a local file the
 * right home rather than a compromise.
 *
 * `node:sqlite` rather than a package: it ships with Node 22, which is what CI
 * and the Mini both run, so the queue costs no native build and no dependency.
 * It prints an experimental warning; `--no-warnings` is NOT used to silence it,
 * because a warning nobody sees is how a runtime change lands unnoticed.
 *
 * LEASES, NOT LOCKS. A worker claims a job for a period and must keep saying it
 * is alive. If it crashes, the lease expires and `reap` puts the job back —
 * with no human involved, which is the whole point on a machine nobody watches
 * at 3am. The alternative, a lock released on exit, is exactly the thing a
 * crash does not do.
 *
 * NO `setInterval` AT MODULE SCOPE (DOCTRINE 5.2 — it hangs every test). This
 * module never schedules anything. `reap` is a function the caller runs; the
 * daemon that runs it on a timer is Studio 7/8's problem.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

/**
 * TWO COUNTERS, BECAUSE THERE ARE TWO DIFFERENT PROBLEMS.
 *
 * `attempts` counts genuine FAILURES: the worker ran the job and it did not
 * work. `recoveries` counts CRASHES: the worker stopped saying it was alive
 * and the lease was reaped.
 *
 * The first draft had one counter, incremented on every claim, and it was
 * wrong in both directions at once — which is what a single counter for two
 * causes always is:
 *
 *   - A job that KILLS its worker never terminated. Only `fail` checked the
 *     ceiling, and a crashed worker never calls `fail`, so the cycle was
 *     claim -> crash -> reap -> claim, forever. Measured: ten cycles with a
 *     ceiling of three left the job pending at attempts=10, with nothing ever
 *     reported. DOCTRINE 3.11 on the crash path: not silently dropped,
 *     silently never finished, on a machine nobody watches.
 *   - And the MACHINE GOING TO SLEEP spent the failure budget. Four sleeps
 *     later, the first genuine failure sent a perfectly good job straight to
 *     `blocked`.
 *
 * Splitting them fixes both: sleeping costs a recovery and never a retry, and
 * a poison job still terminates — through the recovery ceiling rather than
 * the failure one, with a reason that says which.
 */
const DEFAULT_MAX_ATTEMPTS = 5;
/**
 * Deliberately generous, and separate. One sleep costs one recovery, so this
 * is also the number of times the Mini may nap mid-job before the queue
 * decides something is actually wrong. A job still running after this many
 * interruptions is worth a human's eye either way.
 */
const DEFAULT_MAX_RECOVERIES = 20;
/** How long a claim is good for before `reap` may take it back. */
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
/** First retry waits this long; each subsequent one doubles. */
const DEFAULT_BACKOFF_BASE_MS = 30 * 1000;
/** ... but never waits longer than this, or a stuck job disappears for a day. */
const DEFAULT_BACKOFF_CAP_MS = 60 * 60 * 1000;

const STATES = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  /** Terminal, and it keeps its reason. Never silently dropped (DOCTRINE 3.11). */
  BLOCKED: 'blocked',
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    stage             TEXT    NOT NULL,
    subject_kind      TEXT    NOT NULL,
    subject_id        TEXT    NOT NULL,
    state             TEXT    NOT NULL DEFAULT 'pending',
    attempts          INTEGER NOT NULL DEFAULT 0,
    recoveries        INTEGER NOT NULL DEFAULT 0,
    lease_owner       TEXT    NOT NULL DEFAULT '',
    lease_expires_at  INTEGER NOT NULL DEFAULT 0,
    run_after         INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT    NOT NULL DEFAULT '',
    progress_pct      INTEGER NOT NULL DEFAULT 0,
    -- What the producer knew that (stage, subject) cannot say. JSON, or ''.
    -- The Drive watcher (Studio 3/8) is the first caller that needs it: the
    -- lane a file came off -- /Studio/Inbox/ or /Studio/Plates/ -- is not
    -- recoverable from a Drive file id without asking Drive again, and it is
    -- the thing that decides whether the file is ever transcribed. The
    -- alternative was encoding the lane in the stage name, which makes every
    -- reader parse a stage to find out what kind of work it is holding.
    --
    -- It is NOT part of the identity of a job. jobs_live_subject_idx covers
    -- (stage, subject_kind, subject_id) only, so re-emitting the same file
    -- with a different payload is still one job, not two.
    payload           TEXT    NOT NULL DEFAULT '',
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );

  -- IDEMPOTENCY, held by the database rather than by a check-then-insert.
  -- Two workers enqueueing the same (stage, subject) at the same moment both
  -- pass a "does one exist?" read before either writes; only a unique index
  -- can actually refuse the second. It covers the two LIVE states only, so a
  -- finished or blocked job never prevents the work being queued again.
  CREATE UNIQUE INDEX IF NOT EXISTS jobs_live_subject_idx
    ON jobs (stage, subject_kind, subject_id)
    WHERE state IN ('pending', 'running');

  CREATE INDEX IF NOT EXISTS jobs_claimable_idx ON jobs (state, run_after, id);
  CREATE INDEX IF NOT EXISTS jobs_lease_idx     ON jobs (state, lease_expires_at);

  CREATE TABLE IF NOT EXISTS drive_cursor (
    resource   TEXT PRIMARY KEY,
    cursor     TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cache_entries (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`;

function nowMs() {
  return Date.now();
}

/** Retry delay for the Nth attempt: doubling, capped, so nothing waits a day. */
function backoffMs(attempts, { base = DEFAULT_BACKOFF_BASE_MS, cap = DEFAULT_BACKOFF_CAP_MS } = {}) {
  const n = Math.max(1, Number(attempts) || 1);
  const raw = base * Math.pow(2, n - 1);
  return Math.min(raw, cap);
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * A payload object -> the string the column holds. `''` for nothing.
 *
 * It REFUSES a value it cannot encode rather than storing `undefined` or a
 * half-serialised string: a payload that silently arrives empty is a lane
 * decision silently lost, and the whole reason this column exists is that the
 * lane cannot be recovered from anywhere else.
 */
function encodePayload(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload.trim();
  let encoded;
  try {
    encoded = JSON.stringify(payload);
  } catch (err) {
    throw new Error(`payload could not be encoded as JSON: ${err.message}`);
  }
  if (typeof encoded !== 'string') {
    throw new Error('payload could not be encoded as JSON (it serialised to nothing)');
  }
  return encoded;
}

/**
 * The stored string -> an object, or null.
 *
 * Unparseable text comes back as `{ raw }` rather than throwing. A row written
 * by an older version, or by hand, must not make `getJob` explode — a queue
 * that cannot be read is worse than a payload that cannot be understood, and
 * the caller can see exactly what was there.
 */
function decodePayload(value) {
  const raw = String(value == null ? '' : value);
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { raw };
  } catch {
    return { raw };
  }
}

/**
 * Add a column to an existing table, or do nothing if it is already there.
 *
 * `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` in SQLite, and catching
 * every error instead would also swallow a genuinely broken ALTER. Asking
 * `PRAGMA table_info` first says exactly what is true.
 *
 * BUT THE ASK AND THE ACT ARE TWO STATEMENTS. Two workers opening the same old
 * queue file in the same instant both read the column as absent and both
 * ALTER; the loser throws `duplicate column name`, and it throws out of
 * `openQueue`, on the one boot where this migration matters at all — which is
 * the Mini, first thing, with nothing watching. That ONE error means the other
 * process did the work and the end state is the one we asked for, so it is the
 * only one swallowed. Everything else still throws.
 */
function addColumnIfMissing(db, table, column, declaration) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => String(c.name) === column)) return false;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  } catch (err) {
    if (!/duplicate column name/i.test(String(err && err.message))) throw err;
    return false;
  }
  return true;
}

/**
 * Roll back, and never let the rollback's own error replace the real one.
 *
 * SQLite rolls a transaction back BY ITSELF on a BUSY, FULL or IOERR, so by
 * the time a catch block runs there may be no transaction left — and the
 * `ROLLBACK` then throws "cannot rollback - no transaction is active", which
 * would be thrown in place of the disk-full that actually happened. The
 * caller must always see what really went wrong.
 */
function rollbackQuietly(db) {
  try {
    db.exec('ROLLBACK');
  } catch {
    // Already rolled back, or never started. Either way there is nothing to
    // undo and nothing worth saying — the real error is on its way up.
  }
}

/**
 * Open (and create) a queue.
 *
 * `clock` is injectable so a test can move time forward without sleeping —
 * a lease test that really waits five minutes is a test nobody runs.
 */
function openQueue(file, options = {}) {
  const {
    clock = nowMs,
    leaseMs = DEFAULT_LEASE_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    maxRecoveries = DEFAULT_MAX_RECOVERIES,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    backoffCapMs = DEFAULT_BACKOFF_CAP_MS,
  } = options;

  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  // WAL lets a reader and a writer coexist, which is what two workers on one
  // machine actually are. Without it the second claimer meets SQLITE_BUSY.
  if (file !== ':memory:') {
    // BUSY TIMEOUT FIRST. Two workers on one machine collide on the write
    // lock, and without a timeout the loser gets SQLITE_BUSY immediately — a
    // perfectly claimable job then looks like an empty queue. Setting it after
    // `journal_mode` is not good enough: switching to WAL is itself a write,
    // so two processes opening the file at the same instant meant one of them
    // threw before the timeout it needed had been set. That failed about one
    // run in five until the order was swapped.
    db.exec(`PRAGMA busy_timeout = ${Number(options.busyTimeoutMs) || 5000};`);
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // A QUEUE FILE THAT ALREADY EXISTS does not get revisited by `CREATE TABLE
  // IF NOT EXISTS`, so a column added later has to be added by hand. The Mini
  // has been running this queue since Studio 2/8 shipped; without this, the
  // first `enqueue` carrying a payload fails on a live machine and passes
  // everywhere else, which is the worst shape a migration can have.
  addColumnIfMissing(db, 'jobs', 'payload', "TEXT NOT NULL DEFAULT ''");

  /**
   * Add work, or return the job already queued for it.
   *
   * Returns `{ job, created }` — `created: false` means an identical live job
   * was already waiting, which is a normal outcome and not an error. The caller
   * that wants to know whether it caused the work can read the flag; the caller
   * that just wants the work queued can ignore it.
   */
  function enqueue({ stage, subjectKind, subjectId, runAfter = 0, payload = null }) {
    const at = clock();
    const encoded = encodePayload(payload);
    const row = {
      stage: text(stage),
      subject_kind: text(subjectKind),
      subject_id: text(subjectId),
    };
    if (!row.stage || !row.subject_kind || !row.subject_id) {
      throw new Error('enqueue needs stage, subjectKind and subjectId');
    }

    try {
      const result = db
        .prepare(
          `INSERT INTO jobs (stage, subject_kind, subject_id, state, run_after, payload, created_at, updated_at)
           VALUES (?, ?, ?, '${STATES.PENDING}', ?, ?, ?, ?)`
        )
        .run(row.stage, row.subject_kind, row.subject_id, Number(runAfter) || 0, encoded, at, at);
      return { job: getJob(Number(result.lastInsertRowid)), created: true };
    } catch (err) {
      // The unique index refused it, which means a live job already exists.
      // Anything else is a real failure and must not be swallowed.
      if (!/UNIQUE constraint failed/i.test(String(err && err.message))) throw err;
      const existing = db
        .prepare(
          `SELECT * FROM jobs
            WHERE stage = ? AND subject_kind = ? AND subject_id = ?
              AND state IN ('${STATES.PENDING}', '${STATES.RUNNING}')
            LIMIT 1`
        )
        .get(row.stage, row.subject_kind, row.subject_id);
      if (existing) return { job: shape(existing), created: false };

      // The conflicting job FINISHED between the refusal and this read, so the
      // index no longer objects and there is nothing to return either. The
      // first draft handed back `{ job: null }`, which a caller following the
      // documented contract dereferences — and the work never got queued at
      // all. Insert again: the window is gone, so this is the ordinary path.
      const retry = db
        .prepare(
          `INSERT INTO jobs (stage, subject_kind, subject_id, state, run_after, payload, created_at, updated_at)
           VALUES (?, ?, ?, '${STATES.PENDING}', ?, ?, ?, ?)`
        )
        .run(row.stage, row.subject_kind, row.subject_id, Number(runAfter) || 0, encoded, at, at);
      return { job: getJob(Number(retry.lastInsertRowid)), created: true };
    }
  }

  /**
   * Take the next job that is due, or null.
   *
   * The claim is ONE statement. Selecting a candidate and then updating it is
   * two, and two concurrent claimers both pass the select before either
   * updates — the classic double-claim. `UPDATE ... WHERE id = (SELECT ...)`
   * is atomic within SQLite's write lock, so exactly one of them changes a row.
   *
   * It counts NOTHING. Incrementing `attempts` here was the original mistake:
   * picking a job up is not an attempt at it, and charging one meant a laptop
   * closing spent the retry budget of every job it was running.
   */
  function claim(owner, { stages = null } = {}) {
    const who = text(owner);
    if (!who) throw new Error('claim needs an owner id');
    const at = clock();
    const expires = at + leaseMs;

    const stageFilter = Array.isArray(stages) && stages.length
      ? `AND stage IN (${stages.map(() => '?').join(', ')})`
      : '';
    const params = Array.isArray(stages) && stages.length ? stages : [];

    const updated = db
      .prepare(
        `UPDATE jobs
            SET state = '${STATES.RUNNING}',
                lease_owner = ?,
                lease_expires_at = ?,
                updated_at = ?
          WHERE id = (
            SELECT id FROM jobs
             WHERE state = '${STATES.PENDING}'
               AND run_after <= ?
               ${stageFilter}
             ORDER BY id
             LIMIT 1
          )
          RETURNING *`
      )
      .get(who, expires, at, at, ...params);

    return updated ? shape(updated) : null;
  }

  /**
   * "Still working." Extends the lease and optionally records progress.
   *
   * Returns false when the job is no longer this worker's — it was reaped and
   * handed to somebody else while this worker was busy. A worker that ignores
   * that answer is about to finish a job a second worker is also doing.
   */
  function heartbeat(id, owner, { progressPct = null } = {}) {
    const at = clock();
    const result = db
      .prepare(
        `UPDATE jobs
            SET lease_expires_at = ?,
                progress_pct = COALESCE(?, progress_pct),
                updated_at = ?
          WHERE id = ? AND lease_owner = ? AND state = '${STATES.RUNNING}'`
      )
      .run(at + leaseMs, progressPct == null ? null : Math.max(0, Math.min(100, Number(progressPct) || 0)), at, Number(id), text(owner));
    return result.changes > 0;
  }

  /** Finished. Also guarded by owner, for the same reason as heartbeat. */
  function complete(id, owner) {
    const at = clock();
    const result = db
      .prepare(
        `UPDATE jobs
            SET state = '${STATES.DONE}',
                lease_owner = '',
                lease_expires_at = 0,
                progress_pct = 100,
                last_error = '',
                updated_at = ?
          WHERE id = ? AND lease_owner = ? AND state = '${STATES.RUNNING}'`
      )
      .run(at, Number(id), text(owner));
    return result.changes > 0;
  }

  /**
   * Failed. Back to pending after a growing delay — until the attempt ceiling,
   * where it becomes `blocked` and KEEPS ITS REASON.
   *
   * A job that runs out of attempts is not deleted and not left looking
   * pending. It sits in a terminal state with the error that put it there,
   * because a queue that quietly drops work is a queue that lies about being
   * empty (DOCTRINE 3.11).
   */
  function fail(id, owner, error) {
    const at = clock();
    const reason = text(error) || 'failed with no reason given';
    const who = text(owner);

    // ONE STATEMENT, GUARDED IN THE WHERE CLAUSE — like heartbeat and
    // complete, and for the same reason. The first draft read the job with
    // getJob, checked owner and state in JavaScript, then ran an UPDATE with
    // no guard at all. A reap plus a re-claim by another process landing
    // between those two statements let a stale worker reset or block a job a
    // live worker was running: the double-processing the single-statement
    // `claim` exists to prevent, arriving by the back door.
    //
    // `attempts` is incremented HERE and nowhere else, because this is the
    // only place that knows the job was actually tried and actually failed.
    const bumped = db
      .prepare(
        `UPDATE jobs
            SET attempts = attempts + 1, last_error = ?, updated_at = ?
          WHERE id = ? AND lease_owner = ? AND state = '${STATES.RUNNING}'
          RETURNING *`
      )
      .get(reason, at, Number(id), who);

    if (!bumped) return false; // not ours any more, or not running

    const job = shape(bumped);
    if (job.attempts >= maxAttempts) {
      // Terminal, and it KEEPS ITS REASON. Never silently dropped
      // (DOCTRINE 3.11).
      db.prepare(
        `UPDATE jobs
            SET state = '${STATES.BLOCKED}', lease_owner = '', lease_expires_at = 0,
                updated_at = ?
          WHERE id = ?`
      ).run(at, job.id);
      return true;
    }

    db.prepare(
      `UPDATE jobs
          SET state = '${STATES.PENDING}', lease_owner = '', lease_expires_at = 0,
              run_after = ?, progress_pct = 0, updated_at = ?
        WHERE id = ?`
    ).run(at + backoffMs(job.attempts, { base: backoffBaseMs, cap: backoffCapMs }), at, job.id);
    return true;
  }

  /**
   * Put a claimed job back, because the MACHINE could not do it — not the job.
   *
   * THE THIRD OUTCOME, and it exists for the same reason `attempts` and
   * `recoveries` are two counters rather than one. `complete` and `fail` are
   * both verdicts on the work; there was no way to say "this work is fine, the
   * conditions are not". Ingest (4/8) is the first caller: a disk with no room
   * for a 3.57 GB file is a fact about the Mini, and charging it to the file
   * means five full disks in a row send a perfectly good piece of footage to
   * `blocked` with an error about somebody else's video.
   *
   * It counts NOTHING — not an attempt, not a recovery — and it keeps the
   * reason, so `listJobs` can say why a pending job is waiting rather than
   * showing a blank `last_error` that reads as "never tried". `runAfterMs`
   * holds it off for a while, because the condition that caused this is not
   * usually fixed in the next ten seconds.
   *
   * ONE STATEMENT, GUARDED IN THE WHERE CLAUSE, like heartbeat / complete /
   * fail: a stale worker must not be able to reset a job a live worker has
   * since claimed. Returns false when the job is no longer this worker's.
   */
  function release(id, owner, { reason = '', runAfterMs = 0 } = {}) {
    const at = clock();
    const result = db
      .prepare(
        `UPDATE jobs
            SET state = '${STATES.PENDING}',
                lease_owner = '',
                lease_expires_at = 0,
                run_after = ?,
                progress_pct = 0,
                last_error = ?,
                updated_at = ?
          WHERE id = ? AND lease_owner = ? AND state = '${STATES.RUNNING}'`
      )
      .run(
        at + Math.max(0, Number(runAfterMs) || 0),
        text(reason) || 'put back with no reason given',
        at,
        Number(id),
        text(owner)
      );
    return result.changes > 0;
  }

  /**
   * File a job that is ALREADY terminal, with the reason that made it so.
   *
   * `fail` is for work that was tried and did not succeed. This is for work
   * that cannot be attempted at all — an expired Drive token, a quota refusal,
   * a folder the credential cannot see. Retrying those is not optimism, it is
   * a retry storm against a wall, and the answer never changes until a person
   * fixes the credential.
   *
   * IDEMPOTENT ON PURPOSE, and that is the whole safety property. The watcher
   * runs on a timer, so a broken token is re-discovered on every single pass.
   * `jobs_live_subject_idx` covers only `pending` and `running`, so the
   * database will happily accept a thousand identical blocked rows — the
   * dedupe has to happen here. One blocked job per (stage, subject); a repeat
   * refreshes the reason and the clock instead of filing another.
   *
   * AND IT TAKES THE LIVE JOB OUT OF THE RUNNING, WHICH IS THE HALF THAT WAS
   * MISSING. The lookup below prefers an ALREADY-BLOCKED row, because that row
   * is the record of when this subject first became impossible. But a blocked
   * row and a fresh pending row for the same subject coexist by design — the
   * live index covers only `pending`/`running` — and when they did, the old
   * code refreshed the blocked row and never touched the job the caller was
   * holding. The caller reported the file as blocked; the job stayed `running`
   * with nobody working it, `reap` returned it to `pending` after the lease,
   * and the cycle repeated to the recovery ceiling before going terminal with
   * entirely the wrong reason ("the worker stopped responding every time",
   * when the worker responded correctly every time). On the ingest checksum
   * path each of those rounds re-downloaded the whole file: about 71 GB of
   * transfer for one 3.57 GB corrupt clip. Found by review on 2026-09-16.
   *
   * So blocking a subject now ALWAYS ends with no live job for it. The live
   * duplicate is absorbed into the canonical blocked row and its own row is
   * removed — not dropped work, because the identical work is recorded as
   * blocked in the same transaction, with the newer reason and payload. The
   * alternative, leaving a second blocked row behind, re-opens the very
   * thousand-identical-rows problem this function exists to prevent: one more
   * blocked row per re-queue, for ever. The absorbed ids are returned so a
   * caller can say what happened rather than guess.
   *
   * `jobId` is optional and belt-and-braces: the live row for the subject IS
   * normally the caller's job, but a caller that holds a job whose payload
   * names a different subject would otherwise leave it running. Name the job
   * you hold and it is taken out whatever the subject lookup finds — absorbed
   * when it is a duplicate of the subject being blocked, blocked in place with
   * the same reason when it is not, because a job for a different subject is
   * not a duplicate of anything and its own record is worth keeping.
   *
   * Wrapped in `BEGIN IMMEDIATE` because it is a read-then-write: two workers
   * both finding no blocked row before either inserts is the same double-file
   * this function exists to prevent. `IMMEDIATE` takes the write lock at the
   * start rather than on first write, which is what makes the read safe.
   */
  function block({ stage, subjectKind, subjectId, reason, payload = null, jobId = null }) {
    const at = clock();
    const row = {
      stage: text(stage),
      subject_kind: text(subjectKind),
      subject_id: text(subjectId),
    };
    if (!row.stage || !row.subject_kind || !row.subject_id) {
      throw new Error('block needs stage, subjectKind and subjectId');
    }
    const why = text(reason) || 'blocked with no reason given';
    const encoded = encodePayload(payload);
    const heldId = jobId === null || jobId === undefined ? null : Number(jobId);

    db.exec('BEGIN IMMEDIATE');
    try {
      const candidates = db
        .prepare(
          `SELECT * FROM jobs
            WHERE stage = ? AND subject_kind = ? AND subject_id = ?
              AND state IN ('${STATES.BLOCKED}', '${STATES.PENDING}', '${STATES.RUNNING}')
            ORDER BY CASE state WHEN '${STATES.BLOCKED}' THEN 0 ELSE 1 END, id`
        )
        .all(row.stage, row.subject_kind, row.subject_id);

      const existing = candidates[0] || null;
      let result;

      if (existing) {
        // Either it is already blocked (refresh the reason) or it is live and
        // has just been found to be impossible (take it out of the running).
        const updated = db
          .prepare(
            `UPDATE jobs
                SET state = '${STATES.BLOCKED}',
                    last_error = ?,
                    lease_owner = '',
                    lease_expires_at = 0,
                    payload = CASE WHEN ? = '' THEN payload ELSE ? END,
                    updated_at = ?
              WHERE id = ?
              RETURNING *`
          )
          .get(why, encoded, encoded, at, existing.id);
        result = { job: shape(updated), created: false };
      } else {
        const inserted = db
          .prepare(
            `INSERT INTO jobs (stage, subject_kind, subject_id, state, last_error, payload, created_at, updated_at)
             VALUES (?, ?, ?, '${STATES.BLOCKED}', ?, ?, ?, ?)
             RETURNING *`
          )
          .get(row.stage, row.subject_kind, row.subject_id, why, encoded, at, at);
        result = { job: shape(inserted), created: true };
      }

      // Anything else still live FOR THIS SUBJECT is a duplicate of the row
      // just written. It is absorbed, never left running: see the note above.
      const absorbed = [];
      const isLive = (candidate) => candidate.state === STATES.PENDING || candidate.state === STATES.RUNNING;
      for (const candidate of candidates) {
        if (Number(candidate.id) === Number(result.job.id)) continue;
        if (!isLive(candidate)) continue;
        db.prepare(`DELETE FROM jobs WHERE id = ? AND state IN ('${STATES.PENDING}', '${STATES.RUNNING}')`)
          .run(candidate.id);
        absorbed.push(Number(candidate.id));
      }

      // And the caller's own job, when it is not one of those. Normally it IS
      // — a claimed ingest job carries the subject being blocked — but ingest
      // reads its subject from the payload and falls back to the job's own, so
      // the two can differ, and the caller has told us it is walking away from
      // this job either way. A job for a DIFFERENT subject is not a duplicate
      // of anything, so it is blocked in place with the same reason rather
      // than deleted: its own subject keeps its own record.
      const held = heldId !== null && Number.isFinite(heldId)
        ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(heldId)
        : null;
      const blockedInPlace = [];
      if (held && isLive(held)
          && Number(held.id) !== Number(result.job.id)
          && !absorbed.includes(Number(held.id))) {
        db.prepare(
          `UPDATE jobs
              SET state = '${STATES.BLOCKED}', last_error = ?, lease_owner = '', lease_expires_at = 0,
                  updated_at = ?
            WHERE id = ?`
        ).run(why, at, held.id);
        blockedInPlace.push(Number(held.id));
      }

      db.exec('COMMIT');
      return { ...result, absorbedJobIds: absorbed, blockedJobIds: blockedInPlace };
    } catch (err) {
      rollbackQuietly(db);
      throw err;
    }
  }


  /**
   * Stand a blocked job down, because the thing that blocked it is fixed.
   *
   * Answers with whether there was one, so the caller can say "this has just
   * recovered" rather than saying nothing — which is the difference between an
   * alarm that clears itself and an alarm somebody has to remember to look at.
   *
   * It moves the job to `done` rather than deleting it: the row IS the record
   * that the pipeline was broken between these two times, and deleting it
   * throws away the only evidence that anything happened. The reason is
   * cleared, because keeping it would leave a finished job still displaying an
   * error it no longer has (the same bug `complete` already guards against).
   */
  function clearBlock({ stage, subjectKind, subjectId }) {
    const at = clock();
    const result = db
      .prepare(
        `UPDATE jobs
            SET state = '${STATES.DONE}',
                last_error = '',
                lease_owner = '',
                lease_expires_at = 0,
                updated_at = ?
          WHERE stage = ? AND subject_kind = ? AND subject_id = ?
            AND state = '${STATES.BLOCKED}'`
      )
      .run(at, text(stage), text(subjectKind), text(subjectId));
    return result.changes > 0;
  }


  /**
   * Return every job whose lease has expired to pending. Answers with how many.
   *
   * EXACTLY ONCE is the property that matters: the update is conditioned on the
   * state it is changing FROM, so a second reaper running at the same moment
   * changes nothing and reports zero rather than resurrecting a job twice.
   * It does not consume an attempt — the worker died, the job did not fail.
   */
  function reap() {
    const at = clock();

    // EXACTLY ONCE is the property that matters: the update is conditioned on
    // the state it is changing FROM, so a second reaper running at the same
    // moment changes nothing and reports zero rather than resurrecting a job
    // twice.
    //
    // A recovery is counted, and it is NOT an attempt. The worker died; the
    // job did not fail. Keeping the two apart is what stops a laptop closing
    // from spending a job's retry budget — and, in the other direction, what
    // lets a job that kills every worker it touches still terminate.
    const recovered = db
      .prepare(
        `UPDATE jobs
            SET state = '${STATES.PENDING}', lease_owner = '', lease_expires_at = 0,
                recoveries = recoveries + 1,
                progress_pct = 0,
                last_error = 'lease expired; worker did not report back',
                updated_at = ?
          WHERE state = '${STATES.RUNNING}' AND lease_expires_at <= ?
          RETURNING *`
      )
      .all(at, at);

    // A job that has been recovered too many times is not unlucky, it is
    // poison: it takes its worker down every time and would otherwise loop
    // forever with nothing ever reported. It goes terminal, and the reason
    // says which ceiling it hit — a job blocked for crashing reads very
    // differently from one blocked for failing.
    let blocked = 0;
    for (const row of recovered) {
      if (Number(row.recoveries) < maxRecoveries) continue;
      db.prepare(
        `UPDATE jobs
            SET state = '${STATES.BLOCKED}',
                last_error = ?,
                updated_at = ?
          WHERE id = ? AND state = '${STATES.PENDING}'`
      ).run(
        `gave up after ${row.recoveries} recoveries — the worker stopped responding every time`,
        at,
        row.id
      );
      blocked += 1;
    }

    return { recovered: recovered.length, blocked };
  }


  function getJob(id) {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(Number(id));
    return row ? shape(row) : null;
  }

  function listJobs({ state = null, stage = null } = {}) {
    const where = [];
    const params = [];
    if (state) { where.push('state = ?'); params.push(state); }
    if (stage) { where.push('stage = ?'); params.push(stage); }
    const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`;
    return db.prepare(sql).all(...params).map(shape);
  }

  /**
   * What is still WAITING, and whether the queue would hand it out right now.
   *
   * `listJobs({ state: 'pending' })` cannot answer this, and the difference is
   * the whole point: a pending job with `run_after` in the future is invisible
   * to `claim` but is absolutely still work outstanding. A pass that claims
   * nothing inside that window looked exactly like a pass with an empty queue,
   * so it reported "finished cleanly", said "no ingest jobs were waiting on
   * the queue" — which was false — and stood its own alarm down while the
   * condition that raised it was still true. Found by review on 2026-09-16
   * (round 2 of 86bbjv686); round 1 fixed the pass that hits the condition and
   * left every pass afterwards contradicting it.
   *
   * IT ASKS THE QUEUE'S OWN CLOCK, WHICH IS WHY IT LIVES HERE RATHER THAN IN
   * THE CALLER. "Is this job due?" has to be decided by the same clock `claim`
   * decides it with, or a report can say nothing is held off while `claim`
   * refuses the very job it is talking about — two surfaces disagreeing about
   * one fact, which is the shape of every bug on this ticket so far.
   *
   * `heldOff` counts the jobs `claim` would refuse; `dueNow` counts the ones
   * it would hand out. A backlog bigger than one pass's `max` is ordinary and
   * shows up as `dueNow`; work put back by `release` or held off by `fail`'s
   * backoff shows up as `heldOff`.
   */
  function waiting({ stage = null } = {}) {
    const at = clock();
    const params = [];
    let sql = `SELECT * FROM jobs WHERE state = '${STATES.PENDING}'`;
    if (stage) { sql += ' AND stage = ?'; params.push(text(stage)); }
    sql += ' ORDER BY run_after, id';
    const jobs = db.prepare(sql).all(...params).map(shape);
    const heldOff = jobs.filter((job) => job.runAfter > at);
    return {
      pending: jobs.length,
      dueNow: jobs.length - heldOff.length,
      heldOff: heldOff.length,
      nextDueAt: heldOff.length ? heldOff[0].runAfter : 0,
      nextDueInMs: heldOff.length ? heldOff[0].runAfter - at : 0,
      jobs,
    };
  }

  function counts() {
    const rows = db.prepare('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state').all();
    const out = { pending: 0, running: 0, done: 0, blocked: 0 };
    for (const row of rows) out[row.state] = Number(row.n);
    return out;
  }

  // --- drive_cursor: one opaque string per watched resource -----------------

  function getCursor(resource) {
    const row = db.prepare('SELECT cursor FROM drive_cursor WHERE resource = ?').get(text(resource));
    return row ? String(row.cursor) : '';
  }

  function setCursor(resource, cursor) {
    db.prepare(
      `INSERT INTO drive_cursor (resource, cursor, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(resource) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`
    ).run(text(resource), text(cursor), clock());
  }

  // --- cache_entries -------------------------------------------------------

  function cacheGet(key) {
    const row = db.prepare('SELECT value, expires_at FROM cache_entries WHERE key = ?').get(text(key));
    if (!row) return null;
    if (Number(row.expires_at) > 0 && Number(row.expires_at) <= clock()) return null;
    return String(row.value);
  }

  function cacheSet(key, value, { ttlMs = 0 } = {}) {
    const at = clock();
    db.prepare(
      `INSERT INTO cache_entries (key, value, expires_at, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`
    ).run(text(key), String(value), ttlMs > 0 ? at + ttlMs : 0, at);
  }

  function close() {
    db.close();
  }

  return {
    enqueue, claim, heartbeat, complete, fail, release, block, clearBlock, reap,
    getJob, listJobs, waiting, counts,
    getCursor, setCursor, cacheGet, cacheSet,
    close, db,
  };
}

/** snake_case row -> camelCase job, so callers never see the column names. */
function shape(row) {
  return {
    id: Number(row.id),
    stage: String(row.stage),
    subjectKind: String(row.subject_kind),
    subjectId: String(row.subject_id),
    state: String(row.state),
    attempts: Number(row.attempts),
    recoveries: Number(row.recoveries),
    leaseOwner: String(row.lease_owner),
    leaseExpiresAt: Number(row.lease_expires_at),
    runAfter: Number(row.run_after),
    lastError: String(row.last_error),
    progressPct: Number(row.progress_pct),
    payload: decodePayload(row.payload),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

module.exports = {
  openQueue,
  // Exported for their own tests. Both are one-line guards against a race that
  // only happens on a busy machine at boot, which is exactly the shape that
  // cannot be reproduced through `openQueue` from a test — and an untested
  // guard is what sent round 1 of this ticket back.
  addColumnIfMissing,
  rollbackQuietly,
  backoffMs,
  STATES,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_RECOVERIES,
  DEFAULT_LEASE_MS,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_CAP_MS,
};
