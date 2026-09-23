globalThis.__zod_globalConfig = { jitless: true };
const duckdb = require('@duckdb/duckdb-wasm');
const { z } = require('zod');

// --- ZOD SCHEMAS ---
const { TrendPayloadSchema, DatabaseRowSchema } = require('./schemas.js');


let db, conn;
let isActive = false;
let eventCount = 0;

// --- 1. PERSISTENT COUNT & TOGGLE STATE ---
browser.storage.local.get(["eventCount"]).then((res) => {
    eventCount = res.eventCount || 0;
    updateIcon();
});
browser.storage.local.remove("isActive"); // Clean up old state

let sessionEventCount = 0;

let longevityState = {};
let previousTopics = new Set();
async function rebuildLongevityState() {
    if (!conn) return;
    try {
        const res = await conn.query("SELECT gap_ms, raw_json FROM trends ORDER BY captured_at ASC");
        const rows = res.toArray().map(r => r.toJSON ? r.toJSON() : r);
        longevityState = {};
        previousTopics = new Set();
        for (const r of rows) {
            let arr = [];
            try { arr = typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : r.raw_json; } catch(e) {}
            
            let currentTopics = new Set();
            if (Array.isArray(arr)) {
                for (const t of arr) {
                    if (t && t.topic) {
                        currentTopics.add(t.topic);
                        if (longevityState[t.topic] === undefined) {
                            longevityState[t.topic] = 0;
                        } else if (previousTopics.has(t.topic)) {
                            longevityState[t.topic] += (r.gap_ms || 0);
                        }
                    }
                }
            }
            previousTopics = currentTopics;
        }
        console.log(`[${new Date().toISOString()}] Rebuilt longevity state for ${Object.keys(longevityState).length} unique trends.`);
    } catch(e) {
        console.error("Failed to rebuild longevity state", e);
    }
}

let sessionStartTime = Date.now();
let firstEventTime = null;
let lastEventTime = null;

let cachedDbSize = "0 B";

async function getDatabaseSizeStr() {
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            if (est && est.usage) {
                let bytes = est.usage;
                if (bytes < 1024) return bytes + " B";
                else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
                else return (bytes / (1024 * 1024)).toFixed(1) + " MB";
            }
        }
    } catch(e) {
        console.error("Storage estimate failed", e);
    }
    return "0 B";
}

let lastUpdateDurationMs = null;





function createIconImageData(isOn) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = isOn ? "#1185fe" : "#999999";
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(26, 0);
    ctx.quadraticCurveTo(32, 0, 32, 6);
    ctx.lineTo(32, 26);
    ctx.quadraticCurveTo(32, 32, 26, 32);
    ctx.lineTo(6, 32);
    ctx.quadraticCurveTo(0, 32, 0, 26);
    ctx.lineTo(0, 6);
    ctx.quadraticCurveTo(0, 0, 6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(6, 25);
    ctx.lineTo(13, 17);
    ctx.lineTo(19, 21);
    ctx.lineTo(26, 11);
    ctx.stroke();
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.moveTo(18, 10);
    ctx.lineTo(28, 10);
    ctx.lineTo(28, 20);
    ctx.closePath();
    ctx.fill();
    return ctx.getImageData(0, 0, 32, 32);
}

