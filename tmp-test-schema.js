require('dotenv').config();
const { sbQuery } = require('./lib/supabase');

async function run() {
  console.log("Fetching Types...");
  const types = await sbQuery({ table: 'contact_types', query: 'select=*&limit=1' });
  console.log("Types:", types);
  
  const statuses = await sbQuery({ table: 'contact_statuses', query: 'select=*&limit=1' });
  console.log("Statuses:", statuses);
}
run();
