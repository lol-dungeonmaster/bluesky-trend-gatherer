const fs = require('fs');
const path = require('path');

beforeEach(() => {
    const html = fs.readFileSync(path.resolve(__dirname, '../src/popup.html'), 'utf8');
    document.documentElement.innerHTML = html;
    jest.clearAllMocks();
    
    global.browser = {
        storage: {
            local: {
                get: jest.fn().mockResolvedValue({ fontSizeMultiplier: "1.25", saved_trend_ts: "2026-09-18" }),
                set: jest.fn().mockResolvedValue()
            }
        },
        runtime: {
            sendMessage: jest.fn().mockImplementation(async (msg) => {
                if (msg.command === "GET_STATE") return { isActive: true, hasCheckedAuth: true };
                if (msg.command === "GET_TREND_MOMENT") return { total: 0, moment: null };
                if (msg.command === "GET_AUTH_STATUS") return { hasCheckedAuth: true, isLoggedIn: true, rateLimit: { remaining: 100, limit: 100, reset: 1000000000 }};
                return {};
            }),
            onMessage: {
                addListener: jest.fn()
            }
        }
    };
    
    // reset state
    jest.isolateModules(() => {
        const { state } = require('../src/popup/state.js');
        state.currentOffset = 0;
        state.totalMoments = 0;
        state.currentRateLimit = null;
        state.isLoggedIn = false;
        state.hasCheckedAuth = false;
        state.activePopover = null;
        state.isScrolling = false;
    });
});

describe("Popup utils", () => {
    it("should format duration", () => {
        const { formatDuration, getCategoryColor, escapeHTML } = require('../src/popup/utils.js');
        expect(formatDuration(0)).toBe("0m");
        expect(formatDuration(60000)).toBe("1m");
        expect(formatDuration(3600000)).toBe("1h 0m");
        
        expect(getCategoryColor("sports").bg).toContain("hsla(30");
        expect(getCategoryColor("nonexistent").bg).toContain("hsla");
        expect(getCategoryColor("Uncategorized").bg).toContain("color-mix");
        
        expect(escapeHTML("<div class='test'>&</div>")).toBe("&lt;div class=&#39;test&#39;&gt;&amp;&lt;/div&gt;");
        expect(escapeHTML(null)).toBe(null);
    });
});

describe("Popup components", () => {
    it("should render actor avatar", async () => {
        const { buildActorAvatar, closePopover } = require('../src/popup/components.js');
        const { state } = require('../src/popup/state.js');
        
        const actor = { handle: "user.bsky.social", displayName: "User", did: "did:1" };
        const el = buildActorAvatar(actor, "#f00");
        
        // test closePopover down flip
        const dummy = document.createElement("div");
        dummy.dataset.isFlipped = "true";
        state.activePopover = dummy;
        closePopover();
        expect(state.activePopover).toBe(null);
        
        // test closePopover up flip
        const dummy2 = document.createElement("div");
        dummy2.dataset.isFlipped = "false";
        state.activePopover = dummy2;
        closePopover();
        
        const avatarClick = el.querySelector('div');
        await avatarClick.onclick(new Event('click'));
        expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({ command: "NAVIGATE", url: "https://bsky.app/profile/user.bsky.social" });
        
        // Mouseenter / Mouseleave
        Element.prototype.getBoundingClientRect = jest.fn(() => ({
            top: 50, bottom: 100, left: -10, right: 100, width: 50, height: 50
        }));
        
        el.dispatchEvent(new Event('mouseenter'));
        
        Element.prototype.getBoundingClientRect = jest.fn(() => ({
            top: 50, bottom: 100, left: 1000, right: 2000, width: 50, height: 50
        }));
        el.dispatchEvent(new Event('mouseenter'));

        el.dispatchEvent(new Event('mouseleave'));
    });
    
    it("should handle analysis mode success and failure", async () => {
        const { buildActorAvatar } = require('../src/popup/components.js');
        const actor = { handle: "u", avatar: "u.jpg" };
        const el = buildActorAvatar(actor, null, true, "topic");
        const av = el.querySelector('div');
        
        el.dispatchEvent(new Event('mouseenter'));
        
        global.browser.runtime.sendMessage = jest.fn().mockResolvedValue({ success: true });
        
        const e = new Event('click');
        e.preventDefault = jest.fn();
        e.stopPropagation = jest.fn();
        await av.onclick(e);
        
        // locked test
        await av.onclick(e);
        
        global.browser.runtime.sendMessage = jest.fn().mockRejectedValue(new Error("fail"));
        const el2 = buildActorAvatar(actor, null, true, "topic");
        await el2.querySelector('div').onclick(e);
        
        jest.useFakeTimers();
        const el3 = buildActorAvatar(actor, "red", true, "topic");
        global.browser.runtime.sendMessage = jest.fn().mockResolvedValue({ success: false });
        await el3.querySelector('div').onclick(e);
        jest.runAllTimers();
        jest.useRealTimers();
    });
});