async function updateIcon() {
    if (isActive) {
        browser.browserAction.setIcon({ imageData: createIconImageData(true) });
        let badgeText = sessionEventCount.toString();
        if (sessionEventCount >= 1000) {
            badgeText = (sessionEventCount / 1000).toFixed(1).replace('.0', '') + 'k';
        }
        browser.browserAction.setBadgeText({ text: badgeText });
        browser.browserAction.setBadgeBackgroundColor({ color: "#28a745" });
    } else {
        browser.browserAction.setIcon({ imageData: createIconImageData(false) });
        browser.browserAction.setBadgeText({ text: "" });
    }
    cachedDbSize = await getDatabaseSizeStr();
    let avgStr = "∞";
    if (sessionEventCount >= 1 && sessionStartTime && lastEventTime) {
        let diffMs = lastEventTime - sessionStartTime;
        let avgSec = Math.round((diffMs / 1000) / sessionEventCount);
        avgStr = `${avgSec}s`;
    }
    
    let lastUpdateStr = "∞";
    if (lastUpdateDurationMs !== null) {
        lastUpdateStr = `${Math.round(lastUpdateDurationMs / 1000)}s`;
    }
    
    let dbCount = "Loading...";
    if (conn) {
        try {
            const countRes = await conn.query("SELECT COUNT(*) as c FROM trends");
            let firstRow = countRes.toArray()[0];
            if (firstRow && firstRow.toJSON) firstRow = firstRow.toJSON();
            if (firstRow) {
                if (firstRow.c !== undefined) dbCount = Number(firstRow.c);
                else if (firstRow.count !== undefined) dbCount = Number(firstRow.count);
                else dbCount = Number(Object.values(firstRow)[0]);
            }
            // Sync cache with real DB count
            eventCount = dbCount;
            browser.storage.local.set({ eventCount });
        } catch(e) {
            dbCount = "Error";
        }
    } else {
        dbCount = "Initializing...";
    }
    
    let titleStr = `Bluesky Trend Gatherer (${isActive ? 'On' : 'Off'})\n`;
    titleStr += `Session Events: ${sessionEventCount}\n`;
    titleStr += `Total DB Rows: ${dbCount}\n`;
    titleStr += `Database Size: ${cachedDbSize}\n`;
    titleStr += `Update Time (avg): ${avgStr}\n`;
    titleStr += `Last Update: ${lastUpdateStr}`;

    browser.browserAction.setTitle({ title: titleStr });
}

async function incrementAndSaveCount() {
    eventCount++;
    sessionEventCount++;
    
    let now = Date.now();
    if (!firstEventTime) firstEventTime = now;
    if (lastEventTime) {
        lastUpdateDurationMs = now - lastEventTime;
    } else {
        let diff = now - sessionStartTime;
        if (Math.round(diff / 1000) > 0) {
            lastUpdateDurationMs = diff;
        }
    }
    lastEventTime = now;
    
    await browser.storage.local.set({ eventCount: eventCount });
    updateIcon();
}

let activeBskyTabId = null;
let lastRawJsonString = null;
let lastFlutterTime = null;
let lastMigrationTime = null;
let totalScheduledDelayMs = 0;
let monitorTimeoutId = null;
const MIN_DELAY = 75000;
const MAX_DELAY = 105000;

async function getBestBskyTab() {
    const tabs = await browser.tabs.query({ url: "*://bsky.app/*" });
    if (tabs.length === 0) return null;
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return tabs[0];
}

async function triggerFlutter() {
    if (!isActive || !activeBskyTabId) return;

    try {
        let timeSinceLastUpdate = lastEventTime ? Date.now() - lastEventTime : Infinity;
        let timeSinceLastMigration = lastMigrationTime ? Date.now() - lastMigrationTime : Infinity;
        
        let skipReason = null;
        let skipAgeMs = 0;
        
        if (timeSinceLastUpdate <= 15000) {
            skipReason = "latest update";
            skipAgeMs = timeSinceLastUpdate;
        } else if (timeSinceLastMigration <= 15000) {
            skipReason = "tab targeting was migrated";
            skipAgeMs = timeSinceLastMigration;
        }

        if (skipReason) {
            let nextDelay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
            nextDelay = nextDelay - skipAgeMs;
            totalScheduledDelayMs += nextDelay;
            console.log(`[${new Date().toISOString()}] [Monitor] Skipped fluttering because ${skipReason} was ${Math.round(skipAgeMs/1000)}s ago. Next event in ${Math.round(nextDelay/1000)}s.`);
            monitorTimeoutId = setTimeout(triggerFlutter, nextDelay);
            return;
        }

        await browser.tabs.sendMessage(activeBskyTabId, { command: "FLUTTER" });
        lastFlutterTime = Date.now();
                const nextDelay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
        totalScheduledDelayMs += nextDelay;
        const ts = new Date().toISOString();
        console.log(`[${ts}] [Monitor] Fluttering (${activeBskyTabId}), next event in ${Math.round(nextDelay/1000)}s`);
        monitorTimeoutId = setTimeout(triggerFlutter, nextDelay);
    } catch (e) {
        console.log(`[${new Date().toISOString()}] [Monitor] Target tab unresponsive. Auto-disabling.`);
        autoDisable();
    }
}

