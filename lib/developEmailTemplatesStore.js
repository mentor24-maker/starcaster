'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

const DEFAULT_EMAIL_TEMPLATES = [
  {
    templateKind: 'text',
    slug: 'newsletter-basic',
    name: 'Newsletter Basic',
    summary: 'Clean editorial email for updates, essays, and recurring community sends.',
    subject: 'A thoughtful update for your audience',
    heading: 'A clear update with one primary idea.',
    body: 'Use this when you want a simple, readable email that carries one main message and one clear action.',
    cta: 'Read More',
  },
  {
    templateKind: 'text',
    slug: 'announcement-launch',
    name: 'Announcement / Launch',
    summary: 'Structured launch email for announcing a new offer, page, event, or release.',
    subject: 'Something new is ready',
    heading: 'Announce a launch with momentum and clarity.',
    body: 'Use this when you want urgency, positioning, and a stronger call to action around a new release.',
    cta: 'See What\'s New',
  },
  {
    templateKind: 'text',
    slug: 'event-invite',
    name: 'Event Invite',
    summary: 'Invitation template for webinars, live streams, calls, and other scheduled events.',
    subject: 'You\'re invited',
    heading: 'Invite people to a time-bound experience.',
    body: 'Use this when the email should focus on attendance, timing, and the value of showing up live.',
    cta: 'Reserve Your Spot',
  },
  {
    templateKind: 'text',
    slug: 'lead-magnet-delivery',
    name: 'Lead Magnet Delivery',
    summary: 'Short fulfillment email for sending a PDF, guide, checklist, or resource after signup.',
    subject: 'Here\'s your resource',
    heading: 'Deliver the promised asset fast.',
    body: 'Use this when the main job is fulfillment: quick context, direct value, and a lightweight next step.',
    cta: 'Download Now',
  },
];

function table() {
  return tableConfig().developEmailTemplates;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function slugify(value) {
  return safeText(value, 255)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeTemplateKind(value) {
  const normalized = safeText(value, 40).toLowerCase();
  return normalized === 'modular' ? 'modular' : 'text';
}

function rowToEmailTemplate(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    templateKind: normalizeTemplateKind(row.template_kind || row.templateKind),
    slug: safeText(row.slug, 120),
    name: safeText(row.name, 255),
    summary: safeText(row.summary, 1000),
    subject: safeText(row.subject, 500),
    heading: safeText(row.heading, 500),
    body: safeText(row.body, 10000),
    cta: safeText(row.cta, 255),
    blocks: normalizeBlocks(row.blocks, row),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function normalizeBlocks(value, fallbackRow) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_) {
      parsed = null;
    }
  }
  const rows = Array.isArray(parsed) ? parsed : [];
  const normalized = rows
    .map((block, index) => {
      const type = safeText(block?.type, 40).toLowerCase();
      if (!type) return null;
      return {
        id: safeText(block?.id, 120) || `block_${index + 1}`,
        type,
        text: safeText(block?.text, 10000),
        url: safeText(block?.url, 2000),
      };
    })
    .filter(Boolean);

  if (normalized.length) return normalized;

  const fallback = [];
  const heading = safeText(fallbackRow?.heading, 500);
  const body = safeText(fallbackRow?.body, 10000);
  const cta = safeText(fallbackRow?.cta, 255);
  if (heading) fallback.push({ id: 'heading_1', type: 'heading', text: heading, url: '' });
  if (body) fallback.push({ id: 'paragraph_1', type: 'paragraph', text: body, url: '' });
  if (cta) fallback.push({ id: 'button_1', type: 'button', text: cta, url: '' });
  if (!fallback.length) {
    fallback.push({ id: 'paragraph_1', type: 'paragraph', text: '', url: '' });
  }
  return fallback;
}

function inputToRow(input) {
  const name = safeText(input?.name, 255);
  const blocks = normalizeBlocks(input?.blocks, input);
  const templateKind = normalizeTemplateKind(input?.templateKind || input?.template_kind);
  return {
    template_kind: templateKind,
    slug: slugify(input?.slug || name),
    name,
    summary: safeText(input?.summary, 1000),
    subject: safeText(input?.subject, 500),
    heading: safeText(input?.heading, 500),
    body: safeText(input?.body, 10000),
    cta: safeText(input?.cta, 255),
    blocks,
  };
}

async function seedDefaults(scope = null) {
  const prepared = await Promise.all(
    DEFAULT_EMAIL_TEMPLATES
      .map(inputToRow)
      .filter((row) => row.name)
      .map((row) => scopedInsertRow(table(), row, scope))
  );
  const body = prepared.filter((row) => row.name);
  if (!body.length) return;
  await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: {
      Prefer: 'return=representation,resolution=ignore-duplicates',
    },
    body,
  });
}

async function listEmailTemplates(limit = 1000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const query = await scopedListQuery(
    table(),
    `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
    scope
  );
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const rows = Array.isArray(res.data) ? res.data : [];
  if (!rows.length) {
    await seedDefaults(scope);
    const seededQuery = await scopedListQuery(
      table(),
      `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
      scope
    );
    const seeded = await sbQuery({
      method: 'GET',
      table: table(),
      query: seededQuery,
    });
    if (!seeded.ok) return seeded;
    return {
      ok: true,
      status: 200,
      data: Array.isArray(seeded.data) ? seeded.data.map(rowToEmailTemplate) : [],
    };
  }
  return {
    ok: true,
    status: 200,
    data: rows.map(rowToEmailTemplate),
  };
}

async function createEmailTemplate(input, scope = null) {
  const row = await scopedInsertRow(table(), inputToRow(input), scope);
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToEmailTemplate(created) };
}

async function updateEmailTemplate(id, input, scope = null) {
  const templateId = Number(id || 0) || 0;
  if (!templateId) return { ok: false, status: 400, error: 'id is required' };
  const row = await scopedPatchRow(table(), inputToRow(input), scope);
  const query = await scopedIdQuery(table(), `id=eq.${templateId}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Email template not found' };
  return { ok: true, status: 200, data: rowToEmailTemplate(updated) };
}

async function deleteEmailTemplate(id, scope = null) {
  const templateId = Number(id || 0) || 0;
  if (!templateId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${templateId}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Email template not found' };
  return { ok: true, status: 200, data: rowToEmailTemplate(removed) };
}

module.exports = {
  DEFAULT_EMAIL_TEMPLATES,
  listEmailTemplates,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  rowToEmailTemplate,
};
