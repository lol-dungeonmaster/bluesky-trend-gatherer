const fs = require('fs');
let code = fs.readFileSync('tests/popup.test.js', 'utf8');

code = code.replace(`const optionsBtn = document.getElementById("optionsBtn");`, 
`window.close = jest.fn();
        const optionsBtn = document.getElementById("btnOptions");`);
        
code = code.replace(`find(s => s.innerText.includes("actors"));`, 
`find(s => s.textContent && s.textContent.includes("actors"));`);

fs.writeFileSync('tests/popup.test.js', code);
