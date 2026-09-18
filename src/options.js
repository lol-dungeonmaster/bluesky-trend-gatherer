document.getElementById('btn-export').addEventListener('click', () => {
    browser.runtime.sendMessage({ command: "EXPORT" });
    alert("Export started! Check your downloads folder in a moment.");
});

document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm("Are you sure? This will permanently delete all gathered trends.")) {
        browser.runtime.sendMessage({ command: "CLEAR" });
        alert("Database cleared!");
    }
});
