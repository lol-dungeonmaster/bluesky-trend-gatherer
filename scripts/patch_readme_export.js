const fs = require('fs');
let content = fs.readFileSync('README.md', 'utf8');

const targetStr = `## Exporting Data
To export your collected data for analysis:
1. Go to \`about:addons\` in Firefox.
2. Find **Bluesky Trend Gatherer** and click the **Preferences/Options** tab.
3. Click the **Export to Parquet** button. Your data will instantly download as a \`.parquet\` file!`;

const replacement = `## 💾 Exporting & Importing Data

The extension includes a built-in database manager to easily back up, analyze, and restore your gathered trends.

### Accessing the Manager
1. Click the **⚙️** (gear icon) in the top right of the extension's popup, OR
2. Go to your browser's extension settings (e.g., \`about:addons\`), find **Bluesky Trend Gatherer**, and click **Preferences/Options**.

### Exporting
Click the **Export to Parquet** button to instantly download your entire local database as a highly compressed \`.parquet\` file. This format is perfect for loading into Python data science tools like Pandas or Jupyter Notebooks!

### Importing
If you've switched browsers or accidentally had your Temporary extension data wiped, you can easily restore your timeline. Click the **Import from Parquet** button and select a previously exported file. 
*(The import process is fully idempotent and validated—it will automatically ignore duplicate timestamps and skip corrupted rows, safely merging the backup into your active database).*`;

content = content.replace(targetStr, replacement);
fs.writeFileSync('README.md', content);
