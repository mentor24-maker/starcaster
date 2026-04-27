require('dotenv').config();
const { sbQuery } = require('./lib/supabase');

(async () => {
  try {
    const res = await sbQuery({ method: 'GET', table: 'agent_messages', query: 'select=*&order=id.desc&limit=5' });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e);
  }
})();
