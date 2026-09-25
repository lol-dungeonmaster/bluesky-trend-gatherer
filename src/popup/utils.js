export function getCategoryColor(categoryStr) {
    if (!categoryStr || categoryStr === "Uncategorized") return { bg: "color-mix(in srgb, CanvasText 10%, transparent)", border: "color-mix(in srgb, CanvasText 30%, transparent)" };
    const knownCats = {
        "sports": 30,
        "business": 60,
        "gaming": 120,
        "culture": 150,
        "news": 180,
        "science-tech": 210,
        "entertainment": 280,
        "art": 320,
        "politics": 355
    };
    let h = 0;
    let key = categoryStr.toLowerCase();
    if (knownCats.hasOwnProperty(key)) {
        h = knownCats[key];
    } else {
        let hash = 0;
        for (let i = 0; i < categoryStr.length; i++) {
            hash = categoryStr.charCodeAt(i) + ((hash << 5) - hash);
        }
        h = Math.abs(hash) % 360;
    }
    return { bg: `hsla(${h}, 70%, 50%, 0.25)`, border: `hsla(${h}, 70%, 50%, 0.8)` };
}

export function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
}

export function formatDuration(ms) {
    if (!ms) return "0m";
    const totalMins = Math.floor(ms / 60000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}
