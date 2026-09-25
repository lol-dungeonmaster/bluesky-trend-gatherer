
jest.mock('parquet-wasm/esm/parquet_wasm.js', () => {
    return {
        __esModule: true,
        default: jest.fn().mockResolvedValue(true),
        writeParquet: jest.fn().mockReturnValue(new Uint8Array(10)),
        readParquet: jest.fn().mockReturnValue({ intoIPCStream: jest.fn().mockReturnValue(new Uint8Array(10)) }),
        Table: { fromIPCStream: jest.fn().mockReturnValue({}) },
        WriterPropertiesBuilder: class { setCompression() { return this; } build() { return {}; } },
        Compression: { ZSTD: 1, SNAPPY: 2 }
    };
}, { virtual: true });

jest.mock('apache-arrow', () => ({
    tableToIPC: jest.fn().mockReturnValue(new Uint8Array(10)),
    tableFromIPC: jest.fn().mockReturnValue({ toArray: jest.fn().mockReturnValue([]) }),
    vectorFromArray: jest.fn().mockReturnValue({}),
    Table: class {}
}));
const { TextEncoder, TextDecoder } = require("util");
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ fillStyle: "", beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), quadraticCurveTo: jest.fn(), closePath: jest.fn(), fill: jest.fn(), font: "", textAlign: "", textBaseline: "", stroke: jest.fn(), fillText: jest.fn(), getImageData: jest.fn(() => ({ data: [] })) }));
global.mockQuery = jest.fn().mockImplementation((sql) => {
    if (sql && sql.includes("gap_ms, raw_json FROM trends ORDER BY captured_at ASC")) {
        return Promise.resolve({ toArray: () => [
            { captured_at: 1000, gap_ms: 10000, raw_json: JSON.stringify([{topic: "test1"}]) },
            { captured_at: 2000, gap_ms: 5000, raw_json: JSON.stringify([{topic: "test1"}, {topic: "test2"}]) }
        ]});
    }
    if (sql && sql.includes("COUNT(*) as total")) {
        return Promise.resolve({ toArray: () => [{ total: 10 }] });
    }
    if (sql && sql.includes("LIMIT 1 OFFSET")) {
        return Promise.resolve({ toArray: () => [{ captured_at: 1000, raw_json: JSON.stringify([{topic: "test"}]) }] });
    }
    if (sql && sql.includes("SELECT * FROM trends")) {
        return Promise.resolve({ 
            toArray: () => [{ captured_at: 1000, gap_ms: 0, raw_json: JSON.stringify([{topic: "export_test"}]) }] 
        });
    }
    if (sql && sql.includes("SELECT COUNT(*) as c FROM trends")) {
        return Promise.resolve({ toArray: () => [{ c: 1 }] });
    }
    return Promise.resolve({ toArray: () => [] });
});
const fs = require('fs');
const path = require('path');

jest.mock('@duckdb/duckdb-wasm', () => ({
    ConsoleLogger: class {},
    VoidLogger: class {},
    getJsDelivrBundles: jest.fn().mockReturnValue({}),
    selectBundle: jest.fn().mockResolvedValue({ mainModule: '', mainWorker: '' }),
    createWorker: jest.fn().mockResolvedValue({}),
    DuckDBDataProtocol: { BROWSER_FSFS: 0 },
    DuckDBAccessMode: { READ_WRITE: 1 },
    AsyncDuckDB: class {
        constructor() {}
        async instantiate() {}
        async registerFileBuffer() {}
        async open() {}
        async connect() { 
            return { 
                query: global.mockQuery,
                close: jest.fn(),
                prepare: jest.fn().mockResolvedValue({
                    query: global.mockQuery,
                    close: jest.fn()
                })
            };
        }
    }
}));

