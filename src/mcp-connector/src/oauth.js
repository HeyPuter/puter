// OAuth 2.0 bridge: lets MCP clients (e.g. Claude Code) obtain the caller's
// Puter token automatically instead of pasting it.
//
// The worker IS the authorization server. It never opens a browser — the MCP
// client does, by navigating to /authorize. From there:
//
//   client → GET  /authorize            -> 302 to puter.com/?action=authme&redirectURL=<worker>/oauth/callback?flow=…
//   (user logs in + approves on puter.com; Puter 302s back with ?token=…)
//   puter  → GET  /oauth/callback       -> 302 to <client redirect_uri>?code=…&state=…
//   client → POST /token                -> { access_token: <puter token> }
//   client → MCP calls with Authorization: Bearer <puter token>   (the existing path)
//
// Stateless: the short-lived `flow` (authorize→callback) and `code`
// (callback→token) blobs are AES-GCM sealed with a worker secret, so nothing is
// persisted. PKCE (S256) is enforced when the client provides a challenge.
//
// Discovery: serves RFC 8414 (authorization-server) and RFC 9728
// (protected-resource) metadata, plus RFC 7591 dynamic client registration.

const DEFAULT_GUI_ORIGIN = 'https://puter.com';
const FLOW_TTL_MS = 10 * 60 * 1000; // authorize -> callback
const CODE_TTL_MS = 5 * 60 * 1000; // callback  -> token

const guiOrigin = () => globalThis.puter_gui_origin || DEFAULT_GUI_ORIGIN;

// A stable secret is required to seal/unseal across requests and isolates.
// Set it in production: `wrangler secret put OAUTH_SECRET`. The dev fallback
// keeps local `wrangler dev` working but must NOT be relied on in production.
const secretString = () =>
    globalThis.OAUTH_SECRET || 'puter-mcp-dev-insecure-secret-change-me';

const originOf = (request) => {
    let originalOrigin = new URL(request.url).origin;
    if (originalOrigin.includes('workers.dev') && globalThis.OVERRIDE_ORIGIN) {
        return globalThis.OVERRIDE_ORIGIN;
    }
    return originalOrigin;
    
};

// ---- base64url + AES-GCM sealing ------------------------------------------

function b64urlEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
}

async function aesKey() {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretString()));
    return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function seal(obj) {
    const key = await aesKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0);
    out.set(ct, iv.length);
    return b64urlEncode(out);
}

async function unseal(blob) {
    const key = await aesKey();
    const raw = b64urlDecode(blob);
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt));
}

async function sha256b64url(str) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return b64urlEncode(new Uint8Array(h));
}

// ---- response helpers ------------------------------------------------------

// Every OAuth response is per-request (sealed flow/code blobs, one-time auth
// codes, tokens) and MUST NOT be cached. Without this, a caching layer in front
// of the worker (e.g. the puter.com zone) can replay one user's /authorize
// redirect — and thus their stale callback port / code — to everyone.
// RFC 6749 §5.1 also mandates no-store on the token endpoint.
const NO_STORE = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
};

function json(status, obj) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', ...NO_STORE },
    });
}

function redirect(location) {
    return new Response(null, {
        status: 302,
        headers: { Location: location, 'Access-Control-Allow-Origin': '*', ...NO_STORE },
    });
}

function redirectWithParams(baseUrl, params) {
    const u = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    }
    return redirect(u.href);
}

// ---- metadata (RFC 8414 / RFC 9728) ---------------------------------------

function authServerMetadata(event) {
    const origin = originOf(event.request);
    return json(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256', 'plain'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['puter'],
    });
}

function protectedResourceMetadata(event) {
    const origin = originOf(event.request);
    return json(200, {
        resource: origin,
        authorization_servers: [origin],
    });
}

// ---- endpoints -------------------------------------------------------------

