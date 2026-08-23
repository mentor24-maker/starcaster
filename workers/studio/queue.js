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

/** A job that has been handed back this many times is a problem, not a retry. */
const DEFAULT_MAX_ATTEMPTS = 5;
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
    lease_owner       TEXT    NOT NULL DEFAULT '',
    lease_expires_at  INTEGER NOT NULL DEFAULT 0,
    run_after         INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT    NOT NULL DEFAULT '',
    progress_pct      INTEGER NOT NULL DEFAULT 0,
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

  /**
   * Add work, or return the job already queued for it.
   *
   * Returns `{ job, created }` — `created: false` means an identical live job
   * was already waiting, which is a normal outcome and not an error. The caller
   * that wants to know whether it caused the work can read the flag; the caller
   * that just wants the work queued can ignore it.
   */
  function enqueue({ stage, subjectKind, subjectId, runAfter = 0 }) {
    const at = clock();
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
          `INSERT INTO jobs (stage, subject_kind, subject_id, state, run_after, created_at, updated_at)
           VALUES (?, ?, ?, '${STATES.PENDING}', ?, ?, ?)`
        )
        .run(row.stage, row.subject_kind, row.subject_id, Number(runAfter) || 0, at, at);
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
      return { job: existing ? shape(existing) : null, created: false };
    }
  }

  /**
   * Take the next job that is due, or null.
   *
   * The claim is ONE statement. Selecting a candidate and then updating it is
   * two, and two concurrent claimers both pass the select before either
   * updates — the classic double-claim. `UPDATE ... WHERE id = (SELECT ...)`
   * is atomic within SQLite's write lock, so exactly one of them changes a row.
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
                attempts = attempts + 1,
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
    const job = getJob(id);
    if (!job || job.leaseOwner !== text(owner) || job.state !== STATES.RUNNING) return false;

    const reason = text(error) || 'failed with no reason given';
    const exhausted = job.attempts >= maxAttempts;

    if (exhausted) {
      db.prepare(
        `UPDATE jobs
            SET state = '${STATES.BLOCKED}', lease_owner = '', lease_expires_at = 0,
                last_error = ?, updated_at = ?
          WHERE id = ?`
      ).run(reason, at, Number(id));
      return true;
    }

    db.prepare(
      `UPDATE jobs
          SET state = '${STATES.PENDING}', lease_owner = '', lease_expires_at = 0,
              run_after = ?, last_error = ?, updated_at = ?
        WHERE id = ?`
    ).run(at + backoffMs(job.attempts, { base: backoffBaseMs, cap: backoffCapMs }), reason, at, Number(id));
    return true;
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
    const result = db
      .prepare(
        `UPDATE jobs
            SET state = '${STATES.PENDING}', lease_owner = '', lease_expires_at = 0,
                last_error = CASE WHEN last_error = '' THEN 'lease expired; worker did not report back' ELSE last_error END,
                updated_at = ?
          WHERE state = '${STATES.RUNNING}' AND lease_expires_at <= ?`
      )
      .run(at, at);
    return result.changes;
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
    enqueue, claim, heartbeat, complete, fail, reap,
    getJob, listJobs, counts,
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
    leaseOwner: String(row.lease_owner),
    leaseExpiresAt: Number(row.lease_expires_at),
    runAfter: Number(row.run_after),
    lastError: String(row.last_error),
    progressPct: Number(row.progress_pct),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

module.exports = {
  openQueue,
  backoffMs,
  STATES,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_LEASE_MS,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_CAP_MS,
};
