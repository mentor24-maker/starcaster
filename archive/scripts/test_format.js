const text = "I'm still trying to wrap my head around the relationship between what I have been calling AG Dev (@antigravity in this forum) and AG App...";
let html = String(text);
const versionRegex = /\b(?:(?:state_?)?version_?id|version|commandhash)(?:\\n|\s|<br\s*\/?>|"|'|&quot;)*:(?:\\n|\s|<br\s*\/?>|"|'|&quot;)*([\w\d]+)/gi;
html = html.replace(versionRegex, '<a href="#devChatVersion_$1" class="dev-version-link" onclick="App.devAgent.scrollToVersion(\'$1\'); return false;">$&</a>');
console.log(html);
