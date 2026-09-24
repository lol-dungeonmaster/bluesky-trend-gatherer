const fs = require('fs');
const path = require('path');

describe("Popup UI", () => {
    beforeEach(() => {
        const html = fs.readFileSync(path.resolve(__dirname, '../src/popup.html'), 'utf8');
        document.documentElement.innerHTML = html;
        jest.clearAllMocks();
        browser.storage.local.get.mockResolvedValue({ fontSizeMultiplier: "1.25" });
        browser.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.command === "GET_STATE") return { isActive: true, hasCheckedAuth: true };
            if (msg.command === "GET_TREND_MOMENT") return { total: 0, moment: null };
            return {};
        });
        global.calculateDeltas = jest.fn().mockReturnValue({ rankDiffStr: "New", pcDiffStr: "", acDiffStr: "", timeUnchangedStr: "" });
    });

    it("should set font size CSS variables and active button state on load", async () => {
        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));
        expect(browser.storage.local.get).toHaveBeenCalledWith(["fontSizeMultiplier"]);
        expect(document.documentElement.style.getPropertyValue('--font-mult')).toBe("1.25");
        const activeBtn = document.querySelector('.font-btn.active');
        expect(activeBtn).not.toBeNull();
        expect(activeBtn.dataset.size).toBe("1.25");
    });

    it("should save new font size to storage when clicked", async () => {
        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));
        const largestBtn = document.querySelector('button[data-size="1.5"]');
        largestBtn.click();
        await new Promise(r => setTimeout(r, 50));
        expect(document.documentElement.style.getPropertyValue('--font-mult')).toBe("1.5");
        expect(browser.storage.local.set).toHaveBeenCalledWith({ fontSizeMultiplier: "1.5" });
    });

    it("should toggle the background monitor when switch is clicked", async () => {
        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));
        const toggle = document.getElementById("monitorToggle");
        expect(toggle.checked).toBe(true);
        toggle.click();
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ command: "SET_STATE", isActive: false });
    });

    it("should render empty state if totalMoments is 0", async () => {
        browser.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.command === "GET_STATE") return { isActive: true, totalMoments: 0, hasCheckedAuth: true };
            if (msg.command === "GET_TREND_MOMENT") return { total: 0, moment: null };
            return {};
        });
        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));
        const trendTimestamp = document.getElementById("trendTimestamp");
        const trendList = document.getElementById("trendList");
        expect(trendTimestamp.innerHTML).toContain("No Data");
        expect(trendList.innerHTML).toContain("Database is empty.");
    });

    it("should generate UI cards when loadMoment receives valid data", async () => {
        browser.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.command === "GET_STATE") return { isActive: true, totalMoments: 1, quotaRemaining: 100, quotaReset: 1726671234, hasCheckedAuth: true };
            if (msg.command === "GET_TREND_MOMENT") {
                return {
                    total: 1,
                    moment: {
                        captured_at: "2026-09-18 10:00:00",
                        raw_json: JSON.stringify([{ topic: "Alpha", postCount: 500, category: "News", description: "Test description", link: "/search?q=Alpha" }])
                    },
                    history: []
                };
            }
            return {};
        });
        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));
        const trendList = document.getElementById("trendList");
        expect(trendList.children.length).toBeGreaterThan(0);
        expect(trendList.innerHTML).toContain("Alpha");
        expect(trendList.innerHTML).toContain("500 posts");
        expect(trendList.innerHTML).toContain("News");
    });

    it("should handle pagination buttons for newer and older moments", async () => {
        browser.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.command === "GET_STATE") return { isActive: true, totalMoments: 5 };
            if (msg.command === "GET_TREND_MOMENT") return { total: 5, moment: { captured_at: "2026-09-18 10:00:00", raw_json: "[]" }, history: [] };
            return {};
        });
        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));
        
        const btnPrev = document.getElementById("btnPrev");
        const btnNext = document.getElementById("btnNext");
        
        btnPrev.click();
        await new Promise(r => setTimeout(r, 10));
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ command: "GET_TREND_MOMENT", offset: 1, target_ts: null });
        
        btnNext.click();
        await new Promise(r => setTimeout(r, 10));
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ command: "GET_TREND_MOMENT", offset: 0, target_ts: null });
    });

    it("should update auth status and handle background messages", async () => {
        let messageListener = null;
        browser.runtime.onMessage.addListener.mockImplementation((cb) => { messageListener = cb; });
        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));

        messageListener({ command: "AUTH_STATUS", rateLimit: { remaining: 45, limit: 3000, reset: 1726671234 }, isLoggedIn: true });
        const authStatus = document.getElementById("authStatus");
        expect(authStatus.innerHTML).toContain("Quota: ");
        
        browser.runtime.sendMessage.mockResolvedValueOnce({ total: 1, moment: { captured_at: "2026-09-18 10:00:00", raw_json: "[]" }, history: [] });
        messageListener({ command: "TREND_ADDED" });
        await new Promise(r => setTimeout(r, 10));
    });

    it("should process URL navigation when clicking topic links", async () => {
        browser.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.command === "GET_STATE") return { isActive: true, totalMoments: 1, hasCheckedAuth: true };
            if (msg.command === "GET_TREND_MOMENT") {
                return {
                    total: 1,
                    moment: { captured_at: "2026-09-18 10:00:00", raw_json: JSON.stringify([{ topic: "Alpha", link: "/search?q=Alpha" }]) },
                    history: []
                };
            }
            return {};
        });
        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));

        const trendList = document.getElementById("trendList");
        const linkBtn = trendList.querySelector("button"); 
        if (linkBtn) linkBtn.click();
        
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ command: "NAVIGATE", url: "https://bsky.app/search?q=Alpha" });
    });

    it("should open options page when gear icon is clicked", async () => {
        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));
        
        jest.spyOn(window, 'close').mockImplementation(() => {});
        const optionsBtn = document.getElementById("btnOptions");
        optionsBtn.click();
        
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ command: "OPEN_OPTIONS_PAGE" });
        await new Promise(r => setTimeout(r, 50));
    });

    it("should render and interact with top actors popover", async () => {
        browser.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.command === "GET_STATE") return { isActive: true, totalMoments: 1, hasCheckedAuth: true };
            if (msg.command === "GET_TREND_MOMENT") {
                return {
                    total: 1,
                    moment: { 
                        captured_at: "2026-09-18 10:00:00", 
                        raw_json: JSON.stringify([{ 
                            topic: "Alpha", 
                            link: "/search?q=Alpha",
                            actors: [
                                { handle: "user1.bsky.social", displayName: "User 1", avatar: "http://example.com/a.jpg", did: "did:plc:1" }
                            ]
                        }]) 
                    },
                    history: [{
                        raw_json: JSON.stringify([{ 
                            topic: "Alpha",
                            actors: [
                                { handle: "user2.bsky.social", did: "did:plc:2" }
                            ]
                        }])
                    }]
                };
            }
            return {};
        });
        
        // Mock getBoundingClientRect for collision detection
        Element.prototype.getBoundingClientRect = jest.fn(() => ({
            top: 500, bottom: 550, left: 10, right: 100, width: 90, height: 50
        }));
        
        window.innerWidth = 800;
        window.innerHeight = 600;

        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));

        // Find the actor trigger span
        const trendList = document.getElementById("trendList");
        const actorsSpan = Array.from(trendList.querySelectorAll("span")).find(s => s.classList.contains("actors-trigger"));

        if (!actorsSpan) { console.log(trendList.innerHTML); }
        expect(actorsSpan).toBeDefined();
        
        // Open popover
        actorsSpan.click();
        await new Promise(r => setTimeout(r, 10));
        
        // Because bottom (550) + popRect.height (50) > innerHeight - 10 (590), it should render! Wait, 550 + 50 = 600 > 590, yes.
        // Let's just check if it's in the DOM
        let popover = document.getElementById('app').lastChild;
        expect(popover.style.position).toBe("absolute");
        
        // Click inside popover avatar to navigate
        const avatarWrapper = popover.querySelector('div[style*="cursor: pointer"]');
        if (avatarWrapper) avatarWrapper.click();
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ command: "NAVIGATE", url: "https://bsky.app/profile/user1.bsky.social" });
        
        // Click outside to close
        document.dispatchEvent(new Event("click"));
        expect(document.getElementById('app').contains(popover)).toBe(false);
        
        // Click again to reopen, then click itself to toggle close
        actorsSpan.click();
        await new Promise(r => setTimeout(r, 10));
        expect(document.getElementById('app').lastChild.style.position).toBe("absolute");
        actorsSpan.click();
        await new Promise(r => setTimeout(r, 10));
        // Should be closed now
        
        // Clean up
        Element.prototype.getBoundingClientRect.mockRestore();
    });
});
