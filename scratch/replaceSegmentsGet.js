const fs = require('fs');
const contents = fs.readFileSync('routes/contacts.js', 'utf8');

const updated = contents.replace(
  /const segments = \(Array.isArray\(segRes\.data\) \? segRes\.data : \[\]\)\.map\(seg => \(\{[\s\S]*? audienceSize: contacts\.filter\(c => contactMatchesSegment\(c, seg\)\)\.length,[\s\S]*?\}\)\);/,
  `const segments = (Array.isArray(segRes.data) ? segRes.data : []).map(seg => ({
      ...seg,
      audienceSize: seg.segment_type === 'youtube_comments' ? 'Dynamic' : contacts.filter(c => contactMatchesSegment(c, seg)).length,
    }));`
);

fs.writeFileSync('routes/contacts.js', updated);
console.log('patched GET /segments audienceSize logic');
