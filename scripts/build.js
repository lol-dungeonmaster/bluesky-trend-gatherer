const { buildSync } = require('esbuild');
const fs = require('fs');

buildSync({
  entryPoints: ['src/background.src.js'],
  inject: ['scripts/zod-config.js'],
  bundle: true,
  minify: true,
  treeShaking: true,
  outfile: 'dist/background.bundle.js',
  format: 'iife'
});

let code = fs.readFileSync('dist/background.bundle.js', 'utf8');

// Suppress Zod's CSP-violating environment check (if it survived tree-shaking)
code = code.replace(/new Function\(\"\"\)/g, 'function(){return true} /* Suppressed CSP violation */');
// Suppress Apache Arrow's JIT compilation
code = code.replace(/new Function\(\"x\",[\s\S]*?\)/g, 'function(x) { return true; } /* Suppressed CSP violation */');

fs.writeFileSync('dist/background.bundle.js', code);

let polyfillCode = fs.readFileSync('node_modules/webextension-polyfill/dist/browser-polyfill.min.js', 'utf8');
polyfillCode = polyfillCode.replace(/\/\/# sourceMappingURL=browser-polyfill\.min\.js\.map/g, '');
fs.writeFileSync('dist/browser-polyfill.min.js', polyfillCode);


const path = require('path');
if (!fs.existsSync(path.join(__dirname, '../dist'))) {
    fs.mkdirSync(path.join(__dirname, '../dist'));
}
fs.copyFileSync(
    path.join(__dirname, '../node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm'),
    path.join(__dirname, '../dist/parquet_wasm_bg.wasm')
);
