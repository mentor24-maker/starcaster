const { sbQuery } = require('./lib/supabase.js');

async function run() {
  const res = await sbQuery({
    method: 'GET',
    table: 'roger_chats',
    query: 'order=created_at.desc&limit=5'
  });
  console.log(JSON.stringify(res, null, 2));
}

run();