async function terminateDatabase() {
    if (conn) {
        try { await conn.close(); } catch(e) {}
        conn = null;
    }
    if (db) {
        try { await db.terminate(); } catch(e) {}
        db = null;
    }
    console.log(`[${new Date().toISOString()}] [Monitor] DuckDB terminated. Memory released.`);
}

async function stopMonitor() {
    if (monitorTimeoutId) {
        clearTimeout(monitorTimeoutId);
        monitorTimeoutId = null;
    }
    if (activeBskyTabId !== null) {
        activeBskyTabId = null;
        console.log(`[${new Date().toISOString()}] [Monitor] Stopped.`);
    }
    await terminateDatabase();
}

async function autoDisable() {
    if (isActive) {
        isActive = false;
        updateIcon();
        await stopMonitor();
        console.log(`[${new Date().toISOString()}] [Monitor] Auto-disabled due to tab loss or crash.`);
    } else {
        await terminateDatabase();
    }
}

async function sha1(str) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function startMonitor() {
    await stopMonitor();
    await initDatabase();
    if (navigator.storage && navigator.storage.estimate) {
        try {
            const est = await navigator.storage.estimate();
            const usageMB = (est.usage / (1024 * 1024)).toFixed(2);
            const quotaMB = (est.quota / (1024 * 1024)).toFixed(2);
            const percent = ((est.usage / est.quota) * 100).toFixed(1);
            console.log(`[${new Date().toISOString()}] [Monitor] Started. Storage: ${usageMB}MB / ${quotaMB}MB (${percent}%)`);
        } catch (e) {
            console.log(`[${new Date().toISOString()}] [Monitor] Started.`);
        }
    } else {
        console.log(`[${new Date().toISOString()}] [Monitor] Started.`);
    }
    const bestTab = await getBestBskyTab();
    if (bestTab) {
        activeBskyTabId = bestTab.id;
        console.log(`[${new Date().toISOString()}] [Monitor] Targeted tab ${activeBskyTabId}`);
        triggerFlutter();
    } else {
        autoDisable();
    }
}



browser.tabs.onActivated.addListener(async (activeInfo) => {
    if (!isActive) return;
    const tab = await browser.tabs.get(activeInfo.tabId).catch(()=>{});
    if (tab && tab.url && tab.url.includes("bsky.app")) {
        if (activeBskyTabId !== tab.id) {
            activeBskyTabId = tab.id;
            lastMigrationTime = Date.now();
            console.log(`[${new Date().toISOString()}] [Monitor] Migrated targeting to tab ${activeBskyTabId}.`);
        }
    }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
    if (isActive && tabId === activeBskyTabId) {
        const bestTab = await getBestBskyTab();
        if (bestTab) {
            activeBskyTabId = bestTab.id;
            lastMigrationTime = Date.now();
            console.log(`[${new Date().toISOString()}] [Monitor] Monitored tab closed. Rescued by migrating to tab ${activeBskyTabId}.`);
        } else {
            console.log(`[${new Date().toISOString()}] [Monitor] Monitored tab closed. No alternative tabs found. Auto-disabling.`);
            autoDisable();
        }
    }
});

browser.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
    if (isActive && removedTabId === activeBskyTabId) {
        activeBskyTabId = addedTabId;
        lastMigrationTime = Date.now();
        console.log(`[${new Date().toISOString()}] [Monitor] Monitored tab replaced (awoken from sleep). Migrated to tab ${activeBskyTabId}.`);
    }
});

