document.getElementById('btn-export').addEventListener('click', () => {
    browser.runtime.sendMessage({ command: "EXPORT" }).then((res) => {
        if (res && res.success) {
            alert("Export started! Check your downloads folder in a moment.");
        } else {
            alert("Export failed: " + (res ? res.error : "Unknown error"));
        }
    }).catch(e => alert("Export failed: " + e.message));
});

document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm("Are you sure? This will permanently delete all gathered trends.")) {
        browser.runtime.sendMessage({ command: "CLEAR" });
        alert("Database cleared!");
    }
});

document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-import').click();
});
document.getElementById('file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        await browser.runtime.sendMessage({ command: "IMPORT", file: file });
        alert("Import complete! Database restored.");
    } catch(err) {
        alert("Import failed: " + err.message);
    }
});
