const fs = require('fs');
const rawChats = JSON.parse(fs.readFileSync('scratch.json', 'utf8'));

const formatMarkdown = function(text) {
  if (!text) return '';
  let chunks = [];
  let html = String(text).replace(/```(?:[a-z0-9]*)?\n([\s\S]*?)```/gi, (match, rawCodeBlock) => {
    let unescapedCodeBlock = rawCodeBlock.replace(/^>\s?/gm, '');
    let index = chunks.length;
    chunks.push(unescapedCodeBlock);
    return `@@@CODEBLOCK${index}@@@`;
  });
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  return html;
}

try {
  rawChats.forEach((chat, i) => {
    try {
      formatMarkdown(chat.content);
      // also the sentence summary logic:
      let rawText = (chat.content || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
      let plainTextSummary = rawText;
      const sentenceMatches = rawText.match(/.*?[.!?](?:\s|$)/g);
      
    } catch(e) {
      console.log("Error at index", i);
      throw e;
    }
  });
  console.log("No errors in formatting");
} catch(e) {
  console.log(e);
}
