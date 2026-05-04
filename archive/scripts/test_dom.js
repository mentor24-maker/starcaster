const { JSDOM } = require('jsdom');
const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="devChatLog"></div></body></html>`);
global.document = dom.window.document;
global.window = dom.window;

const App = { devAgent: {} };
global.App = App;

// Copy functions
App.devAgent.formatMarkdown = function(text) {
  if (!text) return '';
  let html = String(text);
  
  // Basic markdown
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  html = html.replace(/\n/g, '<br>');
  
  // Custom links
  const versionRegex = /\b(?:(?:state_?)?version_?id|version|commandhash)(?:\\n|\s|<br\s*\/?>|"|'|&quot;)*:(?:\\n|\s|<br\s*\/?>|"|'|&quot;)*([\w\d]+)/gi;
  html = html.replace(versionRegex, '<a href="#devChatVersion_$1" class="dev-version-link" onclick="App.devAgent.scrollToVersion(\'$1\'); return false;">$&</a>');
  
  return html;
};

App.devAgent.parseTriAgent = function(rawText) {
  if (!rawText) return null;
  try {
    let maybeJson = String(rawText).trim();
    if (maybeJson.startsWith('```json')) maybeJson = maybeJson.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    else if (maybeJson.startsWith('```')) maybeJson = maybeJson.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(maybeJson);
    
    if (parsed && parsed.payload && parsed.payload.content) {
      try {
         let innerText = String(parsed.payload.content).trim();
         if (innerText.startsWith('```json')) innerText = innerText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
         else if (innerText.startsWith('```')) innerText = innerText.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
         
         const innerParsed = JSON.parse(innerText);
         if (innerParsed && innerParsed.payload && innerParsed.payload.content) {
             parsed.state = { ...parsed.state, ...innerParsed.state };
             parsed.payload = { ...parsed.payload, ...innerParsed.payload };
         }
      } catch(e3) {
         let innerText = String(parsed.payload.content).trim();
         if (innerText.includes('"state"') && innerText.includes('"payload"')) {
            parsed.error = "Double-wrapped JSON schema violation detected but unparseable.";
            parsed.valid = false;
            return parsed;
         }
      }
    }
    
    if (parsed && parsed.state && parsed.payload) {
      return { valid: true, data: parsed };
    }
    return { valid: false, error: 'Missing state or payload', data: parsed };
  } catch (err) {
    return { valid: false, error: err.message };
  }
};

App.devAgent.appendChatNode = function(chat) {
  const log = document.getElementById('devChatLog');
  if (!log) return;
  if (chat.id) {
    const existingNode = document.getElementById('devChatNode_' + chat.id);
    if (existingNode) return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'dev-chat-bubble-wrapper ' + (chat.role || 'user');
  if (chat.id) wrapper.id = 'devChatNode_' + chat.id;
  
  const bubble = document.createElement('div');
  bubble.className = 'dev-chat-bubble ' + (chat.role || 'user');
  
  const content = document.createElement('div');
  content.className = 'dev-chat-content';

  let parsedTriAgent = App.devAgent.parseTriAgent(chat.content);
  if (parsedTriAgent && !parsedTriAgent.valid) {
    parsedTriAgent = null;
  } else if (parsedTriAgent) {
    parsedTriAgent = parsedTriAgent.data;
  }

  let plainTextSummary = '';
  if (parsedTriAgent) {
    plainTextSummary = parsedTriAgent.payload.content.substring(0, 50);
  } else {
    plainTextSummary = chat.content.substring(0, 50);
  }

  content.innerHTML = plainTextSummary;
  bubble.appendChild(content);
  wrapper.appendChild(bubble);
  log.appendChild(wrapper);
};

// Fetch chats from DB and test
require('dotenv').config({path:'.env'});
fetch(process.env.SUPABASE_URL+'/rest/v1/agent_messages?select=*&session_id=eq.18&order=id.asc', {
  headers:{'apikey':process.env.SUPABASE_SERVICE_KEY.trim(),'Authorization':'Bearer '+process.env.SUPABASE_SERVICE_KEY.trim()}
}).then(r=>r.json()).then(chats => {
  console.log('Fetched chats length:', chats.length);
  try {
    chats.forEach((chat, index) => {
      try {
        App.devAgent.appendChatNode(chat);
      } catch (err) {
        console.error('Error appending chat at index', index, chat.id, err);
        throw err;
      }
    });
    console.log('Successfully appended all', document.getElementById('devChatLog').children.length, 'nodes.');
  } catch (err) {
    console.error('Failed during loop:', err);
  }
});
