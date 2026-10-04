const API_KEY = "AIzaSyBxwcmQmIHzyAusOlyTj1BTA5H0ZK0hVS4";
const PROJECT_ID = "quizlet-a8498";

async function signIn(email, password) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
}

async function signUp(email, password) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
}

async function sendVerificationEmail(idToken) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: "VERIFY_EMAIL", idToken })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
}

async function checkEmailVerified(idToken) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.users[0].emailVerified;
}

async function getUserData(uid, idToken) {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
    });
    const data = await res.json();
    if (data.error) {
        if (data.error.code === 404) return null;
        if (data.error.code === 403) throw new Error("Erreur de Base de données. Demandez à Guigui de configurer Firestore Rules.");
        throw new Error(data.error.message);
    }
    
    let resolverCredits = 0;
    let highlighterCredits = 0;
    if (data.fields.resolverCredits) {
        resolverCredits = parseInt(data.fields.resolverCredits.integerValue || data.fields.resolverCredits.doubleValue || data.fields.resolverCredits.stringValue || 0);
    } else if (data.fields.credits) {
        resolverCredits = parseInt(data.fields.credits.integerValue || data.fields.credits.doubleValue || data.fields.credits.stringValue || 0);
    }
    
    if (data.fields.highlighterCredits) {
        highlighterCredits = parseInt(data.fields.highlighterCredits.integerValue || data.fields.highlighterCredits.doubleValue || data.fields.highlighterCredits.stringValue || 0);
    } else if (data.fields.credits) {
        highlighterCredits = 5;
    }

    return {
        role: data.fields.role?.stringValue || 'user',
        resolverCredits: isNaN(resolverCredits) ? 0 : resolverCredits,
        highlighterCredits: isNaN(highlighterCredits) ? 0 : highlighterCredits
    };
}

async function updateUserData(uid, idToken, userData) {
    const fields = {};
    const updateMask = [];
    if (userData.role !== undefined) {
        fields.role = { stringValue: userData.role };
        updateMask.push('role');
    }
    if (userData.resolverCredits !== undefined) {
        fields.resolverCredits = { integerValue: userData.resolverCredits };
        updateMask.push('resolverCredits');
    }
    if (userData.highlighterCredits !== undefined) {
        fields.highlighterCredits = { integerValue: userData.highlighterCredits };
        updateMask.push('highlighterCredits');
    }
    
    const query = updateMask.map(m => `updateMask.fieldPaths=${m}`).join('&');
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}?${query}`, {
        method: 'PATCH',
        headers: { 
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'LOGIN') {
        signIn(request.email, request.password)
            .then(async (user) => {
                const isVerified = await checkEmailVerified(user.idToken);
                if (!isVerified) {
                    throw new Error("EMAIL_NOT_VERIFIED");
                }

                let data = await getUserData(user.localId, user.idToken);
                if (!data) {
                    await updateUserData(user.localId, user.idToken, { role: 'user', resolverCredits: 2, highlighterCredits: 5 });
                    data = { role: 'user', resolverCredits: 2, highlighterCredits: 5 };
                }

                await chrome.storage.local.set({ 
                    userState: data, 
                    token: user.idToken, 
                    uid: user.localId,
                    email: user.email
                });
                sendResponse({ success: true, data, email: user.email });
            })
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
    
    if (request.action === 'REGISTER') {
        signUp(request.email, request.password)
            .then(async (user) => {
                await sendVerificationEmail(user.idToken);
                sendResponse({ success: true });
            })
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
    
    if (request.action === 'REFRESH_USER') {
        chrome.storage.local.get(['uid', 'token', 'email'], async (res) => {
            if (!res.uid || !res.token) {
                sendResponse({ success: false });
                return;
            }
            try {
                let data = await getUserData(res.uid, res.token);
                if (!data) data = { role: 'user', resolverCredits: 0, highlighterCredits: 0 };
                
                await chrome.storage.local.set({ userState: data });
                sendResponse({ success: true, data, email: res.email });
            } catch(e) {
                sendResponse({ success: false, error: e.message });
            }
        });
        return true;
    }

    if (request.action === 'CONSUME_CREDIT') {
        const type = request.type;
        chrome.storage.local.get(['userState', 'token', 'uid'], (res) => {
            if (!res.userState || !res.token || !res.uid) return;
            
            const role = res.userState.role;
            if (role === 'owner' || role === 'vip' || role === 'ami') {
                return; 
            }
            
            let resolverCredits = res.userState.resolverCredits;
            let highlighterCredits = res.userState.highlighterCredits;
            
            if (type === 'resolver' && resolverCredits > 0) {
                resolverCredits--;
                const newState = { ...res.userState, resolverCredits };
                chrome.storage.local.set({ userState: newState });
                updateUserData(res.uid, res.token, { resolverCredits }).catch(console.error);
            } else if (type === 'highlighter' && highlighterCredits > 0) {
                highlighterCredits--;
                const newState = { ...res.userState, highlighterCredits };
                chrome.storage.local.set({ userState: newState });
                updateUserData(res.uid, res.token, { highlighterCredits }).catch(console.error);
            }
        });
    }
});
