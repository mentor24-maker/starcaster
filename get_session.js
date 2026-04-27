require('dotenv').config();
const { listRogerSessions, listRogerChats } = require('./lib/rogerChatsStore');
async function run() {
  const sRes = await listRogerSessions(null);
  if (!sRes.data) {
    console.log("No data returned:", sRes);
    return;
  }
  const session = sRes.data.find(s => s.name.includes("Architectural Blueprint"));
  if (session) {
    console.log("Found Session:", session.id);
    const cRes = await listRogerChats(session.id, null, 100);
    const fs = require('fs');
    fs.writeFileSync('scratch.json', JSON.stringify(cRes.data, null, 2));
    console.log("Saved chats to scratch.json. Count:", cRes.data.length);
  } else {
    console.log("Session not found. Available sessions:", sRes.data.map(s => s.name).join(", "));
  }
}
run();
