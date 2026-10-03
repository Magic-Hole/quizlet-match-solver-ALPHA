document.addEventListener('DOMContentLoaded', () => {
    const btnScan = document.getElementById('btnScan');
    const scanLoader = document.getElementById('scanLoader');
    const dictStatus = document.getElementById('dictStatus');
    const statusEl = document.getElementById('status');
    const presetBtns = document.querySelectorAll('.preset-btn');
    
    // Auth elements
    const authView = document.getElementById('auth-view');
    const mainView = document.getElementById('main-view');
    const emailInput = document.getElementById('emailInput');
    const passwordInput = document.getElementById('passwordInput');
    const btnLogin = document.getElementById('btnLogin');
    const btnRegister = document.getElementById('btnRegister');
    const authError = document.getElementById('authError');
    const authSuccess = document.getElementById('authSuccess');
    
    // User profile elements
    const userEmailDisplay = document.getElementById('userEmailDisplay');
    const userRoleDisplay = document.getElementById('userRoleDisplay');
    const userCreditsDisplay = document.getElementById('userCreditsDisplay');
    
    const btnLogout = document.getElementById('btnLogout');
    const btnRefresh = document.getElementById('btnRefresh');

    function updateView(state, email) {
        if (!state) {
            authView.style.display = 'block';
            mainView.style.display = 'none';
        } else {
            authView.style.display = 'none';
            mainView.style.display = 'flex';
            
            userEmailDisplay.textContent = email || "Utilisateur";
            userRoleDisplay.textContent = `Rôle : ${state.role.toUpperCase()}`;
            
            const isInfinite = ['owner', 'vip', 'ami'].includes(state.role);
            if (isInfinite) {
                userCreditsDisplay.textContent = `Crédits : Infinis 🌟`;
                userCreditsDisplay.style.color = 'var(--accent-1)';
            } else {
                userCreditsDisplay.textContent = `Crédits : ${state.credits}`;
                userCreditsDisplay.style.color = state.credits > 0 ? 'var(--accent-2)' : '#ef4444';
            }
        }
    }

    // Load saved settings
    chrome.storage.local.get(['userState', 'email', 'dictionary', 'targetTime'], (res) => {
        updateView(res.userState, res.email);

        if (res.dictionary) {
            const count = Object.keys(res.dictionary).length / 2;
            dictStatus.textContent = `${count} mots chargés`;
        }
        if (res.targetTime !== undefined) {
            updateSpeedUI(res.targetTime);
        } else {
            updateSpeedUI(3000);
        }
    });

    function handleErrorMsg(msg) {
        if (msg.includes("EMAIL_EXISTS")) return "Cet email est déjà pris.";
        if (msg.includes("INVALID_LOGIN_CREDENTIALS")) return "Email ou mot de passe incorrect.";
        if (msg.includes("WEAK_PASSWORD")) return "Le mot de passe doit faire 6 caractères minimum.";
        if (msg.includes("MISSING_PASSWORD")) return "Veuillez entrer un mot de passe.";
        if (msg.includes("EMAIL_NOT_VERIFIED")) return "Veuillez cliquer sur le lien de vérification envoyé par email avant de vous connecter.";
        return msg;
    }

    btnLogin.addEventListener('click', () => {
        if (!emailInput.value) return;
        authSuccess.textContent = "";
        authError.style.color = "var(--text-muted)";
        authError.textContent = "Connexion en cours...";
        chrome.runtime.sendMessage({
            action: 'LOGIN',
            email: emailInput.value,
            password: passwordInput.value
        }, (res) => {
            if (res.success) {
                authError.textContent = "";
                updateView(res.data, res.email);
            } else {
                authError.style.color = "#ef4444";
                authError.textContent = handleErrorMsg(res.error);
            }
        });
    });

    btnRegister.addEventListener('click', () => {
        if (!emailInput.value) return;
        authSuccess.textContent = "";
        authError.style.color = "var(--text-muted)";
        authError.textContent = "Création du compte...";
        chrome.runtime.sendMessage({
            action: 'REGISTER',
            email: emailInput.value,
            password: passwordInput.value
        }, (res) => {
            if (res.success) {
                authError.textContent = "";
                authSuccess.textContent = "✅ Un lien de vérification a été envoyé à cet email. Veuillez cliquer dessus puis vous connecter.";
            } else {
                authSuccess.textContent = "";
                authError.style.color = "#ef4444";
                authError.textContent = handleErrorMsg(res.error);
            }
        });
    });

    btnRefresh.addEventListener('click', (e) => {
        e.preventDefault();
        const originalText = btnRefresh.textContent;
        btnRefresh.textContent = "Chargement...";
        chrome.runtime.sendMessage({ action: 'REFRESH_USER' }, (res) => {
            if (res.success) {
                updateView(res.data, res.email);
                btnRefresh.textContent = "Rafraîchir";
            } else {
                btnRefresh.textContent = "Erreur";
                setTimeout(() => btnRefresh.textContent = originalText, 2000);
            }
        });
    });

    btnLogout.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.storage.local.remove(['userState', 'token', 'uid', 'email']);
        updateView(null);
    });

    function updateSpeedUI(timeMs) {
        chrome.storage.local.set({ targetTime: parseInt(timeMs) });
        presetBtns.forEach(b => {
            if (parseInt(b.dataset.time) === parseInt(timeMs)) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
        
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'UPDATE_SPEED', timeMs: parseInt(timeMs) }).catch(()=>{});
            }
        });
    }

    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const timeMs = parseInt(btn.dataset.time);
            
            if (timeMs < 1900) {
                chrome.storage.local.get(['userState'], (res) => {
                    const state = res.userState;
                    if (!state) {
                        alert("Veuillez vous connecter pour utiliser les vitesses VIP !");
                        return;
                    }
                    const isInfinite = ['owner', 'vip', 'ami'].includes(state.role);
                    if (!isInfinite) {
                        alert("⭐ Cette vitesse est réservée aux membres VIP !");
                        return;
                    }
                    updateSpeedUI(timeMs);
                });
            } else {
                updateSpeedUI(timeMs);
            }
        });
    });

    function showStatus(msg, type="success") {
        statusEl.textContent = msg;
        statusEl.style.color = type === "error" ? "#ef4444" : "var(--accent-2)";
        setTimeout(() => statusEl.textContent = "", 3000);
    }

    btnScan.addEventListener('click', () => {
        btnScan.disabled = true;
        scanLoader.style.display = 'inline-block';
        
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.scripting.executeScript({
                    target: {tabId: tabs[0].id},
                    world: 'MAIN',
                    func: () => {
                        let dict = {};
                        function findTerms(obj) {
                            if (!obj || typeof obj !== 'object') return false;
                            if (Array.isArray(obj) && obj.length > 0 && obj[0].cardSides) {
                                obj.forEach(t => {
                                    try {
                                        const w = t.cardSides[0].media[0].plainText;
                                        const d = t.cardSides[1].media[0].plainText;
                                        if (w && d) { dict[w] = d; dict[d] = w; }
                                    } catch(e) {}
                                });
                                return true;
                            }
                            if (obj && !Array.isArray(obj) && Object.keys(obj).length > 0) {
                                const fk = Object.keys(obj)[0];
                                if (obj[fk] && obj[fk].word && obj[fk].definition) {
                                    Object.values(obj).forEach(t => {
                                        if (t.word && t.definition) { dict[t.word] = t.definition; dict[t.definition] = t.word; }
                                    });
                                    return true;
                                }
                            }
                            for (const k in obj) {
                                if (obj.hasOwnProperty(k) && (k === 'studiableItems' || k === 'termIdToTermsMap' || k === 'terms' || typeof obj[k] === 'object')) {
                                    if (findTerms(obj[k])) return true;
                                }
                            }
                            return false;
                        }
                        
                        try {
                            if (window.__NEXT_DATA__) findTerms(window.__NEXT_DATA__);
                            if (Object.keys(dict).length === 0 && window.Quizlet) findTerms(window.Quizlet);
                            
                            if (Object.keys(dict).length === 0) {
                                const texts = document.querySelectorAll('.TermText, span.TermText');
                                if (texts.length >= 2) {
                                    for(let i=0; i<texts.length-1; i+=2) {
                                        const w = texts[i].innerText.trim();
                                        const d = texts[i+1].innerText.trim();
                                        if(w && d) { dict[w] = d; dict[d] = w; }
                                    }
                                }
                            }
                        } catch(e) {}
                        return dict;
                    }
                }, (injectionResults) => {
                    btnScan.disabled = false;
                    scanLoader.style.display = 'none';
                    if (chrome.runtime.lastError) {
                        showStatus("Veuillez recharger la page.", "error");
                    } else if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                        const dict = injectionResults[0].result;
                        if (Object.keys(dict).length > 0) {
                            chrome.storage.local.set({ dictionary: dict });
                            const count = Object.keys(dict).length / 2;
                            dictStatus.textContent = `${count} mots chargés`;
                            showStatus("Scanner réussi !");
                            chrome.tabs.sendMessage(tabs[0].id, { action: 'UPDATE_DICT', dict: dict }).catch(()=>{});
                        } else {
                            showStatus("Dico vide. Descendez ?", "error");
                        }
                    } else {
                        showStatus("Échec", "error");
                    }
                });
            }
        });
    });
});
