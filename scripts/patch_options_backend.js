const fs = require('fs');
let code = fs.readFileSync('src/background.src.js', 'utf8');

const targetStr = `browser.runtime.onMessage.addListener(async (message) => {
    if (message.command === "GET_STATE") {`;
const replacement = `browser.runtime.onMessage.addListener(async (message) => {
    if (message.command === "OPEN_OPTIONS_PAGE") {
        (async () => {
            try {
                if (activeBskyTabId) {
                    const tab = await browser.tabs.get(activeBskyTabId);
                    if (tab && tab.windowId !== undefined) {
                        await browser.tabs.create({
                            url: browser.runtime.getURL("src/options.html"),
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
    if (message.command === "GET_STATE") {`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('src/background.src.js', code);
