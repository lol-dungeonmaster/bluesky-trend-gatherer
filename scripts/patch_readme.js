const fs = require('fs');
let content = fs.readFileSync('README.md', 'utf8');

const targetStr = `## 🚀 Installation (For Regular Users)

You don't need any coding experience to install and use this extension!

1. Download or clone this repository to your computer.
2. Open Firefox and navigate to \`about:debugging#/runtime/this-firefox\`.
3. Click the **Load Temporary Add-on...** button.
4. Select the \`manifest.json\` file from the downloaded folder.
5. Open a tab to \`bsky.app\`, click the new extension icon in your toolbar, and toggle it "On" to begin archiving!

> [!WARNING]
> **Data Persistence:** When installed as a "Temporary Add-on" via \`about:debugging\`, Firefox will **permanently delete** your collected OPFS database whenever the browser is restarted. To keep your data between sessions, you must either frequently use the Export button or install the extension permanently.`;

const replacement = `## 🚀 Installation (For Regular Users)

You don't need any coding experience to install and use this extension! Download or clone this repository to your computer, then follow the instructions for your browser.

### Firefox (Indefinite MV2 Support)
1. Open Firefox and navigate to \`about:debugging#/runtime/this-firefox\`.
2. Click the **Load Temporary Add-on...** button.
3. Select the \`manifest.json\` file from the downloaded folder.
4. Open a tab to \`bsky.app\`, click the new extension icon in your toolbar, and toggle it "On" to begin archiving!

> [!WARNING]
> **Firefox Data Persistence:** When installed as a "Temporary Add-on" via \`about:debugging\`, Firefox will **permanently delete** your collected OPFS database whenever the browser is restarted. To keep your data between sessions, you must either frequently use the Export button or follow the Permanent Installation instructions below.

### Chromium Forks (Brave, Vivaldi, Thorium)
Because Google Chrome and Microsoft Edge forcefully deprecated Manifest V2, this extension relies on Chromium forks that have pledged to maintain MV2 support for ad-blockers and privacy tools.
1. Open your browser (Brave, Vivaldi, Thorium, or Supermium) and navigate to the extensions page (e.g., \`brave://extensions\`).
2. Toggle on **Developer mode** in the top right corner.
3. Click the **Load unpacked** button.
4. Select the \`trends_extension\` directory.
*(Chromium browsers will automatically persist your OPFS database across browser restarts without any extra configuration).*`;

content = content.replace(targetStr, replacement);
fs.writeFileSync('README.md', content);
