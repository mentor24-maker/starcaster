require('dotenv').config();
const { sbQuery } = require('./lib/supabase');
async function test() {
  const r = await sbQuery({ method: 'GET', table: process.env.SUPABASE_AUTH_USERS_TABLE || 'app_auth_users', query: 'limit=1' });
  console.log(JSON.stringify(r, null, 2));
}
test();
