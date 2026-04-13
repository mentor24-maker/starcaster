const fs = require('fs');
const path = 'vercel.json';
const config = JSON.parse(fs.readFileSync(path, 'utf8'));

config.functions = config.functions || {};
config.functions["api/[...slug].js"] = {
  maxDuration: 300
};

fs.writeFileSync(path, JSON.stringify(config, null, 2));
