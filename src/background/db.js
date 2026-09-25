import { state } from './state.js';
import { updateIcon } from './monitor.js';
const duckdb = require('@duckdb/duckdb-wasm');
const { TrendPayloadSchema, DatabaseRowSchema } = require('../schemas.js');

export async function initParquet() {
  if (!state.parquetWasmInitialized) {
    const initParquetWasm = require('parquet-wasm/esm/parquet_wasm.js').default;
    await initParquetWasm({
      module_or_path: browser.runtime.getURL('dist/parquet_wasm_bg.wasm')
    });
    state.parquetWasmInitialized = true;
  }
}

export async function rebuildLongevityState() {
  if (!state.conn) return;
  try {
    const res = await state.conn.query("SELECT gap_ms, raw_json FROM trends ORDER BY captured_at ASC");
    const rows = res.toArray().map(r => r.toJSON ? r.toJSON() : r);
    state.longevityState = {};
    state.previousTopics = new Set();
    for (const r of rows) {
      let arr = [];
      try {
        arr = typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : r.raw_json;
      } catch (e) {}
      let currentTopics = new Set();
      if (Array.isArray(arr)) {
        for (const t of arr) {
          if (t && t.topic) {
            currentTopics.add(t.topic);
            if (state.longevityState[t.topic] === undefined) {
              state.longevityState[t.topic] = 0;
            } else if (state.previousTopics.has(t.topic)) {
              state.longevityState[t.topic] += r.gap_ms || 0;
            }
          }
        }
      }
      state.previousTopics = currentTopics;
    }
    console.log(`[${new Date().toISOString()}] Rebuilt longevity state for ${Object.keys(state.longevityState).length} unique trends.`);
  } catch (e) {
    console.error("Failed to rebuild longevity state", e);
  }
}

export async function getDatabaseSizeStr() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est && est.usage) {
        let bytes = est.usage;
        if (bytes < 1024) return bytes + " B";else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";else return (bytes / (1024 * 1024)).toFixed(1) + " MB";
      }
    }
  } catch (e) {
    console.error("Storage estimate failed", e);
  }
  return "0 B";
}

export async function terminateDatabase() {
  if (state.conn) {
    try {
      await state.conn.close();
    } catch (e) {}
    state.conn = null;
  }
  if (state.db) {
    try {
      await state.db.terminate();
    } catch (e) {}
    state.db = null;
  }
  console.log(`[${new Date().toISOString()}] [Monitor] DuckDB terminated. Memory released.`);
}

export async function initDatabase(skipLongevity = false) {
  if (state.db || state.isInitializing) return;
  state.isInitializing = true;
  try {
    console.log(`[${new Date().toISOString()}] Initializing DuckDB-Wasm...`);
    const MANUAL_BUNDLES = {
      eh: {
        mainModule: '../lib/duckdb-eh.wasm',
        mainWorker: '../lib/duckdb-browser-eh.worker.js'
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
        await localDb.open({
          path: 'opfs://bluesky_trends.db',
          accessMode: 3
          /* READ_WRITE */
        });
        localConn = await localDb.connect();
        await localConn.query("SET max_expression_depth TO 10000");
        // Test write access explicitly
        await localConn.query("CREATE TABLE IF NOT EXISTS _lock_test (id INT); DROP TABLE _lock_test;");
        connected = true;
      } catch (e) {
        console.error("DuckDB locked or failed. Retries left: " + retries, e);
        if (localConn) {
          try {
            await localConn.close();
          } catch (e2) {}
          localConn = null;
        }
        retries--;
        if (retries === 0) {
          // Try renaming the file as a final fallback if removeEntry fails
          console.log("Nuclear OPFS wipe due to hanging locks...");
          try {
            const root = await navigator.storage.getDirectory();
            try {
              await root.removeEntry('bluesky_trends.db', {
                recursive: true
              });
            } catch (err) {}
            try {
              await root.removeEntry('bluesky_trends.db.wal', {
                recursive: true
              });
            } catch (err) {}
          } catch (e3) {}
          await localDb.open({
            path: 'opfs://bluesky_trends.db',
            accessMode: 3
          });
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
      if (est.usage && est.quota && est.usage / est.quota > 0.95) {
        console.log(`[${new Date().toISOString()}] OPFS Quota > 95%. Culling oldest 10% of trends.`);
        await localConn.query(`
                    DELETE FROM trends WHERE captured_at IN (
                        SELECT captured_at FROM trends ORDER BY captured_at ASC LIMIT (SELECT CAST(count(*) * 0.1 AS INTEGER) FROM trends)
                    )
                `);
        await localConn.query("VACUUM");
        await localConn.query("CHECKPOINT");
        console.log(`[${new Date().toISOString()}] OPFS database vacuumed and checkpointed.`);
      }
    }
    await localConn.query(`
            CREATE TABLE IF NOT EXISTS trends (
                captured_at TIMESTAMP,
                raw_json VARCHAR
            );
        `);
    await localConn.query("CREATE INDEX IF NOT EXISTS idx_captured_at ON trends(captured_at);");
    const colRes = await localConn.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'trends'");
    const columns = colRes.toArray().map(r => r.toJSON().column_name);
    if (!columns.includes('viewer_did')) await localConn.query("ALTER TABLE trends ADD COLUMN viewer_did VARCHAR");
    if (!columns.includes('is_flutter')) await localConn.query("ALTER TABLE trends ADD COLUMN is_flutter BOOLEAN");
    if (!columns.includes('gap_ms')) await localConn.query("ALTER TABLE trends ADD COLUMN gap_ms INTEGER");
    if (!columns.includes('payload_hash')) await localConn.query("ALTER TABLE trends ADD COLUMN payload_hash VARCHAR");
    await localConn.query(`CREATE INDEX IF NOT EXISTS idx_captured_at ON trends(captured_at DESC);`);
    state.db = localDb;
    state.conn = localConn;
    console.log(`[${new Date().toISOString()}] DuckDB successfully initialized on OPFS!`);
    if (!skipLongevity) await rebuildLongevityState();
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Failed to initialize DuckDB`, e);
  } finally {
    state.isInitializing = false;
  }
}
