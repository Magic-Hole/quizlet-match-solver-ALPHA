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
    
    let credits = 0;
    if (data.fields.credits) {
        if (data.fields.credits.integerValue !== undefined) credits = parseInt(data.fields.credits.integerValue);
        else if (data.fields.credits.doubleValue !== undefined) credits = parseInt(data.fields.credits.doubleValue);
        else if (data.fields.credits.stringValue !== undefined) credits = parseInt(data.fields.credits.stringValue);
    }

    return {
        role: data.fields.role?.stringValue || 'user',
        credits: isNaN(credits) ? 0 : credits
    };
}

async function updateUserData(uid, idToken, userData) {
    const fields = {};
    const updateMask = [];
    if (userData.role !== undefined) {
        fields.role = { stringValue: userData.role };
        updateMask.push('role');
    }
    if (userData.credits !== undefined) {
        fields.credits = { integerValue: userData.credits };
        updateMask.push('credits');
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
                    await updateUserData(user.localId, user.idToken, { role: 'user', credits: 3 });
                    data = { role: 'user', credits: 3 };
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
                if (!data) data = { role: 'user', credits: 0 };
                
                await chrome.storage.local.set({ userState: data });
                sendResponse({ success: true, data, email: res.email });
            } catch(e) {
                sendResponse({ success: false, error: e.message });
            }
        });
        return true;
    }

    if (request.action === 'CONSUME_CREDIT') {
        chrome.storage.local.get(['userState', 'token', 'uid'], (res) => {
            if (!res.userState || !res.token || !res.uid) return;
            
            const role = res.userState.role;
            if (role === 'owner' || role === 'vip' || role === 'ami') {
                return; 
            }
            
            let credits = res.userState.credits;
            if (credits > 0) {
                credits--;
                const newState = { ...res.userState, credits };
                chrome.storage.local.set({ userState: newState });
                
                updateUserData(res.uid, res.token, { credits }).catch(console.error);
            }
        });
    }
});
