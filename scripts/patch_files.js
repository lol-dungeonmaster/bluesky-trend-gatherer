const fs = require('fs');

// Patch build.js
let buildCode = fs.readFileSync('scripts/build.js', 'utf8');
if (!buildCode.includes('browser-polyfill.min.js')) {
    buildCode += "\nfs.copyFileSync('node_modules/webextension-polyfill/dist/browser-polyfill.min.js', 'dist/browser-polyfill.min.js');\n";
    fs.writeFileSync('scripts/build.js', buildCode);
}

// Helper to inject script tag
function injectScript(file, scriptTag) {
    let code = fs.readFileSync(file, 'utf8');
    if (!code.includes(scriptTag)) {
        if (code.includes('<body>') || code.includes('</head>')) {
            // Find a good place, maybe right before the first <script
            code = code.replace(/(<script\b[^>]*>)/i, scriptTag + '\n  $1');
        }
        fs.writeFileSync(file, code);
    }
}

injectScript('src/popup.html', '<script src="../dist/browser-polyfill.min.js"></script>');
injectScript('src/options.html', '<script src="../dist/browser-polyfill.min.js"></script>');
injectScript('src/background.html', '<script src="../dist/browser-polyfill.min.js"></script>');

// Patch manifest.json
let manifestCode = fs.readFileSync('manifest.json', 'utf8');
let manifest = JSON.parse(manifestCode);
let modified = false;

// Add to content_scripts
for (let cs of manifest.content_scripts) {
    if (!cs.js.includes("dist/browser-polyfill.min.js")) {
        cs.js.unshift("dist/browser-polyfill.min.js");
        modified = true;
    }
}

if (modified) {
    fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
}
