const fs = require('fs');
let code = fs.readFileSync('tests/popup.test.js', 'utf8');

code = code.replace(`find(s => s.innerHTML && s.innerHTML.includes("actors"));`, `find(s => s.classList.contains("actors-trigger"));`);
code = code.replace(`await new Promise(r => setTimeout(r, 10));\n        expect(window.close).toHaveBeenCalled();`, `await new Promise(setImmediate);\n        expect(window.close).toHaveBeenCalled();`);

fs.writeFileSync('tests/popup.test.js', code);