// --- 0. INITIALIZE DUCKDB ---
async function initDatabase(skipLongevity = false) {
    if (db) return;
    try {
        console.log(`[${new Date().toISOString()}] Initializing DuckDB-Wasm...`);
        
        const MANUAL_BUNDLES = {
            eh: {
                mainModule: '../lib/duckdb-eh.wasm',
                mainWorker: '../lib/duckdb-browser-eh.worker.js',
            }
        };
        
        const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
        const worker = new Worker(bundle.mainWorker);
        const logger = new duckdb.VoidLogger();
        db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        
        
        let retries = 5;
    let connected = false;
    while (retries > 0 && !connected) {
        try {
            await db.open({ path: 'opfs://bluesky_trends.db', accessMode: 3 /* READ_WRITE */ });
            conn = await db.connect();
            await conn.query("SET max_expression_depth TO 10000");
            // Test write access explicitly
            await conn.query("CREATE TABLE IF NOT EXISTS _lock_test (id INT); DROP TABLE _lock_test;");
            connected = true;
        } catch(e) {
            console.error("DuckDB locked or failed. Retries left: " + retries, e);
            if (conn) { try { await conn.close(); } catch(e2){} conn = null; }
            retries--;
            if (retries === 0) {
                // Try renaming the file as a final fallback if removeEntry fails
                console.log("Nuclear OPFS wipe due to hanging locks...");
                try {
                    const root = await navigator.storage.getDirectory();
                    try { await root.removeEntry('bluesky_trends.db', { recursive: true }); } catch(err){}
                    try { await root.removeEntry('bluesky_trends.db.wal', { recursive: true }); } catch(err){}
                } catch(e3) {}
                await db.open({ path: 'opfs://bluesky_trends.db', accessMode: 3 });
                conn = await db.connect();
            await conn.query("SET max_expression_depth TO 10000");
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
                    console.log(`[${new Date().toISOString()}] OPFS Quota > 95%. Culling oldest 10% of trends.`);
                    await conn.query(`
                        DELETE FROM trends WHERE captured_at IN (
                            SELECT captured_at FROM trends ORDER BY captured_at ASC LIMIT (SELECT CAST(count(*) * 0.1 AS INTEGER) FROM trends)
                        )
                    `);
                }
            }
            await conn.query(`
            CREATE TABLE IF NOT EXISTS trends (
                captured_at TIMESTAMP,
                raw_json VARCHAR
            );
        `);
        const colRes = await conn.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'trends'");
        const columns = colRes.toArray().map(r => r.toJSON().column_name);
        if (!columns.includes('viewer_did')) await conn.query("ALTER TABLE trends ADD COLUMN viewer_did VARCHAR");
        if (!columns.includes('is_flutter')) await conn.query("ALTER TABLE trends ADD COLUMN is_flutter BOOLEAN");
        if (!columns.includes('gap_ms')) await conn.query("ALTER TABLE trends ADD COLUMN gap_ms INTEGER");
        if (!columns.includes('payload_hash')) await conn.query("ALTER TABLE trends ADD COLUMN payload_hash VARCHAR");
        
        console.log(`[${new Date().toISOString()}] DuckDB successfully initialized on OPFS!`);
        if (!skipLongevity) await rebuildLongevityState();
    } catch (e) {
        console.error(`[${new Date().toISOString()}] Failed to initialize DuckDB`, e);
    }
}

// --- 2. THE INTERCEPTOR ---

let currentRateLimit = null;
let isLoggedIn = false;
let hasCheckedAuth = false;

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isActive || !details.url.includes("app.bsky.unspecced.getTrends") || details.method === "OPTIONS") { return {}; 
    }
    
    let remaining = null;
    let limit = null;
    let reset = null;
    let policy = null;

    for (let header of details.responseHeaders) {
        let name = header.name.toLowerCase();
        if (name === 'ratelimit-remaining') remaining = header.value;
        if (name === 'ratelimit-limit') limit = header.value;
        if (name === 'ratelimit-reset') reset = header.value;
        if (name === 'ratelimit-policy') {
            let m = header.value.match(/w=(\d+)/);
            if (m) policy = parseInt(m[1]); // Cache the window size directly
        }
    }
    
    hasCheckedAuth = true;
    if (remaining !== null && limit !== null) {
        isLoggedIn = true;
        currentRateLimit = { remaining, limit, reset, policy };
    } else {
        isLoggedIn = false;
        currentRateLimit = null;
    }
    
    browser.runtime.sendMessage({ 
        command: "AUTH_STATUS", 
        isLoggedIn: isLoggedIn, 
        rateLimit: currentRateLimit 
    }).catch(() => {});
    
  },
  { urls: ["*://*.bsky.network/xrpc/*", "*://*.bsky.app/xrpc/*"] },
  ["responseHeaders"]
);

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isActive || !details.url.includes("app.bsky.unspecced.getTrends") || details.method === "OPTIONS") { return {}; 
    }

    let filter = browser.webRequest.filterResponseData(details.requestId);
    let decoder = new TextDecoder("utf-8");
    let responseBody = "";

    filter.ondata = (event) => {
      responseBody += decoder.decode(event.data, { stream: true });
      filter.write(event.data); 
    };

    filter.onstop = async (event) => {
      filter.disconnect();
      try {
        
        let rawData = JSON.parse(responseBody);
        let trendsArray = rawData.topics || rawData.trends || (Array.isArray(rawData) ? rawData : []);
        
        // 1. Validate incoming Bluesky API payload via Zod
        let validTrendsArray = TrendPayloadSchema.parse(trendsArray);
        let currentTrendsString = JSON.stringify(validTrendsArray);

        const urlObj = new URL(details.url);
        const rawViewerDid = urlObj.searchParams.get("viewer") || 'anonymous';
        let timeSinceFlutterMs = lastFlutterTime ? (Date.now() - lastFlutterTime) : 0;
        const rawIsFlutter = timeSinceFlutterMs < 5000;
        const rawPayloadHash = await sha1(currentTrendsString);
        const rawGapMs = lastEventTime ? (Date.now() - lastEventTime) : 0;
        
        // 1.5 Inject Live Longevity Data
        let currentTopics = new Set();
        for (let t of validTrendsArray) {
            currentTopics.add(t.topic);
            if (longevityState[t.topic] === undefined) {
                longevityState[t.topic] = 0;
            } else if (previousTopics.has(t.topic)) {
                longevityState[t.topic] += rawGapMs;
            }
            t.timeInTop20Ms = longevityState[t.topic];
        }
        previousTopics = currentTopics;
        // Re-stringify with injected data
        currentTrendsString = JSON.stringify(validTrendsArray);

        // 2. Validate our engineered database row fields via Zod
        const dbRow = DatabaseRowSchema.parse({
            viewer_did: rawViewerDid,
            is_flutter: rawIsFlutter,
            gap_ms: rawGapMs,
            payload_hash: rawPayloadHash,
            raw_json: currentTrendsString
        });
        
        let isDuplicate = false;
        if (lastRawJsonString === currentTrendsString) {
            isDuplicate = true;
            console.log(`[${new Date().toISOString()}] Deduplication check: Payload identical to previous.`);
        }
        lastRawJsonString = currentTrendsString;
        const captureTime = new Date().toISOString();
        
        if (conn) {
            
            await conn.query(`
                INSERT INTO trends (captured_at, raw_json, viewer_did, is_flutter, gap_ms, payload_hash)
                VALUES (CURRENT_TIMESTAMP, '${dbRow.raw_json.replace(/'/g, "''")}', '${dbRow.viewer_did.replace(/'/g, "''")}', ${dbRow.is_flutter}, ${dbRow.gap_ms}, '${dbRow.payload_hash}')
            `);
            browser.runtime.sendMessage({ command: "TREND_ADDED" }).catch(() => {});
            
            
            
            


            incrementAndSaveCount();
            console.log(`[${captureTime}] Successfully saved trend update #${eventCount}!`);
            
            if (timeSinceFlutterMs > 5000) {
                if (monitorTimeoutId) {
                    clearTimeout(monitorTimeoutId);
                }
                let nextDelay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
                totalScheduledDelayMs = nextDelay;
                console.log(`[${new Date().toISOString()}] [Monitor] Updated fluttering interval. Next event in ${Math.round(nextDelay/1000)}s.`);
                monitorTimeoutId = setTimeout(triggerFlutter, nextDelay);
            }
        } else {
            console.error(`[${new Date().toISOString()}] DuckDB not connected yet!`);
        }

      } catch (e) {
        console.error(`[${new Date().toISOString()}] Failed to process trend data`, e);
      }
    };
  },
  { urls: ["*://*.bsky.network/xrpc/*"] },
  ["blocking"]
);