describe("Popup index", () => {
    it("should init UI", async () => {
        jest.mock('../src/math_deltas.js', () => ({
            calculateDeltas: jest.fn().mockReturnValue({ rankDiffStr: "", pcDiffStr: "", acDiffStr: "", timeUnchangedStr: "", newActors: [], droppedActors: [] })
        }));

        const { loadMoment, updateAuthUI, updateNavButtons } = require('../src/popup/index.js');
        const { state } = require('../src/popup/state.js');
        
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));
        
        const btnNext = document.getElementById("btnNext");
        const btnPrev = document.getElementById("btnPrev");
        const btnOldest = document.getElementById("btnOldest");
        const btnNewest = document.getElementById("btnNewest");
        const trendList = document.getElementById("trendList");
        const scrollTopBtn = document.getElementById("scrollTopBtn");
        const toggle = document.getElementById("monitorToggle");
        
        expect(toggle.checked).toBe(true);
        toggle.click();
        
        const fontBtn = document.querySelector('button[data-size="1.5"]');
        fontBtn.click();
        
        trendList.scrollTop = 150;
        trendList.dispatchEvent(new Event('scroll'));
        
        trendList.scrollTop = 50;
        trendList.dispatchEvent(new Event('scroll'));

        btnNext.click();
        btnPrev.click();
        btnOldest.click();
        btnNewest.click();
        
        const btnOptions = document.getElementById("btnOptions");
        btnOptions.click();
        
        global.browser.runtime.sendMessage = jest.fn().mockResolvedValue({
            total: 2,
            offset: 0,
            moment: {
                captured_at: "2026-09-18 10:00:00",
                raw_json: JSON.stringify([{ topic: "Alpha", category: "sports", postCount: 5, actors: [{ handle: "user" }], timeInTop20Ms: 1000 }])
            },
            history: []
        });
        
        await loadMoment(0);
        
        btnNext.click();
        btnPrev.click();
        btnOldest.click();
        btnNewest.click();
        
        state.isLoggedIn = true;
        state.hasCheckedAuth = true;
        state.currentRateLimit = { remaining: 10, limit: 100, reset: Math.floor(Date.now()/1000) - 10 };
        updateAuthUI();
        
        state.currentRateLimit = { remaining: 10, limit: 100, reset: Math.floor(Date.now()/1000) + 100 };
        updateAuthUI();
        
        state.currentRateLimit = { remaining: 10, limit: 100, reset: 100 };
        updateAuthUI();
        
        state.isLoggedIn = false;
        updateAuthUI();
        
        const listener = global.browser.runtime.onMessage.addListener.mock.calls[0][0];
        listener({ command: "AUTH_STATUS", rateLimit: {}, isLoggedIn: true });
        
        // Add a trend with empty
        state.totalMoments = 0;
        listener({ command: "TREND_ADDED" });

        state.totalMoments = 1;
        state.currentOffset = 0;
        listener({ command: "TREND_ADDED" });
        
        // click actors popover
        const actorsSpan = document.querySelector('.actors-trigger');
        if (actorsSpan) actorsSpan.click();
        
        const postCountSpan = document.querySelector('.post-count-trigger');
        if (postCountSpan) postCountSpan.click();
        
        // wait so requestAnimationFrame finishes
        await new Promise(r => setTimeout(r, 50));
    });
    
    it("should handle error parsing", async () => {
        jest.mock('../src/math_deltas.js', () => ({
            calculateDeltas: jest.fn().mockReturnValue({})
        }));
        const { loadMoment } = require('../src/popup/index.js');
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));
        
        global.browser.runtime.sendMessage = jest.fn().mockResolvedValue({
            total: 1,
            offset: 0,
            moment: {
                captured_at: "2026-09-18 10:00:00",
                raw_json: "invalid"
            }
        });
        await loadMoment(0, true);
    });
    
    it("should handle raw json objects instead of array", async () => {
        const { loadMoment } = require('../src/popup/index.js');
        global.browser.runtime.sendMessage = jest.fn().mockResolvedValue({
            total: 1,
            offset: 0,
            moment: {
                captured_at: "2026-09-18 10:00:00",
                raw_json: JSON.stringify({ error: "bad" })
            }
        });
        await loadMoment(0);
    });
    
    it("should handle full popovers with multiple actors, new actors, dropped actors", async () => {
        jest.mock('../src/math_deltas.js', () => ({
            calculateDeltas: jest.fn().mockReturnValue({ newActors: ["did:2"], droppedActors: [{handle: "drop"}] })
        }));
        const { loadMoment, updateAuthUI } = require('../src/popup/index.js');
        const { state } = require('../src/popup/state.js');
        
        global.browser.runtime.sendMessage = jest.fn().mockResolvedValue({
            total: 2,
            offset: 0,
            moment: {
                captured_at: "2026-09-18 10:00:00",
                raw_json: JSON.stringify([{ topic: "Alpha", category: "sports", postCount: 5, link: "/search?q=Alpha", actors: [{ handle: "user", did: "did:1" }, { handle: "u2", did: "did:2" }], timeInTop20Ms: 1000 }])
            },
            history: [{ raw: "{}" }]
        });
        
        await loadMoment(0);
        
        const actorsSpan = document.querySelector('.actors-trigger');
        if (actorsSpan) {
            actorsSpan.click();
            await new Promise(r => requestAnimationFrame(r));
        }
        
        const linkBtn = document.querySelector('button[style*="text-decoration: underline"]');
        if (linkBtn) linkBtn.click();
        
        // updateAuthUI reset 0 test
        state.isLoggedIn = true;
        state.hasCheckedAuth = true;
        state.currentRateLimit = { remaining: 10, limit: 100, reset: 2000000000, policy: 3600 };
        const OriginalDateNow = Date.now;
        Date.now = () => 2000000000 * 1000;
        updateAuthUI();
        Date.now = OriginalDateNow;
    });
});
