const fs = require('fs');
let code = fs.readFileSync('tests/popup.test.js', 'utf8');

code = code.replace(`s.textContent && s.textContent.includes("actors")`, `s.innerHTML && s.innerHTML.includes("actors")`);
code = code.replace(`expect(window.close).toHaveBeenCalled();`, `await new Promise(r => setTimeout(r, 0));\n        expect(window.close).toHaveBeenCalled();`);

fs.writeFileSync('tests/popup.test.js', code);
