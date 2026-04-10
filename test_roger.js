const { handle } = require('./routes/roger');
const req = {
  url: '/api/develop/roger/chat',
  method: 'POST',
  headers: { },
  on: (event, cb) => {
    if (event === 'data') cb(Buffer.from('{"content":"Hello"}'));
    if (event === 'end') cb();
  }
};
const res = {
  setHeader: () => {},
  writeHead: (status) => console.log('STATUS:', status),
  end: (data) => console.log('RESPONSE:', data)
};
handle(req, res, '/api/develop/roger/chat', 'POST').catch(console.error);
