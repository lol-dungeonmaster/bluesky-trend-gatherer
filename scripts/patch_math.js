const fs = require('fs');
let code = fs.readFileSync('background.src.js', 'utf8');

// First replace the updateIcon logic
const regexIcon = /if \(sessionEventCount > 1 && firstEventTime && lastEventTime\) \{\n\s*let diffMs = lastEventTime - firstEventTime;\n\s*let avgSec = Math\.round\(\(diffMs \/ 1000\) \/ \(sessionEventCount - 1\)\);/;

const replaceIcon = `if (sessionEventCount >= 1 && sessionStartTime && lastEventTime) {
        let diffMs = lastEventTime - sessionStartTime;
        let avgSec = Math.round((diffMs / 1000) / sessionEventCount);`;

code = code.replace(regexIcon, replaceIcon);

// Second replace the session_metrics table logic
const regexMetrics = /let avgMs = 0;\n\s*if \(sessionEventCount > 0 && firstEventTime && lastEventTime\) \{\n\s*let totalDurMs = \(lastEventTime - firstEventTime\);\n\s*avgMs = Math\.round\(totalDurMs \/ sessionEventCount\);\n\s*\}/;

const replaceMetrics = `let avgMs = 0;
            if (sessionEventCount > 0 && sessionStartTime && lastEventTime) {
                let totalDurMs = (lastEventTime - sessionStartTime);
                avgMs = Math.round(totalDurMs / sessionEventCount);
            }`;

code = code.replace(regexMetrics, replaceMetrics);

fs.writeFileSync('background.src.js', code);
