'use strict';

const crypto = require('crypto');
const {
  callOpenClawResponses,
  extractJsonFromText,
} = require('./openclawResponsesClient');

const JOB_TYPE = 'engage.facebook.personal_post';
const SESSION_PREFIX = 'starcaster:facebook_personal';

function safeText(value) {
  return String(value || '').trim();
}

function sessionUserForJob(jobId) {
  return `${SESSION_PREFIX}:${safeText(jobId)}`;
}

function formatTaggedPeople(taggedPeople) {
  return (Array.isArray(taggedPeople) ? taggedPeople : [])
    .map((person) => {
      const label = safeText(person?.displayName || person?.display_name)
        || safeText(person?.facebookHandle || person?.facebook_handle)
        || safeText(person?.facebookUrl || person?.facebook_url);
      const handle = safeText(person?.facebookHandle || person?.facebook_handle).replace(/^@+/, '');
      if (!label) return '';
      return handle ? `${label} (@${handle})` : label;
    })
    .filter(Boolean);
}

function buildPreviewInput(input) {
  const taggedPeople = formatTaggedPeople(input.taggedPeople);
  return [
    `STARCASTER TASK: ${JOB_TYPE} — PREVIEW ONLY`,
    '',
    `Browser profile: ${safeText(input.openclawProfile)}`,
    `StarCaster post id: ${safeText(input.postId) || '(campaign publish)'}`,
    `Project id: ${safeText(input.projectId) || '(unknown)'}`,
    '',
    'Steps:',
    '1. Open Facebook as the logged-in personal account using the browser profile above (not a Page).',
    '2. Open the personal timeline composer ("Create a post" / "What\'s on your mind").',
    '3. Enter the post text EXACTLY as provided below.',
    taggedPeople.length
      ? `4. Tag these people in the composer: ${taggedPeople.join('; ')}.`
      : '4. Do not tag anyone unless listed above.',
    '5. Capture a screenshot of the filled composer preview.',
    '6. DO NOT click Post / Publish.',
    '',
    'Post text:',
    '---',
    safeText(input.text),
    '---',
    '',
    'Return ONLY valid JSON (no markdown fences):',
    '{"status":"awaiting_approval","composer_ready":true,"preview_notes":"short summary","screenshot_description":"what the screenshot shows"}',
  ].join('\n');
}

function buildPublishInput() {
  return [
    `STARCASTER TASK: ${JOB_TYPE} — APPROVED, PUBLISH NOW`,
    '',
    'The human approved this preview in StarCaster Promote Social.',
    'Click Post / Publish on the Facebook personal timeline composer for this session.',
    'Confirm the post went live.',
    '',
    'Return ONLY valid JSON (no markdown fences):',
    '{"status":"published","post_url":"https://www.facebook.com/...","notes":"short result summary"}',
  ].join('\n');
}

function buildStatusInput() {
  return [
    `STARCASTER TASK: ${JOB_TYPE} — STATUS CHECK`,
    '',
    'Report the current state of the Facebook personal post workflow for this session.',
    '',
    'Return ONLY valid JSON (no markdown fences):',
    '{"status":"published|awaiting_approval|failed|unknown","post_url":"","notes":""}',
  ].join('\n');
}

function previewPayloadFromResponse(result, jobId) {
  const parsed = extractJsonFromText(result.text || '');
  const preview = parsed && typeof parsed === 'object'
    ? parsed
    : { status: 'awaiting_approval', preview_notes: safeText(result.text).slice(0, 2000) };
  return {
    protocol: 'openresponses_v1',
    job_id: jobId,
    type: JOB_TYPE,
    preview,
    raw_text: safeText(result.text).slice(0, 8000),
    response_id: safeText(result.data?.id),
  };
}

