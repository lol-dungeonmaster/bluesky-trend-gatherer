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
let sessionStartTime = Date.now();
let firstEventTime = null;
let lastEventTime = null;

let cachedDbSize = "0 B";

async function getDatabaseSizeStr() {
    let totalBytes = 0;
    try {
        const opfsRoot = await navigator.storage.getDirectory();
        try {
            const handle = await opfsRoot.getFileHandle('bluesky_trends.db');
            const file = await handle.getFile();
            totalBytes += file.size;
        } catch(e) {}
        try {
            const handleWAL = await opfsRoot.getFileHandle('bluesky_trends.db.wal');
            const fileWAL = await handleWAL.getFile();
            totalBytes += fileWAL.size;
        } catch(e) {}
    } catch(e) {}

    if (totalBytes === 0) return "0 B";
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(totalBytes) / Math.log(k));
    return parseFloat((totalBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

let lastUpdateDurationMs = null;

async function updateIcon() {
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

    if (isActive) {
        browser.browserAction.setIcon({ path: "/assets/icon-on.svg" });
        browser.browserAction.setBadgeText({ text: sessionEventCount.toString() });
        browser.browserAction.setBadgeBackgroundColor({ color: "#28a745" });
    } else {
        browser.browserAction.setIcon({ path: "/assets/icon-off.svg" });
        browser.browserAction.setBadgeText({ text: "" });
    }
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
    cachedDbSize = await getDatabaseSizeStr();
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

async function stopMonitor() {
    if (monitorTimeoutId) {
        clearTimeout(monitorTimeoutId);
        monitorTimeoutId = null;
    }
    if (activeBskyTabId !== null) {
        activeBskyTabId = null;
        console.log(`[${new Date().toISOString()}] [Monitor] Stopped.`);
    }
}

async function autoDisable() {
    if (isActive) {
        isActive = false;
                updateIcon();
        await stopMonitor();
        console.log(`[${new Date().toISOString()}] [Monitor] Auto-disabled due to tab loss or crash.`);
    }
}

async function sha1(str) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function startMonitor() {
    await stopMonitor();
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
        console.log(`[${new Date().toISOString()}] [Monitor] Monitored tab closed. Auto-disabling.`);
        autoDisable();
    }
});

// --- 0. INITIALIZE DUCKDB ---
async function initDatabase() {
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
        
        await db.open({ path: 'opfs://bluesky_trends.db', accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
        conn = await db.connect();
        
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
                raw_json JSON
            );
        `);
        try { await conn.query("ALTER TABLE trends ADD COLUMN viewer_did VARCHAR"); } catch(e) {}
        try { await conn.query("ALTER TABLE trends ADD COLUMN is_flutter BOOLEAN"); } catch(e) {}
        try { await conn.query("ALTER TABLE trends ADD COLUMN gap_ms INTEGER"); } catch(e) {}
        try { await conn.query("ALTER TABLE trends ADD COLUMN payload_hash VARCHAR"); } catch(e) {}
        
        console.log(`[${new Date().toISOString()}] DuckDB successfully initialized on OPFS!`);
    } catch (e) {
        console.error(`[${new Date().toISOString()}] Failed to initialize DuckDB`, e);
    }
}
initDatabase();

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
                VALUES (CURRENT_TIMESTAMP, '${dbRow.raw_json.replace(/'/g, "''")}', '${dbRow.viewer_did}', ${dbRow.is_flutter}, ${dbRow.gap_ms}, '${dbRow.payload_hash}')
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
                console.log(`[${new Date().toISOString()}] [Monitor] Timer reset due to migration. Next event in ${Math.round(nextDelay/1000)}s.`);
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
    if (message.command === "GET_AUTH_STATUS") {
        return Promise.resolve({ hasCheckedAuth, isLoggedIn, rateLimit: currentRateLimit });
    }
    if (message.command === "GET_TREND_MOMENT") {
      if (!conn) return Promise.resolve({ error: "DB not initialized" });
      try {
          const offset = message.offset || 0;
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
        console.log(`[${new Date().toISOString()}] Clearing database...`);
        try {
            await conn.query(`DELETE FROM trends`);
            eventCount = 0;
            await browser.storage.local.set({ eventCount: 0 });
            updateIcon();
        } catch (e) {
            console.error(`[${new Date().toISOString()}] Clear failed`, e);
        }
    }
});
