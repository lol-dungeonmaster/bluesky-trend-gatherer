import { state } from './state.js';
import { closePopover, buildActorAvatar } from './components.js';
import { getCategoryColor, escapeHTML, formatDuration } from './utils.js';
import { calculateDeltas } from '../math_deltas.js'; // Assuming math_deltas.js exports it

const style = document.createElement('style');
style.textContent = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .5; }
}
`;
document.head.appendChild(style);

document.addEventListener("click", closePopover);

let btnOldest, btnPrev, btnNext, btnNewest, trendTimestamp, trendList, scrollTopBtn;

document.addEventListener("DOMContentLoaded", async () => {
    btnOldest = document.getElementById("btnOldest");
    btnPrev = document.getElementById("btnPrev");
    btnNext = document.getElementById("btnNext");
    btnNewest = document.getElementById("btnNewest");
    trendTimestamp = document.getElementById("trendTimestamp");
    trendList = document.getElementById("trendList");
    scrollTopBtn = document.getElementById("scrollTopBtn");

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
    const btnOptions = document.getElementById("btnOptions");
    
    if (btnOptions) {
        btnOptions.addEventListener("click", () => {
            if (typeof browser !== 'undefined' && browser.runtime.sendMessage) {
                browser.runtime.sendMessage({ command: "OPEN_OPTIONS_PAGE" });
            } else {
                console.warn("browser.runtime.openOptionsPage is not available.");
            }
        });
    }

    const response = await browser.runtime.sendMessage({ command: "GET_STATE" });
    if (response) {
        toggle.checked = response.isActive;
        toggle.parentElement.title = response.isActive ? "Disable Monitor" : "Enable Monitor";
    }

    toggle.addEventListener("change", async (e) => {
        const isChecked = e.target.checked;
        toggle.parentElement.title = isChecked ? "Disable Monitor" : "Enable Monitor";
        await browser.runtime.sendMessage({ 
            command: "SET_STATE", 
            isActive: isChecked 
        });
    });

    trendList.addEventListener("scroll", () => {
        if (!state.isScrolling) {
            window.requestAnimationFrame(() => {
                closePopover();
                if (trendList.scrollTop > 100) {
                    scrollTopBtn.classList.add("visible");
                } else {
                    scrollTopBtn.classList.remove("visible");
                }
                state.isScrolling = false;
            });
            state.isScrolling = true;
        }
    }, { passive: true });

    scrollTopBtn.addEventListener("click", () => {
        const start = trendList.scrollTop;
        const duration = 250;
        const startTime = performance.now();

        function animateScroll(currentTime) {
            const timeElapsed = currentTime - startTime;
            const progress = Math.min(timeElapsed / duration, 1);
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            trendList.scrollTop = start * (1 - easeProgress);
            if (timeElapsed < duration) {
                requestAnimationFrame(animateScroll);
            }
        }
        requestAnimationFrame(animateScroll);
    });

    btnPrev.addEventListener("click", () => {
        if (state.totalMoments <= 0 || state.currentOffset >= state.totalMoments - 1) return;
        loadMoment(state.currentOffset + 1, true);
    });
    btnNext.addEventListener("click", () => {
        if (state.totalMoments <= 0 || state.currentOffset <= 0) return;
        loadMoment(state.currentOffset - 1, true);
    });
    btnOldest.addEventListener("click", () => {
        if (state.totalMoments <= 0 || state.currentOffset >= state.totalMoments - 1) return;
        loadMoment(state.totalMoments - 1, true);
    });
    btnNewest.addEventListener("click", () => {
        if (state.totalMoments <= 0 || state.currentOffset <= 0) return;
        loadMoment(0, true);
    });

    browser.storage.local.get("saved_trend_ts").then(data => {
        const toggleNode = document.getElementById("monitorToggle");
        const initPromise = data.saved_trend_ts ? loadMoment(0, false, data.saved_trend_ts) : loadMoment(0, false);
        initPromise.finally(() => {
            if (toggleNode) {
                toggleNode.disabled = false;
                if (toggleNode.parentElement) {
                    toggleNode.parentElement.style.opacity = "1";
                    toggleNode.parentElement.style.cursor = "pointer";
                }
            }
        });
    });
    
    browser.runtime.sendMessage({ command: "GET_AUTH_STATUS" }).then((res) => {
        if (res) {
            state.hasCheckedAuth = res.hasCheckedAuth;
            state.isLoggedIn = res.isLoggedIn;
            state.currentRateLimit = res.rateLimit;
            updateAuthUI();
        }
    });
});

function updateNavButtons() {
    btnPrev.disabled = state.currentOffset >= state.totalMoments - 1;
    btnOldest.disabled = state.currentOffset >= state.totalMoments - 1;
    btnNext.disabled = state.currentOffset <= 0;
    btnNewest.disabled = state.currentOffset <= 0;
}

async function loadMoment(offset, isSilentRefresh = false, target_ts = null) {
    if (!isSilentRefresh) {
        trendList.innerHTML = "Loading data from DuckDB...";
    }
    const res = await browser.runtime.sendMessage({ command: "GET_TREND_MOMENT", offset: offset, target_ts: target_ts });
    if (!res || res.error) {
        trendList.innerHTML = "Error loading data or DB not initialized.";
        return;
    }
    state.totalMoments = res.total;
    if (state.totalMoments === 0) {
        trendTimestamp.textContent = "No Data";
        trendList.innerHTML = "Database is empty.";
        btnPrev.disabled = true;
        btnNext.disabled = true;
        btnOldest.disabled = true;
        btnNewest.disabled = true;
        return;
    }

    state.currentOffset = res.offset !== undefined ? res.offset : offset;
    browser.storage.local.set({ 
        saved_trend_ts: state.currentOffset === 0 ? null : res.moment.captured_at 
    });
    updateNavButtons();

    const d = new Date(res.moment.captured_at.replace(" ", "T"));
    trendTimestamp.textContent = `${d.toLocaleDateString()} ${d.toLocaleTimeString()} (${state.currentOffset + 1} of ${state.totalMoments})`;

    try {
        let trends = JSON.parse(res.moment.raw_json);
        const newContent = document.createElement("div");
        
        if (!Array.isArray(trends)) {
            newContent.innerHTML = `<pre style="margin:0; font-family:inherit; font-size: calc(10px * var(--font-mult));">${escapeHTML(JSON.stringify(trends, null, 2))}</pre>`;
        } else {
            let history = [];
            if (res.history) {
                history = res.history.map(h => {
                    try { return { ts: new Date(h.ts.replace(" ", "T")), trends: JSON.parse(h.raw) }; } 
                    catch(e) { return null; }
                }).filter(Boolean);
            }

            let catCounts = {};
            trends.forEach(t => {
                let c = t.category || "Uncategorized";
                catCounts[c] = (catCounts[c] || 0) + 1;
            });
            let chartContainer = document.getElementById("categoryChartContainer");
            let catBar = document.getElementById("categoryBar");
            let catLegend = document.getElementById("categoryLegend");
            
            if (trends.length > 0) {
                chartContainer.style.display = "flex";
                catBar.innerHTML = "";
                catLegend.innerHTML = "";
                let sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
                
                sortedCats.forEach(([cat, count]) => {
                    let pct = (count / trends.length) * 100;
                    let color = getCategoryColor(cat);
                    let bg = typeof color === 'string' ? color : color.bg;
                    let border = typeof color === 'string' ? 'transparent' : color.border;
                    
                    let seg = document.createElement("div");
                    seg.style.width = pct + "%";
                    seg.style.height = "100%";
                    seg.style.background = border !== 'transparent' ? border : bg;
                    seg.title = `${cat}: ${count} trends (${Math.round(pct)}%)`;
                    catBar.appendChild(seg);
                    
                    let legItem = document.createElement("div");
                    legItem.style.position = "relative";
                    legItem.style.display = "flex";
                    legItem.style.alignItems = "center";
                    legItem.style.gap = "4px";
                    legItem.style.cursor = "default";
                    legItem.innerHTML = `<div style="width: 8px; height: 8px; border-radius: 50%; background: ${border !== 'transparent' ? border : bg}"></div>${escapeHTML(cat)}`;
                    
                    let tooltip = document.createElement("div");
                    tooltip.style.position = "absolute";
                    tooltip.style.bottom = "120%";
                    tooltip.style.left = "50%";
                    tooltip.style.transform = "translateX(-50%)";
                    tooltip.style.background = "Field";
                    tooltip.style.color = "FieldText";
                    tooltip.style.border = "1px solid color-mix(in srgb, CanvasText 20%, transparent)";
                    tooltip.style.padding = "4px 8px";
                    tooltip.style.borderRadius = "4px";
                    tooltip.style.fontSize = "calc(12px * var(--font-mult))";
                    tooltip.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
                    tooltip.style.whiteSpace = "nowrap";
                    tooltip.style.opacity = "0";
                    tooltip.style.pointerEvents = "none";
                    tooltip.style.transition = "opacity 0.15s ease";
                    tooltip.style.zIndex = "100";
                    tooltip.textContent = Math.round(pct) + "%";
                    legItem.appendChild(tooltip);

                    legItem.onmouseenter = () => { tooltip.style.opacity = "1"; };
                    legItem.onmouseleave = () => { tooltip.style.opacity = "0"; };
                    
                    catLegend.appendChild(legItem);
                });
            } else {
                chartContainer.style.display = "none";
            }

            trends.forEach((t, i) => {
                let title = t.displayName || t.topic || t.name || t.value || "Unknown Topic";
                let desc = t.description || "No description provided.";
                let cat = t.category || "Uncategorized";
                let rank = i + 1;
                let pc = t.postCount || 0;
                let ac = (t.actors && Array.isArray(t.actors)) ? t.actors.length : 0;
                
                let deltas = calculateDeltas(t, i, history, res.moment.captured_at);
                let { rankDiffStr, pcDiffStr, acDiffStr, timeUnchangedStr, newActors, droppedActors } = deltas;

                let link = t.link || "";
                let exactQuery = title;
                if (link.includes("?q=")) {
                    try { exactQuery = new URLSearchParams(link.split("?")[1]).get("q") || title; } catch(e) {}
                }
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

                let catColorObj = getCategoryColor(cat);
                let catBg = typeof catColorObj === 'string' ? catColorObj : catColorObj.bg;
                let catBorder = typeof catColorObj === 'string' ? 'none' : `1px solid ${catColorObj.border}`;

                let header = document.createElement("div");
                header.style.display = "flex";
                header.style.justifyContent = "space-between";
                header.style.alignItems = "flex-start";
                header.innerHTML = `<strong style="font-size: calc(13px * var(--font-mult)); color: #1185fe; margin-right: 10px; display: flex; align-items: center;">${rank}. ${escapeHTML(title)}</strong>
                                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                                        ${timeUnchangedStr} ${rankDiffStr}
                                        <span style="font-size: calc(10px * var(--font-mult)); opacity: 0.9; background: ${catBg}; border: ${catBorder}; padding: 1px 6px; border-radius: 10px; white-space: nowrap;">${escapeHTML(cat)}</span>
                                    </div>`;
                card.appendChild(header);

                let descEl = document.createElement("div");
                descEl.style.fontSize = "calc(11px * var(--font-mult))";
                descEl.style.opacity = "0.9";
                descEl.textContent = desc;
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
                
                let postCountSpan = document.createElement("span");
                postCountSpan.className = 'post-count-trigger';
                postCountSpan.style.minWidth = "220px";
                postCountSpan.style.display = "inline-block";
                postCountSpan.style.whiteSpace = "nowrap";
                postCountSpan.innerHTML = `💬 ${pc.toLocaleString()} posts ${pcDiffStr}`;

                if (t.actors && t.actors.length > 0) {
                    postCountSpan.style.cursor = "pointer";
                    postCountSpan.style.color = "#1185fe";
                    postCountSpan.style.textDecoration = "underline";
                    postCountSpan.title = "Click to view Top Actor Stats & Analyze Threads";

                    postCountSpan.addEventListener("click", (e) => {
                        e.stopPropagation();
                        if (state.activePopover && state.activePopover.triggerEl === postCountSpan) {
                            closePopover();
                            return;
                        }
                        closePopover();

                        state.activePopover = document.createElement("div");
                        state.activePopover.triggerEl = postCountSpan;
                        state.activePopover.style.position = "fixed";
                        state.activePopover.style.background = "Field";
                        state.activePopover.style.border = "1px solid color-mix(in srgb, CanvasText 20%, transparent)";
                        state.activePopover.style.padding = "10px";
                        state.activePopover.style.borderRadius = "8px";
                        state.activePopover.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
                        state.activePopover.style.zIndex = "1000";
                        state.activePopover.style.display = "flex";
                        state.activePopover.style.gap = "8px";
                        state.activePopover.style.opacity = "0";
                        state.activePopover.style.transform = "translateY(8px) scale(0.95)";
                        state.activePopover.style.transformOrigin = "top center";
                        state.activePopover.style.transition = "all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)";

                        t.actors.forEach(actor => {
                            state.activePopover.appendChild(buildActorAvatar(actor, null, true, exactQuery));
                        });

                        document.body.appendChild(state.activePopover);

                        let rect = postCountSpan.getBoundingClientRect();
                        let popRect = state.activePopover.getBoundingClientRect();
                        let left = rect.left + (rect.width / 2) - (popRect.width / 2);
                        if (left < 10) left = 10;
                        if (left + popRect.width > window.innerWidth - 10) {
                            left = window.innerWidth - popRect.width - 10;
                        }
                        state.activePopover.style.left = Math.max(10, left) + "px";

                        let top = rect.bottom + 8;
                        let isFlipped = false;
                        if (top + popRect.height > window.innerHeight - 10) {
                            top = rect.top - popRect.height - 8;
                            isFlipped = true;
                        }
                        state.activePopover.style.top = top + "px";

                        state.activePopover.classList.add(isFlipped ? "speech-bubble-down" : "speech-bubble-up");
                        if (isFlipped) {
                            state.activePopover.style.transform = "translateY(8px) scale(0.95)";
                            state.activePopover.style.transformOrigin = "bottom center";
                            state.activePopover.dataset.isFlipped = "true";
                        }

                        requestAnimationFrame(() => {
                            if (state.activePopover) {
                                state.activePopover.style.opacity = "1";
                                state.activePopover.style.transform = "translateY(0) scale(1)";
                            }
                        });
                    });
                }

                meta.appendChild(postCountSpan);

                let actorsSpan = document.createElement("span");
                actorsSpan.className = 'actors-trigger';
                actorsSpan.style.minWidth = "170px";
                actorsSpan.style.display = "inline-block";
                actorsSpan.style.whiteSpace = "nowrap";
                let shiftIndicator = ((newActors && newActors.length > 0) || (droppedActors && droppedActors.length > 0)) ? ` ✨` : ``;
                actorsSpan.innerHTML = ac > 0 ? `👥 Top Actors${shiftIndicator} ${acDiffStr}` : `👥 No Top Actors`;
                
                if (ac > 0 && t.actors) {
                    actorsSpan.style.cursor = "pointer";
                    actorsSpan.style.color = "#1185fe";
                    actorsSpan.style.textDecoration = "underline";
                    actorsSpan.title = "View top actors";
                    
                    actorsSpan.onclick = (e) => {
                        e.stopPropagation();
                        if (state.activePopover && state.activePopover.triggerEl === actorsSpan) {
                            closePopover();
                            return;
                        }
                        closePopover();
                        
                        state.activePopover = document.createElement("div");
                        state.activePopover.triggerEl = actorsSpan;
                        state.activePopover.style.position = "absolute";
                        state.activePopover.style.zIndex = "1000";
                        state.activePopover.style.background = "Field";
                        state.activePopover.style.border = "1px solid color-mix(in srgb, CanvasText 20%, transparent)";
                        state.activePopover.style.borderRadius = "8px";
                        state.activePopover.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
                        state.activePopover.style.padding = "8px";
                        state.activePopover.style.display = "flex";
                        state.activePopover.style.flexDirection = "column";
                        state.activePopover.style.gap = "8px";
                        state.activePopover.style.opacity = "0";
                        state.activePopover.style.transform = "translateY(-8px) scale(0.95)";
                        state.activePopover.style.transformOrigin = "top center";
                        state.activePopover.style.transition = "all 0.15s cubic-bezier(0.2, 0, 0, 1)";
                        state.activePopover.onclick = (e) => e.stopPropagation();
                        
                        let activeRow = document.createElement("div");
                        activeRow.style.display = "flex";
                        activeRow.style.gap = "8px";
                        state.activePopover.appendChild(activeRow);

                        t.actors.forEach(actor => {
                            let outlineColor = (newActors && newActors.includes(actor.did)) ? "#4ade80" : null;
                            activeRow.appendChild(buildActorAvatar(actor, outlineColor));
                        });
                        
                        if (droppedActors && droppedActors.length > 0) {
                            let divider = document.createElement("div");
                            divider.style.width = "100%";
                            divider.style.height = "1px";
                            divider.style.background = "color-mix(in srgb, CanvasText 20%, transparent)";
                            divider.style.margin = "2px 0";
                            state.activePopover.appendChild(divider);

                            let droppedRow = document.createElement("div");
                            droppedRow.style.display = "flex";
                            droppedRow.style.gap = "8px";
                            droppedRow.style.opacity = "0.7"; 
                            state.activePopover.appendChild(droppedRow);

                            droppedActors.forEach(actor => {
                                droppedRow.appendChild(buildActorAvatar(actor, "#ef4444"));
                            });
                        }
                        
                        document.getElementById('app').appendChild(state.activePopover);
                        const rect = actorsSpan.getBoundingClientRect();
                        const popRect = state.activePopover.getBoundingClientRect();
                        
                        let left = rect.left;
                        if (left + popRect.width > window.innerWidth - 10) {
                            left = window.innerWidth - popRect.width - 10;
                        }
                        state.activePopover.style.left = Math.max(10, left) + "px";
                        
                        let top = rect.bottom + 8;
                        let isFlipped = false;
                        if (top + popRect.height > window.innerHeight - 10) {
                            top = rect.top - popRect.height - 8;
                            isFlipped = true;
                        }
                        state.activePopover.style.top = top + "px";
                        
                        state.activePopover.classList.add(isFlipped ? "speech-bubble-down" : "speech-bubble-up");
                        if (isFlipped) {
                            state.activePopover.style.transform = "translateY(8px) scale(0.95)";
                            state.activePopover.style.transformOrigin = "bottom center";
                            state.activePopover.dataset.isFlipped = "true";
                        }
                        
                        requestAnimationFrame(() => {
                            if (state.activePopover) {
                                state.activePopover.style.opacity = "1";
                                state.activePopover.style.transform = "translateY(0) scale(1)";
                            }
                        });
                    };
                }
                meta.appendChild(actorsSpan);

                if (link) {
                    let linkBtn = document.createElement("button");
                    linkBtn.textContent = "View Topic ↗";
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
                
                if (t.timeInTop20Ms !== undefined) {
                    let badge = document.createElement("span");
                    badge.textContent = `⏱️ ${formatDuration(t.timeInTop20Ms)}`;
                    badge.style.marginLeft = "auto";
                    badge.style.opacity = "0.8";
                    badge.title = "Total time tracked in Top 20";
                    meta.appendChild(badge);
                }

                card.appendChild(meta);
                newContent.appendChild(card);
            });
        }
        
        trendList.innerHTML = "";
        trendList.appendChild(newContent);
        
        if (isSilentRefresh) {
            trendTimestamp.classList.remove("flash");
            void trendTimestamp.offsetWidth;
            trendTimestamp.classList.add("flash");
            trendTimestamp.style.borderRadius = "4px";
        }
    } catch(e) {
        trendList.innerHTML = `<pre style="margin:0; font-family:inherit; font-size: calc(10px * var(--font-mult)); color:red;">Error parsing: ${e.message}
