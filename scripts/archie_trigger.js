const express = require('express');
const { exec } = require('child_process');
const app = express();
const PORT = 3005;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.json());

const appleScript = `
tell application "Antigravity"
    activate
end tell
delay 0.2
tell application "System Events"
    keystroke "l" using command down
    delay 0.2
    keystroke "checkdev"
    delay 0.1
    keystroke return
end tell
`;

app.post('/trigger', (req, res) => {
  console.log('Received macro trigger request!');
  
  exec(`osascript -e '${appleScript.replace(/\n/g, "' -e '")}'`, (error, stdout, stderr) => {
    if (error) {
      console.error('Error executing AppleScript:', error);
      return res.status(500).json({ error: 'Failed to execute macro', details: error.message });
    }
    console.log('Macro executed successfully.');
    res.json({ success: true, message: 'Macro executed' });
  });
});

app.listen(PORT, () => {
  console.log(`Archie Macro Server listening on http://localhost:${PORT}`);
  console.log('Waiting for /trigger requests from the browser...');
});
