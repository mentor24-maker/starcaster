require('dotenv').config();
const { sbQuery } = require('./lib/supabase');

(async () => {
  try {
    const res = await sbQuery({ method: 'GET', table: 'agent_messages', query: 'select=*&session_id=eq.19&order=id.asc' });
    const msgs = res.data.map(m => `[${m.role}] ID: ${m.id}\n${m.content}\n`).join('\n\n');
    const fs = require('fs');
    fs.writeFileSync('./session_19_transcript.txt', msgs);
    console.log("Wrote transcript to session_19_transcript.txt");
  } catch(e) {
    console.error(e);
  }
})();
