const db = require('better-sqlite3')('./db.sqlite');
const rows = db.prepare("SELECT key, value FROM api_settings WHERE key = 'supabase_url' OR key = 'supabase_service_key'").all();
const env = {};
rows.forEach(r => { env[r.key] = r.value; });
console.log("SUPA CONFIG:", env);