// GET /authorize — kick off the flow by sending the browser to Puter's authme.
async function authorize(event) {
    const p = new URL(event.request.url).searchParams;
    const responseType = p.get('response_type');
    const redirectUri = p.get('redirect_uri');
    const clientState = p.get('state') || '';
    const codeChallenge = p.get('code_challenge') || '';
    const codeChallengeMethod = p.get('code_challenge_method') || (codeChallenge ? 'plain' : '');

    if (responseType !== 'code' || !redirectUri) {
        return json(400, {
            error: 'invalid_request',
            error_description: 'response_type=code and redirect_uri are required',
        });
    }

    const flow = await seal({
        redirectUri,
        clientState,
        codeChallenge,
        codeChallengeMethod,
        ts: Date.now(),
    });

    const callbackUrl = `${originOf(event.request)}/oauth/callback?flow=${encodeURIComponent(flow)}`;
    const dest = `${guiOrigin()}/?action=authme&redirectURL=${encodeURIComponent(callbackUrl)}`;
    return redirect(dest);
}

// GET /oauth/callback — Puter redirected here with ?token=… ; mint an auth code.
async function callback(event) {
    const params = new URL(event.request.url).searchParams;
    const flowBlob = params.get('flow');
    const token = params.get('token');

    let flow;
    try {
        flow = await unseal(flowBlob);
    } catch {
        return json(400, { error: 'invalid_request', error_description: 'invalid or missing flow' });
    }
    if (!flow || Date.now() - flow.ts > FLOW_TTL_MS) {
        return json(400, { error: 'invalid_request', error_description: 'authorization flow expired' });
    }

    // No token => user declined the authme consent (or Puter returned nothing).
    if (!token) {
        return redirectWithParams(flow.redirectUri, { error: 'access_denied', state: flow.clientState });
    }

    const code = await seal({
        token,
        codeChallenge: flow.codeChallenge,
        codeChallengeMethod: flow.codeChallengeMethod,
        ts: Date.now(),
    });
    return redirectWithParams(flow.redirectUri, { code, state: flow.clientState });
}

async function parseForm(request) {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        const obj = await request.json().catch(() => ({}));
        return new URLSearchParams(Object.entries(obj).map(([k, v]) => [k, String(v)]));
    }
    return new URLSearchParams(await request.text());
}

// POST /token — exchange the auth code (+PKCE) for the Puter token.
async function token(event) {
    const form = await parseForm(event.request);
    if (form.get('grant_type') !== 'authorization_code') {
        return json(400, { error: 'unsupported_grant_type' });
    }

    const code = form.get('code') || '';
    const verifier = form.get('code_verifier') || '';

    let payload;
    try {
        payload = await unseal(code);
    } catch {
        return json(400, { error: 'invalid_grant', error_description: 'invalid authorization code' });
    }
    if (!payload || Date.now() - payload.ts > CODE_TTL_MS) {
        return json(400, { error: 'invalid_grant', error_description: 'authorization code expired' });
    }

    // PKCE: enforce only if the client supplied a challenge at /authorize.
    if (payload.codeChallenge) {
        const ok = payload.codeChallengeMethod === 'S256'
            ? (await sha256b64url(verifier)) === payload.codeChallenge
            : verifier === payload.codeChallenge;
        if (!ok) {
            return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        }
    }

    // The access token IS the Puter token — the bearer path consumes it as-is.
    return json(200, { access_token: payload.token, token_type: 'Bearer', scope: 'puter' });
}

// POST /register — dynamic client registration (RFC 7591). We don't persist
// clients; security rests on PKCE + the redirect_uri sealed into the flow.
async function register(event) {
    const body = await event.request.json().catch(() => ({}));
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    return json(201, {
        client_id: `puter-mcp-${crypto.randomUUID()}`,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: redirectUris,
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
    });
}

/** Attach the OAuth routes to the (already-initialized) router. */
export default function registerOAuthRoutes(router) {
    router.get('/.well-known/oauth-authorization-server', authServerMetadata);
    router.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
    // Path-suffixed variants some clients probe (resource = the /mcp endpoint).
    router.get('/.well-known/oauth-authorization-server/mcp', authServerMetadata);
    router.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);
    router.post('/register', register);
    router.get('/authorize', authorize);
    router.get('/oauth/callback', callback);
    router.post('/token', token);
}
