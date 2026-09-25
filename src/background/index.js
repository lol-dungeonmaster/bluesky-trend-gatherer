globalThis.__zod_globalConfig = {
  jitless: true
};

import { state } from './state.js';
import { initParquet, rebuildLongevityState, getDatabaseSizeStr, terminateDatabase, initDatabase } from './db.js';
import { bootstrapAppPassword, fetchWithAuth } from './auth.js';
import { analyzeTopActorThread } from './analysis.js';
import { updateIcon, incrementAndSaveCount, getBestBskyTab, triggerFlutter, stopMonitor, autoDisable, startMonitor, MIN_DELAY, MAX_DELAY } from './monitor.js';

const {
  TrendPayloadSchema,
  DatabaseRowSchema
} = require('../schemas.js');

async function sha1(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- 1. PERSISTENT COUNT & TOGGLE STATE ---
browser.storage.local.get(["eventCount"]).then(res => {
  state.eventCount = res.eventCount || 0;
  updateIcon();
});
browser.storage.local.remove("isActive");

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "flutterAlarm") triggerFlutter();
});

bootstrapAppPassword();

browser.tabs.onActivated.addListener(async activeInfo => {
  if (!state.isActive) return;
  const tab = await browser.tabs.get(activeInfo.tabId).catch(() => {});
  if (tab && tab.url) {
    let isBskyApp = false;
    try {
      isBskyApp = new URL(tab.url).hostname === "bsky.app";
    } catch (e) {}
    if (isBskyApp) {
      if (state.activeBskyTabId !== tab.id) {
        state.activeBskyTabId = tab.id;
        state.lastMigrationTime = Date.now();
        console.log(`[${new Date().toISOString()}] [Monitor] Migrated targeting to tab ${state.activeBskyTabId}.`);
      }
    }
  }
});

browser.tabs.onRemoved.addListener(async tabId => {
  if (state.isActive && tabId === state.activeBskyTabId) {
    const bestTab = await getBestBskyTab();
    if (bestTab) {
      state.activeBskyTabId = bestTab.id;
      state.lastMigrationTime = Date.now();
      console.log(`[${new Date().toISOString()}] [Monitor] Monitored tab closed. Rescued by migrating to tab ${state.activeBskyTabId}.`);
    } else {
      console.log(`[${new Date().toISOString()}] [Monitor] Monitored tab closed. No alternative tabs found. Auto-disabling.`);
      autoDisable();
    }
  }
});

browser.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  if (state.isActive && removedTabId === state.activeBskyTabId) {
    state.activeBskyTabId = addedTabId;
    state.lastMigrationTime = Date.now();
    console.log(`[${new Date().toISOString()}] [Monitor] Monitored tab replaced (awoken from sleep). Migrated to tab ${state.activeBskyTabId}.`);
  }
});

browser.webRequest.onBeforeSendHeaders.addListener(details => {
  if (state.activeAuthHeaders && !details.url.includes("getTrendingTopics")) {
    return {
      requestHeaders: details.requestHeaders
    };
  }
  let authVal, clientVal, uaVal;
  for (let i = 0; i < details.requestHeaders.length; i++) {
    let name = details.requestHeaders[i].name.toLowerCase();
    if (name === 'authorization') authVal = details.requestHeaders[i].value;else if (name === 'x-bsky-client') clientVal = details.requestHeaders[i].value;else if (name === 'user-agent') uaVal = details.requestHeaders[i].value;
  }
  if (authVal && authVal.startsWith('Bearer')) {
    state.activeAuthHeaders = {
      'Authorization': authVal,
      'Accept': 'application/json'
    };
    if (clientVal) state.activeAuthHeaders['x-bsky-client'] = clientVal;
    if (uaVal) state.activeAuthHeaders['User-Agent'] = uaVal;
  }
  return {
    requestHeaders: details.requestHeaders
  };
}, {
  urls: ["*://*.bsky.app/xrpc/*", "*://*.bsky.network/xrpc/*"]
}, ["requestHeaders"]);

browser.webRequest.onHeadersReceived.addListener(details => {
  if (!state.isActive || !details.url.includes("app.bsky.unspecced.getTrends") || details.method === "OPTIONS") {
    return {};
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
      if (m) policy = parseInt(m[1]);
    }
  }
  state.hasCheckedAuth = true;
  if (remaining !== null && limit !== null) {
    state.isLoggedIn = true;
    state.currentRateLimit = {
      remaining,
      limit,
      reset,
      policy
    };
  } else {
    state.isLoggedIn = false;
    state.currentRateLimit = null;
  }
  browser.runtime.sendMessage({
    command: "AUTH_STATUS",
    isLoggedIn: state.isLoggedIn,
    rateLimit: state.currentRateLimit
  }).catch(() => {});
}, {
  urls: ["*://*.bsky.network/xrpc/*", "*://*.bsky.app/xrpc/*"]
}, ["responseHeaders"]);

