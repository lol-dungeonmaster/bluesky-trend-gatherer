function getTrendId(t) {
    return t.topic || t.name || t.value || t.displayName || "Unknown Topic";
}

function calculateDeltas(t, i, history, currentMomentTsStr) {
    let title = t.displayName || t.topic || t.name || t.value || "Unknown Topic";
    let tid = getTrendId(t);
    let rank = i + 1;
    let pc = t.postCount || 0;
    let ac = (t.actors && Array.isArray(t.actors)) ? t.actors.length : 0;
    
    let rankDiffStr = `<span style="color: #f97316; font-weight: bold; margin-left: 4px; font-size: calc(10px * var(--font-mult)); white-space: nowrap; display: inline-flex; align-items: flex-start; gap: 1px; text-shadow: 0 0 4px rgba(249, 115, 22, 0.4);">New<span style="font-size: calc(16px * var(--font-mult)); color: #fbbf24; margin-top: -6px; line-height: 1;">✦</span></span>`;
    let pcDiffStr = "";
    let acDiffStr = "";
    let timeUnchangedStr = "";

    let newActors = [];
    let droppedActors = [];

    if (history && history.length > 0) {
        let prevTrends = history[0].trends;
        let prevIndex = prevTrends.findIndex(pt => getTrendId(pt) === tid);
        
        if (prevIndex !== -1) {
            let prevRank = prevIndex + 1;
            let prevPt = prevTrends[prevIndex];
            let prevPc = prevPt.postCount || 0;
            let prevAc = (prevPt.actors && Array.isArray(prevPt.actors)) ? prevPt.actors.length : 0;

            if (t.actors && Array.isArray(t.actors) && prevPt.actors && Array.isArray(prevPt.actors)) {
                let currentDids = t.actors.map(a => a.did);
                let prevDids = prevPt.actors.map(a => a.did);
                newActors = currentDids.filter(did => !prevDids.includes(did));
                droppedActors = prevPt.actors.filter(a => !currentDids.includes(a.did));
            }

            let rankDiff = prevRank - rank;
            if (rankDiff > 0) rankDiffStr = `<span style="color:#4ade80; margin-left:4px; font-size: calc(11px * var(--font-mult));">▲${rankDiff}</span>`;
            else if (rankDiff < 0) rankDiffStr = `<span style="color:#ef4444; margin-left:4px; font-size: calc(11px * var(--font-mult));">▼${Math.abs(rankDiff)}</span>`;
            else rankDiffStr = `<span style="color:color-mix(in srgb, CanvasText 40%, transparent); margin-left:4px; font-size: calc(11px * var(--font-mult));">—</span>`;

            let pcDiff = pc - prevPc;
            if (pcDiff > 0) pcDiffStr = `<span style="color:#4ade80;">(+${pcDiff})</span>`;
            else if (pcDiff < 0) pcDiffStr = `<span style="color:#ef4444;">(${pcDiff})</span>`;

            let acDiff = ac - prevAc;
            if (acDiff > 0) acDiffStr = `<span style="color:#4ade80;">(+${acDiff})</span>`;
            else if (acDiff < 0) acDiffStr = `<span style="color:#ef4444;">(${acDiff})</span>`;

            if (rankDiff === 0 && currentMomentTsStr) {
                let unchangedSince = history[0].ts;
                for (let j = 1; j < history.length; j++) {
                    let ht = history[j].trends;
                    let hIndex = ht.findIndex(pt => getTrendId(pt) === tid);
                    if (hIndex + 1 === rank) unchangedSince = history[j].ts;
                    else break;
                }
                let durMs = new Date(currentMomentTsStr.replace(" ", "T")) - new Date(typeof unchangedSince === "string" ? unchangedSince.replace(" ", "T") : unchangedSince);
                let durMins = Math.floor(durMs / 60000);
                if (durMins > 0) {
                    timeUnchangedStr = `<span style="font-size: calc(9px * var(--font-mult)); opacity: 0.6; margin-left: 6px; font-weight: normal; color: FieldText;">(${durMins}m in pos)</span>`;
                } else if (durMins === 0) {
                    timeUnchangedStr = `<span style="font-size: calc(9px * var(--font-mult)); opacity: 0.6; margin-left: 6px; font-weight: normal; color: FieldText;">(<1m in pos)</span>`;
                }
            }
        } else {
            // Not in immediately previous snapshot. Is it returning?
            let seenBefore = false;
            for (let j = 1; j < history.length; j++) {
                if (history[j].trends.findIndex(pt => getTrendId(pt) === tid) !== -1) {
                    seenBefore = true;
                    break;
                }
            }
            
            let currentGapMs = 0;
            if (currentMomentTsStr) {
                currentGapMs = new Date(currentMomentTsStr.replace(" ", "T")) - new Date(typeof history[0].ts === "string" ? history[0].ts.replace(" ", "T") : history[0].ts);
            }
            
            if (seenBefore || (t.timeInTop20Ms && t.timeInTop20Ms > currentGapMs + 1000)) {
                rankDiffStr = `<span style="color:color-mix(in srgb, CanvasText 40%, transparent); margin-left:4px; font-size: calc(11px * var(--font-mult));">—</span>`;
                timeUnchangedStr = `<span style="font-size: calc(9px * var(--font-mult)); opacity: 0.6; margin-left: 6px; font-weight: normal; color: FieldText;">(<1m in pos)</span>`;
            }
        }
    }

    return { rankDiffStr, pcDiffStr, acDiffStr, timeUnchangedStr, newActors, droppedActors };
}

/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculateDeltas };
}
