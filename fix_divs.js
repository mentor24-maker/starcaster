const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');
const lines = html.split('\n');
let newLines = [];
let inSection = false;
let sectionDivs = 0;
let currentId = null;

for(let i=0; i<lines.length; i++) {
  const line = lines[i];
  if (line.includes('<section') && line.includes('app-page')) {
    currentId = line.match(/id=\"([^\"]+)\"/)?.[1];
    inSection = true;
    sectionDivs = 0;
  }
  
  if (inSection) {
    let openMatch = line.match(/<div[ >]/g) || [];
    let closeMatch = line.match(/<\/div>/g) || [];
    
    // Quick hack to avoid double counting inline strings if any, but it's fine for our HTML structure usually
    sectionDivs += openMatch.length;
    sectionDivs -= closeMatch.length;
    
    if (line.includes('</section>')) {
      if (sectionDivs > 0) {
        console.log(`Fixing ${currentId} by appending ${sectionDivs} closing divs`);
        const spaces = line.match(/^\s*/)[0] || '      ';
        for(let d=0; d<sectionDivs; d++) {
          newLines.push(spaces + '</div>');
        }
      } else if (sectionDivs < 0) {
        console.log(`WARNING: ${currentId} has ${sectionDivs} extra closing divs!`);
      }
      inSection = false;
      sectionDivs = 0;
    }
  }
  
  newLines.push(line);
}

fs.writeFileSync('public/index.html', newLines.join('\n'), 'utf8');
console.log('Fixed index.html structure.');
