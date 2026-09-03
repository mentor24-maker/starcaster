'use strict';

/**
 * Read-only audit of a project's blog post addresses (86bbu23n7, follow-up to
 * the bulk import 86bbtuh3y): which posts have no slug, which have a slug the
 * normalizer would change, and what the public blog can actually serve.
 *
 *   doppler run --project starcaster --config prd -- \
 *     node scripts/blog_slug_audit.cjs --project <projectId>
 */

const { sbQuery, tableConfig } = require('../lib/supabase');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? String(process.argv[i + 1] || '') : '';
}

(async () => {
  const projectId = arg('project');
  if (!projectId) {
    console.error('Usage: node scripts/blog_slug_audit.cjs --project <projectId>');
    process.exit(1);
  }
  const res = await sbQuery({
    table: tableConfig().blogPosts,
    query:
      `select=id,title,slug,status,published_at,created_at&project_id=eq.${encodeURIComponent(projectId)}` +
      '&order=created_at.desc&limit=500',
  });
  if (!res.ok) {
    console.error('Could not read blog_posts:', String(res.error).slice(0, 300));
    process.exit(2);
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  const byStatus = {};
  for (const p of rows) byStatus[p.status || '(none)'] = (byStatus[p.status || '(none)'] || 0) + 1;

  const blank = rows.filter((p) => !String(p.slug || '').trim());
  const dupes = new Map();
  for (const p of rows) {
    const s = String(p.slug || '').trim();
    if (!s) continue;
    dupes.set(s, (dupes.get(s) || 0) + 1);
  }

  console.log(`blog_posts in ${projectId}: ${rows.length}`);
  console.log('by status:', JSON.stringify(byStatus));
  console.log(`blank slug: ${blank.length}`);
  console.log(`duplicate slugs: ${[...dupes.values()].filter((n) => n > 1).length}`);
  console.log('\nposts with NO address:');
  for (const p of blank) console.log('  ', p.id, '|', String(p.status).padEnd(9), '|', String(p.title || '(no title)').slice(0, 70));
  console.log('\npublished posts (what a visitor can reach):');
  for (const p of rows.filter((x) => x.status === 'published')) {
    console.log('  ', JSON.stringify(String(p.slug || '')).padEnd(46), String(p.title || '').slice(0, 50));
  }
})();
