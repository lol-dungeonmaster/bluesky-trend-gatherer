const fs = require('fs');
let content = fs.readFileSync('README.md', 'utf8');

// 1. Change Firefox heading
content = content.replace('### Firefox (Indefinite MV2 Support)', '### Firefox / Gecko Forks');

// 2. Change the Chromium directory instruction
content = content.replace('4. Select the `trends_extension` directory.', '4. Select the root project directory (the folder containing `manifest.json`).');

fs.writeFileSync('README.md', content);
