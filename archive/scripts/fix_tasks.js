const fs = require('fs');
const { execSync } = require('child_process');

let html = fs.readFileSync('public/index.html', 'utf8');
let oldHtml = execSync('git show HEAD~1:public/index.html').toString();

function extractDiv(id, sourceHtml) {
    const startStr = `<div id="${id}"`;
    const startIdx = sourceHtml.indexOf(startStr);
    if (startIdx === -1) return null;
    let divCount = 0;
    let inQuotes = false;
    let i = startIdx;
    while (i < sourceHtml.length) {
        if (sourceHtml[i] === '"') inQuotes = !inQuotes;
        if (!inQuotes) {
            if (sourceHtml.substr(i, 4) === '<div') { divCount++; }
            if (sourceHtml.substr(i, 6) === '</div') { divCount--; }
        }
        if (divCount === 0 && sourceHtml.substr(i, 6) === '</div>') {
            return sourceHtml.substring(startIdx, i + 6);
        }
        i++;
    }
    return null;
}

const browserPanel = extractDiv('devTaskBrowserPanel', oldHtml);
const editorPanel = extractDiv('devTaskEditorPanel', oldHtml);

if (browserPanel && editorPanel) {
    // Insert them right before `<div id="devDashboardKanban"`
    const targetStr = `<div id="devDashboardKanban"`;
    if (html.includes(targetStr)) {
        if (!html.includes('id="devTaskBrowserPanel"')) {
            html = html.replace(targetStr, browserPanel + '\n\n' + editorPanel + '\n\n' + targetStr);
            fs.writeFileSync('public/index.html', html, 'utf8');
            console.log("Successfully inserted Task panels!");
        } else {
            console.log("Task panels already present!");
        }
    } else {
        console.log("Could not find devDashboardKanban!");
    }
} else {
    console.log("Could not extract panels from HEAD~1!");
}
