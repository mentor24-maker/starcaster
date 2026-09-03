'use strict';
const { sbQuery, tableConfig } = require('../lib/supabase');
(async () => {
  const projectId = 'proj_1786047238296_opepjk';
  const res = await sbQuery({ table: tableConfig().blogPosts,
    query: `select=id,title,slug,status,created_at&project_id=eq.${projectId}&order=created_at.asc&limit=500` });
  const rows = res.data || [];
  console.log('id / created / status / slug / title');
  for (const p of rows) {
    const flag = String(p.slug || '').trim() ? '   ' : '>>>';
    console.log(flag, String(p.created_at).slice(0, 16), String(p.status).padEnd(9), JSON.stringify(String(p.slug || '')).slice(0, 40).padEnd(42), String(p.title || '').slice(0, 45));
  }
})();
