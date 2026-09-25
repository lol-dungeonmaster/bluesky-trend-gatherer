import { initParquet, rebuildLongevityState, getDatabaseSizeStr, terminateDatabase, initDatabase } from '../src/background/db.js';
import { state } from '../src/background/state.js';
import * as duckdb from '@duckdb/duckdb-wasm';

jest.mock('@duckdb/duckdb-wasm', () => {
  const AsyncDuckDB = jest.fn();
  AsyncDuckDB.prototype.instantiate = jest.fn();
  AsyncDuckDB.prototype.open = jest.fn();
  AsyncDuckDB.prototype.connect = jest.fn();
  AsyncDuckDB.prototype.terminate = jest.fn();

  return {
    selectBundle: jest.fn().mockResolvedValue({ mainWorker: 'worker.js', mainModule: 'module.wasm', pthreadWorker: 'pthread.js' }),
    VoidLogger: jest.fn(),
    AsyncDuckDB: AsyncDuckDB
  };
});

jest.mock('../src/background/monitor.js', () => ({
  updateIcon: jest.fn()
}));

jest.mock('parquet-wasm/esm/parquet_wasm.js', () => ({
  default: jest.fn().mockResolvedValue()
}));

describe('db.js', () => {
  let originalStorage;

  beforeEach(() => {
    state.parquetWasmInitialized = false;
    state.conn = null;
    state.db = null;
    state.isInitializing = false;
    state.longevityState = {};
    state.previousTopics = new Set();
    
    global.browser = {
      runtime: {
        getURL: jest.fn().mockReturnValue('url')
      }
    };
    
    originalStorage = global.navigator.storage;
    Object.defineProperty(global.navigator, 'storage', {
      value: {
        estimate: jest.fn(),
        getDirectory: jest.fn()
      },
      configurable: true
    });
    
    global.Worker = jest.fn();
    
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  
  afterEach(() => {
    Object.defineProperty(global.navigator, 'storage', {
      value: originalStorage,
      configurable: true
    });
    jest.restoreAllMocks();
  });

  describe('initParquet', () => {
    it('initializes parquet wasm', async () => {
      await initParquet();
      expect(state.parquetWasmInitialized).toBe(true);
      await initParquet(); // second time should not re-initialize
    });
  });

  describe('rebuildLongevityState', () => {
    it('bails if no connection', async () => {
      await rebuildLongevityState();
      expect(state.longevityState).toEqual({});
    });

    it('rebuilds longevity state from db records', async () => {
      const mockQuery = jest.fn().mockResolvedValue({
        toArray: () => [
          { gap_ms: 100, raw_json: JSON.stringify([{ topic: 'a' }, { topic: 'b' }]), toJSON: () => ({ gap_ms: 100, raw_json: JSON.stringify([{ topic: 'a' }, { topic: 'b' }]) }) }, // covers toJSON true
          { gap_ms: 200, raw_json: [{ topic: 'a' }, { topic: 'c' }, { topic: '' }, null, {}] }, // covers t && t.topic false cases
          { gap_ms: 300, raw_json: 'invalid json' }, // catch block for JSON.parse
          { gap_ms: 50, raw_json: JSON.stringify([{ topic: 'c' }]) },
          { gap_ms: undefined, raw_json: [{ topic: 'c' }] }, // covers r.gap_ms || 0
          { gap_ms: 10, raw_json: { not: 'an array' } } // covers Array.isArray(arr) false
        ]
      });
      state.conn = { query: mockQuery };

      await rebuildLongevityState();

      expect(state.longevityState).toEqual({
        'a': 200, // second row
        'b': 0,
        'c': 0 // c is cleared on row 3, re-added row 4 with 50 (wait, is it re-added with 0?), then row 5 adds 0
      });
    });

    it('catches and logs error', async () => {
      state.conn = { query: jest.fn().mockRejectedValue(new Error('db error')) };
      await rebuildLongevityState();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('getDatabaseSizeStr', () => {
    it('returns size in Bytes', async () => {
      global.navigator.storage.estimate.mockResolvedValue({ usage: 500 });
      const size = await getDatabaseSizeStr();
      expect(size).toBe('500 B');
    });

    it('returns 0 B if estimate returns null or no usage', async () => {
      global.navigator.storage.estimate.mockResolvedValue(null);
      let size = await getDatabaseSizeStr();
      expect(size).toBe('0 B');
      
      global.navigator.storage.estimate.mockResolvedValue({ quota: 100 }); // missing usage
      size = await getDatabaseSizeStr();
      expect(size).toBe('0 B');
    });

    it('returns size in KB', async () => {
      global.navigator.storage.estimate.mockResolvedValue({ usage: 1024 * 500 });
      const size = await getDatabaseSizeStr();
      expect(size).toBe('500.0 KB');
    });

    it('returns size in MB', async () => {
      global.navigator.storage.estimate.mockResolvedValue({ usage: 1024 * 1024 * 5 });
      const size = await getDatabaseSizeStr();
      expect(size).toBe('5.0 MB');
    });

    it('returns 0 B on error', async () => {
      global.navigator.storage.estimate.mockRejectedValue(new Error('err'));
      const size = await getDatabaseSizeStr();
      expect(size).toBe('0 B');
    });
    
    it('returns 0 B if no navigator.storage', async () => {
      Object.defineProperty(global.navigator, 'storage', {
        value: undefined,
        configurable: true
      });
      const size = await getDatabaseSizeStr();
      expect(size).toBe('0 B');
    });
  });

  describe('terminateDatabase', () => {
    it('closes connection and terminates db', async () => {
      state.conn = { close: jest.fn().mockResolvedValue() };
      state.db = { terminate: jest.fn().mockResolvedValue() };

      await terminateDatabase();

      expect(state.conn).toBeNull();
      expect(state.db).toBeNull();
    });

    it('catches close/terminate errors silently', async () => {
      state.conn = { close: jest.fn().mockRejectedValue(new Error('err')) };
      state.db = { terminate: jest.fn().mockRejectedValue(new Error('err')) };

      await terminateDatabase();

      expect(state.conn).toBeNull();
      expect(state.db).toBeNull();
    });
  });

  describe('initDatabase', () => {
    let mockConn;
    let mockDbInstance;

    beforeEach(() => {
      mockConn = {
        query: jest.fn().mockResolvedValue({ toArray: () => [] }),
        close: jest.fn()
      };
      
      mockDbInstance = {
        instantiate: jest.fn(),
        open: jest.fn(),
        connect: jest.fn().mockResolvedValue(mockConn),
        terminate: jest.fn()
      };
      
      duckdb.AsyncDuckDB.mockImplementation(() => mockDbInstance);
    });

    it('bails if already initializing or db exists', async () => {
      state.db = {};
      await initDatabase();
      expect(duckdb.selectBundle).not.toHaveBeenCalled();

      state.db = null;
      state.isInitializing = true;
      await initDatabase();
      expect(duckdb.selectBundle).not.toHaveBeenCalled();
    });

    it('initializes duckdb successfully on first try', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('information_schema.columns')) {
          return Promise.resolve({ toArray: () => [{ toJSON: () => ({ column_name: 'test' }) }] });
        }
        return Promise.resolve({ toArray: () => [] });
      });

      await initDatabase(true);

      expect(state.db).toBeDefined();
      expect(state.conn).toBeDefined();
      expect(mockDbInstance.open).toHaveBeenCalledWith({ path: 'opfs://bluesky_trends.db', accessMode: 3 });
      expect(mockConn.query).toHaveBeenCalled();
      expect(state.isInitializing).toBe(false);
    });

    it('handles opfs quota > 95%', async () => {
      global.navigator.storage.estimate.mockResolvedValue({ usage: 96, quota: 100 });
      mockConn.query.mockImplementation((q) => {
        if (q.includes('information_schema.columns')) {
          return Promise.resolve({ toArray: () => [{ toJSON: () => ({ column_name: 'viewer_did' }) }, { toJSON: () => ({ column_name: 'is_flutter' }) }, { toJSON: () => ({ column_name: 'gap_ms' }) }, { toJSON: () => ({ column_name: 'payload_hash' }) }] });
        }
        return Promise.resolve({ toArray: () => [] });
      });

      await initDatabase(true);

      expect(mockConn.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM trends'));
      expect(mockConn.query).toHaveBeenCalledWith('VACUUM');
      expect(mockConn.query).toHaveBeenCalledWith('CHECKPOINT');
    });

    it('does not vacuum if opfs quota <= 95% or missing fields', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('information_schema.columns')) {
          return Promise.resolve({ toArray: () => [] });
        }
        return Promise.resolve({ toArray: () => [] });
      });

      // missing quota
      global.navigator.storage.estimate.mockResolvedValue({ usage: 96 });
      await initDatabase(true);
      expect(mockConn.query).not.toHaveBeenCalledWith('VACUUM');
      state.db = null; state.isInitializing = false;

      // <= 95%
      global.navigator.storage.estimate.mockResolvedValue({ usage: 95, quota: 100 });
      await initDatabase(true);
      expect(mockConn.query).not.toHaveBeenCalledWith('VACUUM');
      state.db = null; state.isInitializing = false;
      
      // est is null
      global.navigator.storage.estimate.mockResolvedValue(null);
      await initDatabase(true);
      expect(mockConn.query).not.toHaveBeenCalledWith('VACUUM');
    });

    it('retries on open failure and eventually wipes opfs', async () => {
      mockDbInstance.open.mockRejectedValue(new Error('locked'));
      const mockRemoveEntry = jest.fn();
      global.navigator.storage.getDirectory.mockResolvedValue({
        removeEntry: mockRemoveEntry
      });

      // It will retry 5 times.
      // On the 5th failure (retries === 0), it will do the nuclear wipe.
      let openCallCount = 0;
      mockDbInstance.open.mockImplementation(() => {
        openCallCount++;
        if (openCallCount <= 5) {
          return Promise.reject(new Error('locked'));
        }
        return Promise.resolve(); // succeed after wipe
      });

      jest.useFakeTimers();
      
      const initPromise = initDatabase(true);
      await jest.runAllTimersAsync();
      await initPromise;
      jest.useRealTimers();

      expect(mockRemoveEntry).toHaveBeenCalledWith('bluesky_trends.db', { recursive: true });
      expect(mockRemoveEntry).toHaveBeenCalledWith('bluesky_trends.db.wal', { recursive: true });
      expect(state.db).toBeDefined();
    });

    it('catches and ignores removeEntry errors during wipe', async () => {
      const mockRemoveEntry = jest.fn().mockRejectedValue(new Error('not found'));
      global.navigator.storage.getDirectory.mockResolvedValue({
        removeEntry: mockRemoveEntry
      });

      let openCallCount = 0;
      mockDbInstance.open.mockImplementation(() => {
        openCallCount++;
        if (openCallCount <= 5) return Promise.reject(new Error('locked'));
        return Promise.resolve();
      });

      jest.useFakeTimers();
      const initPromise = initDatabase(true);
      await jest.runAllTimersAsync();
      await initPromise;
      jest.useRealTimers();

      expect(state.db).toBeDefined();
    });

    it('handles getDirectory failure during wipe', async () => {
      global.navigator.storage.getDirectory.mockRejectedValue(new Error('no opfs'));

      let openCallCount = 0;
      mockDbInstance.open.mockImplementation(() => {
        openCallCount++;
        if (openCallCount <= 5) return Promise.reject(new Error('locked'));
        return Promise.resolve();
      });

      jest.useFakeTimers();
      const initPromise = initDatabase(true);
      await jest.runAllTimersAsync();
      await initPromise;
      jest.useRealTimers();

      expect(state.db).toBeDefined();
    });

    it('handles conn close error during retry', async () => {
      mockConn.close.mockRejectedValue(new Error('err'));
      
      let openCallCount = 0;
      mockDbInstance.open.mockImplementation(() => {
        openCallCount++;
        if (openCallCount === 1) return Promise.resolve(); // open succeeds
        return Promise.resolve(); // subsequent opens succeed too
      });
      mockDbInstance.connect.mockImplementation(() => {
        if (openCallCount === 1) return Promise.resolve(mockConn); // connect succeeds
        return Promise.resolve(mockConn);
      });
      mockConn.query.mockImplementation((q) => {
        if (openCallCount === 1 && q === "CREATE TABLE IF NOT EXISTS _lock_test (id INT); DROP TABLE _lock_test;") {
          return Promise.reject(new Error('lock test failed')); // simulate write failure
        }
        return Promise.resolve({ toArray: () => [] });
      });

      jest.useFakeTimers();
      const initPromise = initDatabase(true);
      await jest.runAllTimersAsync();
      await initPromise;
      jest.useRealTimers();

      expect(mockConn.close).toHaveBeenCalled();
    });

    it('handles init error and resets isInitializing', async () => {
      duckdb.selectBundle.mockRejectedValue(new Error('bundle error'));
      await initDatabase();
      expect(state.isInitializing).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });
  });
});
