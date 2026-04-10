require('dotenv').config();
const { sbQuery, tableConfig } = require('./lib/supabase');
async function run() {
  const query = `select=*&order=id.desc&limit=5`;
  const res = await sbQuery({
    method: 'GET',
    table: tableConfig().rogerChats || 'roger_chats',
    query,
  });
  if (res.ok) {
    res.data.reverse().forEach(c => console.log(`[${c.role}]: ${c.content}\n`));
  } else {
    console.log("error", res);
  }
}
run();
