const { handle } = require('./routes/auth.js');
const req = {
  url: '/api/auth/login',
  method: 'POST',
  headers: {},
  on: (event, cb) => {
    if (event === 'data') cb(JSON.stringify({ email: "test@test.com", password: "test" }));
    if (event === 'end') cb();
  }
};
const res = {
  setHeader: () => {},
  end: (data) => console.log('Response:', data)
};
handle(req, res, '/api/auth/login', 'POST').catch(err => console.error("CRASH:", err));
