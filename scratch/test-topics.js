const { sbQuery } = require('../lib/supabase.js');

async function test() {
  try {
    const res = await sbQuery({ method: 'GET', table: 'messaging_topics', query: 'select=topic' });
    console.log("Topics:", res.data);
  } catch (err) {
    console.error("Crash:", err);
  }
}
test();
