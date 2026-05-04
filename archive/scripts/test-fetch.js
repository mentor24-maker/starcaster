const http = require('http');

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      console.log('Received POST to', req.url, 'Body:', body);
      res.writeHead(200);
      res.end('OK');
    });
  } else {
    res.writeHead(200);
    res.end('Hello');
  }
});

server.listen(3000, '127.0.0.1', () => {
  console.log('Server started on 127.0.0.1:3000');
  
  const host = 'localhost:3000';
  const protocol = 'http';
  
  fetch(`${protocol}://${host}/api/worker`, {
    method: 'POST',
    body: 'test'
  }).then(r => r.text()).then(t => {
    console.log('Fetch response:', t);
    server.close();
  }).catch(err => {
    console.error('Fetch error:', err.message);
    server.close();
  });
});
