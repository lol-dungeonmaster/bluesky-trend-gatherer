const fs = require('fs');
let code = fs.readFileSync('src/background.src.js', 'utf8');

// Add isInitializing flag
code = code.replace('let db, conn;', 'let db, conn;\nlet isInitializing = false;');

// Update initDatabase
const initTarget = `async function initDatabase(skipLongevity = false) {
    if (db) return;
    try {`;
const initReplacement = `async function initDatabase(skipLongevity = false) {
    if (db || isInitializing) return;
    isInitializing = true;
    try {`;
code = code.replace(initTarget, initReplacement);

// Make finally block
const finallyTarget = `        if (!skipLongevity) await rebuildLongevityState();
    } catch (e) {
        console.error(\`[\${new Date().toISOString()}] Failed to initialize DuckDB\`, e);
    }
}`;
const finallyReplacement = `        if (!skipLongevity) await rebuildLongevityState();
    } catch (e) {
        console.error(\`[\${new Date().toISOString()}] Failed to initialize DuckDB\`, e);
    } finally {
        isInitializing = false;
    }
}`;
code = code.replace(finallyTarget, finallyReplacement);

// Replace db with localDb and conn with localConn inside the try block
// Be careful to only replace inside initDatabase
let parts = code.split('async function initDatabase');
let before = parts[0];
let after = 'async function initDatabase' + parts[1];

let initDbBodyEnd = after.indexOf('// --- 2. THE INTERCEPTOR ---');
let initDbBody = after.substring(0, initDbBodyEnd);
let restOfFile = after.substring(initDbBodyEnd);

initDbBody = initDbBody.replace(/db = new duckdb\.AsyncDuckDB/g, 'let localDb = new duckdb.AsyncDuckDB');
initDbBody = initDbBody.replace(/db\./g, 'localDb.');
initDbBody = initDbBody.replace(/conn = await /g, 'let localConn = await ');
initDbBody = initDbBody.replace(/conn = null/g, 'localConn = null');
initDbBody = initDbBody.replace(/if \(conn\) \{/g, 'if (localConn) {');
initDbBody = initDbBody.replace(/conn\./g, 'localConn.');

// Note: `let localConn = await localDb.connect();` might happen multiple times (in try and in the fallback).
initDbBody = initDbBody.replace(/let localConn = await localDb\.connect\(\);/g, 'localConn = await localDb.connect();');
// Pre-declare localConn at the top of the retry loop
initDbBody = initDbBody.replace(/let retries = 5;/, 'let retries = 5;\n        let localConn = null;');

// Assign globals at the end of the success path
initDbBody = initDbBody.replace(/console\.log\(\`\[\$\{\new Date\(\)\.toISOString\(\)\}\] DuckDB successfully initialized on OPFS!\`\);/, 'db = localDb;\n        conn = localConn;\n        console.log(`[${new Date().toISOString()}] DuckDB successfully initialized on OPFS!`);');

code = before + initDbBody + restOfFile;
fs.writeFileSync('src/background.src.js', code);
console.log("Fixed background.src.js");
