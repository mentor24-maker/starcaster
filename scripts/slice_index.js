const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '../public/index.html');
const pagesDir = path.join(__dirname, '../src/pages');
const layoutPath = path.join(__dirname, '../src/layout.html');

if (!fs.existsSync(pagesDir)) {
    fs.mkdirSync(pagesDir, { recursive: true });
}

let html = fs.readFileSync(indexPath, 'utf8');

// Find where the main sections start
// Find the main content area which comes after the header and nav
const mainIndex = html.indexOf('<main>');
if (mainIndex === -1) {
    console.error("Could not find <main>");
    process.exit(1);
}

// The first actual app page is contactsPage right after <main>
const startIndex = html.indexOf('<section id="contactsPage"', mainIndex);
if (startIndex === -1) {
    console.error("Could not find the first app page section.");
    process.exit(1);
}

// The end is right before closing </main> or </div>
const endIndex = html.lastIndexOf('</main>');
if (endIndex === -1) {
    console.error("Could not find </main>");
    process.exit(1);
}

const headerPart = html.substring(0, startIndex);
const sectionsPart = html.substring(startIndex, endIndex);
const footerPart = html.substring(endIndex);

// Let's create the layout shell
const layoutContent = headerPart + '      <!-- INJECT_PAGES -->\n    ' + footerPart;
fs.writeFileSync(layoutPath, layoutContent, 'utf8');
console.log(`Created src/layout.html`);

// Now split sectionsPart into groups.
// To do this perfectly without breaking nested sections, we look for the top-level sections.
// A top level section starts with <section id="...
const sections = sectionsPart.split(/(?=\n\s*<section id="[^"]+" class="(?:app-page|auth-landing)[^"]*">)/g);

let currentFileContent = '';
let currentGroup = 'misc';

// Mapping rules
const groups = {
    'auth': ['authLanding'],
    'contacts': ['contacts', 'addContact', 'viewContact', 'editContact', 'cloneContact', 'segments', 'segmentEditor', 'manageContactPersonas', 'createContactPersona', 'editContactPersona'],
    'campaigns': ['campaigns'],
    'acquire': ['acquire', 'askIzzy', 'editYoutube', 'bulkEditYoutube', 'youtube', 'createYoutube'],
    'promote': ['promote'],
    'engage': ['engage'],
    'messaging': ['messaging', 'createMessaging', 'editMessaging'],
    'assets': ['assets', 'addAsset', 'assetCategories', 'manageAssetCategories', 'createAssetCategory', 'editAssetCategory'],
    'channels': ['channels', 'addChannel', 'editChannel'],
    'develop': ['develop'],
    'observe': ['observe', 'activityLog'],
    'docs': ['docs'],
    'settings': ['settings', 'envConfig'],
    'training': ['training'],
    'devAgent': ['devTasks', 'devForum', 'devKanban', 'devWorkflow', 'rogerAi']
};

function getGroupForId(id) {
    for (const [group, prefixes] of Object.entries(groups)) {
        if (prefixes.some(p => id.startsWith(p))) {
            return group;
        }
    }
    return 'misc';
}

const groupedContents = {};

for (let i = 0; i < sections.length; i++) {
    let sec = sections[i];
    if (!sec.trim()) continue;
    
    const idMatch = sec.match(/<section id="([^"]+)"/);
    if (idMatch) {
        const id = idMatch[1];
        const group = getGroupForId(id);
        
        if (!groupedContents[group]) {
            groupedContents[group] = '';
        }
        groupedContents[group] += sec;
    } else {
        groupedContents['misc'] += sec;
    }
}

for (const [group, content] of Object.entries(groupedContents)) {
    const filename = path.join(pagesDir, `${group}.html`);
    fs.writeFileSync(filename, content, 'utf8');
    console.log(`Created src/pages/${group}.html`);
}

console.log("Successfully sliced index.html!");
