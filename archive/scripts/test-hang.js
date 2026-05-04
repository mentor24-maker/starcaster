require('dotenv').config();
const { handle } = require('./routes/devAgent');

async function run() {
  const req = {
    method: 'POST',
    url: '/api/develop/devAgent/worker',
    headers: { host: 'localhost:3000', 'content-type': 'application/json' },
    body: { type: 'INSERT', record: { id: 691, session_id: 17, role: 'roger', status: 'processing', content: '[SYSTEM::PROCESSING]' } }
  };
  const res = {
    statusCode: 200,
    setHeader: () => {},
    end: (data) => console.log('Response ended:', data)
  };
  
  console.log('STARTING HANDLE...');
  try {
    await handle(req, res, '/api/develop/devAgent/worker', 'POST');
    console.log('DONE HANDLE');
  } catch(e) {
    console.error('ERROR:', e);
  }
}
run();
