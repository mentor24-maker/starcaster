const text = 'directive ( stateversionid:\\n67 ).';
const pattern = /\b(?:(?:state_?)?version_?id|version)(?:\\n|\s|<br\s*\/?>)*:(?:\\n|\s|<br\s*\/?>)*(\d+)/gi;

console.log("MATCHES:", text.match(pattern));
