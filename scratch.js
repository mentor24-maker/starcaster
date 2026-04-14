const { sbQuery } = require('./lib/supabase');
(async () => {
  const res = await sbQuery({ method: 'GET', table: 'agent_messages', query: 'order=id.desc&limit=5' });
  console.log(JSON.stringify(res.data, null, 2));
})();
