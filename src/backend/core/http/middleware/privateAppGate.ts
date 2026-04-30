import type { Request } from 'express';
import type { AuthService } from '../../../services/auth/AuthService';
import type { IConfig } from '../../../types';

/**
 * Support helpers for the private-app access gate — ported from v1's
 * `puterSiteMiddleware.js` (see `origin/main:src/backend/src/routers/
 * hosting/puterSiteMiddleware.js`). Split out because the middleware file
 * was getting long.
 *
 * Covers:
 *   - Host/subdomain parsing against `private_app_hosting_domain(_alt)`.
 *   - Broader private-app detection for hosted sites whose subdomain row
 *     has no `associated_app_id` — falls back to an `index_url` lookup
 *     against the subdomain owner's private apps.
 *   - Bootstrap-token identity resolution (`Authorization: Bearer`,
 *     `?puter.auth.token=`, `X-Puter-Auth-Token`, referrer query) so
 *     private-app visitors with a valid session token (but no cookie on
 *     the private host) can still be identified.
 *   - Building the redirect URL from a public hosting host (`puter.site`)
 *     to the private host (`puter.app`) when a private app is being
 *     served off the wrong domain.
 *
 * Sticky cookies (`puter.private.asset.token` for private apps,
 * `puter.public.hosted.actor.token` for public-hosted actors) are set
 * after a visitor passes the gate, and honored on subsequent requests
 * to skip the full entitlement lookup. See AuthService
 * `createPrivateAssetToken` / `createPublicHostedActorToken`.
 */

export interface PrivateHostingConfig {
    domain: string | null;
    staticDomains: string[];
    privateDomains: string[];
    /**
     * Raw hosting domain values (preserving port, if configured). Used for
     * `index_url` candidate generation — the DB stores URLs exactly as the
     * app was created, so dev setups with explicit ports like
     * `app.puter.localhost:4100` must be matched verbatim.
     */
    staticDomainsRaw: string[];
    privateDomainsRaw: string[];
    /** Configured protocol (e.g. `http` in dev, `https` in prod). */
    protocol: string;
}

export interface PrivateIdentity {
    source:
        | 'private-cookie'
        | 'session-cookie'
        | 'bootstrap-token'
        | 'authorization'
        | 'query'
        | 'referrer'
        | 'none';
    userUid?: string;
    sessionUuid?: string;
    /** True when resolved from the sticky `puter.private.asset.token` cookie. */
    hasValidPrivateCookie?: boolean;
}

interface SubdomainLike {
    user_id?: number | null;
    associated_app_id?: number | null;
}

interface AppLike {
    id?: number;
    uid?: string;
    name?: string;
    owner_user_id?: number;
    is_private?: boolean | number | null;
    index_url?: string | null;
}

interface DBClient {
    read: (
        sql: string,
        params: unknown[],
    ) => Promise<Record<string, unknown>[]>;
}

// ── Host helpers ────────────────────────────────────────────────────

export function normalizeHost(value: string | undefined | null): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase().replace(/^\./, '');
    if (!trimmed) return null;
    return trimmed.split(':')[0] || null;
}

/** Like `normalizeHost` but preserves port when present. */
export function normalizeHostRaw(
    value: string | undefined | null,
): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase().replace(/^\./, '');
    return trimmed || null;
}

export function buildHostingConfig(config: IConfig): PrivateHostingConfig {
    const staticRaw = [
        normalizeHostRaw(config.static_hosting_domain),
        normalizeHostRaw(config.static_hosting_domain_alt),
    ].filter((d): d is string => !!d);
    const privateRaw = [
        normalizeHostRaw(config.private_app_hosting_domain),
        normalizeHostRaw(config.private_app_hosting_domain_alt),
    ].filter((d): d is string => !!d);
    const rawProtocol =
        typeof config.protocol === 'string'
            ? config.protocol.trim().replace(/:$/, '')
            : '';
    return {
        domain: normalizeHost(config.domain),
        staticDomains: [
            normalizeHost(config.static_hosting_domain),
            normalizeHost(config.static_hosting_domain_alt),
        ].filter((d): d is string => !!d),
        privateDomains: [
            normalizeHost(config.private_app_hosting_domain),
            normalizeHost(config.private_app_hosting_domain_alt),
        ].filter((d): d is string => !!d),
        staticDomainsRaw: staticRaw,
        privateDomainsRaw: privateRaw,
        protocol: rawProtocol || 'https',
    };
}

