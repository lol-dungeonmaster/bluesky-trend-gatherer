const fs = require('fs');
let content = fs.readFileSync('README.md', 'utf8');

const newBullet = `- **Cross-Browser MV2 Support:** Built natively for Firefox and its Gecko forks (Waterfox, LibreWolf, Zen), but fully bundled with Mozilla's WebExtension Polyfill to allow seamless installation on privacy-focused Chromium forks that continue to maintain Manifest V2 support (Brave, Vivaldi, Thorium).`;

const insertTarget = `- **Data Portability & Import Idempotency:** Instantly export your collected timeline as a compressed \`.parquet\` file, ready for Jupyter or Pandas. You can also **import** \`.parquet\` backups directly back into the extension—fortified by rigorous Zod schema validation and idempotent duplicate protection.`;

content = content.replace(insertTarget, insertTarget + '\n' + newBullet);
fs.writeFileSync('README.md', content);
