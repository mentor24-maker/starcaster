require('dotenv').config();
const { sbQuery } = require('./lib/supabase');

(async () => {
  try {
    const res = await sbQuery({ method: 'GET', table: 'agent_messages', query: 'select=*&session_id=eq.19&order=id.asc&limit=10' });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e);
  }
})();
