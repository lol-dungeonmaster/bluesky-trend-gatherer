globalThis.__zod_globalConfig = { jitless: true };
const duckdb = require('@duckdb/duckdb-wasm');
const { z } = require('zod');


// Ensure parquet-wasm is initialized before use
let parquetWasmInitialized = false;
async function initParquet() {
    if (!parquetWasmInitialized) {
        const initParquetWasm = require('parquet-wasm/esm/parquet_wasm.js').default;
        await initParquetWasm({ module_or_path: browser.runtime.getURL('dist/parquet_wasm_bg.wasm') });
        parquetWasmInitialized = true;
    }
}

// --- ZOD SCHEMAS ---
const { TrendPayloadSchema, DatabaseRowSchema } = require('./schemas.js');


let db, conn;
let isInitializing = false;
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
browser.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "flutterAlarm") triggerFlutter(); });
const MIN_DELAY = 75000;
const MAX_DELAY = 105000;

async function getBestBskyTab() {
    let tabs = await browser.tabs.query({ url: "*://bsky.app/*" });
    tabs = tabs.filter(t => {
        try { return new URL(t.url).hostname === "bsky.app"; } catch(e) { return false; }
    });
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
            browser.alarms.create("flutterAlarm", { when: Date.now() + nextDelay });
            return;
        }

        await browser.tabs.sendMessage(activeBskyTabId, { command: "FLUTTER" });
        lastFlutterTime = Date.now();
                const nextDelay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
        totalScheduledDelayMs += nextDelay;
        const ts = new Date().toISOString();
        console.log(`[${ts}] [Monitor] Fluttering (${activeBskyTabId}), next event in ${Math.round(nextDelay/1000)}s`);
        browser.alarms.create("flutterAlarm", { when: Date.now() + nextDelay });
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
    browser.alarms.clear("flutterAlarm");
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
    if (tab && tab.url) {
        let isBskyApp = false;
        try { isBskyApp = new URL(tab.url).hostname === "bsky.app"; } catch(e){}
        if (isBskyApp) {
            if (activeBskyTabId !== tab.id) {
                activeBskyTabId = tab.id;
                lastMigrationTime = Date.now();
                console.log(`[${new Date().toISOString()}] [Monitor] Migrated targeting to tab ${activeBskyTabId}.`);
            }
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
    if (db || isInitializing) return;
    isInitializing = true;
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
        
        db = localDb;
        conn = localConn;
        console.log(`[${new Date().toISOString()}] DuckDB successfully initialized on OPFS!`);
        if (!skipLongevity) await rebuildLongevityState();
    } catch (e) {
        console.error(`[${new Date().toISOString()}] Failed to initialize DuckDB`, e);
    } finally {
        isInitializing = false;
    }
}

// --- 2. THE NETWORK LISTENER ---

let currentRateLimit = null;
let isLoggedIn = false;
let hasCheckedAuth = false;


// ==========================================
// AUTHENTICATION STATE (DUAL-LAYERED)
// ==========================================
let activeAuthHeaders = null; // Passive fallback
let appPasswordHeaders = null; // Primary (Autonomous)

async function bootstrapAppPassword() {
    const data = await browser.storage.local.get(["bskyHandle", "bskyPassword"]);
    if (data.bskyHandle && data.bskyPassword) {
        try {
            const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: data.bskyHandle, password: data.bskyPassword })
            });
            if (res.ok) {
                const session = await res.json();
                appPasswordHeaders = {
                    'Authorization': `Bearer ${session.accessJwt}`,
                    'Accept': 'application/json'
                };
                console.log(`[${new Date().toISOString()}] [Auth] App Password authentication successful. Switching to autonomous mode.`);
            } else {
                console.warn(`[${new Date().toISOString()}] [Auth] App Password authentication failed (${res.status}). Falling back to passive sniffing.`);
                appPasswordHeaders = null;
            }
        } catch (e) {
            console.warn(`[${new Date().toISOString()}] [Auth] App Password network error. Falling back to passive sniffing.`);
            appPasswordHeaders = null;
        }
    } else {
        appPasswordHeaders = null;
    }
}
// Boot check
bootstrapAppPassword();


browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // OPTIMIZATION: If we already bootstrapped the token, avoid wasting CPU cycles 
    // parsing headers on every timeline scroll. Only refresh the token when checking trends.
    if (activeAuthHeaders && !details.url.includes("getTrendingTopics")) {
      return { requestHeaders: details.requestHeaders };
    }

    let authVal, clientVal, uaVal;
    // O(n) single pass instead of O(3n) Array.find() passes
    for (let i = 0; i < details.requestHeaders.length; i++) {
      let name = details.requestHeaders[i].name.toLowerCase();
      if (name === 'authorization') authVal = details.requestHeaders[i].value;
      else if (name === 'x-bsky-client') clientVal = details.requestHeaders[i].value;
      else if (name === 'user-agent') uaVal = details.requestHeaders[i].value;
    }

    if (authVal && authVal.startsWith('Bearer')) {
      activeAuthHeaders = {
        'Authorization': authVal,
        'Accept': 'application/json'
      };
      if (clientVal) activeAuthHeaders['x-bsky-client'] = clientVal;
      if (uaVal) activeAuthHeaders['User-Agent'] = uaVal;
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["*://*.bsky.app/xrpc/*", "*://*.bsky.network/xrpc/*"] },
  ["requestHeaders"]
);

// Utility function ready for advanced analysis tasks
async function fetchWithAuth(url) {
  let headersToUse = appPasswordHeaders || activeAuthHeaders;
  if (!headersToUse) {
    throw new Error("[Auth] Warning: No active Bearer token. Please configure an App Password or wait for bootstrap.");
  }
  
  const response = await fetch(url, {
    method: 'GET',
    headers: headersToUse
  });
  
  if (response.status === 401 || response.status === 403) {
    if (appPasswordHeaders && headersToUse === appPasswordHeaders) {
        appPasswordHeaders = null;
        bootstrapAppPassword(); // Try to renew it asynchronously
        throw new Error(`[Auth] Warning: App Password session expired (${response.status}). Attempting re-auth and falling back to passive capability.`);
    } else {
        activeAuthHeaders = null; // Force the passive listener to parse the very next request
        throw new Error(`[Auth] Warning: API returned ${response.status}. The Bearer token is stale. Purging token to re-enter bootstrap mode.`);
    }
  }
  
  return response.json();
}
// ==========================================

