const https = require('https');
https.get('https://app.isitas.org/api/develop/roger/chat?action=list', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(data));
});
