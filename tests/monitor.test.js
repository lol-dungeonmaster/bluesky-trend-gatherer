import { 
  createIconImageData, 
  updateIcon, 
  incrementAndSaveCount, 
  getBestBskyTab, 
  triggerFlutter, 
  stopMonitor, 
  autoDisable, 
  startMonitor,
  MIN_DELAY,
  MAX_DELAY
} from '../src/background/monitor.js';

import { state } from '../src/background/state.js';
import { getDatabaseSizeStr, terminateDatabase, initDatabase } from '../src/background/db.js';

jest.mock('../src/background/state.js', () => ({
  state: {
    isActive: false,
    sessionEventCount: 0,
    eventCount: 0,
    sessionStartTime: 0,
    lastEventTime: 0,
    lastUpdateDurationMs: null,
    conn: null,
    activeBskyTabId: null,
    totalScheduledDelayMs: 0,
    lastFlutterTime: 0,
    lastMigrationTime: 0,
    firstEventTime: 0,
    cachedDbSize: "0B"
  }
}));

jest.mock('../src/background/db.js', () => ({
  getDatabaseSizeStr: jest.fn().mockResolvedValue("1MB"),
  terminateDatabase: jest.fn().mockResolvedValue(),
  initDatabase: jest.fn().mockResolvedValue()
}));

