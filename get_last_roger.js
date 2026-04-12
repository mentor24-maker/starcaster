const { sbQuery } = require('./lib/supabase.js');
async function run() {
  const res = await sbQuery({ method: 'GET', table: 'roger_chats', query: 'select=*&order=id.desc&limit=5' });
  const data = res.data || [];
  console.log(JSON.stringify(data.filter(d => d.role === 'model'), null, 2));
}
run();
