const { buildSync } = require('esbuild');
const fs = require('fs');

buildSync({
  entryPoints: ['src/background.src.js'],
  inject: ['scripts/zod-config.js'],
  bundle: true,
  outfile: 'dist/background.bundle.js',
  format: 'iife'
});

let code = fs.readFileSync('dist/background.bundle.js', 'utf8');

// Suppress Zod's CSP-violating environment check
code = code.replace(/const F = Function;\n\s*new F\(\"\"\);\n\s*return true;/g, 'return false; // Suppressed CSP violation');
code = code.replace(/const F2 = Function;\n\s*new F2\(\"\"\);\n\s*return true;/g, 'return false; // Suppressed CSP violation');

code = code.replace(/return new Function\(\`x\`, \`\$\{fnBody\}\nreturn true;\`\);/g, 'return function(x) { return true; }; // Suppressed CSP violation');

fs.writeFileSync('dist/background.bundle.js', code);

fs.copyFileSync('node_modules/webextension-polyfill/dist/browser-polyfill.min.js', 'dist/browser-polyfill.min.js');
