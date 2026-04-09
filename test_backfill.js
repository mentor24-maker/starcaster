const { handle } = require('./routes/acquire');
require('dotenv').config({ path: '/Users/mentor/Desktop/ISITAS/Development/alphire-promo/.env' });

async function run() {
  const req = {
    url: '/api/acquire/youtube-videos/backfill-details',
    method: 'POST',
    on: (evt, cb) => {
      if (evt === 'data') cb(Buffer.from(JSON.stringify({ video_urls: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'] })));
      if (evt === 'end') cb();
    }
  };
  const res = {
    writeHead: (s, h) => console.log('STATUS:', s),
    end: (body) => console.log('BODY:', body)
  };
  await handle(req, res);
}
run();
