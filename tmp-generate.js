const { sbQuery } = require('./lib/supabase');

async function main() {
  const result = await sbQuery({
    method: 'GET',
    table: 'contacts',
    query: 'select=status,source',
  });

  if (!result.ok) {
    console.error('Failed to fetch contacts:', result);
    process.exit(1);
  }

  const statuses = new Set();
  const sources = new Set();

  result.data.forEach(row => {
    if (row.status && row.status.trim()) statuses.add(row.status.trim());
    if (row.source && row.source.trim()) sources.add(row.source.trim());
  });

  const generateInserts = (table, items) => {
    if (items.size === 0) return '';
    const arr = Array.from(items).map(item => {
      const key = item.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      return `('${key}', '${item.replace(/'/g, "''")}', true, 0)`;
    });
    return `INSERT INTO public.${table} (key, label, is_active, sort_order) VALUES\n  ${arr.join(',\n  ')}\nON CONFLICT (key) DO NOTHING;\n`;
  };

  const sql = `-- contacts_options_management_setup.sql

CREATE TABLE IF NOT EXISTS public.contact_statuses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contact_sources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed Statuses
${generateInserts('contact_statuses', statuses)}
-- Seed Sources
${generateInserts('contact_sources', sources)}
`;

  const fs = require('fs');
  fs.writeFileSync('docs/contacts_options_management_setup.sql', sql);
  console.log('Successfully generated docs/contacts_options_management_setup.sql');
  console.log(`Found ${statuses.size} statuses and ${sources.size} sources.`);
}

main().catch(console.error);
