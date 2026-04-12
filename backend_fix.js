const fs = require('fs');
let code = fs.readFileSync('routes/roger.js', 'utf8');

// Inside POST /chat, remove the internal fetch loopback!
// Replace from start of fetch to the end.
code = code.replace(
  /const proto = req\.headers\['x-forwarded-proto'\][\s\S]*?body: JSON\.stringify\([\s\S]*?respondingAgent\s*\}\)[\s\S]*?\}\)\.catch[\s\S]*?return sendOk/,
  "return sendOk"
);

// Inside POST /worker, STOP it from returning early!
// We want it to wait and hold the container active until Gemini completes.
code = code.replace(
  `sendOk(res, 202, { status: "processing" }); // Acknowledge to drop original requestor safely`,
  `// Do NOT return response early. The browser holds this open to keep Vercel alive.`
);
code = code.replace(
  `await updateRogerChat(chatId, { content: \`**SYSTEM ERROR EXCEPTION:** Worker thread collapsed randomly -> \${err.message}\` });\n    }\n    return true;`,
  `await updateRogerChat(chatId, { content: \`**SYSTEM ERROR EXCEPTION:** Worker thread collapsed randomly -> \${err.message}\` });\n    }\n    sendOk(res, 200, { success: true });\n    return true;`
);

fs.writeFileSync('routes/roger.js', code);
