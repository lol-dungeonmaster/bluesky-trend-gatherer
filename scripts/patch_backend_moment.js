const fs = require('fs');
let code = fs.readFileSync('src/background.src.js', 'utf8');

const targetStr = `          const offset = Number(message.offset) || 0;
          const countResult = await conn.query(\`SELECT COUNT(*) as c FROM trends\`);`;

const replacement = `          let offset = Number(message.offset) || 0;
          if (message.target_ts) {
              const offRes = await conn.query(\`SELECT COUNT(*) as c FROM trends WHERE captured_at > '\${message.target_ts}'\`);
              const offRows = offRes.toArray();
              let offRow = offRows[0];
              if (offRow && offRow.toJSON) offRow = offRow.toJSON();
              if (offRow) {
                  if (offRow.c !== undefined) offset = Number(offRow.c);
                  else if (offRow.count !== undefined) offset = Number(offRow.count);
                  else offset = Number(Object.values(offRow)[0]);
              }
          }
          const countResult = await conn.query(\`SELECT COUNT(*) as c FROM trends\`);`;

code = code.replace(targetStr, replacement);

const returnTarget = `          return Promise.resolve({
              total: totalCount,
              moment: { `;
const returnReplacement = `          return Promise.resolve({
              total: totalCount,
              offset: offset,
              moment: { `;

code = code.replace(returnTarget, returnReplacement);
fs.writeFileSync('src/background.src.js', code);
