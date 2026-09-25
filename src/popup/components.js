import { state } from './state.js';

export function closePopover() { 
    if (state.activePopover) { 
        let el = state.activePopover; 
        state.activePopover = null; 
        el.style.opacity = "0"; 
        el.style.transform = el.dataset.isFlipped === "true" ? "translateY(8px) scale(0.95)" : "translateY(-8px) scale(0.95)"; 
        setTimeout(() => el.remove(), 150); 
    } 
}

export function buildActorAvatar(actor, outlineColor, isAnalysisMode = false, topicQuery = null) {
    let wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.display = "flex";
    wrapper.style.justifyContent = "center";

    let avContainer = document.createElement("div");
    avContainer.style.width = "36px";
    avContainer.style.height = "36px";
    avContainer.style.borderRadius = "50%";
    avContainer.style.cursor = "pointer";
    avContainer.style.overflow = "hidden";
    avContainer.style.border = "1px solid color-mix(in srgb, CanvasText 10%, transparent)";
    if (outlineColor) {
        avContainer.style.boxShadow = `0 0 0 2px ${outlineColor}`;
    }
    
    let tooltip = document.createElement("div");
    tooltip.textContent = actor.displayName || actor.handle;
    tooltip.style.position = "absolute";
    tooltip.style.bottom = "115%";
    tooltip.style.left = "50%";
    tooltip.style.transform = "translateX(-50%)";
    tooltip.style.background = "Field";
    tooltip.style.color = "FieldText";
    tooltip.style.border = "1px solid color-mix(in srgb, CanvasText 20%, transparent)";
    tooltip.style.padding = "4px 8px";
    tooltip.style.borderRadius = "4px";
    tooltip.style.fontSize = "calc(12px * var(--font-mult))";
    tooltip.style.fontWeight = "bold";
    tooltip.style.fontFamily = 'Monaco, "Bitstream Vera Sans Mono", "Lucida Console", Terminal, monospace';
    tooltip.style.whiteSpace = "nowrap";
    tooltip.style.pointerEvents = "none";
    tooltip.style.opacity = "0";
    tooltip.style.transition = "opacity 0.1s ease-in-out";
    tooltip.style.zIndex = "2000";
    tooltip.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";

    let isLocked = false;
    let currentAnalysisColor = null;
    avContainer.onclick = async (e) => {
        if (isAnalysisMode) {
            e.preventDefault();
            e.stopPropagation();
            
            if (isLocked) return;
            isLocked = true;
            currentAnalysisColor = "#f59e0b"; // Orange/Yellow working color
            
            // Add spinning/pulsating animation
            avContainer.style.transition = "box-shadow 0.3s ease-in-out";
            avContainer.style.boxShadow = "0 0 0 3px " + currentAnalysisColor; 
            avContainer.style.animation = "pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite";
            
            try {
                let res = await browser.runtime.sendMessage({ command: "ANALYZE_THREAD", topic: topicQuery, actorDid: actor.did });
                avContainer.style.animation = "none";
                currentAnalysisColor = (res && res.success) ? "#4ade80" : "#ef4444";
                avContainer.style.boxShadow = "0 0 0 3px " + currentAnalysisColor;
            } catch (err) {
                avContainer.style.animation = "none";
                currentAnalysisColor = "#ef4444";
                avContainer.style.boxShadow = "0 0 0 3px " + currentAnalysisColor;
            }
            
            setTimeout(() => {
                isLocked = false;
                currentAnalysisColor = null;
                avContainer.style.boxShadow = outlineColor ? `0 0 0 2px ${outlineColor}` : "none";
            }, 3000);
            
        } else {
            browser.runtime.sendMessage({ command: "NAVIGATE", url: `https://bsky.app/profile/${actor.handle}` });
        }
    };
    wrapper.onmouseenter = () => { 
        avContainer.style.transform = "scale(1.1)"; 
        if (currentAnalysisColor) avContainer.style.boxShadow = "0 0 8px " + currentAnalysisColor;
        else if (outlineColor) avContainer.style.boxShadow = `0 0 8px ${outlineColor}`;
        else avContainer.style.boxShadow = "0 0 8px #1185fe"; 
        
        // Reset position to center to calculate true bounding box
        tooltip.style.left = "50%";
        tooltip.style.transform = "translateX(-50%)";
        
        requestAnimationFrame(() => {
            let tipRect = tooltip.getBoundingClientRect();
            // Dynamic Collision Detection: snap tooltip inwards if it clips the window edge
            if (tipRect.left < 5) {
                tooltip.style.left = "0%";
                tooltip.style.transform = "translateX(0)";
            } else if (tipRect.right > window.innerWidth - 5) {
                tooltip.style.left = "100%";
                tooltip.style.transform = "translateX(-100%)";
            }
            tooltip.style.opacity = "1"; // Fade in only after clamping
        });
    }
    wrapper.onmouseleave = () => { 
        avContainer.style.transform = "none"; 
        if (currentAnalysisColor) avContainer.style.boxShadow = "0 0 0 3px " + currentAnalysisColor;
        else if (outlineColor) avContainer.style.boxShadow = `0 0 0 2px ${outlineColor}`;
        else avContainer.style.boxShadow = "none"; 
        tooltip.style.opacity = "0";
    }
    avContainer.style.transition = "all 0.2s";

    if (actor.avatar) {
        let img = document.createElement("img");
        img.src = actor.avatar;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        avContainer.appendChild(img);
    } else {
        avContainer.style.background = "#1185fe";
        let init = document.createElement("div");
        init.style.color = "white";
        init.style.width = "100%";
        init.style.height = "100%";
        init.style.display = "flex";
        init.style.alignItems = "center";
        init.style.justifyContent = "center";
        init.style.fontWeight = "bold";
        init.textContent = (actor.displayName || actor.handle).charAt(0).toUpperCase();
        avContainer.appendChild(init);
    }
    wrapper.appendChild(avContainer);
    wrapper.appendChild(tooltip);
    return wrapper;
}