${escapeHTML(res.moment.raw_json)}</pre>`;
    }
}

function updateAuthUI() {
    const authDiv = document.getElementById("authStatus");
    if (!authDiv) return;
    
    if (!state.hasCheckedAuth) {
        authDiv.innerHTML = "ℹ️ Awaiting next trend update...";
        return;
    }
    if (state.isLoggedIn && state.currentRateLimit) {
        let resetStr = "Unknown";
        if (state.currentRateLimit.reset) {
            let resetVal = parseInt(state.currentRateLimit.reset);
            if (resetVal > 1000000000) {
                let secondsLeft = Math.max(0, resetVal - Math.floor(Date.now() / 1000));
                resetStr = secondsLeft + "s";
                if (secondsLeft === 0) {
                    state.currentRateLimit.remaining = state.currentRateLimit.limit;
                    if (state.currentRateLimit.policy) {
                        state.currentRateLimit.reset = (resetVal + state.currentRateLimit.policy).toString();
                    }
                }
            } else {
                resetStr = resetVal + "s";
            }
        }
        authDiv.innerHTML = `<span style="color: #4ade80; text-shadow: 0 0 4px #4ade80;">●</span> Quota: ${state.currentRateLimit.remaining} / ${state.currentRateLimit.limit} (Resets in ${resetStr})`;
    } else {
        authDiv.innerHTML = `<span style="color: #ef4444; font-weight: bold; text-shadow: 0 0 4px #ef4444;">⚠️ Not Logged In</span> | You should login to avoid guest rate-limits.`;
    }
}

setInterval(() => {
    if (state.hasCheckedAuth && state.isLoggedIn && state.currentRateLimit) {
        updateAuthUI();
    }
}, 1000);

browser.runtime.onMessage.addListener((message) => {
    if (message.command === "AUTH_STATUS") {
        state.hasCheckedAuth = true;
        state.isLoggedIn = message.isLoggedIn;
        state.currentRateLimit = message.rateLimit;
        updateAuthUI();
    }
    if (message.command === "TREND_ADDED") {
        if (state.totalMoments === 0) {
            loadMoment(0, true);
            return;
        }
        state.currentOffset++;
        state.totalMoments++;
        
        const labelParts = trendTimestamp.textContent.split('(');
        if (labelParts.length > 1) {
            trendTimestamp.textContent = `${labelParts[0]}(${state.currentOffset + 1} of ${state.totalMoments})`;
        }
        updateNavButtons();
        
        trendTimestamp.classList.remove("flash");
        void trendTimestamp.offsetWidth; 
        trendTimestamp.classList.add("flash");
        trendTimestamp.style.borderRadius = "4px";
    }
});

// For testing purposes
export { loadMoment, updateAuthUI, updateNavButtons };