browser.webRequest.onBeforeRequest.addListener(details => {
  if (!state.isActive || !details.url.includes("app.bsky.unspecced.getTrends") || details.method === "OPTIONS") {
    return {};
  }
  let filter = browser.webRequest.filterResponseData(details.requestId);
  let decoder = new TextDecoder("utf-8");
  let responseBody = "";
  filter.ondata = event => {
    responseBody += decoder.decode(event.data, {
      stream: true
    });
    filter.write(event.data);
  };
  filter.onstop = async event => {
    filter.disconnect();
    try {
      if (!responseBody || !responseBody.trim()) return;
      let rawData = JSON.parse(responseBody);
      let trendsArray = rawData.topics || rawData.trends || (Array.isArray(rawData) ? rawData : []);
      let validTrendsArray = TrendPayloadSchema.parse(trendsArray);
      let currentTrendsString = JSON.stringify(validTrendsArray);
      const urlObj = new URL(details.url);
      const rawViewerDid = urlObj.searchParams.get("viewer") || 'anonymous';
      let timeSinceFlutterMs = state.lastFlutterTime ? Date.now() - state.lastFlutterTime : 0;
      const rawIsFlutter = timeSinceFlutterMs < 5000;
      const rawPayloadHash = await sha1(currentTrendsString);
      const rawGapMs = state.lastEventTime ? Date.now() - state.lastEventTime : 0;
      let currentTopics = new Set();
      for (let t of validTrendsArray) {
        currentTopics.add(t.topic);
        if (state.longevityState[t.topic] === undefined) {
          state.longevityState[t.topic] = 0;
        } else if (state.previousTopics.has(t.topic)) {
          state.longevityState[t.topic] += rawGapMs;
        }
        t.timeInTop20Ms = state.longevityState[t.topic];
      }
      state.previousTopics = currentTopics;
      currentTrendsString = JSON.stringify(validTrendsArray);
      const dbRow = DatabaseRowSchema.parse({
        viewer_did: rawViewerDid,
        is_flutter: rawIsFlutter,
        gap_ms: rawGapMs,
        payload_hash: rawPayloadHash,
        raw_json: currentTrendsString
      });
      let isDuplicate = false;
      if (state.lastRawJsonString === currentTrendsString) {
        isDuplicate = true;
        console.log(`[${new Date().toISOString()}] Deduplication check: Payload identical to previous.`);
      }
      state.lastRawJsonString = currentTrendsString;
      const captureTime = new Date().toISOString();
      if (state.conn) {
        const stmt = await state.conn.prepare(`
                INSERT INTO trends (captured_at, raw_json, viewer_did, is_flutter, gap_ms, payload_hash)
                VALUES (CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
            `);
        await stmt.query(dbRow.raw_json, dbRow.viewer_did, dbRow.is_flutter, dbRow.gap_ms, dbRow.payload_hash);
        await stmt.close();
        await state.conn.query("CHECKPOINT");
        browser.runtime.sendMessage({
          command: "TREND_ADDED"
        }).catch(() => {});
        incrementAndSaveCount();
        console.log(`[${captureTime}] Successfully saved trend update #${state.eventCount}!`);
        if (timeSinceFlutterMs > 5000) {
          browser.alarms.clear("flutterAlarm");
          let nextDelay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
          state.totalScheduledDelayMs = nextDelay;
          console.log(`[${new Date().toISOString()}] [Monitor] Updated fluttering interval. Next event in ${Math.round(nextDelay / 1000)}s.`);
          browser.alarms.create("flutterAlarm", {
            when: Date.now() + nextDelay
          });
        }
      } else {
        console.error(`[${new Date().toISOString()}] DuckDB not connected yet!`);
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Failed to process trend data`, e);
    }
  };
}, {
  urls: ["*://*.bsky.network/xrpc/*"]
}, ["blocking"]);

browser.runtime.onMessage.addListener(async message => {
  if (message.command === "AUTH_CREDENTIALS_UPDATED") {
    bootstrapAppPassword();
    return {
      status: "updating"
    };
  }
  if (message.command === "ANALYZE_THREAD") {
    console.log(`[${new Date().toISOString()}] [Analysis] Received command from popup UI.`);
    return analyzeTopActorThread(message.topic, message.actorDid).then(res => {
      return {
        status: "complete",
        success: !!res
      };
    });
  }
  if (message.command === "OPEN_OPTIONS_PAGE") {
    (async () => {
      try {
        const optionsUrl = browser.runtime.getURL("src/options.html");
        const existingTabs = await browser.tabs.query({
          url: optionsUrl
        });
        if (existingTabs.length > 0) {
          await browser.tabs.update(existingTabs[0].id, {
            active: true
          });
          await browser.windows.update(existingTabs[0].windowId, {
            focused: true
          });
          return;
        }
        if (state.activeBskyTabId) {
          const tab = await browser.tabs.get(state.activeBskyTabId);
          if (tab && tab.windowId !== undefined) {
            await browser.tabs.create({
              url: optionsUrl,
              windowId: tab.windowId,
              index: tab.index + 1
            });
            return;
          }
        }
      } catch (e) {}
      browser.runtime.openOptionsPage();
    })();
    return Promise.resolve({
      success: true
    });
  }
  if (message.command === "GET_STATE") {
    return Promise.resolve({
      isActive: state.isActive
    });
  } else if (message.command === "SET_STATE") {
    state.isActive = message.isActive;
    updateIcon();
    if (state.isActive) {
      startMonitor();
    } else {
      stopMonitor();
    }
    return Promise.resolve({
      success: true
    });
  } else if (message.command === "NAVIGATE") {
    if (state.activeBskyTabId) {
      browser.tabs.update(state.activeBskyTabId, {
        url: message.url,
        active: true
      }).then(tab => browser.windows.update(tab.windowId, {
        focused: true
      })).catch(() => {});
    } else {
      browser.tabs.create({
        url: message.url,
        active: true
      });
    }
    return Promise.resolve(true);
  }
  if (!state.conn && ["GET_TREND_MOMENT", "EXPORT", "CLEAR", "IMPORT"].includes(message.command)) {
    await initDatabase(message.command === "CLEAR");
  }
  if (message.command === "GET_AUTH_STATUS") {
    return Promise.resolve({
      hasCheckedAuth: state.hasCheckedAuth,
      isLoggedIn: state.isLoggedIn,
      rateLimit: state.currentRateLimit
    });
  }
  if (message.command === "GET_TREND_MOMENT") {
    if (!state.conn) return Promise.resolve({
      error: "DB not initialized"
    });
    try {
      let offset = Number(message.offset) || 0;
      if (message.target_ts) {
        const offRes = await state.conn.query(`SELECT COUNT(*) as c FROM trends WHERE captured_at > '${message.target_ts}'`);
        const offRows = offRes.toArray();
        let offRow = offRows[0];
        if (offRow && offRow.toJSON) offRow = offRow.toJSON();
        if (offRow) {
          if (offRow.c !== undefined) offset = Number(offRow.c);else if (offRow.count !== undefined) offset = Number(offRow.count);else offset = Number(Object.values(offRow)[0]);
        }
      }
      const countResult = await state.conn.query(`SELECT COUNT(*) as c FROM trends`);
      const rows = countResult.toArray();
      let firstRow = rows[0];
      if (firstRow && firstRow.toJSON) firstRow = firstRow.toJSON();
      let totalCount = 0;
      if (firstRow) {
        if (firstRow.c !== undefined) totalCount = Number(firstRow.c);else if (firstRow.count !== undefined) totalCount = Number(firstRow.count);else {
          const vals = Object.values(firstRow);
          if (vals.length > 0) totalCount = Number(vals[0]);
        }
      }
      if (totalCount === 0) {
        return Promise.resolve({
          total: 0,
          moment: null
        });
      }
      if (offset >= totalCount) offset = Math.max(0, totalCount - 1);
      const momentResult = await state.conn.query(`SELECT CAST(captured_at AS VARCHAR) as captured_at_str, raw_json FROM trends ORDER BY captured_at DESC LIMIT 100 OFFSET ${offset}`);
      const historyRows = momentResult.toArray().map(r => r.toJSON ? r.toJSON() : r);
      if (historyRows.length === 0) return Promise.resolve({
        total: totalCount,
        moment: null
      });
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
      return Promise.resolve({
        error: e.toString()
      });
    }
  } else if (message.command === "IMPORT") {
    console.log(`[${new Date().toISOString()}] Importing database...`);

    try {
      await initParquet();
      const parquetBuffer = new Uint8Array(await message.file.arrayBuffer());
      const {
        readParquet
      } = require('parquet-wasm/esm/parquet_wasm.js');
      const wasmTable = readParquet(parquetBuffer);
      const ipcStream = wasmTable.intoIPCStream();
      const {
        tableFromIPC
      } = require('apache-arrow');
      const arrowTable = tableFromIPC(ipcStream);

      // Read all existing timestamps for deduplication
      const existingRes = await state.conn.query("SELECT captured_at FROM trends");
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
          const stmt = await state.conn.prepare(`INSERT INTO trends (captured_at, raw_json, viewer_did, is_flutter, gap_ms, payload_hash) VALUES ${placeholders}`);
          const params = [];
          for (const r of chunk) {
            params.push(r.captured_at, r.raw_json, r.viewer_did, r.is_flutter, r.gap_ms, r.payload_hash);
          }
          await stmt.query(...params);
          await stmt.close();
        }
      }
      console.log(`[${new Date().toISOString()}] [Import] Finished. Inserted ${validInsertRows.length} valid rows. Skipped ${errorsLogged} invalid/corrupt rows.`);
      const countRes = await state.conn.query("SELECT COUNT(*) as c FROM trends");
      const rowObj = countRes.toArray()[0];
      const firstRow = rowObj.toJSON ? rowObj.toJSON() : rowObj;
      state.eventCount = Number(firstRow.c || firstRow.count || Object.values(firstRow)[0] || 0);
      await browser.storage.local.set({
        eventCount: state.eventCount
      });
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
      try {
        await initParquet();

        // Get data as Apache Arrow Table
        const res = await state.conn.query("SELECT * FROM trends");
        const rows = res.toArray().map(r => r.toJSON ? r.toJSON() : r);

        // Manually construct a pristine Apache Arrow Table to avoid DuckDB-Wasm schema corruption
        const {
          vectorFromArray,
          Table: ArrowTable
        } = require('apache-arrow');
        const captured_at = vectorFromArray(rows.map(r => {
          let d = r.captured_at;
          if (d instanceof Date) return d.getTime();
          if (typeof d === 'number') return d;
          return new Date(d).getTime();
        }));
        const raw_json = vectorFromArray(rows.map(r => String(r.raw_json)));
        const cleanTable = new ArrowTable({
          captured_at,
          raw_json
        });

        // Serialize to IPC stream
        const {
          tableToIPC
        } = require('apache-arrow');
        const ipcStream = tableToIPC(cleanTable, "stream");

        // Load into parquet-wasm and encode to Parquet
        const {
          writeParquet,
          Table,
          WriterPropertiesBuilder,
          Compression
        } = require('parquet-wasm/esm/parquet_wasm.js');
        const wasmTable = Table.fromIPCStream(ipcStream);
        const writerProps = new WriterPropertiesBuilder().setCompression(Compression.ZSTD).build();
        const parquetBytes = writeParquet(wasmTable, writerProps);
        const blob = new Blob([parquetBytes], {
          type: 'application/vnd.apache.parquet'
        });
        const url = URL.createObjectURL(blob);
        const downloadId = await browser.downloads.download({
          url: url,
          filename: `bluesky_trends_${new Date().getTime()}.parquet`,
          saveAs: false
        });
        const listener = delta => {
          if (delta.id === downloadId && delta.state && delta.state.current !== 'in_progress') {
            URL.revokeObjectURL(url);
            browser.downloads.onChanged.removeListener(listener);
            console.log(`[${new Date().toISOString()}] Parquet export ${downloadId} completed, revoked ObjectURL from memory.`);
          }
        };
        browser.downloads.onChanged.addListener(listener);
        resolve({
          success: true
        });
      } catch (e) {
        console.error(`[${new Date().toISOString()}] Export failed`, e);
        resolve({
          success: false,
          error: e.message || e.toString()
        });
      }
    });
  } else if (message.command === "CLEAR") {
    try {
      await state.conn.query(`DROP TABLE IF EXISTS trends`);
      await state.conn.query(`
                CREATE TABLE trends (
                    captured_at TIMESTAMP,
                    raw_json VARCHAR,
                    viewer_did VARCHAR,
                    is_flutter BOOLEAN,
                    gap_ms INTEGER,
                    payload_hash VARCHAR
                )
            `);
      await state.conn.query(`CHECKPOINT`);
      state.eventCount = 0;
      await browser.storage.local.set({
        eventCount: 0
      });
      updateIcon();
      state.longevityState = {};
      console.log(`[${new Date().toISOString()}] Cleared and checkpointed database...`);
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Clear failed`, e);
    }
  }
});
