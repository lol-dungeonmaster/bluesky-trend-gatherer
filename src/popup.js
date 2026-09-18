
function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
}

document.addEventListener("DOMContentLoaded", async () => {
    const fontBtns = document.querySelectorAll(".font-btn");
    async function applyFontSize(multiplier) {
        document.documentElement.style.setProperty('--font-mult', multiplier);
        fontBtns.forEach(b => {
            if (b.dataset.size == multiplier) b.classList.add("active");
            else b.classList.remove("active");
        });
        await browser.storage.local.set({ fontSizeMultiplier: multiplier });
    }
    fontBtns.forEach(btn => btn.addEventListener("click", () => applyFontSize(btn.dataset.size)));
    browser.storage.local.get(["fontSizeMultiplier"]).then(res => {
        applyFontSize(res.fontSizeMultiplier || "1");
    });

    const toggle = document.getElementById("monitorToggle");

    // Get current state from background script
    const response = await browser.runtime.sendMessage({ command: "GET_STATE" });
    if (response) {
        toggle.checked = response.isActive;
        toggle.parentElement.title = response.isActive ? "Disable Monitor" : "Enable Monitor";
    }

    // Listen for toggle changes
    toggle.addEventListener("change", async (e) => {
        const isChecked = e.target.checked;
        toggle.parentElement.title = isChecked ? "Disable Monitor" : "Enable Monitor";
        await browser.runtime.sendMessage({ 
            command: "SET_STATE", 
            isActive: isChecked 
        });
    });
});

    let currentOffset = 0;
    let totalMoments = 0;

    const btnPrev = document.getElementById("btnPrev");
    const btnNext = document.getElementById("btnNext");
    const trendTimestamp = document.getElementById("trendTimestamp");
    const trendList = document.getElementById("trendList");
    const scrollTopBtn = document.getElementById("scrollTopBtn");

    trendList.addEventListener("scroll", () => {
        if (trendList.scrollTop > 100) {
            scrollTopBtn.classList.add("visible");
        } else {
            scrollTopBtn.classList.remove("visible");
        }
    });

    scrollTopBtn.addEventListener("click", () => {
        const start = trendList.scrollTop;
        const duration = 250;
        const startTime = performance.now();

        function animateScroll(currentTime) {
            const timeElapsed = currentTime - startTime;
            const progress = Math.min(timeElapsed / duration, 1);
            
            // Ease-out cubic
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            
            trendList.scrollTop = start * (1 - easeProgress);

            if (timeElapsed < duration) {
                requestAnimationFrame(animateScroll);
            }
        }
        
        requestAnimationFrame(animateScroll);
    });

    
    function updateNavButtons() {
        btnPrev.disabled = currentOffset >= totalMoments - 1;
        btnNext.disabled = currentOffset <= 0;
    }
    
    async function loadMoment(offset, isSilentRefresh = false) {
        if (!isSilentRefresh) {
            trendList.innerHTML = "Loading data from DuckDB...";
        }
        

        const res = await browser.runtime.sendMessage({ command: "GET_TREND_MOMENT", offset: offset });
        if (!res || res.error) {
            trendList.innerHTML = "Error loading data or DB not initialized.";
            return;
        }
        totalMoments = res.total;
        if (totalMoments === 0) {
            trendTimestamp.textContent = "No Data";
            trendList.innerHTML = "Database is empty.";
            btnPrev.disabled = true;
            btnNext.disabled = true;
            return;
        }

        currentOffset = offset;
        updateNavButtons();
         
         

        // Format Date
        const d = new Date(res.moment.captured_at.replace(" ", "T"));
        trendTimestamp.textContent = `${d.toLocaleDateString()} ${d.toLocaleTimeString()} (${currentOffset + 1} of ${totalMoments})`;

        try {
            let trends = JSON.parse(res.moment.raw_json);
            
            // Rebuild DOM
            const newContent = document.createElement("div");
            
            if (!Array.isArray(trends)) {
                newContent.innerHTML = `<pre style="margin:0; font-family:inherit; font-size: calc(10px * var(--font-mult));">${JSON.stringify(trends, null, 2)}</pre>`;
            } else {
                let history = [];
            if (res.history) {
                history = res.history.map(h => {
                    try { return { ts: new Date(h.ts.replace(" ", "T")), trends: JSON.parse(h.raw) }; } 
                    catch(e) { return null; }
                }).filter(Boolean);
            }

            trends.forEach((t, i) => {
                    let title = t.displayName || t.topic || t.name || t.value || "Unknown Topic";
                    let desc = t.description || "No description provided.";
                    let cat = t.category || "Uncategorized";
                    
                    let rank = i + 1;
                    let pc = t.postCount || 0;
                    let ac = (t.actors && Array.isArray(t.actors)) ? t.actors.length : 0;
                    
                    let deltas = calculateDeltas(t, i, history, res.moment.captured_at);
                    let { rankDiffStr, pcDiffStr, acDiffStr, timeUnchangedStr } = deltas;

                    let link = t.link || "";
                    if (link && link.startsWith("/")) {
                        link = "https://bsky.app" + link;
                    }

                    const card = document.createElement("div");
                    card.style.background = "Field";
                    card.style.border = "1px solid color-mix(in srgb, CanvasText 20%, transparent)";
                    card.style.borderRadius = "6px";
                    card.style.padding = "10px";
                    card.style.marginBottom = "10px";
                    card.style.display = "flex";
                    card.style.flexDirection = "column";
                    card.style.gap = "4px";

                    let header = document.createElement("div");
                    header.style.display = "flex";
                    header.style.justifyContent = "space-between";
                    header.style.alignItems = "flex-start";
                    header.innerHTML = `<strong style="font-size: calc(13px * var(--font-mult)); color: #1185fe; margin-right: 10px; display: flex; align-items: center;">${rank}. ${escapeHTML(title)}</strong>
                                        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                                            ${timeUnchangedStr} ${rankDiffStr}
                                            <span style="font-size: calc(10px * var(--font-mult)); opacity: 0.8; background: color-mix(in srgb, CanvasText 10%, transparent); padding: 2px 6px; border-radius: 10px; white-space: nowrap;">${escapeHTML(cat)}</span>
                                        </div>`;
                    card.appendChild(header);

                    let descEl = document.createElement("div");
                    descEl.style.fontSize = "calc(11px * var(--font-mult))";
                    descEl.style.opacity = "0.9";
                    descEl.innerText = desc;
                    card.appendChild(descEl);

                    let meta = document.createElement("div");
                    meta.style.display = "flex";
                    meta.style.justifyContent = "flex-start";
                    meta.style.alignItems = "center";
                    meta.style.flexWrap = "wrap";
                    meta.style.gap = "32px";
                    meta.style.marginTop = "6px";
                    meta.style.fontSize = "calc(10px * var(--font-mult))";
                    meta.style.opacity = "0.7";
                    meta.innerHTML = `<span style="min-width: 170px; display: inline-block; white-space: nowrap;">💬 ${pc.toLocaleString()} posts ${pcDiffStr}</span><span style="min-width: 170px; display: inline-block; white-space: nowrap;">👥 ${ac} top actors ${acDiffStr}</span>`;
                    
                    if (link) {
                        let linkBtn = document.createElement("button");
                        linkBtn.innerText = "View Topic ↗";
                        linkBtn.style.background = "none";
                        linkBtn.style.border = "none";
                        linkBtn.style.color = "#1185fe";
                        linkBtn.style.cursor = "pointer";
                        linkBtn.style.padding = "0";
                        linkBtn.style.textDecoration = "underline";
                        linkBtn.style.fontSize = "calc(10px * var(--font-mult))";
                        linkBtn.onclick = () => {
                            browser.runtime.sendMessage({ command: "NAVIGATE", url: link });
                        };
                        meta.appendChild(linkBtn);
                    }

                    card.appendChild(meta);
                    newContent.appendChild(card);
                });
            }
            
            trendList.innerHTML = "";
            trendList.appendChild(newContent);
            
            if (isSilentRefresh) {
                trendTimestamp.classList.remove("flash");
                void trendTimestamp.offsetWidth; // trigger reflow
                trendTimestamp.classList.add("flash");
                trendTimestamp.style.borderRadius = "4px";
            }
        } catch(e) {
            trendList.innerHTML = `<pre style="margin:0; font-family:inherit; font-size: calc(10px * var(--font-mult)); color:red;">Error parsing:\n${escapeHTML(res.moment.raw_json)}</pre>`;
        }
    }

    btnPrev.addEventListener("click", () => {
        if (totalMoments <= 0 || currentOffset >= totalMoments - 1) return;
        loadMoment(currentOffset + 1, true);
    });
    btnNext.addEventListener("click", () => {
        if (totalMoments <= 0 || currentOffset <= 0) return;
        loadMoment(currentOffset - 1, true);
    });

    loadMoment(0, false);


