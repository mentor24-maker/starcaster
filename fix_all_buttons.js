const fs = require('fs');
const path = require('path');

const pagesDir = path.join(__dirname, 'src', 'pages');
const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));

files.forEach(file => {
    const filePath = path.join(pagesDir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Replace <button type="submit">
    content = content.replace(/<button([^>]*)type="submit"([^>]*)>/g, (match, p1, p2) => {
        if (!match.includes('class=')) {
            return `<button${p1}type="submit"${p2} class="btn btn-primary">`;
        }
        return match.replace(/class="([^"]*)"/, (m, c) => {
            if (!c.includes('btn')) {
                return `class="btn btn-primary ${c}"`;
            }
            if (c === 'tiny-btn' || c === 'primary-btn') {
               return `class="btn btn-primary"`;
            }
            return m;
        });
    });

    // Replace <button type="button">
    content = content.replace(/<button([^>]*)type="button"([^>]*)>/g, (match, p1, p2) => {
        if (!match.includes('class=')) {
            return `<button${p1}type="button"${p2} class="btn">`;
        }
        return match.replace(/class="([^"]*)"/, (m, c) => {
            if (!c.includes('btn') && !c.includes('table-sort-btn') && !c.includes('youtube-miner-collapsible-toggle')) {
                return `class="btn ${c}"`;
            }
            if (c === 'tiny-btn') {
               return `class="btn"`;
            }
            if (c.includes('tiny-btn')) {
                return m.replace('tiny-btn', 'btn');
            }
            if (c.includes('primary-btn')) {
                return m.replace('primary-btn', 'btn btn-primary');
            }
            return m;
        });
    });

    fs.writeFileSync(filePath, content);
    console.log(`Updated buttons in ${file}`);
});