export function hostMatchesPrivateDomain(
    host: string,
    privateDomains: string[],
): boolean {
    return privateDomains.some((pd) => host === pd || host.endsWith(`.${pd}`));
}

// ── Subdomain extraction from a hosted request ─────────────────────

export function subdomainFromHost(
    host: string,
    hostingDomains: string[],
): string {
    // Longest-first so `foo.bar.puter.app` matches `bar.puter.app` before
    // falling back to `puter.app`.
    const sorted = [...hostingDomains].sort((a, b) => b.length - a.length);
    for (const d of sorted) {
        const suffix = `.${d}`;
        if (host === d) return '';
        if (host.endsWith(suffix)) {
            const prefix = host.slice(0, host.length - suffix.length);
            return prefix.split('.')[0] || '';
        }
    }
    return host.split('.')[0] || '';
}

// ── Private-app detection fallback (v1 `resolvePrivateAppForHostedSite`)

/**
 * When the subdomain row has no `associated_app_id`, v1 looked up the
 * owner's private apps and matched `index_url` against the request host
 * variants (this-subdomain × every hosting domain). Ports that logic.
 *
 * Returns the matched private app (if any) so the caller can run the
 * normal access check — closes a gap where a private app's files could
 * be served via a subdomain whose row wasn't explicitly linked.
 */
export async function resolvePrivateAppForHostedSite(opts: {
    req: Request;
    site: SubdomainLike;
    associatedApp: AppLike | null;
    db: DBClient;
    config: PrivateHostingConfig;
    matchedHostingDomain: string;
}): Promise<AppLike | null> {
    // When the subdomain row's own `associated_app_id` points at a private
    // app, that wins outright. Otherwise fall through to index_url matching
    // so a private app whose canonical URL lives on one hosting variant
    // (`beans.puter.site`) still resolves when the visitor hits another
    // (`beans.puter.app`).
    if (opts.associatedApp && Number(opts.associatedApp.is_private ?? 0) > 0) {
        return opts.associatedApp;
    }
    if (!opts.site?.user_id) return opts.associatedApp ?? null;

    const host = normalizeHost(opts.req.hostname);
    if (!host) return opts.associatedApp ?? null;

    const hostedSubdomain = subdomainFromHost(host, [
        ...opts.config.staticDomains,
        ...opts.config.privateDomains,
    ]);
    if (!hostedSubdomain) return opts.associatedApp ?? null;

    // Build host variants with AND without port, then cross each with both
    // protocols. Apps store whatever URL the user typed at create time, so
    // we match liberally: ports-in-config (dev), the request's own header
    // host, and every configured hosting variant all count as equivalent.
    const hostCandidates = new Set<string>();
    hostCandidates.add(host);
    const headerHost =
        typeof opts.req.headers?.host === 'string'
            ? opts.req.headers.host.trim().toLowerCase()
            : '';
    if (headerHost) hostCandidates.add(headerHost);
    const hostingDomainVariants = [
        ...opts.config.staticDomains,
        ...opts.config.privateDomains,
        ...opts.config.staticDomainsRaw,
        ...opts.config.privateDomainsRaw,
    ];
    for (const d of hostingDomainVariants) {
        if (!d) continue;
        hostCandidates.add(`${hostedSubdomain}.${d}`);
    }

    const protocolCandidates = new Set<string>([
        opts.req.protocol || 'https',
        opts.config.protocol,
        'https',
        'http',
    ]);

    const urlCandidates: string[] = [];
    for (const hc of hostCandidates) {
        for (const protocol of protocolCandidates) {
            const base = `${protocol}://${hc}`;
            urlCandidates.push(base, `${base}/`, `${base}/index.html`);
        }
    }
    const uniqueCandidates = [...new Set(urlCandidates)];
    if (uniqueCandidates.length === 0) return opts.associatedApp ?? null;

    const placeholders = uniqueCandidates.map(() => '?').join(', ');
    const rows = await opts.db.read(
        `SELECT * FROM apps WHERE owner_user_id = ? AND is_private = 1 AND index_url IN (${placeholders}) LIMIT 2`,
        [opts.site.user_id, ...uniqueCandidates],
    );
    if (rows.length === 0) return opts.associatedApp ?? null;
    if (rows.length > 1) {
        console.warn('[puter-site] private_access.host_match_ambiguous', {
            requestHost: host,
            matchCount: rows.length,
        });
    }
    return rows[0] as unknown as AppLike;
}

