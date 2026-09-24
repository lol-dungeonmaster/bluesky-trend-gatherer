const fs = require('fs');
let code = fs.readFileSync('src/background.src.js', 'utf8');

const targetStr = `          const countResult = await conn.query(\`SELECT COUNT(*) as c FROM trends\`);`;
const replacement = `          const countResult = await conn.query(\`SELECT COUNT(*) as c FROM trends\`);`;

code = code.replace(`          const momentResult = await conn.query(\`SELECT CAST(captured_at AS VARCHAR) as captured_at_str, raw_json FROM trends ORDER BY captured_at DESC LIMIT 100 OFFSET \${offset}\`);`,
`          if (offset >= totalCount) offset = Math.max(0, totalCount - 1);
          const momentResult = await conn.query(\`SELECT CAST(captured_at AS VARCHAR) as captured_at_str, raw_json FROM trends ORDER BY captured_at DESC LIMIT 100 OFFSET \${offset}\`);`);

fs.writeFileSync('src/background.src.js', code);
