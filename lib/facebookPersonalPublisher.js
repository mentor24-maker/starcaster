'use strict';

const { relayOpenClaw } = require('./openclawGateway');

const JOB_TYPE = 'engage.facebook.personal_post';

function safeText(value) {
  return String(value || '').trim();
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
  );
}

function buildCreatePayload(input) {
  const taggedPeople = Array.isArray(input.taggedPeople)
    ? input.taggedPeople
      .map((person) => ({
        contactId: safeText(person?.contactId || person?.contact_id),
        displayName: safeText(person?.displayName || person?.display_name),
        facebookHandle: safeText(person?.facebookHandle || person?.facebook_handle),
        facebookUrl: safeText(person?.facebookUrl || person?.facebook_url),
      }))
      .filter((person) => person.displayName || person.facebookHandle || person.facebookUrl)
    : [];
  const tagInstruction = taggedPeople.length
    ? ` Tag these people in the composer before capture: ${taggedPeople.map((person) => {
      const label = person.displayName || person.facebookHandle || person.facebookUrl;
      const handle = person.facebookHandle ? `@${person.facebookHandle.replace(/^@+/, '')}` : '';
      return handle ? `${label} (${handle})` : label;
    }).join('; ')}.`
    : '';
  return {
    manual_confirmed: true,
    role: 'operator',
    type: JOB_TYPE,
    payload: {
      text: safeText(input.text),
      profile: safeText(input.openclawProfile),
      starcasterChannelId: safeText(input.starcasterChannelId),
      projectId: safeText(input.projectId),
      postId: safeText(input.postId),
      taggedPeople,
      instructions: [
        'Use the OpenClaw browser profile to open Facebook as a logged-in personal account.',
        'Navigate to the personal timeline composer (not a Page).',
        'Enter the post text exactly as provided.',
        tagInstruction,
        'Capture a preview screenshot and wait for human approval before clicking Post.',
        'Do not submit the post during preview.',
      ].filter(Boolean).join(' '),
    },
  };
}

function relayPayload(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.result && typeof data.result === 'object') return data.result;
  return data;
}

async function queuePreviewJob(input) {
  const openclawProfile = safeText(input.openclawProfile);
  if (!openclawProfile) {
    return { ok: false, status: 400, error: 'OpenClaw profile is required on the Facebook Personal channel.' };
  }
  const text = safeText(input.text);
  if (!text) return { ok: false, status: 400, error: 'Post text is required' };

  const created = await relayOpenClaw('create_job', buildCreatePayload(input));
  if (!created.ok) {
    return {
      ok: false,
      status: created.status || 502,
      error: safeText(created.error) || 'OpenClaw create_job failed',
      data: created.data,
    };
  }

  const jobId = extractJobId(relayPayload(created.data));
  if (!jobId) {
    return {
      ok: false,
      status: 502,
      error: 'OpenClaw create_job succeeded but no job id was returned',
      data: created.data,
    };
  }

  const preview = await relayOpenClaw('preview_job', {
    manual_confirmed: true,
    job_id: jobId,
    role: 'marketer',
  });

  return {
    ok: true,
    status: 202,
    jobId,
    create: relayPayload(created.data),
    preview: preview.ok ? relayPayload(preview.data) : null,
    previewError: preview.ok ? '' : safeText(preview.error) || 'OpenClaw preview_job failed',
    previewStatus: Number(preview.status || 0) || 0,
  };
}

async function approveAndExecuteJob(jobId) {
  const id = safeText(jobId);
  if (!id) return { ok: false, status: 400, error: 'OpenClaw job_id is required' };

  const approved = await relayOpenClaw('approve_job', {
    manual_confirmed: true,
    job_id: id,
    role: 'approver',
  });
  if (!approved.ok) {
    return {
      ok: false,
      status: approved.status || 502,
      error: safeText(approved.error) || 'OpenClaw approve_job failed',
      data: approved.data,
      step: 'approve_job',
    };
  }

  const executed = await relayOpenClaw('execute_job', {
    manual_confirmed: true,
    job_id: id,
    role: 'approver',
  });
  if (!executed.ok) {
    return {
      ok: false,
      status: executed.status || 502,
      error: safeText(executed.error) || 'OpenClaw execute_job failed',
      data: executed.data,
      step: 'execute_job',
      approve: relayPayload(approved.data),
    };
  }

  const status = await fetchJobStatus(id);
  return {
    ok: true,
    status: 200,
    jobId: id,
    approve: relayPayload(approved.data),
    execute: relayPayload(executed.data),
    jobStatus: status.ok ? status.data : null,
    jobStatusError: status.ok ? '' : safeText(status.error),
  };
}

async function fetchJobStatus(jobId) {
  const id = safeText(jobId);
  if (!id) return { ok: false, status: 400, error: 'OpenClaw job_id is required' };

  const result = await relayOpenClaw('job_status', {
    manual_confirmed: true,
    job_id: id,
    role: 'operator',
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status || 502,
      error: safeText(result.error) || 'OpenClaw job_status failed',
      data: result.data,
    };
  }
  return { ok: true, status: 200, data: relayPayload(result.data) };
}

function isOpenClawConfigured() {
  const { getProviderValues } = require('./apiSettings');
  const cfg = getProviderValues('openclaw') || {};
  return Boolean(safeText(cfg.base_url));
}

module.exports = {
  JOB_TYPE,
  queuePreviewJob,
  approveAndExecuteJob,
  fetchJobStatus,
  isOpenClawConfigured,
  extractJobId,
};
