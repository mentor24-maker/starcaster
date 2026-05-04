const fs = require('fs');
const file = 'src/pages/acquire.html';
let content = fs.readFileSync(file, 'utf8');

// Replace standard <button type="submit"> with <button type="submit" class="btn btn-primary">
content = content.replace(/<button type="submit">/g, '<button type="submit" class="btn btn-primary">');
content = content.replace(/<button id="directAcquireSubmitBtn" type="submit" class="acquire-web-harvest-btn">/g, '<button id="directAcquireSubmitBtn" type="submit" class="btn btn-primary">');
content = content.replace(/<button id="youtubeResearchSubmitBtn" type="submit">/g, '<button id="youtubeResearchSubmitBtn" type="submit" class="btn btn-primary">');

// Also update the buttons that have other classes but need to look like primary/secondary
content = content.replace(/<button id="directAcquireWebsitePeerSaveBtn" type="submit">/g, '<button id="directAcquireWebsitePeerSaveBtn" type="submit" class="btn btn-primary">');
content = content.replace(/<button id="youtubeMinerTargetSelectorBtn" type="button" class="primary-btn">/g, '<button id="youtubeMinerTargetSelectorBtn" type="button" class="btn">');

// tiny-btn to btn btn-secondary (or just btn)
content = content.replace(/class="tiny-btn"/g, 'class="btn"');
content = content.replace(/class="tiny-btn hidden"/g, 'class="btn hidden"');
content = content.replace(/class="primary-btn"/g, 'class="btn btn-primary"');

fs.writeFileSync(file, content);
