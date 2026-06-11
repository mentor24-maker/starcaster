'use strict';

const {
  listPageTemplates,
  createPageTemplate,
  updatePageTemplate,
  deletePageTemplate,
  rowToPageTemplate,
} = require('./developPageTemplatesStore');
const { migrateLegacyEmailBlocksToDocument } = require('./builder/migrate-from-legacy');

const DEFAULT_EMAIL_TEMPLATES = [
  {
    templateKind: 'email',
    slug: 'newsletter-basic',
    name: 'Newsletter Basic',
    summary: 'Clean editorial email for updates, essays, and recurring community sends.',
    subject: 'A thoughtful update for your audience',
    heading: 'A clear update with one primary idea.',
    body: 'Use this when you want a simple, readable email that carries one main message and one clear action.',
    cta: 'Read More',
  },
  {
    templateKind: 'email',
    slug: 'announcement-launch',
    name: 'Announcement / Launch',
    summary: 'Structured launch email for announcing a new offer, page, event, or release.',
    subject: 'Something new is ready',
    heading: 'Announce a launch with momentum and clarity.',
    body: 'Use this when you want urgency, positioning, and a stronger call to action around a new release.',
    cta: 'See What\'s New',
  },
  {
    templateKind: 'email',
    slug: 'event-invite',
    name: 'Event Invite',
    summary: 'Invitation template for webinars, live streams, calls, and other scheduled events.',
    subject: 'You\'re invited',
    heading: 'Invite people to a time-bound experience.',
    body: 'Use this when the email should focus on attendance, timing, and the value of showing up live.',
    cta: 'Reserve Your Spot',
  },
  {
    templateKind: 'email',
    slug: 'lead-magnet-delivery',
    name: 'Lead Magnet Delivery',
    summary: 'Short fulfillment email for sending a PDF, guide, checklist, or resource after signup.',
    subject: 'Here\'s your resource',
    heading: 'Deliver the promised asset fast.',
    body: 'Use this when the main job is fulfillment: quick context, direct value, and a lightweight next step.',
    cta: 'Download Now',
  },
];

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function pageTemplateToEmailTemplate(record) {
  if (!record) return null;
  const firstSection = Array.isArray(record.layoutSections) ? record.layoutSections[0] : null;
  const modules = Array.isArray(firstSection?.modules) ? firstSection.modules : [];
  const headingModule = modules.find((module) => module.type === 'heading');
  const textModule = modules.find((module) => module.type === 'text');
  const buttonModule = modules.find((module) => module.type === 'button');
  return {
    id: Number(record.id || 0) || 0,
    templateKind: 'email',
    slug: safeText(record.emailSlug, 120),
    name: safeText(record.name, 255),
    summary: safeText(record.summary, 1000),
    subject: safeText(record.subject, 500),
    emailFunction: safeText(record.emailFunction, 80),
    heading: safeText(headingModule?.text, 500),
    body: safeText(textModule?.text, 10000),
    cta: safeText(buttonModule?.text, 255),
    pageBackground: record.pageBackground,
    layoutSections: record.layoutSections,
    blocks: modules.map((module, index) => ({
      id: safeText(module.id, 120) || `block_${index + 1}`,
      type: module.type === 'button' ? 'button' : module.type === 'heading' ? 'heading' : 'paragraph',
      text: safeText(module.text, 10000),
      url: safeText(module.settings?.href, 2000),
    })),
    createdAt: record.createdAt || '',
    updatedAt: record.updatedAt || '',
  };
}

function emailInputToPageTemplateInput(input) {
  const name = safeText(input?.name, 255);
  const slug = safeText(input?.slug, 120);
  const document = migrateLegacyEmailBlocksToDocument({
    subject: input?.subject,
    heading: input?.heading,
    body: input?.body,
    cta: input?.cta,
    blocks: input?.blocks,
  });
  return {
    name,
    templateKind: 'email',
    templateId: slug || `email-${Date.now()}`,
    emailSlug: slug,
    emailFunction: input?.emailFunction || input?.email_function,
    summary: input?.summary,
    subject: input?.subject,
    pageBackground: document.pageBackground,
    layoutSections: document.sections,
  };
}

async function seedDefaults(scope = null) {
  for (const template of DEFAULT_EMAIL_TEMPLATES) {
    await createPageTemplate(emailInputToPageTemplateInput(template), scope);
  }
}

async function listEmailTemplates(limit = 1000, scope = null) {
  const result = await listPageTemplates(limit, scope, { templateKind: 'email' });
  if (!result.ok) return result;
  const rows = Array.isArray(result.data) ? result.data : [];
  if (!rows.length) {
    await seedDefaults(scope);
    const seeded = await listPageTemplates(limit, scope, { templateKind: 'email' });
    if (!seeded.ok) return seeded;
    return {
      ok: true,
      status: 200,
      data: (seeded.data || []).map(pageTemplateToEmailTemplate),
    };
  }
  return {
    ok: true,
    status: 200,
    data: rows.map(pageTemplateToEmailTemplate),
  };
}

async function createEmailTemplate(input, scope = null) {
  const result = await createPageTemplate(emailInputToPageTemplateInput(input), scope);
  if (!result.ok) return result;
  return { ok: true, status: 201, data: pageTemplateToEmailTemplate(result.data) };
}

async function updateEmailTemplate(id, input, scope = null) {
  const result = await updatePageTemplate(id, emailInputToPageTemplateInput(input), scope);
  if (!result.ok) return result;
  return { ok: true, status: 200, data: pageTemplateToEmailTemplate(result.data) };
}

async function deleteEmailTemplate(id, scope = null) {
  const result = await deletePageTemplate(id, scope);
  if (!result.ok) return result;
  return { ok: true, status: 200, data: pageTemplateToEmailTemplate(result.data) };
}

module.exports = {
  DEFAULT_EMAIL_TEMPLATES,
  listEmailTemplates,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  rowToEmailTemplate: pageTemplateToEmailTemplate,
  rowToPageTemplate,
};
