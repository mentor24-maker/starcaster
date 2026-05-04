const http = require('http');

const data = JSON.stringify({
  type: 'INSERT',
  record: { id: 691, session_id: 17, role: 'roger', status: 'processing', content: '[SYSTEM::PROCESSING]' }
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/develop/devAgent/worker',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('Response:', res.statusCode, body));
});

req.on('error', (e) => console.error('Request error:', e));
req.write(data);
req.end();
