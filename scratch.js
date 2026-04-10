const { listRogerChats } = require('./lib/rogerChatsStore');
async function run() {
  const res = await listRogerChats(9, null, 10); // Assume session 9? Wait, let's just query everything?
  // listRogerChats requires session ID. Let's find latest session first!
}
