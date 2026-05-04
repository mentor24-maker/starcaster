const fs = require('fs');
let js = fs.readFileSync('public/js/devAgent.js', 'utf8');

const oldSubmitChat = `App.devAgent.submitChat = async function() {
  const text = devElements.input?.value.trim();
  if (!text && devState.stagedFiles.length === 0) return; // Do nothing if no input
  if (!devState.activeSessionId) return;

  const staged = devState.stagedFiles[0] || null;

  devElements.input.value = '';
  devElements.input.disabled = true;
  if (devElements.fileBtn) devElements.fileBtn.disabled = true;`;

const newSubmitChat = `App.devAgent.submitChat = async function(formEl = null) {
  let inputEl = formEl ? formEl.querySelector('.dev-chat-input') : devElements.input;
  let fileBtn = formEl ? formEl.querySelector('.dev-file-trigger-btn') : devElements.fileBtn;
  
  const text = inputEl?.value.trim();
  if (!text && devState.stagedFiles.length === 0) return; // Do nothing if no input
  if (!devState.activeSessionId) return;

  const staged = devState.stagedFiles[0] || null;

  if (inputEl) {
    inputEl.value = '';
    inputEl.disabled = true;
  }
  if (fileBtn) fileBtn.disabled = true;`;

if (js.includes(oldSubmitChat)) {
  js = js.replace(oldSubmitChat, newSubmitChat);
} else {
  console.log("Could not find oldSubmitChat snippet!");
}

const oldSubmitReenable = `  } catch(err) {
    console.error('Chat error:', err);
    devElements.input.disabled = false;
    if (devElements.fileBtn) devElements.fileBtn.disabled = false;
    App.notify('Failed to send message', true);
  }`;

const newSubmitReenable = `  } catch(err) {
    console.error('Chat error:', err);
    if (inputEl) inputEl.disabled = false;
    if (fileBtn) fileBtn.disabled = false;
    App.notify('Failed to send message', true);
  }`;

if (js.includes(oldSubmitReenable)) {
  js = js.replace(oldSubmitReenable, newSubmitReenable);
} else {
  console.log("Could not find oldSubmitReenable snippet!");
}

// Fix my expandThreadAccordion logic which used sendMessage instead of submitChat
js = js.replace('App.devAgent.sendMessage(sessionId, form);', 'App.devAgent.submitChat(form);');

fs.writeFileSync('public/js/devAgent.js', js, 'utf8');
console.log("Rewrote submitChat");
