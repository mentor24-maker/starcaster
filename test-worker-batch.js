const queue = [697, 698];

async function processQueue() {
  for (const id of queue) {
    try {
      const r = await fetch('http://127.0.0.1:3000/api/develop/devAgent/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'INSERT',
          record: { id, session_id: 17, role: 'roger', project_id: null, status: 'processing' }
        })
      });
      const t = await r.text();
      console.log(`Fetch response for ${id}:`, t);
    } catch(err) {
      console.error(`Fetch error for ${id}:`, err.message);
    }
  }
}
processQueue();
