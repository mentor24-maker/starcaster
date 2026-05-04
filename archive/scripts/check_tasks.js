require('dotenv').config();
const { sbQuery } = require('./lib/supabase');

(async () => {
  try {
    const res = await sbQuery({ method: 'GET', table: 'dev_tasks', query: 'select=*' });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e);
  }
})();
