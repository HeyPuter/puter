const PUTER_API = 'https://api.puter.com';

async function getAnonToken() {
    const res = await fetch(`${PUTER_API}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_temp: true })
    });
    if (!res.ok) throw new Error(`signup failed: ${res.status}`);
    const data = await res.json();
    return data.token ?? data.auth_token ?? data.tmp_token ?? null;
}

async function initPuterAnon() {
    if (!window.puter) throw new Error('puter.js not loaded');
    if (window.puter.authToken) return;
    const token = await getAnonToken();
    if (!token) throw new Error('no token in response');
    window.puter.setAuthToken(token);
    console.log('[anon] token set:', token.slice(0, 16) + '...');
}

async function startRefreshLoop() {
    await initPuterAnon();
    setInterval(async () => {
        try { await initPuterAnon(); }
        catch(e) { console.warn('[anon] refresh failed:', e.message); }
    }, 29 * 60 * 1000);
}

startRefreshLoop().catch(e => console.error('[anon]', e));
