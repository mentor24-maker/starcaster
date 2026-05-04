const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/debugSession',
  method: 'GET',
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk}`);
  });
});

req.end();
