const fs = require('fs');
let code = fs.readFileSync('src/popup.js', 'utf8');

const targetStr = `                            document.getElementById('app').appendChild(activePopover);
                            const rect = actorsSpan.getBoundingClientRect();
                            activePopover.style.top = (rect.bottom + 8) + "px";
                            let left = rect.left;
                            const popRect = activePopover.getBoundingClientRect();
                            if (left + popRect.width > window.innerWidth - 10) {
                                left = window.innerWidth - popRect.width - 10;
                            }
                            activePopover.style.left = left + "px";`;

const replacement = `                            document.getElementById('app').appendChild(activePopover);
                            const rect = actorsSpan.getBoundingClientRect();
                            const popRect = activePopover.getBoundingClientRect();
                            
                            let left = rect.left;
                            if (left + popRect.width > window.innerWidth - 10) {
                                left = window.innerWidth - popRect.width - 10;
                            }
                            activePopover.style.left = Math.max(10, left) + "px";
                            
                            let top = rect.bottom + 8;
                            if (top + popRect.height > window.innerHeight - 10) {
                                top = rect.top - popRect.height - 8;
                            }
                            activePopover.style.top = top + "px";`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('src/popup.js', code);
