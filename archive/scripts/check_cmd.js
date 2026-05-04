require('dotenv').config();
const { listPendingCommands } = require('./lib/rogerChatsStore');

(async () => {
  try {
    const res = await listPendingCommands(null);
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e);
  }
})();