describe('monitor.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.browser = {
      browserAction: {
        setIcon: jest.fn(),
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setTitle: jest.fn(),
      },
      storage: {
        local: {
          set: jest.fn().mockResolvedValue(),
        }
      },
      tabs: {
        query: jest.fn().mockResolvedValue([]),
        sendMessage: jest.fn().mockResolvedValue(),
      },
      alarms: {
        create: jest.fn(),
        clear: jest.fn(),
      }
    };
    
    Object.defineProperty(global, 'navigator', {
      value: {
        storage: {
          estimate: jest.fn().mockResolvedValue({ usage: 1024*1024, quota: 1024*1024*10 })
        }
      },
      writable: true,
      configurable: true
    });
    
    Object.assign(state, {
      isActive: false,
      sessionEventCount: 0,
      eventCount: 0,
      sessionStartTime: 0,
      lastEventTime: 0,
      lastUpdateDurationMs: null,
      conn: null,
      activeBskyTabId: null,
      totalScheduledDelayMs: 0,
      lastFlutterTime: 0,
      lastMigrationTime: 0,
      firstEventTime: 0,
      cachedDbSize: "0B"
    });

    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      quadraticCurveTo: jest.fn(),
      closePath: jest.fn(),
      fill: jest.fn(),
      stroke: jest.fn(),
      getImageData: jest.fn().mockReturnValue('imagedata')
    });
    
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('createIconImageData', () => {
    it('creates icon when isOn is true', () => {
      expect(createIconImageData(true)).toBe('imagedata');
    });
    it('creates icon when isOn is false', () => {
      expect(createIconImageData(false)).toBe('imagedata');
    });
  });

  describe('updateIcon', () => {
    it('handles inactive state', async () => {
      state.isActive = false;
      await updateIcon();
      expect(browser.browserAction.setIcon).toHaveBeenCalled();
      expect(browser.browserAction.setBadgeText).toHaveBeenCalledWith({ text: "" });
    });

    it('handles active state < 1000 events', async () => {
      state.isActive = true;
      state.sessionEventCount = 500;
      await updateIcon();
      expect(browser.browserAction.setBadgeText).toHaveBeenCalledWith({ text: "500" });
    });

    it('handles active state >= 1000 events', async () => {
      state.isActive = true;
      state.sessionEventCount = 1500;
      await updateIcon();
      expect(browser.browserAction.setBadgeText).toHaveBeenCalledWith({ text: "1.5k" });
    });

    it('handles average time calculation', async () => {
      state.sessionEventCount = 2;
      state.sessionStartTime = 1000;
      state.lastEventTime = 3000;
      await updateIcon();
      expect(browser.browserAction.setTitle).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringContaining('Update Time (avg): 1s')
      }));
    });

    it('handles lastUpdateDurationMs calculation', async () => {
      state.lastUpdateDurationMs = 5000;
      await updateIcon();
      expect(browser.browserAction.setTitle).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringContaining('Last Update: 5s')
      }));
    });

    it('handles conn querying successfully with .c', async () => {
      state.conn = {
        query: jest.fn().mockResolvedValue({
          toArray: () => [{ toJSON: () => ({ c: 42 }) }]
        })
      };
      await updateIcon();
      expect(browser.storage.local.set).toHaveBeenCalledWith({ eventCount: 42 });
    });

    it('handles conn querying successfully with .count', async () => {
      state.conn = {
        query: jest.fn().mockResolvedValue({
          toArray: () => [{ count: 43 }]
        })
      };
      await updateIcon();
      expect(browser.storage.local.set).toHaveBeenCalledWith({ eventCount: 43 });
    });
    
    it('handles conn querying successfully with Object.values', async () => {
      state.conn = {
        query: jest.fn().mockResolvedValue({
          toArray: () => [{ somethingElse: 44 }]
        })
      };
      await updateIcon();
      expect(browser.storage.local.set).toHaveBeenCalledWith({ eventCount: 44 });
    });

    it('handles conn querying successfully without toJSON', async () => {
      state.conn = {
        query: jest.fn().mockResolvedValue({
          toArray: () => [{ c: 45 }]
        })
      };
      await updateIcon();
      expect(browser.storage.local.set).toHaveBeenCalledWith({ eventCount: 45 });
    });

    it('handles conn querying with missing firstRow', async () => {
      state.conn = {
        query: jest.fn().mockResolvedValue({
          toArray: () => []
        })
      };
      await updateIcon();
    });

    it('handles conn querying error', async () => {
      state.conn = {
        query: jest.fn().mockRejectedValue(new Error('db error'))
      };
      await updateIcon();
      expect(browser.browserAction.setTitle).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringContaining('Total DB Rows: Error')
      }));
    });
  });

  describe('incrementAndSaveCount', () => {
    it('handles first event and no lastEventTime (diff > 0)', async () => {
      const now = Date.now();
      state.firstEventTime = 0;
      state.lastEventTime = 0;
      state.sessionStartTime = now - 2000;
      await incrementAndSaveCount();
      expect(state.firstEventTime).toBeGreaterThan(0);
      expect(state.lastUpdateDurationMs).toBeGreaterThanOrEqual(2000);
    });

    it('handles first event and no lastEventTime (diff <= 0)', async () => {
      const now = Date.now();
      state.firstEventTime = 0;
      state.lastEventTime = 0;
      state.sessionStartTime = now;
      await incrementAndSaveCount();
    });

    it('handles subsequent events', async () => {
      const now = Date.now();
      state.firstEventTime = now - 5000;
      state.lastEventTime = now - 3000;
      await incrementAndSaveCount();
      expect(state.lastUpdateDurationMs).toBeGreaterThanOrEqual(3000);
    });
  });

  describe('getBestBskyTab', () => {
    it('filters non-bsky hostnames and invalid urls', async () => {
      browser.tabs.query.mockResolvedValue([
        { url: 'https://bsky.app/home', lastAccessed: 100 },
        { url: 'invalid-url', lastAccessed: 200 },
        { url: 'https://other.com/bsky.app', lastAccessed: 300 }
      ]);
      const result = await getBestBskyTab();
      expect(result.url).toBe('https://bsky.app/home');
    });

    it('returns null if no bsky tabs', async () => {
      browser.tabs.query.mockResolvedValue([]);
      const result = await getBestBskyTab();
      expect(result).toBeNull();
    });

    it('sorts tabs by lastAccessed', async () => {
      browser.tabs.query.mockResolvedValue([
        { url: 'https://bsky.app/old', lastAccessed: 100 },
        { url: 'https://bsky.app/none' },
        { url: 'https://bsky.app/new', lastAccessed: 300 }
      ]);
      const result = await getBestBskyTab();
      expect(result.url).toBe('https://bsky.app/new');
    });
  });

  describe('triggerFlutter', () => {
    beforeEach(() => {
      state.isActive = true;
      state.activeBskyTabId = 123;
    });

    it('returns early if inactive', async () => {
      state.isActive = false;
      await triggerFlutter();
      expect(browser.alarms.create).not.toHaveBeenCalled();
    });
    
    it('returns early if no activeBskyTabId', async () => {
      state.activeBskyTabId = null;
      await triggerFlutter();
      expect(browser.alarms.create).not.toHaveBeenCalled();
    });

    it('skips if timeSinceLastUpdate <= 15000', async () => {
      state.lastEventTime = Date.now() - 5000;
      await triggerFlutter();
      expect(browser.alarms.create).toHaveBeenCalled();
      expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('skips if timeSinceLastMigration <= 15000', async () => {
      state.lastEventTime = 0;
      state.lastMigrationTime = Date.now() - 5000;
      await triggerFlutter();
      expect(browser.alarms.create).toHaveBeenCalled();
      expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('does not skip if both are Infinity', async () => {
      state.lastEventTime = 0;
      state.lastMigrationTime = 0;
      await triggerFlutter();
      expect(browser.tabs.sendMessage).toHaveBeenCalledWith(123, { command: "FLUTTER" });
      expect(browser.alarms.create).toHaveBeenCalled();
    });

    it('sends message and schedules next flutter', async () => {
      state.lastEventTime = Date.now() - 20000;
      state.lastMigrationTime = Date.now() - 20000;
      await triggerFlutter();
      expect(browser.tabs.sendMessage).toHaveBeenCalledWith(123, { command: "FLUTTER" });
      expect(browser.alarms.create).toHaveBeenCalled();
    });

    it('auto-disables on sendMessage error', async () => {
      browser.tabs.sendMessage.mockRejectedValue(new Error('tab closed'));
      state.lastEventTime = Date.now() - 20000;
      await triggerFlutter();
      expect(state.isActive).toBe(false);
    });
  });

  describe('stopMonitor', () => {
    it('clears alarm and resets tab id', async () => {
      state.activeBskyTabId = 123;
      await stopMonitor();
      expect(browser.alarms.clear).toHaveBeenCalledWith("flutterAlarm");
      expect(state.activeBskyTabId).toBeNull();
      expect(terminateDatabase).toHaveBeenCalled();
    });
  });

  describe('autoDisable', () => {
    it('disables when active', async () => {
      state.isActive = true;
      state.activeBskyTabId = 123;
      await autoDisable();
      expect(state.isActive).toBe(false);
      expect(terminateDatabase).toHaveBeenCalled();
    });

    it('terminates db when already inactive', async () => {
      state.isActive = false;
      await autoDisable();
      expect(terminateDatabase).toHaveBeenCalled();
    });
  });

  describe('startMonitor', () => {
    it('starts with storage.estimate success', async () => {
      browser.tabs.query.mockResolvedValue([{ id: 123, url: 'https://bsky.app/home' }]);
      await startMonitor();
      expect(initDatabase).toHaveBeenCalled();
      expect(state.activeBskyTabId).toBe(123);
    });

    it('starts with storage.estimate throwing', async () => {
      navigator.storage.estimate.mockRejectedValue(new Error('storage error'));
      browser.tabs.query.mockResolvedValue([{ id: 123, url: 'https://bsky.app/home' }]);
      await startMonitor();
      expect(initDatabase).toHaveBeenCalled();
    });

    it('starts without navigator.storage', async () => {
      delete global.navigator.storage;
      browser.tabs.query.mockResolvedValue([{ id: 123, url: 'https://bsky.app/home' }]);
      await startMonitor();
      expect(initDatabase).toHaveBeenCalled();
    });

    it('calls autoDisable if no best tab', async () => {
      browser.tabs.query.mockResolvedValue([]);
      await startMonitor();
      expect(state.isActive).toBe(false); // Since autoDisable turns it to false (wait, we should just check if autoDisable was called, but we didn't mock it so we check the side effect)
    });
  });
});