let currentRateLimit = null;
let isLoggedIn = false;
let hasCheckedAuth = false;

function updateAuthUI() {
    const authDiv = document.getElementById("authStatus");
    if (!authDiv) return;
    
    if (!hasCheckedAuth) {
        authDiv.innerHTML = "ℹ️ Awaiting next trend update...";
        return;
    }
    if (isLoggedIn && currentRateLimit) {
        let resetStr = "Unknown";
        if (currentRateLimit.reset) {
            let resetVal = parseInt(currentRateLimit.reset);
            if (resetVal > 1000000000) {
                let secondsLeft = Math.max(0, resetVal - Math.floor(Date.now() / 1000));
                resetStr = secondsLeft + "s";
                if (secondsLeft === 0) {
                    currentRateLimit.remaining = currentRateLimit.limit;
                    if (currentRateLimit.policy) {
                        currentRateLimit.reset = (resetVal + currentRateLimit.policy).toString();
                    }
                }
            } else {
                resetStr = resetVal + "s";
            }
        }
        authDiv.innerHTML = `<span style="color: #4ade80; text-shadow: 0 0 4px #4ade80;">●</span> Quota: ${currentRateLimit.remaining} / ${currentRateLimit.limit} (Resets in ${resetStr})`;
    } else {
        authDiv.innerHTML = `<span style="color: #ef4444; font-weight: bold; text-shadow: 0 0 4px #ef4444;">⚠️ Not Logged In</span> | You should login to avoid guest rate-limits.`;
    }
}