// ==========================================
// ADVANCED TOPIC ANALYSIS
// ==========================================
async function analyzeTopActorThread(topicQuery, actorDid) {
  try {
    console.log(`[${new Date().toISOString()}] [Analysis] Starting thread analysis for topic: "${topicQuery}", actor: ${actorDid}`);
    
    // Step 1: Find the exact post using Advanced Search syntax
    let query = encodeURIComponent(`${topicQuery} from:${actorDid}`);
    let searchUrl = `https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${query}&limit=1`;
    
    let searchData = await fetchWithAuth(searchUrl);
    
    let postUri = null;
    let postText = "";
    if (!searchData.posts || searchData.posts.length === 0) {
      console.warn(`[${new Date().toISOString()}] [Analysis] Search query missed exact phrase. Falling back to getAuthorFeed for actor ${actorDid}`);
      let authorFeedUrl = `https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?actor=${actorDid}&limit=1`;
      let authorData = await fetchWithAuth(authorFeedUrl);
      if (authorData && authorData.feed && authorData.feed.length > 0) {
          postUri = authorData.feed[0].post.uri;
          postText = authorData.feed[0].post.record.text;
      } else {
          console.warn(`[${new Date().toISOString()}] [Analysis] Failure: No posts found for actor ${actorDid}`);
          return null;
      }
    } else {
      postUri = searchData.posts[0].uri;
      postText = searchData.posts[0].record.text;
    }
    
    // Snippet the text to 60 characters for clean logging
    let snippet = postText.replace(/\n/g, ' ');
    if (snippet.length > 60) snippet = snippet.substring(0, 60) + "...";
    
    console.log(`[${new Date().toISOString()}] [Analysis] Success: Found post (${postUri})`);
    console.log(`[${new Date().toISOString()}] [Analysis] Post Content: "${snippet}"`);
    
    // Step 2: Pull the full thread (comments/replies) for that post
    let threadUrl = `https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}`;
    let threadData = await fetchWithAuth(threadUrl);
    
    if (threadData && threadData.thread) {
      let replyCount = threadData.thread.replies ? threadData.thread.replies.length : 0;
      console.log(`[${new Date().toISOString()}] [Analysis] Success: Pulled thread with ${replyCount} top-level replies.`);
      return threadData.thread;
    } else {
      console.warn(`[${new Date().toISOString()}] [Analysis] Failure: Thread data malformed or empty.`);
      return null;
    }
    
  } catch (err) {
    if (err.message.includes("[Auth] Warning:")) {
      console.warn(`[${new Date().toISOString()}] ${err.message}`);
    } else {
      console.error(`[${new Date().toISOString()}] [Analysis] Fatal Error during thread analysis:`, err);
    }
    return null;
  }
}
// ==========================================


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
        if (!responseBody || !responseBody.trim()) return;
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
            
            const stmt = await conn.prepare(`
                INSERT INTO trends (captured_at, raw_json, viewer_did, is_flutter, gap_ms, payload_hash)
                VALUES (CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
            `);
            await stmt.query(dbRow.raw_json, dbRow.viewer_did, dbRow.is_flutter, dbRow.gap_ms, dbRow.payload_hash);
            await stmt.close();
            await conn.query("CHECKPOINT");
            browser.runtime.sendMessage({ command: "TREND_ADDED" }).catch(() => {});
            
            
            
            


            incrementAndSaveCount();
            console.log(`[${captureTime}] Successfully saved trend update #${eventCount}!`);
            
            if (timeSinceFlutterMs > 5000) {
                browser.alarms.clear("flutterAlarm");
                let nextDelay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
                totalScheduledDelayMs = nextDelay;
                console.log(`[${new Date().toISOString()}] [Monitor] Updated fluttering interval. Next event in ${Math.round(nextDelay/1000)}s.`);
                browser.alarms.create("flutterAlarm", { when: Date.now() + nextDelay });
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
    if (message.command === "AUTH_CREDENTIALS_UPDATED") {
        bootstrapAppPassword();
        return { status: "updating" };
    }
    if (message.command === "ANALYZE_THREAD") {
        console.log(`[${new Date().toISOString()}] [Analysis] Received command from popup UI.`);
        return analyzeTopActorThread(message.topic, message.actorDid).then(res => {
            return { status: "complete", success: !!res };
        });
    }

    if (message.command === "OPEN_OPTIONS_PAGE") {
        (async () => {
            try {
                const optionsUrl = browser.runtime.getURL("src/options.html");
                const existingTabs = await browser.tabs.query({ url: optionsUrl });
                if (existingTabs.length > 0) {
                    await browser.tabs.update(existingTabs[0].id, { active: true });
                    await browser.windows.update(existingTabs[0].windowId, { focused: true });
                    return;
                }
                
                if (activeBskyTabId) {
                    const tab = await browser.tabs.get(activeBskyTabId);
                    if (tab && tab.windowId !== undefined) {
                        await browser.tabs.create({
                            url: optionsUrl,
                            windowId: tab.windowId,
                            index: tab.index + 1
                        });
                        return;
                    }
                }
            } catch (e) { }
            browser.runtime.openOptionsPage();
        })();
        return Promise.resolve({ success: true });
    }
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
          let offset = Number(message.offset) || 0;
          if (message.target_ts) {
              const offRes = await conn.query(`SELECT COUNT(*) as c FROM trends WHERE captured_at > '${message.target_ts}'`);
              const offRows = offRes.toArray();
              let offRow = offRows[0];
              if (offRow && offRow.toJSON) offRow = offRow.toJSON();
              if (offRow) {
                  if (offRow.c !== undefined) offset = Number(offRow.c);
                  else if (offRow.count !== undefined) offset = Number(offRow.count);
                  else offset = Number(Object.values(offRow)[0]);
              }
          }
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
          
          if (offset >= totalCount) offset = Math.max(0, totalCount - 1);
          const momentResult = await conn.query(`SELECT CAST(captured_at AS VARCHAR) as captured_at_str, raw_json FROM trends ORDER BY captured_at DESC LIMIT 100 OFFSET ${offset}`);
          const historyRows = momentResult.toArray().map(r => r.toJSON ? r.toJSON() : r);
          
          if (historyRows.length === 0) return Promise.resolve({ total: totalCount, moment: null });
          
          return Promise.resolve({
              total: totalCount,
              offset: offset,
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
        let wasSleeping = false;
        if (!conn) {
            wasSleeping = true;
            await initDatabase();
        }
                try {
            await initParquet();
            
            const parquetBuffer = new Uint8Array(await message.file.arrayBuffer());
            const { readParquet } = require('parquet-wasm/esm/parquet_wasm.js');
            const wasmTable = readParquet(parquetBuffer);
            const ipcStream = wasmTable.intoIPCStream();
            const { tableFromIPC } = require('apache-arrow');
            const arrowTable = tableFromIPC(ipcStream);
            
            // Read all existing timestamps for deduplication
            const existingRes = await conn.query("SELECT captured_at FROM trends");
            const existingSet = new Set(existingRes.toArray().map(r => {
                let d = r.toJSON ? r.toJSON().captured_at : r.captured_at;
                if (d instanceof Date) return d.getTime();
                if (typeof d === 'number') return d;
                return new Date(d).getTime();
            }));
            
            const incomingRows = arrowTable.toArray().map(r => r.toJSON ? r.toJSON() : r);
            
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
                    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(',\n');
                    const stmt = await conn.prepare(`INSERT INTO trends (captured_at, raw_json, viewer_did, is_flutter, gap_ms, payload_hash) VALUES ${placeholders}`);
                    
                    const params = [];
                    for (const r of chunk) {
                        params.push(r.captured_at, r.raw_json, r.viewer_did, r.is_flutter, r.gap_ms, r.payload_hash);
                    }
                    
                    await stmt.query(...params);
                    await stmt.close();
                }
            }
            
            console.log(`[${new Date().toISOString()}] [Import] Finished. Inserted ${validInsertRows.length} valid rows. Skipped ${errorsLogged} invalid/corrupt rows.`);
            
            const countRes = await conn.query("SELECT COUNT(*) as c FROM trends");
            const rowObj = countRes.toArray()[0];
            const firstRow = rowObj.toJSON ? rowObj.toJSON() : rowObj;
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
        return new Promise(async (resolve, reject) => {
            console.log(`[${new Date().toISOString()}] Exporting database...`);
            let wasSleeping = false;
            if (!conn) {
                wasSleeping = true;
                await initDatabase();
            }
            try {
                await initParquet();
                
                // Get data as Apache Arrow Table
                const res = await conn.query("SELECT * FROM trends");
                const rows = res.toArray().map(r => r.toJSON ? r.toJSON() : r);
                
                // Manually construct a pristine Apache Arrow Table to avoid DuckDB-Wasm schema corruption
                const { vectorFromArray, Table: ArrowTable } = require('apache-arrow');
                const captured_at = vectorFromArray(rows.map(r => {
                    let d = r.captured_at;
                    if (d instanceof Date) return d.getTime();
                    if (typeof d === 'number') return d;
                    return new Date(d).getTime();
                }));
                const raw_json = vectorFromArray(rows.map(r => String(r.raw_json)));
                const cleanTable = new ArrowTable({ captured_at, raw_json });
                
                // Serialize to IPC stream
                const { tableToIPC } = require('apache-arrow');
                const ipcStream = tableToIPC(cleanTable, "stream");
                
                // Load into parquet-wasm and encode to Parquet
                const { writeParquet, Table, WriterPropertiesBuilder, Compression } = require('parquet-wasm/esm/parquet_wasm.js');
                const wasmTable = Table.fromIPCStream(ipcStream);
                const writerProps = new WriterPropertiesBuilder().setCompression(Compression.ZSTD).build();
                const parquetBytes = writeParquet(wasmTable, writerProps);
                
                const blob = new Blob([parquetBytes], { type: 'application/vnd.apache.parquet' });
                const url = URL.createObjectURL(blob);
                
                const downloadId = await browser.downloads.download({
                    url: url,
                    filename: `bluesky_trends_${new Date().getTime()}.parquet`,
                    saveAs: false
                });
                
                const listener = (delta) => {
                    if (delta.id === downloadId && delta.state && delta.state.current !== 'in_progress') {
                        URL.revokeObjectURL(url);
                        browser.downloads.onChanged.removeListener(listener);
                        console.log(`[${new Date().toISOString()}] Parquet export ${downloadId} completed, revoked ObjectURL from memory.`);
                    }
                };
                browser.downloads.onChanged.addListener(listener);
                
                if (wasSleeping) { await terminateDatabase().catch(()=>{}); }
                resolve({ success: true });
            } catch (e) {
                console.error(`[${new Date().toISOString()}] Export failed`, e);
                if (wasSleeping) { await terminateDatabase().catch(()=>{}); }
                resolve({ success: false, error: e.message || e.toString() });
            }
        });
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
