const fs = require('fs');
let code = fs.readFileSync('tests/popup.test.js', 'utf8');

const newTests = `
    it("should open options page when gear icon is clicked", async () => {
        jest.isolateModules(() => { require('../src/popup.js'); });
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await new Promise(r => setTimeout(r, 50));
        
        const optionsBtn = document.getElementById("optionsBtn");
        optionsBtn.click();
        
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ command: "OPEN_OPTIONS_PAGE" });
        expect(window.close).toHaveBeenCalled();
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
        const actorsSpan = Array.from(trendList.querySelectorAll("span")).find(s => s.innerText.includes("actors"));
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
`;

code = code.replace(/}\);\s*$/, newTests + '});\n');
fs.writeFileSync('tests/popup.test.js', code);
