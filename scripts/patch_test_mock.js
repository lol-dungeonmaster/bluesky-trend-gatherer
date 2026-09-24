const fs = require('fs');
let code = fs.readFileSync('tests/background.test.js', 'utf8');

code = code.replace(`            return { 
                query: global.mockQuery,
                close: jest.fn()
            };`, `            return { 
                query: global.mockQuery,
                close: jest.fn(),
                prepare: jest.fn().mockResolvedValue({
                    query: global.mockQuery,
                    close: jest.fn()
                })
            };`);

fs.writeFileSync('tests/background.test.js', code);
