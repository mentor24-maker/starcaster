require('dotenv').config({ path: '.env' });
const { listRogerChats } = require('./lib/rogerChatsStore');

async function run() {
  const result = await listRogerChats(18, null, 100);
  console.log("Length of returned chats:", result.data ? result.data.length : result);
  
  if (result.data) {
     console.log("First 10 IDs:", result.data.slice(0,10).map(c=>c.id));
     console.log("Last 10 IDs:", result.data.slice(-10).map(c=>c.id));
  }
}

run().catch(console.error);