describe("Background Script", () => {
    let messageListeners = [];
    let alarmListeners = [];
    let requestListeners = [];
    let headersReceivedListeners = [];
    let tabsActivatedListeners = [];
    let tabsUpdatedListeners = [];
    let beforeRequestListeners = [];

    beforeEach(() => {
        jest.clearAllMocks();
        global.crypto = {
            subtle: {
                digest: jest.fn().mockResolvedValue(new ArrayBuffer(8))
            }
        };
        global.TextDecoder = require("util").TextDecoder;
        global.Worker = class { constructor() {} };

        // Mock OPFS API
        global.navigator = {
            storage: {
                getDirectory: jest.fn().mockResolvedValue({
                    getFileHandle: jest.fn().mockRejectedValue(new Error("File not found"))
                })
            }
        };

        if (!browser.webRequest) browser.webRequest = {};
        if (!browser.webRequest.onBeforeSendHeaders) browser.webRequest.onBeforeSendHeaders = { addListener: jest.fn() };
        if (!browser.webRequest.onHeadersReceived) browser.webRequest.onHeadersReceived = { addListener: jest.fn() };
        if (!browser.webRequest.onBeforeRequest) browser.webRequest.onBeforeRequest = { addListener: jest.fn() };
        if (!browser.tabs) browser.tabs = {};
        if (!browser.tabs.onActivated) browser.tabs.onActivated = { addListener: jest.fn() };
        if (!browser.tabs.onUpdated) browser.tabs.onUpdated = { addListener: jest.fn() };
        if (!browser.tabs.onRemoved) browser.tabs.onRemoved = { addListener: jest.fn() };
        if (!global.crypto.subtle) global.crypto.subtle = { digest: jest.fn().mockResolvedValue(new ArrayBuffer(20)) };
        if (!browser.tabs.onReplaced) browser.tabs.onReplaced = { addListener: jest.fn() };
        browser.tabs.query = jest.fn().mockResolvedValue([{ id: 1, url: "https://bsky.app" }]);

        // Capture listeners
        browser.runtime.onMessage.addListener.mockImplementation((cb) => messageListeners.push(cb));
        browser.alarms.onAlarm.addListener.mockImplementation((cb) => alarmListeners.push(cb));
        browser.webRequest.onBeforeSendHeaders.addListener.mockImplementation((cb, filter, extra) => requestListeners.push(cb));
        browser.webRequest.onHeadersReceived.addListener.mockImplementation((cb, filter, extra) => headersReceivedListeners.push(cb));
        browser.tabs.onActivated.addListener.mockImplementation((cb) => tabsActivatedListeners.push(cb));
        browser.tabs.onUpdated.addListener.mockImplementation((cb) => tabsUpdatedListeners.push(cb));
        browser.webRequest.onBeforeRequest.addListener.mockImplementation((cb) => beforeRequestListeners.push(cb));

        // Mock generic runtime/storage
        browser.storage.local.get.mockResolvedValue({ eventCount: 5 });
        browser.storage.local.remove.mockResolvedValue();
        browser.storage.local.set.mockResolvedValue();
        
        browser.browserAction = {
            setIcon: jest.fn(),
            setBadgeText: jest.fn(),
            setBadgeBackgroundColor: jest.fn(),
            setTitle: jest.fn()
        };
        browser.action = {
            setBadgeText: jest.fn(),
            setBadgeBackgroundColor: jest.fn(),
            setTitle: jest.fn()
        };
    });

    afterEach(() => {
        messageListeners = [];
        alarmListeners = [];
        requestListeners = [];
        headersReceivedListeners = [];
        tabsActivatedListeners = [];
        tabsUpdatedListeners = [];
        beforeRequestListeners = [];
        jest.resetModules();
    });

    it("should initialize cleanly and attach listeners", async () => {
        jest.isolateModules(() => {
            require('../src/background.src.js');
        });
        
        // Wait for init
        await new Promise(r => setTimeout(r, 50));

        expect(browser.storage.local.get).toHaveBeenCalledWith(["eventCount"]);
        expect(browser.storage.local.remove).toHaveBeenCalledWith("isActive");
        expect(browser.runtime.onMessage.addListener).toHaveBeenCalled();
        expect(browser.webRequest.onHeadersReceived.addListener).toHaveBeenCalled();
        expect(browser.tabs.onActivated.addListener).toHaveBeenCalled();
    });

    it("should handle SET_STATE and GET_STATE commands via runtime messages", async () => {
        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));

        const onMessage = messageListeners[0];
        let sendResponse = jest.fn();

        // Turn ON
        const resSet = await onMessage({ command: "SET_STATE", isActive: true }, {}, sendResponse);
        expect(resSet).toEqual({ success: true });
        await new Promise(r => setTimeout(r, 50)); expect(browser.browserAction.setBadgeText).toHaveBeenCalled();

        // Get State
        const resGet = await onMessage({ command: "GET_STATE" }, {}, sendResponse);
        expect(resGet.isActive).toBe(true);
        await onMessage({ command: "SET_STATE", isActive: false }, {}, jest.fn());
    });

    it("should handle NAVIGATE commands", async () => {
        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));

        const onMessage = messageListeners[0];
        browser.tabs.create = jest.fn();

        await onMessage({ command: "NAVIGATE", url: "https://bsky.app" }, {}, jest.fn());
        expect(browser.tabs.create).toHaveBeenCalledWith({ url: "https://bsky.app", active: true });
    });

    it("should intercept and process Bluesky trends via webRequest", async () => {
        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));
        
        // Turn it ON first
        await messageListeners[0]({ command: "SET_STATE", isActive: true }, {}, jest.fn());

        const onBeforeRequest = requestListeners.find(cb => cb.name !== ""); // The webRequest listener logic
        // Actually, requestListeners holds onBeforeSendHeaders. 
        // headersReceivedListeners holds onHeadersReceived.
        
        const onHeadersReceived = headersReceivedListeners[0];
        const resHeader = onHeadersReceived({
            url: "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends",
            method: "GET",
            responseHeaders: [
                { name: "RateLimit-Remaining", value: "50" },
                { name: "RateLimit-Reset", value: "1726671234" },
                { name: "RateLimit-Limit", value: "3000" }
            ]
        });
        
        expect(resHeader).toBeUndefined(); // It doesn't return anything blocking
    });

    it("should handle CLEAR commands", async () => {
        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));

        const onMessage = messageListeners[0];
        
        // Mock query
        browser.storage.local.set = jest.fn();

        const resClear = await onMessage({ command: "CLEAR" }, {}, jest.fn());
        expect(resClear).toBeUndefined();
        expect(browser.storage.local.set).toHaveBeenCalledWith({ eventCount: 0 });
    });

    it("should handle EXPORT commands", async () => {
        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));

        const onMessage = messageListeners[0];
        
        browser.downloads = { download: jest.fn().mockResolvedValue(1) };
        global.URL.createObjectURL = jest.fn().mockReturnValue("blob:test");

        // The mock DuckDB connection needs to simulate OPFS getFileHandle
        Object.defineProperty(global.navigator, 'storage', {
            value: {
                getDirectory: jest.fn().mockResolvedValue({
                    getFileHandle: jest.fn().mockResolvedValue({
                        getFile: jest.fn().mockResolvedValue(new Blob(["test data"]))
                    })
                })
            },
            configurable: true
        });
        global.navigator.storage.getDirectory.mockResolvedValueOnce({
            getFileHandle: jest.fn().mockResolvedValue({
                getFile: jest.fn().mockResolvedValue(new Blob(["test data"]))
            })
        });

        const resExport = await onMessage({ command: "EXPORT" }, {}, jest.fn());
        
        expect(browser.downloads.download).toHaveBeenCalled();
    });

    it("should handle GET_TREND_MOMENT commands", async () => {
        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));

        const onMessage = messageListeners[0];
        
        // We must mock conn.query for this
        // But conn is hidden inside the module. The global mock returns { query: jest.fn() }
        // We can just rely on the global mock which returns empty array.
        
        const resMoment = await onMessage({ command: "GET_TREND_MOMENT", offset: 0 }, {}, jest.fn());
        
        expect(resMoment.total).toBeDefined();
        expect(resMoment.moment).toBeDefined();
        
    });

    it("should intercept GET requests and filter payload data", async () => {
        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));
        await messageListeners[0]({ command: "SET_STATE", isActive: true }, {}, jest.fn());

        const filterMock = {
            onstart: null,
            ondata: null,
            onstop: null,
            write: jest.fn(),
            disconnect: jest.fn(),
            close: jest.fn()
        };
        browser.webRequest.filterResponseData = jest.fn().mockReturnValue(filterMock);

        const onBeforeRequest = beforeRequestListeners[0];
        
        onBeforeRequest({
            requestId: "123",
            method: "GET",
            url: "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends"
        });

        // Trigger ondata
        const { TextEncoder } = require("util"); const encoder = new TextEncoder();
        const dummyData = JSON.stringify({ trends: [{ topic: "test", link: "/search?q=test", description: "testing" }] });
        filterMock.ondata({ data: encoder.encode(dummyData).buffer });
        await new Promise(r => setTimeout(r, 50));
        
        // Trigger onstop
        filterMock.onstop();
        
        expect(browser.webRequest.filterResponseData).toHaveBeenCalledWith("123");
        expect(filterMock.write).toHaveBeenCalled();
        expect(filterMock.disconnect).toHaveBeenCalled();
    });

    it("should process RateLimit headers correctly in onHeadersReceived", async () => {
        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));
        await messageListeners[0]({ command: "SET_STATE", isActive: true }, {}, jest.fn());

        const onHeadersReceived = headersReceivedListeners[0];
        
        onHeadersReceived({
            url: "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends",
            method: "GET",
            responseHeaders: [
                { name: "ratelimit-remaining", value: "45" },
                { name: "ratelimit-reset", value: "1726671234" },
                { name: "ratelimit-limit", value: "3000" }
            ]
        });

        // We check if it sent a message to the popup
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            command: "AUTH_STATUS",
            rateLimit: { remaining: "45", reset: "1726671234", limit: "3000", policy: null },
            isLoggedIn: true
        });
    });
    it("should process IMPORT commands and handle Parquet files", async () => {
        global.mockQuery.mockReset();
        global.mockQuery.mockResolvedValue({ toArray: () => [] }); // default fallback

        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));
        await messageListeners[0]({ command: "SET_STATE", isActive: true }, {}, jest.fn());
        await new Promise(r => setTimeout(r, 50));

        const onMessage = messageListeners[0];
        
        // Mock query sequence
        global.mockQuery
            .mockResolvedValueOnce({ toArray: () => [{ captured_at: "2024-01-01T12:00:00.000Z" }] }) // SELECT captured_at
            .mockResolvedValueOnce({ 
                toArray: () => [
                    { captured_at: "2024-01-01T12:00:00.000Z", raw_json: "[]" }, // Duplicate, should be skipped
                    { captured_at: "2024-01-01T12:01:00.000Z", raw_json: "[]", gap_ms: 50, viewer_did: "abc", is_flutter: false, payload_hash: "hash" }, // Valid
                    { captured_at: 1726671234000, raw_json: "[]" }, // Valid Number
                    { captured_at: new Date(), raw_json: "[]" }, // Valid Date
                    { captured_at: null } // Corrupt
                ] 
            }) // SELECT * FROM 'import.parquet'
            .mockResolvedValueOnce({}) // INSERT INTO
            .mockResolvedValueOnce({ toArray: () => [{ toJSON: () => ({ c: 8 }) }] }) // SELECT COUNT
            .mockResolvedValueOnce({ toArray: () => [] }); // rebuild longevity

        const dummyFile = {
            arrayBuffer: async () => new ArrayBuffer(10)
        };
        
        await onMessage({ command: "IMPORT", file: dummyFile }, {}, jest.fn());
        
        // Insert query is now handled by prepared statements
        expect(browser.storage.local.set).toHaveBeenCalledWith({ eventCount: 8 });
    });


    it("should handle corrupted JSON gracefully in filterResponseData", async () => {
        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));
        await messageListeners[0]({ command: "SET_STATE", isActive: true }, {}, jest.fn());

        let filterMock = {
            ondata: jest.fn(),
            onstop: jest.fn(),
            write: jest.fn(),
            disconnect: jest.fn()
        };
        browser.webRequest.filterResponseData = jest.fn().mockReturnValue(filterMock);
        beforeRequestListeners[0]({ requestId: "999", method: "GET", url: "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends" });
        
        let encoder = new TextEncoder();
        filterMock.ondata({ data: encoder.encode("INVALID JSON {") });
        await filterMock.onstop();
        // Just checking that it doesn't throw and disconnects
        expect(filterMock.disconnect).toHaveBeenCalled();
    });

    it("should handle invalid Zod schema gracefully in filterResponseData", async () => {
        jest.isolateModules(() => { require('../src/background.src.js'); });
        await new Promise(r => setTimeout(r, 50));
        await messageListeners[0]({ command: "SET_STATE", isActive: true }, {}, jest.fn());

        let filterMock = {
            ondata: jest.fn(),
            onstop: jest.fn(),
            write: jest.fn(),
            disconnect: jest.fn()
        };
        browser.webRequest.filterResponseData = jest.fn().mockReturnValue(filterMock);
        beforeRequestListeners[0]({ requestId: "9992", method: "GET", url: "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends" });
        
        let encoder = new TextEncoder();
        // valid JSON, but missing required Zod fields (e.g. topic)
        filterMock.ondata({ data: encoder.encode(JSON.stringify([{ broken: "schema" }])) });
        await filterMock.onstop();
        expect(filterMock.disconnect).toHaveBeenCalled();
    });
});
