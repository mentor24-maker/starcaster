#!/usr/bin/env node
'use strict';

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (e) {}

const { listRogerChats, createRogerChat } = require('../lib/rogerChatsStore');
const fs = require('fs');

async function main() {
  const [cmd, sessionIdStr, ...rest] = process.argv.slice(2);
  const sessionId = Number(sessionIdStr);

  if (!cmd || !['read', 'chat'].includes(cmd) || !sessionId) {
    console.error('Usage: node bin/ag.js [read|chat] [session_id] [file]');
    process.exit(1);
  }

  if (cmd === 'read') {
    const res = await listRogerChats(sessionId, null, 100);
    if (!res.ok) throw new Error(res.error);
    const chats = res.data;
    console.log(`\n=== SESSION ${sessionId} HISTORY ===\n`);
    chats.forEach(c => {
      console.log(`[${c.role.toUpperCase()}] at ${c.created_at}:`);
      console.log(`${c.content}\n---------------------------------\n`);
    });
  }

  if (cmd === 'chat') {
    const file = rest[0];
    if (!file || !fs.existsSync(file)) {
      console.error('Antigravity Chat error: Please provide a valid file containing your markdown response.');
      process.exit(1);
    }
    const content = fs.readFileSync(file, 'utf8');
    const res = await createRogerChat({ session_id: sessionId, role: 'antigravity', content });
    if (!res.ok) throw new Error(res.error);
    console.log(`[AG] Successfully synced response to Session #${sessionId}.`);
  }
}

main().catch(e => {
  console.error("AG Tool Error:", e);
  process.exit(1);
});