// --- 3. LISTEN FOR EXPORT/CLEAR COMMANDS ---
browser.runtime.onMessage.addListener(async (message) => {
    if (message.command === "GET_STATE") {
      return Promise.resolve({ isActive });
    } else if (message.command === "SET_STATE") {
      isActive = message.isActive;
      updateIcon();
      if (isActive) {
        startMonitor();
      } else {
        stopMonitor();
      }
      return Promise.resolve({ success: true });
    } else if (message.command === "NAVIGATE") {
        if (activeBskyTabId) {
            browser.tabs.update(activeBskyTabId, { url: message.url, active: true })
                .then(tab => browser.windows.update(tab.windowId, { focused: true }))
                .catch(() => {});
        } else {
            browser.tabs.create({ url: message.url, active: true });
        }
        return Promise.resolve(true);
    }
    if (!conn && ["GET_TREND_MOMENT", "EXPORT", "CLEAR", "IMPORT"].includes(message.command)) {
        await initDatabase(message.command === "CLEAR");
    }
    if (message.command === "GET_AUTH_STATUS") {
        return Promise.resolve({ hasCheckedAuth, isLoggedIn, rateLimit: currentRateLimit });
    }
    if (message.command === "GET_TREND_MOMENT") {
      if (!conn) return Promise.resolve({ error: "DB not initialized" });
      try {
          const offset = Number(message.offset) || 0;
          const countResult = await conn.query(`SELECT COUNT(*) as c FROM trends`);
          const rows = countResult.toArray();
          let firstRow = rows[0];
          if (firstRow && firstRow.toJSON) firstRow = firstRow.toJSON();
          let totalCount = 0;
          if (firstRow) {
              if (firstRow.c !== undefined) totalCount = Number(firstRow.c);
              else if (firstRow.count !== undefined) totalCount = Number(firstRow.count);
              else {
                  const vals = Object.values(firstRow);
                  if (vals.length > 0) totalCount = Number(vals[0]);
              }
          }
          
          if (totalCount === 0) {
              return Promise.resolve({ total: 0, moment: null });
          }
          
          const momentResult = await conn.query(`SELECT CAST(captured_at AS VARCHAR) as captured_at_str, raw_json FROM trends ORDER BY captured_at DESC LIMIT 100 OFFSET ${offset}`);
          const historyRows = momentResult.toArray().map(r => r.toJSON ? r.toJSON() : r);
          
          if (historyRows.length === 0) return Promise.resolve({ total: totalCount, moment: null });
          
          return Promise.resolve({
              total: totalCount,
              moment: { 
                  captured_at: historyRows[0].captured_at_str, 
                  raw_json: typeof historyRows[0].raw_json === 'string' ? historyRows[0].raw_json : JSON.stringify(historyRows[0].raw_json) 
              },
              history: historyRows.slice(1).map(r => ({ 
                  ts: r.captured_at_str, 
                  raw: typeof r.raw_json === 'string' ? r.raw_json : JSON.stringify(r.raw_json) 
              }))
          });
      } catch (e) {
          console.error("GET_TREND_MOMENT Error:", e);
          return Promise.resolve({ error: e.toString() });
      }
    } else if (message.command === "IMPORT") {
        console.log(`[${new Date().toISOString()}] Importing database...`);
        try {
            const buffer = new Uint8Array(await message.file.arrayBuffer());
            await db.registerFileBuffer('import.parquet', buffer);
            
            // Read all existing timestamps for deduplication
            const existingRes = await conn.query("SELECT captured_at FROM trends");
            const existingSet = new Set(existingRes.toArray().map(r => {
                let d = r.toJSON ? r.toJSON().captured_at : r.captured_at;
                if (d instanceof Date) return d.getTime();
                if (typeof d === 'number') return d;
                return new Date(d).getTime();
            }));
            
            // Read all incoming rows
            const importRes = await conn.query(`SELECT * FROM 'import.parquet'`);
            const incomingRows = importRes.toArray().map(r => r.toJSON ? r.toJSON() : r);
            
            const validInsertRows = [];
            let errorsLogged = 0;
            
            for (let i = 0; i < incomingRows.length; i++) {
                const row = incomingRows[i];
                try {
                    let tsStr = row.captured_at;
                    if (!tsStr) throw new Error("Missing captured_at timestamp");
                    
                    let tsTime;
                    if (tsStr instanceof Date) {
                        tsTime = tsStr.getTime();
                        tsStr = tsStr.toISOString();
                    } else if (typeof tsStr !== 'string') {
                        tsTime = Number(tsStr);
                        tsStr = new Date(tsTime).toISOString();
                    } else {
                        tsTime = new Date(tsStr).getTime();
                    }
                    
                    if (existingSet.has(tsTime)) continue; // skip duplicates silently
                    
                    const dbRow = DatabaseRowSchema.parse({
                        viewer_did: row.viewer_did || 'anonymous',
                        is_flutter: Boolean(row.is_flutter),
                        gap_ms: Number(row.gap_ms) || 0,
                        payload_hash: row.payload_hash || '',
                        raw_json: typeof row.raw_json === 'string' ? row.raw_json : JSON.stringify(row.raw_json)
                    });
                    
                    const payloadData = JSON.parse(dbRow.raw_json);
                    TrendPayloadSchema.parse(payloadData);
                    
                    validInsertRows.push({
                        captured_at: tsStr,
                        raw_json: dbRow.raw_json,
                        viewer_did: dbRow.viewer_did,
                        is_flutter: dbRow.is_flutter,
                        gap_ms: dbRow.gap_ms,
                        payload_hash: dbRow.payload_hash
                    });
                } catch (e) {
                    errorsLogged++;
                    console.warn(`[Import] Skipping corrupt row at index ${i}:`, e.message);
                }
            }
            
            if (validInsertRows.length > 0) {
                const CHUNK_SIZE = 50;
                for (let i = 0; i < validInsertRows.length; i += CHUNK_SIZE) {
                    const chunk = validInsertRows.slice(i, i + CHUNK_SIZE);
                    const values = chunk.map(r => `('${r.captured_at}', '${r.raw_json.replace(/'/g, "''")}', '${r.viewer_did.replace(/'/g, "''")}', ${r.is_flutter}, ${r.gap_ms}, '${r.payload_hash.replace(/'/g, "''")}')`).join(',\n');
                    await conn.query(`INSERT INTO trends (captured_at, raw_json, viewer_did, is_flutter, gap_ms, payload_hash) VALUES ${values}`);
                }
            }
            
            console.log(`[Import] Finished. Inserted ${validInsertRows.length} valid rows. Skipped ${errorsLogged} invalid/corrupt rows.`);
            
            const countRes = await conn.query("SELECT COUNT(*) as c FROM trends");
            const firstRow = countRes.toArray()[0].toJSON();
            eventCount = Number(firstRow.c || firstRow.count || Object.values(firstRow)[0] || 0);
            await browser.storage.local.set({ eventCount });
            updateIcon();
            await rebuildLongevityState();
            return Promise.resolve(true);
        } catch (e) {
            console.error("Import error:", e);
            throw e;
        }
    } else if (message.command === "EXPORT") {
        console.log(`[${new Date().toISOString()}] Exporting database...`);
        try {
            await conn.query(`COPY trends TO 'opfs://trends_export.parquet' (FORMAT PARQUET)`);
            
            const opfsRoot = await navigator.storage.getDirectory();
            const fileHandle = await opfsRoot.getFileHandle('trends_export.parquet');
            const file = await fileHandle.getFile();
            const url = URL.createObjectURL(file);
            
            browser.downloads.download({
                url: url,
                filename: `bluesky_trends_${new Date().getTime()}.parquet`,
                saveAs: false
            });
        } catch (e) {
            console.error(`[${new Date().toISOString()}] Export failed`, e);
        }
    } else if (message.command === "CLEAR") {
        try {
            await conn.query(`DROP TABLE IF EXISTS trends`);
            await conn.query(`
                CREATE TABLE trends (
                    captured_at TIMESTAMP,
                    raw_json VARCHAR,
                    viewer_did VARCHAR,
                    is_flutter BOOLEAN,
                    gap_ms INTEGER,
                    payload_hash VARCHAR
                )
            `);
            await conn.query(`CHECKPOINT`);
            eventCount = 0;
            await browser.storage.local.set({ eventCount: 0 });
            updateIcon();
            longevityState = {};
            console.log(`[${new Date().toISOString()}] Cleared and checkpointed database...`);
        } catch (e) {
            console.error(`[${new Date().toISOString()}] Clear failed`, e);
        }
    }
});
