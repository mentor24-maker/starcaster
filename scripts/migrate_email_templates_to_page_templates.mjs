#!/usr/bin/env node
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sbQuery, tableConfig, isConfigured } = require('../lib/supabase.js');
const { migrateLegacyEmailBlocksToDocument } = require('../lib/builder/migrate-from-legacy.js');
const { serializeBuilderDocument } = require('../lib/builder/document.js');

const APPLY = process.argv.includes('--apply');

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

async function listEmailTemplates(emailTable) {
  const res = await sbQuery({
    method: 'GET',
    table: emailTable,
    query: 'select=*&limit=5000',
  });
  if (!res.ok) throw new Error(res.error || res.message || 'Could not load develop_email_templates');
  return Array.isArray(res.data) ? res.data : [];
}

async function emailTemplateExists(pageTable, slug, projectId) {
  let query = `select=id&template_kind=eq.email&email_slug=eq.${encodeURIComponent(slug)}&limit=1`;
  if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
  const res = await sbQuery({ method: 'GET', table: pageTable, query });
  if (!res.ok) return false;
  return Array.isArray(res.data) && res.data.length > 0;
}

async function main() {
  if (!isConfigured()) {
    console.error('Supabase is not configured. Set env vars and retry.');
    process.exit(1);
  }

  const tables = tableConfig();
  const emailTable = tables.developEmailTemplates;
  const pageTable = tables.developPageTemplates;
  const rows = await listEmailTemplates(emailTable);

  console.log(APPLY ? 'Applying email template merge...' : 'Dry run (pass --apply to write)...');
  console.log(`Found ${rows.length} develop_email_templates row(s).`);

  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const slug = safeText(row.slug, 120);
    const projectId = safeText(row.project_id, 120);
    if (await emailTemplateExists(pageTable, slug, projectId)) {
      console.log(`skip slug=${slug || row.id} (already in develop_page_templates)`);
      skipped += 1;
      continue;
    }

    const document = migrateLegacyEmailBlocksToDocument({
      subject: row.subject,
      heading: row.heading,
      body: row.body,
      cta: row.cta,
      blocks: row.blocks,
    });
    const payload = {
      name: safeText(row.name, 255) || slug || 'Email Template',
      template_kind: 'email',
      template_id: slug || `email-${row.id}`,
      email_slug: slug || null,
      email_function: null,
      summary: safeText(row.summary, 1000),
      subject: safeText(row.subject, 500),
      layout_sections: serializeBuilderDocument({
        pageBackground: document.pageBackground,
        layoutSections: document.sections,
      }),
      project_id: projectId || null,
      owner_user_id: safeText(row.owner_user_id, 120) || null,
    };

    console.log(`create slug=${slug || row.id} name=${payload.name}`);
    if (!APPLY) {
      created += 1;
      continue;
    }

    const res = await sbQuery({
      method: 'POST',
      table: pageTable,
      query: 'select=id',
      headers: { Prefer: 'return=representation' },
      body: [payload],
    });
    if (!res.ok) {
      console.error(`failed slug=${slug || row.id}:`, res.error || res.message);
      continue;
    }
    created += 1;
  }

  console.log(`done created=${created} skipped=${skipped}`);
  if (!APPLY && created > 0) {
    console.log('Re-run with --apply to insert rows.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
