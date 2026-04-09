require('dotenv').config();
const { sbQuery } = require('./lib/supabase');

async function run() {
  const q = `method=POST&table=...` // Wait, sbQuery abstracts Postgrest REST API. We can't query information_schema easily on REST.
}
