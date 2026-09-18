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
        async open() {}
        async connect() { 
            return { 
                query: jest.fn().mockResolvedValue({ toArray: () => [] }),
                close: jest.fn()
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
});
