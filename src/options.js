
// Load existing credentials
browser.storage.local.get(["bskyHandle", "bskyPassword"]).then(data => {
    if (data.bskyHandle) document.getElementById('bsky-handle').value = data.bskyHandle;
    if (data.bskyPassword) document.getElementById('bsky-password').value = data.bskyPassword;
});

document.getElementById('btn-save-auth').addEventListener('click', async () => {
    const handle = document.getElementById('bsky-handle').value.trim();
    const password = document.getElementById('bsky-password').value.trim();
    const statusMsg = document.getElementById('auth-status-msg');
    
    if (!handle && !password) {
        await browser.storage.local.remove(["bskyHandle", "bskyPassword"]);
        statusMsg.textContent = "Cleared (Falling back to passive capability)";
        statusMsg.style.color = "#ef4444";
        browser.runtime.sendMessage({ command: "AUTH_CREDENTIALS_UPDATED" });
    } else {
        await browser.storage.local.set({ bskyHandle: handle, bskyPassword: password });
        statusMsg.textContent = "Saved! Authenticating in background...";
        statusMsg.style.color = "#4ade80";
        browser.runtime.sendMessage({ command: "AUTH_CREDENTIALS_UPDATED" });
    }
    
    setTimeout(() => { statusMsg.textContent = ""; }, 3000);
});

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
