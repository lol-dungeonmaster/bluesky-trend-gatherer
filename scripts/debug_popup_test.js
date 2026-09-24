const fs = require('fs');
let code = fs.readFileSync('tests/popup.test.js', 'utf8');

code = code.replace(`        expect(actorsSpan).toBeDefined();`, `
        if (!actorsSpan) { console.log(trendList.innerHTML); }
        expect(actorsSpan).toBeDefined();`);

fs.writeFileSync('tests/popup.test.js', code);
