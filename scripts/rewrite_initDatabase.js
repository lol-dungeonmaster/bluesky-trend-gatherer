const fs = require('fs');
let code = fs.readFileSync('src/background.src.js', 'utf8');

const targetRegex = /async function initDatabase.*?Failed to initialize DuckDB\`, e\);\n    }\n}/s;

const replacement = `async function initDatabase(skipLongevity = false) {
    if (db || isInitializing) return;
    isInitializing = true;
    try {
        console.log(\`[\${new Date().toISOString()}] Initializing DuckDB-Wasm...\`);
        
        const MANUAL_BUNDLES = {
            eh: {
                mainModule: '../lib/duckdb-eh.wasm',
                mainWorker: '../lib/duckdb-browser-eh.worker.js',
            }
        };
        
        const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
        const worker = new Worker(bundle.mainWorker);
        const logger = new duckdb.VoidLogger();
        let localDb = new duckdb.AsyncDuckDB(logger, worker);
        await localDb.instantiate(bundle.mainModule, bundle.pthreadWorker);
        
        
        let retries = 5;
        let connected = false;
        let localConn = null;
        while (retries > 0 && !connected) {
            try {
                await localDb.open({ path: 'opfs://bluesky_trends.db', accessMode: 3 /* READ_WRITE */ });
                localConn = await localDb.connect();
                await localConn.query("SET max_expression_depth TO 10000");
                // Test write access explicitly
                await localConn.query("CREATE TABLE IF NOT EXISTS _lock_test (id INT); DROP TABLE _lock_test;");
                connected = true;
            } catch(e) {
                console.error("DuckDB locked or failed. Retries left: " + retries, e);
                if (localConn) { try { await localConn.close(); } catch(e2){} localConn = null; }
                retries--;
                if (retries === 0) {
                    // Try renaming the file as a final fallback if removeEntry fails
                    console.log("Nuclear OPFS wipe due to hanging locks...");
                    try {
                        const root = await navigator.storage.getDirectory();
                        try { await root.removeEntry('bluesky_trends.db', { recursive: true }); } catch(err){}
                        try { await root.removeEntry('bluesky_trends.db.wal', { recursive: true }); } catch(err){}
                    } catch(e3) {}
                    await localDb.open({ path: 'opfs://bluesky_trends.db', accessMode: 3 });
                    localConn = await localDb.connect();
                    await localConn.query("SET max_expression_depth TO 10000");
                    connected = true;
                } else {
                    console.log("Waiting 3 seconds for Firefox to release the OPFS lock...");
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
        }
        
        if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            if (est.usage && est.quota && (est.usage / est.quota) > 0.95) {
                console.log(\`[\${new Date().toISOString()}] OPFS Quota > 95%. Culling oldest 10% of trends.\`);
                await localConn.query(\`
                    DELETE FROM trends WHERE captured_at IN (
                        SELECT captured_at FROM trends ORDER BY captured_at ASC LIMIT (SELECT CAST(count(*) * 0.1 AS INTEGER) FROM trends)
                    )
                \`);
            }
        }
        await localConn.query(\`
            CREATE TABLE IF NOT EXISTS trends (
                captured_at TIMESTAMP,
                raw_json VARCHAR
            );
        \`);
        const colRes = await localConn.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'trends'");
        const columns = colRes.toArray().map(r => r.toJSON().column_name);
        if (!columns.includes('viewer_did')) await localConn.query("ALTER TABLE trends ADD COLUMN viewer_did VARCHAR");
        if (!columns.includes('is_flutter')) await localConn.query("ALTER TABLE trends ADD COLUMN is_flutter BOOLEAN");
        if (!columns.includes('gap_ms')) await localConn.query("ALTER TABLE trends ADD COLUMN gap_ms INTEGER");
        if (!columns.includes('payload_hash')) await localConn.query("ALTER TABLE trends ADD COLUMN payload_hash VARCHAR");
        
        await localConn.query(\`CREATE INDEX IF NOT EXISTS idx_captured_at ON trends(captured_at DESC);\`);
        
        db = localDb;
        conn = localConn;
        console.log(\`[\${new Date().toISOString()}] DuckDB successfully initialized on OPFS!\`);
        if (!skipLongevity) await rebuildLongevityState();
    } catch (e) {
        console.error(\`[\${new Date().toISOString()}] Failed to initialize DuckDB\`, e);
    } finally {
        isInitializing = false;
    }
}`;

code = code.replace(targetRegex, replacement);
fs.writeFileSync('src/background.src.js', code);
console.log("Replaced successfully");
