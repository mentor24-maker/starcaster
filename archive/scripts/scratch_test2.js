require('dotenv').config();
const { createRogerSession } = require('./lib/rogerChatsStore');

async function run() {
  const result = await createRogerSession({ project_id: null, name: 'Task: Test Server Side' });
  console.log(result);
}
run();
