let dictionary = {};
let targetTime = 3000;
let guiguiMode = 'OFF';
let isSolving = false;

chrome.storage.local.get(['dictionary', 'targetTime'], (res) => {
    if (res.dictionary) dictionary = res.dictionary;
    if (res.targetTime !== undefined) targetTime = res.targetTime;
    
    injectGuiguiWidget();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'UPDATE_DICT') {
        dictionary = request.dict;
        sendResponse({ success: true });
    } 
    else if (request.action === 'UPDATE_SPEED') {
        targetTime = request.timeMs;
        sendResponse({ success: true });
    }
});

function injectGuiguiWidget() {
    if (document.getElementById('guigui-container')) return;
    
    const container = document.createElement('div');
    container.id = 'guigui-container';
    container.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 30px;
        z-index: 999999;
        font-family: 'Inter', sans-serif;
        user-select: none;
        display: flex;
        flex-direction: column-reverse;
        align-items: flex-start;
        gap: 10px;
    `;
    
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: rgba(9, 9, 11, 0.95);
        backdrop-filter: blur(12px);
        padding: 12px 24px;
        border-radius: 50px;
        color: white;
        cursor: pointer;
        border: 1px solid #27272a;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        gap: 12px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    
    const text = document.createElement('span');
    text.style.cssText = `
        font-weight: 800;
        font-size: 16px;
        background: linear-gradient(90deg, #a855f7, #06b6d4);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: 1px;
        text-transform: uppercase;
    `;
    text.textContent = 'Resolver';
    
    const status = document.createElement('span');
    status.style.fontSize = '18px';
    status.textContent = '❌'; 
    status.id = 'guigui-status';
    
    panel.appendChild(text);
    panel.appendChild(status);
    panel.id = 'guigui-panel';
    
    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
        background: rgba(24, 24, 27, 0.95);
        backdrop-filter: blur(12px);
        border-radius: 12px;
        border: 1px solid #27272a;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px);
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.8);
    `;
    
    const btnHighlight = createDropdownBtn('🟢 Surligneur');
    const btnAuto = createDropdownBtn('⚡ Auto-Resolve');
    const btnOff = createDropdownBtn('❌ Désactivé (Legit)');
    
    dropdown.appendChild(btnHighlight);
    dropdown.appendChild(btnAuto);
    dropdown.appendChild(btnOff);
    
    let menuOpen = false;
    
    function setMode(mode) {
        chrome.storage.local.get(['userState'], (res) => {
            const state = res.userState;
            
            if (mode !== 'OFF') {
                if (!state) {
                    alert("🔒 Veuillez vous connecter dans l'extension !");
                    return;
                }
                const isInfinite = ['owner', 'vip', 'ami'].includes(state.role);
                if (!isInfinite && state.credits <= 0) {
                    alert("🔒 Vous n'avez plus de crédits.");
                    return;
                }
            }

            guiguiMode = mode;
            if (mode === 'OFF') {
                status.textContent = '❌';
                panel.style.border = '1px solid #27272a';
                removeHighlights();
            } else if (mode === 'HIGHLIGHT') {
                status.textContent = '🟢';
                panel.style.border = '1px solid #10b981';
            } else if (mode === 'AUTO') {
                status.textContent = '⚡';
                panel.style.border = '1px solid #a855f7';
                removeHighlights();
                if (getMatchTiles().length >= 12 && !isSolving) {
                    startAutoSolveSequence();
                }
            }
            closeMenu();
        });
    }
    
    btnOff.onclick = () => setMode('OFF');
    btnHighlight.onclick = () => setMode('HIGHLIGHT');
    btnAuto.onclick = () => setMode('AUTO');
    
    function closeMenu() {
        menuOpen = false;
        dropdown.style.opacity = '0';
        dropdown.style.visibility = 'hidden';
        dropdown.style.transform = 'translateY(10px)';
    }
    
    function openMenu() {
        menuOpen = true;
        dropdown.style.opacity = '1';
        dropdown.style.visibility = 'visible';
        dropdown.style.transform = 'translateY(0)';
    }
    
    panel.addEventListener('click', () => {
        if (menuOpen) closeMenu();
        else openMenu();
    });
    
    panel.addEventListener('mouseover', () => {
        panel.style.transform = 'translateY(-3px)';
        panel.style.boxShadow = '0 15px 35px -5px rgba(168, 85, 247, 0.4)';
    });
    panel.addEventListener('mouseout', () => {
        panel.style.transform = 'translateY(0)';
        panel.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.5)';
    });
    
    container.appendChild(panel);
    container.appendChild(dropdown);
    document.body.appendChild(container);
    
    observeGameStart();
    setupHighlighter();
}

function createDropdownBtn(text) {
    const btn = document.createElement('div');
    btn.textContent = text;
    btn.style.cssText = `
        padding: 8px 16px;
        color: #f4f4f5;
        font-size: 14px;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.2s;
    `;
    btn.addEventListener('mouseover', () => btn.style.background = 'rgba(255,255,255,0.05)');
    btn.addEventListener('mouseout', () => btn.style.background = 'transparent');
    return btn;
}

function getMatchTiles() {
    const tiles = [];
    const seenEls = new Set();
    const allElements = Array.from(document.querySelectorAll('*'));
    
    for (const el of allElements) {
        if (el.children.length > 0 && !el.classList.contains('FormattedText')) continue;
        
        const text = el.textContent.trim();
        if (text && dictionary[text]) {
            let clickable = el;
            while (clickable && clickable !== document.body) {
                if (clickable.tagName === 'BUTTON' || clickable.getAttribute('role') === 'button' || clickable.hasAttribute('tabindex') || clickable.classList.contains('AssemblyCard-content')) {
                    break;
                }
                clickable = clickable.parentElement;
            }
            if (!clickable || clickable === document.body) {
                clickable = el.parentElement || el;
            }
            
            if (!seenEls.has(clickable)) {
                seenEls.add(clickable);
                tiles.push({ element: clickable, text: text });
            }
        }
    }
    return tiles;
}

