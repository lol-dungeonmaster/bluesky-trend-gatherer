// Inject a script into the main webpage context to safely handle fluttering
const script = document.createElement('script');
script.textContent = `
    window.addEventListener('extension-flutter', () => {
        // 1. Temporarily simulate visibility
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        
        // 2. Dispatch the native events so React Query catches them
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        
        // 3. Immediately delete our temporary overrides to restore the browser's native behavior
        delete document.visibilityState;
        delete document.hidden;
    });
`;
(document.head || document.documentElement).appendChild(script);
script.remove(); // Clean up the DOM

browser.runtime.onMessage.addListener((message) => {
    if (message.command === "FLUTTER") {
        // Trigger the main-world script to do its temporary simulation routine
        window.dispatchEvent(new CustomEvent('extension-flutter'));
    }
});
