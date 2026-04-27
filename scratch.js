require('dotenv').config();
const { sbQuery } = require('./lib/supabase.js');
async function test() {
  const res = await sbQuery({ method: 'GET', table: 'dev_tasks', query: 'select=title,status,assignee' });
  console.log(JSON.stringify(res.data, null, 2));
}
test();
