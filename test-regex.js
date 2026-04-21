const fs = require('fs');
let code = fs.readFileSync('public/js/roger.js', 'utf8');

// evaluate the formatMarkdown function
let formatMarkdownStr = code.substring(code.indexOf('function formatMarkdown(text) {'));
formatMarkdownStr = formatMarkdownStr.substring(0, formatMarkdownStr.indexOf('\n  }') + 4);

eval(formatMarkdownStr);

const text = "2026-04-20T23:50:15.141Z', \"source_agent\": \"@Roger\", \"target_agent\": \"@Human\", \"active_objective_id\": \"AG-DEV-APP-INTEGRATION-PLAN\", \"context_checksum\": \"5v4w3x2y\" ], \"payload\": { \"action\": \"CONFIRM\", \"commandhash\": \"8u7n63t\" } }";

console.log("Input: ", text);
console.log("Formatted: ", formatMarkdown(text));
