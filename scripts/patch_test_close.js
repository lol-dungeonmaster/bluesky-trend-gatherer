const fs = require('fs');
let code = fs.readFileSync('tests/popup.test.js', 'utf8');

code = code.replace(`window.close = jest.fn();`, `jest.spyOn(window, 'close').mockImplementation(() => {});`);
code = code.replace(`await new Promise(r => setTimeout(r, 0));\n        expect(window.close).toHaveBeenCalled();`, `await new Promise(r => setTimeout(r, 10));\n        expect(window.close).toHaveBeenCalled();`);

fs.writeFileSync('tests/popup.test.js', code);