// ── Bootstrap token resolution ──────────────────────────────────────

function getAuthorizationToken(req: Request): string | null {
    const header = req.headers?.authorization;
    if (typeof header !== 'string') return null;
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

function getQueryToken(req: Request): string | null {
    const q = req.query as Record<string, unknown> | undefined;
    const candidates = [q?.['puter.auth.token'], q?.auth_token];
    for (const v of candidates) {
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
}

function getHeaderToken(req: Request): string | null {
    const raw = req.headers?.['x-puter-auth-token'];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    return null;
}

function getReferrerToken(req: Request): string | null {
    const ref = req.headers?.referer || req.headers?.referrer;
    if (typeof ref !== 'string' || !ref.trim()) return null;
    try {
        const url = new URL(ref);
        return (
            url.searchParams.get('puter.auth.token') ||
            url.searchParams.get('auth_token')
        );
    } catch {
        return null;
    }
}

export function getBootstrapToken(
    req: Request,
): { token: string; source: PrivateIdentity['source'] } | null {
    const auth = getAuthorizationToken(req);
    if (auth) return { token: auth, source: 'authorization' };
    const q = getQueryToken(req);
    if (q) return { token: q, source: 'query' };
    const h = getHeaderToken(req);
    if (h) return { token: h, source: 'authorization' };
    const r = getReferrerToken(req);
    if (r) return { token: r, source: 'referrer' };
    return null;
}

/**
 * Resolve the acting user for a private-app hosted request. Lookup
 * order (first hit wins):
 *
 *   1. `puter.private.asset.token` cookie — the sticky cookie set
 *      after a previous successful entitlement check. Must match the
 *      expected app + subdomain + private host.
 *   2. `req.actor` from the auth probe (e.g. main session cookie on
 *      same-site requests).
 *   3. Raw session cookie fallback (cross-site drops the probe's read).
 *   4. Bootstrap token from Authorization / query / header / referrer.
 *
 * Returns `{source: 'none'}` when no identity can be established —
 * the caller then renders the login bootstrap page.
 */
export async function resolvePrivateIdentity(opts: {
    req: Request;
    authService: AuthService;
    sessionCookieName: string | undefined;
    expectedAppUid?: string;
    expectedSubdomain?: string;
    expectedPrivateHost?: string;
}): Promise<PrivateIdentity> {
    const {
        req,
        authService,
        sessionCookieName,
        expectedAppUid,
        expectedSubdomain,
        expectedPrivateHost,
    } = opts;

    const cookies = (req as Request & { cookies?: Record<string, string> })
        .cookies;

    // 1. Sticky private-asset cookie.
    const privateCookieName = authService.getPrivateAssetCookieName();
    const privateCookieToken =
        typeof cookies?.[privateCookieName] === 'string'
            ? cookies[privateCookieName]
            : null;
    if (privateCookieToken) {
        try {
            const claims = await authService.verifyPrivateAssetToken(
                privateCookieToken,
                {
                    expectedAppUid,
                    expectedSubdomain,
                    expectedPrivateHost,
                },
            );
            return {
                source: 'private-cookie',
                userUid: claims.userUid,
                sessionUuid: claims.sessionUuid,
                hasValidPrivateCookie: true,
            };
        } catch {
            /* fall through — stale / mismatched / logged-out cookie */
        }
    }

    // 2. Auth probe actor.
    const existingActor = req.actor;
    if (existingActor?.user?.uuid) {
        return {
            source: 'session-cookie',
            userUid: existingActor.user.uuid,
            sessionUuid: existingActor.session?.uid,
        };
    }

    // 3. Raw session cookie fallback.
    const sessionToken =
        sessionCookieName && typeof cookies?.[sessionCookieName] === 'string'
            ? cookies[sessionCookieName]
            : null;
    if (sessionToken) {
        try {
            const actor = await authService.authenticateFromToken(sessionToken);
            if (actor?.user?.uuid) {
                return {
                    source: 'session-cookie',
                    userUid: actor.user.uuid,
                    sessionUuid: actor.session?.uid,
                };
            }
        } catch {
            /* fall through */
        }
    }

    // 4. Bootstrap token.
    const bootstrap = getBootstrapToken(req);
    if (bootstrap) {
        try {
            const actor = await authService.authenticateFromToken(
                bootstrap.token,
            );
            if (actor?.user?.uuid) {
                return {
                    source: bootstrap.source,
                    userUid: actor.user.uuid,
                    sessionUuid: actor.session?.uid,
                };
            }
        } catch {
            /* fall through */
        }
    }

    return { source: 'none' };
}

/**
 * Mirror of `resolvePrivateIdentity` for public hosted apps. Reads the
 * sticky `puter.public.hosted.actor.token` cookie first, then the same
 * session/bootstrap fallbacks.
 */
export async function resolvePublicHostedIdentity(opts: {
    req: Request;
    authService: AuthService;
    sessionCookieName: string | undefined;
    expectedAppUid?: string;
    expectedSubdomain?: string;
    expectedHost?: string;
}): Promise<PrivateIdentity & { hasValidPublicCookie?: boolean }> {
    const {
        req,
        authService,
        sessionCookieName,
        expectedAppUid,
        expectedSubdomain,
        expectedHost,
    } = opts;

    const cookies = (req as Request & { cookies?: Record<string, string> })
        .cookies;

    const publicCookieName = authService.getPublicHostedActorCookieName();
    const publicCookieToken =
        typeof cookies?.[publicCookieName] === 'string'
            ? cookies[publicCookieName]
            : null;
    if (publicCookieToken) {
        try {
            const claims = authService.verifyPublicHostedActorToken(
                publicCookieToken,
                {
                    expectedAppUid,
                    expectedSubdomain,
                    expectedHost,
                },
            );
            return {
                source: 'private-cookie',
                userUid: claims.userUid,
                sessionUuid: claims.sessionUuid,
                hasValidPublicCookie: true,
            };
        } catch {
            /* fall through */
        }
    }

    const existingActor = req.actor;
    if (existingActor?.user?.uuid) {
        return {
            source: 'session-cookie',
            userUid: existingActor.user.uuid,
            sessionUuid: existingActor.session?.uid,
        };
    }

    const sessionToken =
        sessionCookieName && typeof cookies?.[sessionCookieName] === 'string'
            ? cookies[sessionCookieName]
            : null;
    if (sessionToken) {
        try {
            const actor = await authService.authenticateFromToken(sessionToken);
            if (actor?.user?.uuid) {
                return {
                    source: 'session-cookie',
                    userUid: actor.user.uuid,
                    sessionUuid: actor.session?.uid,
                };
            }
        } catch {
            /* fall through */
        }
    }

    const bootstrap = getBootstrapToken(req);
    if (bootstrap) {
        try {
            const actor = await authService.authenticateFromToken(
                bootstrap.token,
            );
            if (actor?.user?.uuid) {
                return {
                    source: bootstrap.source,
                    userUid: actor.user.uuid,
                    sessionUuid: actor.session?.uid,
                };
            }
        } catch {
            /* fall through */
        }
    }

    return { source: 'none' };
}

// ── Redirect helpers ────────────────────────────────────────────────

/** Build the URL to redirect a private-app request to its private host. */
export function buildPrivateHostRedirect(
    req: Request,
    app: AppLike,
    config: PrivateHostingConfig,
): string | null {
    // Prefer the raw configured value so dev setups that include a port
    // (`app.puter.localhost:4100`) produce a working redirect target.
    const privateDomain =
        config.privateDomainsRaw[0] ?? config.privateDomains[0];
    if (!privateDomain) return null;
    const host = normalizeHost(req.hostname);
    if (!host) return null;
    const subdomain = subdomainFromHost(host, [
        ...config.staticDomains,
        ...config.privateDomains,
    ]);
    if (!subdomain) return null;
    try {
        const protocol = config.protocol || req.protocol || 'https';
        const base = `${protocol}://${subdomain}.${privateDomain}`;
        const reqPath = (req.originalUrl || '/').startsWith('/')
            ? req.originalUrl || '/'
            : `/${req.originalUrl}`;
        return new URL(reqPath, base).toString();
    } catch {
        return null;
    }
    void app; // reserved for future use (logging)
}

/** Redirect URL when private access is denied — lands on the app-center listing. */
export function buildAppCenterFallback(
    app: AppLike,
    config: PrivateHostingConfig,
): string {
    if (!config.domain) return '/';
    const appName =
        typeof app?.name === 'string' && app.name.trim()
            ? app.name.trim()
            : null;
    if (!appName) {
        return `https://${config.domain}/app/app-center/?item=${encodeURIComponent(app?.uid ?? '')}`;
    }
    return `https://${config.domain}/app/app-center/?item=${encodeURIComponent(appName)}`;
}

// ── Login bootstrap HTML ────────────────────────────────────────────

/**
 * Minimal HTML page that prompts the visitor to sign in with Puter.
 * Uses puter.js's `auth.signIn` to get a token, then redirects back to
 * the same URL with `?puter.auth.token=…` so the middleware can resolve
 * identity on the next request.
 *
 * Kept inline (no template engine dependency). Ported from v1's
 * `respondPrivateLoginBootstrap` with non-essential bells removed.
 */
export function renderLoginBootstrapHtml(app: AppLike): string {
    const escape = (value: unknown): string =>
        String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    const title = escape(app?.title ?? app?.name ?? 'this app');
    const name = escape(app?.name ?? 'this app');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign In Required | ${title}</title>
<meta name="robots" content="noindex,nofollow" />
<style>
:root{color-scheme:light}
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(145deg,#f5f7fb,#eef2ff);color:#1f2937}
.card{width:min(480px,calc(100vw - 32px));background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 16px 40px rgba(15,23,42,.08);padding:24px}
h1{margin:0 0 12px;font-size:22px;line-height:1.2}
p{margin:0 0 16px;line-height:1.45}
#status{font-size:14px;color:#4b5563;min-height:20px}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px}
button{border:0;border-radius:10px;font-size:15px;font-weight:600;padding:10px 16px;cursor:pointer}
#loginButton{background:#111827;color:#fff}
#retryButton{background:#e5e7eb;color:#111827}
#loginButton:disabled{opacity:.7;cursor:progress}
</style>
</head>
<body>
<main class="card">
<h1>Sign in required</h1>
<p>${name} requires Puter authentication before private files can load.</p>
<p id="status">Click "Sign In with Puter" to continue.</p>
<div class="actions">
<button id="loginButton" type="button">Sign In with Puter</button>
<button id="retryButton" type="button">Retry</button>
</div>
</main>
<script src="https://js.puter.com/v2/"></script>
<script>
(() => {
const status = document.getElementById('status');
const loginBtn = document.getElementById('loginButton');
const retryBtn = document.getElementById('retryButton');
const storageKey = 'puter.privateAppBootstrap.lastAttemptedToken';
const setStatus = m => { status.textContent = m; };
const getStored = () => globalThis.puter?.authToken || localStorage.getItem('auth_token') || localStorage.getItem('puter.auth.token');
const redirectWithToken = t => {
if (typeof t !== 'string' || !t) throw new Error('missing_auth_token');
sessionStorage.setItem(storageKey, t);
const u = new URL(location.href);
u.searchParams.set('puter.auth.token', t);
location.replace(u.toString());
};
const tryStored = () => {
const u = new URL(location.href);
if (u.searchParams.get('puter.auth.token')) return false;
const t = getStored();
if (!t) return false;
const last = sessionStorage.getItem(storageKey);
if (last === t) return false;
setStatus('Using saved Puter session...');
redirectWithToken(t);
return true;
};
loginBtn.addEventListener('click', async () => {
loginBtn.disabled = true;
setStatus('Authenticating with Puter...');
try {
if (tryStored()) return;
const r = await globalThis.puter.auth.signIn();
redirectWithToken(r?.token || getStored());
} catch (e) {
console.error(e);
loginBtn.disabled = false;
setStatus('Sign in was not completed. Click to try again.');
}
});
retryBtn.addEventListener('click', () => location.reload());
if (tryStored()) return;
})();
</script>
</body>
</html>`;
}
