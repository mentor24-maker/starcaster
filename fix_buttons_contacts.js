const fs = require('fs');
const file = 'src/pages/contacts.html';
let content = fs.readFileSync(file, 'utf8');

// Replace standard <button type="submit"> with <button type="submit" class="btn btn-primary">
content = content.replace(/<button type="submit">/g, '<button type="submit" class="btn btn-primary">');
content = content.replace(/<button id="csvImportBtn" type="button">/g, '<button id="csvImportBtn" type="button" class="btn btn-primary">');

// tiny-btn to btn
content = content.replace(/class="tiny-btn"/g, 'class="btn"');
content = content.replace(/class="primary-btn"/g, 'class="btn btn-primary"');

// also replace <button id="..."> that don't have a class with btn
// This regex will capture the button tag and add class="btn" if it doesn't have a class.
content = content.replace(/<button([^>]*)>/g, (match, p1) => {
    if (!p1.includes('class=') && p1.includes('type="button"')) {
        return `<button${p1} class="btn">`;
    }
    return match;
});

// For acquire.html as well, catch any remaining button type="button" without classes
const file2 = 'src/pages/acquire.html';
let content2 = fs.readFileSync(file2, 'utf8');
content2 = content2.replace(/<button([^>]*)>/g, (match, p1) => {
    if (!p1.includes('class=') && p1.includes('type="button"')) {
        return `<button${p1} class="btn">`;
    }
    return match;
});
fs.writeFileSync(file2, content2);


fs.writeFileSync(file, content);
