const fs = require('fs');
let code = fs.readFileSync('src/background.src.js', 'utf8');

const target1 = `            await conn.query(\`
                INSERT INTO trends (captured_at, raw_json, viewer_did, is_flutter, gap_ms, payload_hash)
                VALUES (CURRENT_TIMESTAMP, '\${dbRow.raw_json.replace(/'/g, "''")}', '\${dbRow.viewer_did.replace(/'/g, "''")}', \${dbRow.is_flutter}, \${dbRow.gap_ms}, '\${dbRow.payload_hash}')
            \`);`;
const repl1 = `            const stmt = await conn.prepare(\`
                INSERT INTO trends (captured_at, raw_json, viewer_did, is_flutter, gap_ms, payload_hash)
                VALUES (CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
            \`);
            await stmt.query(dbRow.raw_json, dbRow.viewer_did, dbRow.is_flutter, dbRow.gap_ms, dbRow.payload_hash);
            await stmt.close();`;
code = code.replace(target1, repl1);

const target2 = `                    const values = chunk.map(r => \`('\${r.captured_at}', '\${r.raw_json.replace(/'/g, "''")}', '\${r.viewer_did.replace(/'/g, "''")}', \${r.is_flutter}, \${r.gap_ms}, '\${r.payload_hash.replace(/'/g, "''")}')\`).join(',\\n');
                    await conn.query(\`INSERT INTO trends (captured_at, raw_json, viewer_did, is_flutter, gap_ms, payload_hash) VALUES \${values}\`);`;
const repl2 = `                    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(',\\n');
                    const stmt = await conn.prepare(\`INSERT INTO trends (captured_at, raw_json, viewer_did, is_flutter, gap_ms, payload_hash) VALUES \${placeholders}\`);
                    
                    const params = [];
                    for (const r of chunk) {
                        params.push(r.captured_at, r.raw_json, r.viewer_did, r.is_flutter, r.gap_ms, r.payload_hash);
                    }
                    
                    await stmt.query(...params);
                    await stmt.close();`;
code = code.replace(target2, repl2);

fs.writeFileSync('src/background.src.js', code);