// HIGHILIGHTER LOGIC
let currentHovered = null;
let highlightCreditConsumed = false;

function setupHighlighter() {
    document.addEventListener('mouseover', (e) => {
        if (guiguiMode !== 'HIGHLIGHT') return; 
        
        const tiles = getMatchTiles();
        let hoveredTile = null;
        for (let t of tiles) {
            if (t.element === e.target || t.element.contains(e.target)) {
                hoveredTile = t;
                break;
            }
        }
        
        if (hoveredTile) {
            if (currentHovered === hoveredTile.element) return;
            
            if (!highlightCreditConsumed && tiles.length >= 12) {
                chrome.runtime.sendMessage({ action: 'CONSUME_CREDIT' });
                highlightCreditConsumed = true;
            }
            
            removeHighlights();
            currentHovered = hoveredTile.element;
            
            hoveredTile.element.classList.add('qz-highlight-active');
            const pairText = dictionary[hoveredTile.text];
            
            tiles.forEach(t => {
                if (t.text === pairText && t.element !== hoveredTile.element) {
                    t.element.classList.add('qz-highlight-pair');
                }
            });
        }
    });

    document.addEventListener('mouseout', (e) => {
        if (!currentHovered) return;
        const tiles = getMatchTiles();
        let isStillHovering = false;
        for (let t of tiles) {
            if (t.element === e.relatedTarget || t.element.contains(e.relatedTarget)) {
                isStillHovering = true;
                break;
            }
        }
        if (!isStillHovering) {
            removeHighlights();
            currentHovered = null;
        }
    });
}

function removeHighlights() {
    document.querySelectorAll('.qz-highlight-active, .qz-highlight-pair').forEach(el => {
        el.classList.remove('qz-highlight-active', 'qz-highlight-pair');
    });
}

// GAME START DETECTOR
let gameObserver = null;
function observeGameStart() {
    if (gameObserver) return;
    gameObserver = new MutationObserver((mutations) => {
        const tiles = getMatchTiles();
        
        if (tiles.length === 0) {
            highlightCreditConsumed = false;
        }
        
        if (guiguiMode !== 'AUTO' || isSolving) return;
        
        if (tiles.length >= 12) {
            isSolving = true;
            setTimeout(() => {
                startAutoSolveSequence().catch(e => {
                    isSolving = false;
                });
            }, 500);
        }
    });
    gameObserver.observe(document.body, { childList: true, subtree: true });
}

// AUTO SOLVE LOGIC
function startAutoSolveSequence() {
    return new Promise((resolve, reject) => {
        if (Object.keys(dictionary).length === 0) {
            isSolving = false;
            return reject(new Error("Dictionary is empty."));
        }

        let tiles = getMatchTiles();
        if (tiles.length === 0) {
            isSolving = false;
            return reject(new Error("No matching tiles found."));
        }

        chrome.storage.local.get(['userState'], (res) => {
            const state = res.userState;
            if (!state) {
                isSolving = false;
                alert("🔒 Veuillez vous connecter dans l'extension !");
                return reject(new Error("No auth"));
            }
            const isInfinite = ['owner', 'vip', 'ami'].includes(state.role);
            if (!isInfinite && state.credits <= 0) {
                isSolving = false;
                alert("🔒 Plus de crédits !");
                guiguiMode = 'OFF';
                document.getElementById('guigui-panel').style.border = '1px solid #27272a';
                document.getElementById('guigui-status').textContent = '❌';
                return reject(new Error("No credits"));
            }
            
            // Check VIP speeds enforcement
            let actualTargetTime = targetTime;
            if (actualTargetTime < 1900 && !isInfinite) {
                actualTargetTime = 1900; 
            }

            chrome.runtime.sendMessage({ action: 'CONSUME_CREDIT' });

            isSolving = true;
            const matchedPairs = [];
            const used = new Set();

            for (let i = 0; i < tiles.length; i++) {
                if (used.has(i)) continue;
                const tileA = tiles[i];
                const targetText = dictionary[tileA.text];

                for (let j = 0; j < tiles.length; j++) {
                    if (i !== j && !used.has(j)) {
                        const tileB = tiles[j];
                        if (tileB.text === targetText) {
                            matchedPairs.push([tileA.element, tileB.element]);
                            used.add(i);
                            used.add(j);
                            break;
                        }
                    }
                }
            }

            const clickEl = (el) => {
                el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                el.click();
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
            };

            const sleep = ms => new Promise(r => setTimeout(r, ms));
            
            const numPairs = matchedPairs.length || 6;
            const startTime = performance.now();

            (async function processPairs() {
                for (let i = 0; i < matchedPairs.length; i++) {
                    if (guiguiMode !== 'AUTO') break; 
                    
                    const [elA, elB] = matchedPairs[i];
                    clickEl(elA);
                    
                    await sleep(20); 
                    clickEl(elB);

                    const expectedTime = startTime + (actualTargetTime / numPairs) * (i + 1);
                    const now = performance.now();
                    const timeToWait = expectedTime - now;
                    
                    if (timeToWait > 0) {
                        await sleep(timeToWait); 
                    }
                }
                isSolving = false;
                resolve();
            })();
        });
    });
}