async function queuePreviewJob(input) {
  const openclawProfile = safeText(input.openclawProfile);
  if (!openclawProfile) {
    return { ok: false, status: 400, error: 'OpenClaw profile is required on the Facebook Personal channel.' };
  }
  const text = safeText(input.text);
  if (!text) return { ok: false, status: 400, error: 'Post text is required' };

  const jobId = crypto.randomUUID();
  const previewResult = await callOpenClawResponses({
    user: sessionUserForJob(jobId),
    instructions: 'You are executing a StarCaster Facebook Personal publish workflow via browser automation. Follow the task precisely. Never publish during preview.',
    input: buildPreviewInput(input),
    timeoutMs: 180000,
  });

  if (!previewResult.ok) {
    return {
      ok: false,
      status: previewResult.status || 502,
      error: safeText(previewResult.error) || 'OpenClaw preview request failed',
      data: previewResult.data,
    };
  }

  const preview = previewPayloadFromResponse(previewResult, jobId);
  return {
    ok: true,
    status: 202,
    jobId,
    create: { id: jobId, protocol: 'openresponses_v1' },
    preview,
    previewError: '',
    previewStatus: 200,
  };
}

async function approveAndExecuteJob(jobId) {
  const id = safeText(jobId);
  if (!id) return { ok: false, status: 400, error: 'OpenClaw job_id is required' };

  const publishResult = await callOpenClawResponses({
    user: sessionUserForJob(id),
    instructions: 'You are completing an approved StarCaster Facebook Personal publish. Click Post now.',
    input: buildPublishInput(),
    timeoutMs: 180000,
  });
  if (!publishResult.ok) {
    return {
      ok: false,
      status: publishResult.status || 502,
      error: safeText(publishResult.error) || 'OpenClaw publish request failed',
      data: publishResult.data,
      step: 'execute_job',
    };
  }

  const parsed = extractJsonFromText(publishResult.text || '') || {};
  const status = await fetchJobStatus(id);
  return {
    ok: true,
    status: 200,
    jobId: id,
    approve: { protocol: 'openresponses_v1', status: 'approved' },
    execute: {
      protocol: 'openresponses_v1',
      result: parsed,
      raw_text: safeText(publishResult.text).slice(0, 8000),
      response_id: safeText(publishResult.data?.id),
    },
    jobStatus: status.ok ? status.data : parsed,
    jobStatusError: status.ok ? '' : safeText(status.error),
  };
}

async function fetchJobStatus(jobId) {
  const id = safeText(jobId);
  if (!id) return { ok: false, status: 400, error: 'OpenClaw job_id is required' };

  const result = await callOpenClawResponses({
    user: sessionUserForJob(id),
    instructions: 'Report Facebook Personal publish status for this StarCaster session.',
    input: buildStatusInput(),
    timeoutMs: 120000,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status || 502,
      error: safeText(result.error) || 'OpenClaw status request failed',
      data: result.data,
    };
  }
  const parsed = extractJsonFromText(result.text || '');
  return {
    ok: true,
    status: 200,
    data: parsed && typeof parsed === 'object'
      ? { protocol: 'openresponses_v1', ...parsed, raw_text: safeText(result.text).slice(0, 8000) }
      : { protocol: 'openresponses_v1', status: 'unknown', raw_text: safeText(result.text).slice(0, 8000) },
  };
}

function isOpenClawConfigured() {
  const { getOpenClawConfig } = require('./openclawResponsesClient');
  const cfg = getOpenClawConfig();
  return Boolean(cfg.baseUrl && cfg.apiKey);
}

function extractJobId(data) {
  if (!data || typeof data !== 'object') return '';
  return safeText(
    data.id
    || data.job_id
    || data.jobId
    || data.data?.id
    || data.data?.job_id
    || data.result?.id
    || data.result?.job_id
    || data.preview?.job_id
  );
}

module.exports = {
  JOB_TYPE,
  queuePreviewJob,
  approveAndExecuteJob,
  fetchJobStatus,
  isOpenClawConfigured,
  extractJobId,
};
