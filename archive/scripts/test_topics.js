const { listMessagingTopics } = require('./lib/messagingTopicsStore');
async function run() {
  const res = await listMessagingTopics(10);
  console.log(JSON.stringify(res, null, 2));
}
run();
