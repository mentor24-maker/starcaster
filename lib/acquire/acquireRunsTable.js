'use strict';

/**
 * The four moves the X and Reddit run stores share, against a Supabase table
 * keyed by `run_id` (docs/SQL/acquire_x_reddit_runs_setup.sql).
 *
 * These stores used to write data/*.json, which Vercel skips without an error
 * (CLAUDE.md landmine 6): every run answered 201 and was never kept. There is
 * deliberately no file fallback here — a store that falls back when the
 * database REFUSES answers success while keeping nothing (landmine 15). When
 * the table is missing, the error says so.
 *
 * Every call returns the usual `{ ok, status, data }` envelope (or
 * `{ ok: false, status, error }`).
 */

const { sbQuery } = require('../supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('../projectScope');

const MAX_LIST = 200;

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function refused(res, what) {
  return {
    ok: false,
    status: res.status || 500,
    error: `${what}: ${res.error || 'the database refused'}`,
  };
}

/**
 * @param {object} opts
 * @param {() => string} opts.table          table name (resolved per call, so env overrides apply)
 * @param {string}       opts.label          "X" / "Reddit", used in error messages
 * @param {string}       opts.listColumns    columns the history list needs — never the big result_json
 * @param {(row: object) => object} opts.summarize
 */
function acquireRunsTable({ table, label, listColumns, summarize }) {
  async function create(rowInput, scope) {
    const name = table();
    const row = await scopedInsertRow(name, rowInput, scope);
    const res = await sbQuery({
      method: 'POST',
      table: name,
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [row],
    });
    if (!res.ok) return refused(res, `Could not save the ${label} run`);
    const created = (Array.isArray(res.data) && res.data[0]) || null;
    if (!created) return { ok: false, status: 500, error: `Could not save the ${label} run: the database returned no row` };
    return { ok: true, status: 201, data: created };
  }

  async function list(limit = 20, scope = null) {
    const name = table();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, MAX_LIST));
    const query = await scopedListQuery(
      name,
      `select=${listColumns}&order=created_at.desc&limit=${safeLimit}`,
      scope
    );
    const res = await sbQuery({ method: 'GET', table: name, query });
    if (!res.ok) return refused(res, `Could not read the ${label} run history`);
    return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(summarize) };
  }

  async function get(runId, scope = null) {
    const id = String(runId || '').trim();
    if (!id) return { ok: false, status: 400, error: 'run_id is required' };
    const name = table();
    const query = await scopedIdQuery(name, `run_id=eq.${encodeURIComponent(id)}&select=*`, scope);
    const res = await sbQuery({ method: 'GET', table: name, query });
    if (!res.ok) return refused(res, `Could not read the ${label} run`);
    const row = (Array.isArray(res.data) && res.data[0]) || null;
    if (!row) return { ok: false, status: 404, error: 'Run not found' };
    return {
      ok: true,
      status: 200,
      data: { ...row, request: row.request_json || {}, result: row.result_json || {} },
    };
  }

  async function remove(runId, scope = null) {
    const id = String(runId || '').trim();
    if (!id) return { ok: false, status: 400, error: 'run_id is required' };
    const name = table();
    const query = await scopedIdQuery(name, `run_id=eq.${encodeURIComponent(id)}`, scope);
    const res = await sbQuery({
      method: 'DELETE',
      table: name,
      query,
      headers: { Prefer: 'return=representation' },
    });
    if (!res.ok) return refused(res, `Could not delete the ${label} run`);
    if (!(Array.isArray(res.data) && res.data.length)) return { ok: false, status: 404, error: 'Run not found' };
    return { ok: true, status: 200, data: { deleted: true, run_id: id } };
  }

  return { create, list, get, remove };
}

module.exports = { acquireRunsTable, makeId };
