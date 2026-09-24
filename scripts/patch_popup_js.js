const fs = require('fs');
let code = fs.readFileSync('src/popup.js', 'utf8');

const target1 = `async function loadMoment(offset, isSilentRefresh = false) {`;
const repl1 = `async function loadMoment(offset, isSilentRefresh = false, target_ts = null) {`;
code = code.replace(target1, repl1);

const target2 = `const res = await browser.runtime.sendMessage({ command: "GET_TREND_MOMENT", offset: offset });`;
const repl2 = `const res = await browser.runtime.sendMessage({ command: "GET_TREND_MOMENT", offset: offset, target_ts: target_ts });`;
code = code.replace(target2, repl2);

const target3 = `currentOffset = offset;
        updateNavButtons();`;
const repl3 = `currentOffset = res.offset !== undefined ? res.offset : offset;
        browser.storage.local.set({ 
            saved_trend_ts: currentOffset === 0 ? null : res.moment.captured_at 
        });
        updateNavButtons();`;
code = code.replace(target3, repl3);

const target4 = `loadMoment(0, false);`;
const repl4 = `browser.storage.local.get("saved_trend_ts").then(data => {
        if (data.saved_trend_ts) {
            loadMoment(0, false, data.saved_trend_ts);
        } else {
            loadMoment(0, false);
        }
    });`;
code = code.replace(target4, repl4);

fs.writeFileSync('src/popup.js', code);
