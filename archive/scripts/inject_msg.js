const fs = require('fs');

async function run() {
  const fileContent = fs.readFileSync('task_api_discovery.md', 'utf8');
  const payload = {
    sessionId: 19,
    content: "Here are the results of the `cat task_api_discovery.md` command for @Archie:\n\n" + fileContent
  };
  
  const res = await fetch('http://127.0.0.1:3000/api/develop/devAgent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  console.log(res.status);
  console.log(await res.text());
}
run();
