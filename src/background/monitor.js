import { state } from './state.js';
import { getDatabaseSizeStr, terminateDatabase, initDatabase } from './db.js';

export const MIN_DELAY = 75000;
export const MAX_DELAY = 105000;

export function createIconImageData(isOn) {
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

export async function updateIcon() {
  if (state.isActive) {
    browser.browserAction.setIcon({
      imageData: createIconImageData(true)
    });
    let badgeText = state.sessionEventCount.toString();
    if (state.sessionEventCount >= 1000) {
      badgeText = (state.sessionEventCount / 1000).toFixed(1).replace('.0', '') + 'k';
    }
    browser.browserAction.setBadgeText({
      text: badgeText
    });
    browser.browserAction.setBadgeBackgroundColor({
      color: "#28a745"
    });
  } else {
    browser.browserAction.setIcon({
      imageData: createIconImageData(false)
    });
    browser.browserAction.setBadgeText({
      text: ""
    });
  }
  state.cachedDbSize = await getDatabaseSizeStr();
  let avgStr = "∞";
  if (state.sessionEventCount >= 1 && state.sessionStartTime && state.lastEventTime) {
    let diffMs = state.lastEventTime - state.sessionStartTime;
    let avgSec = Math.round(diffMs / 1000 / state.sessionEventCount);
    avgStr = `${avgSec}s`;
  }
  let lastUpdateStr = "∞";
  if (state.lastUpdateDurationMs !== null) {
    lastUpdateStr = `${Math.round(state.lastUpdateDurationMs / 1000)}s`;
  }
  let dbCount = "Loading...";
  if (state.conn) {
    try {
      const countRes = await state.conn.query("SELECT COUNT(*) as c FROM trends");
      let firstRow = countRes.toArray()[0];
      if (firstRow && firstRow.toJSON) firstRow = firstRow.toJSON();
      if (firstRow) {
        if (firstRow.c !== undefined) dbCount = Number(firstRow.c);else if (firstRow.count !== undefined) dbCount = Number(firstRow.count);else dbCount = Number(Object.values(firstRow)[0]);
      }
      // Sync cache with real DB count
      state.eventCount = dbCount;
      browser.storage.local.set({
        eventCount: state.eventCount
      });
    } catch (e) {
      dbCount = "Error";
    }
  } else {
    dbCount = "Initializing...";
  }
  let titleStr = `Bluesky Trend Gatherer (${state.isActive ? 'On' : 'Off'})\n`;
  titleStr += `Session Events: ${state.sessionEventCount}\n`;
  titleStr += `Total DB Rows: ${dbCount}\n`;
  titleStr += `Database Size: ${state.cachedDbSize}\n`;
  titleStr += `Update Time (avg): ${avgStr}\n`;
  titleStr += `Last Update: ${lastUpdateStr}`;
  browser.browserAction.setTitle({
    title: titleStr
  });
}

export async function incrementAndSaveCount() {
  state.eventCount++;
  state.sessionEventCount++;
  let now = Date.now();
  if (!state.firstEventTime) state.firstEventTime = now;
  if (state.lastEventTime) {
    state.lastUpdateDurationMs = now - state.lastEventTime;
  } else {
    let diff = now - state.sessionStartTime;
    if (Math.round(diff / 1000) > 0) {
      state.lastUpdateDurationMs = diff;
    }
  }
  state.lastEventTime = now;
  await browser.storage.local.set({
    eventCount: state.eventCount
  });
  updateIcon();
}

export async function getBestBskyTab() {
  let tabs = await browser.tabs.query({
    url: "*://bsky.app/*"
  });
  tabs = tabs.filter(t => {
    try {
      return new URL(t.url).hostname === "bsky.app";
    } catch (e) {
      return false;
    }
  });
  if (tabs.length === 0) return null;
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0];
}

export async function triggerFlutter() {
  if (!state.isActive || !state.activeBskyTabId) return;
  try {
    let timeSinceLastUpdate = state.lastEventTime ? Date.now() - state.lastEventTime : Infinity;
    let timeSinceLastMigration = state.lastMigrationTime ? Date.now() - state.lastMigrationTime : Infinity;
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
      state.totalScheduledDelayMs += nextDelay;
      console.log(`[${new Date().toISOString()}] [Monitor] Skipped fluttering because ${skipReason} was ${Math.round(skipAgeMs / 1000)}s ago. Next event in ${Math.round(nextDelay / 1000)}s.`);
      browser.alarms.create("flutterAlarm", {
        when: Date.now() + nextDelay
      });
      return;
    }
    await browser.tabs.sendMessage(state.activeBskyTabId, {
      command: "FLUTTER"
    });
    state.lastFlutterTime = Date.now();
    const nextDelay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
    state.totalScheduledDelayMs += nextDelay;
    const ts = new Date().toISOString();
    console.log(`[${ts}] [Monitor] Fluttering (${state.activeBskyTabId}), next event in ${Math.round(nextDelay / 1000)}s`);
    browser.alarms.create("flutterAlarm", {
      when: Date.now() + nextDelay
    });
  } catch (e) {
    console.log(`[${new Date().toISOString()}] [Monitor] Target tab unresponsive. Auto-disabling.`);
    autoDisable();
  }
}

export async function stopMonitor() {
  browser.alarms.clear("flutterAlarm");
  if (state.activeBskyTabId !== null) {
    state.activeBskyTabId = null;
    console.log(`[${new Date().toISOString()}] [Monitor] Stopped.`);
  }
  await terminateDatabase();
}

export async function autoDisable() {
  if (state.isActive) {
    state.isActive = false;
    updateIcon();
    await stopMonitor();
    console.log(`[${new Date().toISOString()}] [Monitor] Auto-disabled due to tab loss or crash.`);
  } else {
    await terminateDatabase();
  }
}

export async function startMonitor() {
  await stopMonitor();
  await initDatabase();
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      const usageMB = (est.usage / (1024 * 1024)).toFixed(2);
      const quotaMB = (est.quota / (1024 * 1024)).toFixed(2);
      const percent = (est.usage / est.quota * 100).toFixed(1);
      console.log(`[${new Date().toISOString()}] [Monitor] Started. Storage: ${usageMB}MB / ${quotaMB}MB (${percent}%)`);
    } catch (e) {
      console.log(`[${new Date().toISOString()}] [Monitor] Started.`);
    }
  } else {
    console.log(`[${new Date().toISOString()}] [Monitor] Started.`);
  }
  const bestTab = await getBestBskyTab();
  if (bestTab) {
    state.activeBskyTabId = bestTab.id;
    console.log(`[${new Date().toISOString()}] [Monitor] Targeted tab ${state.activeBskyTabId}`);
    triggerFlutter();
  } else {
    autoDisable();
  }
}
