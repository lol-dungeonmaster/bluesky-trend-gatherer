const fs = require('fs');
let content = fs.readFileSync('README.md', 'utf8');

const advancedBlock = `\n\n<details>
<summary><b>Advanced: Permanent Installation</b> (Click to expand)</summary>

To prevent Firefox from wiping your database on restart, you can permanently install the extension via a packaged \`.xpi\` file.

1. Generate the \`.xpi\` file (see the Development section below on how to run \`npm run package\`), or use an existing one in the \`dist/\` folder.
2. Open Firefox and navigate to \`about:config\`.
3. Search for \`xpinstall.signatures.required\` and double-click it to set it to **\`false\`**. *(This allows you to install your own unsigned extensions locally).*
4. Navigate to \`about:addons\`, click the gear icon ⚙️ in the top right, and select **Install Add-on From File...**
5. Select the \`dist/bluesky-trend-gatherer.xpi\` file and add it to Firefox.

Your database will now safely persist across all browser restarts!
</details>`;

content = content.replace(advancedBlock, "");

const insertTarget = `> **Firefox Data Persistence:** When installed as a "Temporary Add-on" via \`about:debugging\`, Firefox will **permanently delete** your collected OPFS database whenever the browser is restarted. To keep your data between sessions, you must either frequently use the Export button or follow the Permanent Installation instructions below.`;

content = content.replace(insertTarget, insertTarget + advancedBlock);
fs.writeFileSync('README.md', content);
