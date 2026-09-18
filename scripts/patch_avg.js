const fs = require('fs');
let code = fs.readFileSync('background.src.js', 'utf8');

const regexAvg = /if \(sessionEventCount > 1 && firstEventTime && lastEventTime\) \{/;
const replaceAvg = `if (sessionEventCount > 2 && firstEventTime && lastEventTime) {`;

code = code.replace(regexAvg, replaceAvg);
fs.writeFileSync('background.src.js', code);
