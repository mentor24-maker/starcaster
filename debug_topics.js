const { tableConfig } = require('./lib/supabase');
const { listMessagingTopics } = require('./lib/messagingTopicsStore');

async function test() {
  console.log("Table target:", tableConfig().messagingTopics);
  
  // Test with no scope
  const noScope = await listMessagingTopics(10);
  console.log("No Scope Topic Count:", noScope.data?.length);

  // Test with scope from screenshot
  const scope = { projectId: 'proj_1773122003509_u5j6z7' };
  const scoped = await listMessagingTopics(10, scope);
  console.log("Proj Scope Topic Count:", scoped.data?.length);
}

test().catch(console.error);