browser.runtime.sendMessage({ command: "GET_AUTH_STATUS" }).then((res) => {
    if (res) {
        hasCheckedAuth = res.hasCheckedAuth;
        isLoggedIn = res.isLoggedIn;
        currentRateLimit = res.rateLimit;
        updateAuthUI();
    }
});

setInterval(() => {
    if (hasCheckedAuth && isLoggedIn && currentRateLimit) {
        updateAuthUI();
    }
}, 1000);

browser.runtime.onMessage.addListener((message) => {

    if (message.command === "AUTH_STATUS") {
            hasCheckedAuth = true;
            isLoggedIn = message.isLoggedIn;
            currentRateLimit = message.rateLimit;
            updateAuthUI();
        }
        if (message.command === "TREND_ADDED") {
        if (totalMoments === 0) {
            loadMoment(0, true);
            return;
        }
        currentOffset++;
        totalMoments++;
        
        // Update the title label to reflect new index without changing the data we are reading!
        const labelParts = trendTimestamp.innerText.split('(');
        if (labelParts.length > 1) {
            trendTimestamp.textContent = `${labelParts[0]}(${currentOffset + 1} of ${totalMoments})`;
        }
        updateNavButtons();
        
        // The "Newer" button should now be enabled because there's a newer entry!
         
         
        
        // Flash the title bar to notify the user
        trendTimestamp.classList.remove("flash");
        void trendTimestamp.offsetWidth; 
        trendTimestamp.classList.add("flash");
        trendTimestamp.style.borderRadius = "4px";
    }
});
