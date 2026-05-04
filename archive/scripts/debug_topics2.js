const { tableConfig } = require('./lib/supabase');
const { listMessagingTopics } = require('./lib/messagingTopicsStore');
async function test() {
  const noScope = await listMessagingTopics(10);
  console.log(JSON.stringify(noScope, null, 2));
}
test();
