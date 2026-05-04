const fs = require('fs');
const text = fs.readFileSync('public/index.html', 'utf8');

const startTag = '<div id="devTaskEditorPanel"';
const endTagStr = '              </form>\n            </div>';

const startIndex = text.indexOf(startTag);
let endIndex = text.indexOf(endTagStr, startIndex);
if (endIndex > -1) endIndex += endTagStr.length;

const panelText = text.substring(startIndex, endIndex);
let newText = text.substring(0, startIndex) + text.substring(endIndex);

const insertIndex = newText.indexOf('<div id="devChatLog"');
newText = newText.substring(0, insertIndex) + panelText + '\n            ' + newText.substring(insertIndex);

fs.writeFileSync('public/index.html', newText);
console.log('Moved devTaskEditorPanel');
