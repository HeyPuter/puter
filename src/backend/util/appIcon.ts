// Always routes through the backend `/app-icon/<uid>/<size>` endpoint rather
// than the `puter-app-icons` subdomain directly. Some apps (especially those
// imported with a URL icon column that predates the sharp pipeline) only have
// the original PNG on the subdomain and no sized variants — a direct subdomain
// URL like `<uid>-256.png` 404s in that case. The backend endpoint self-heals:
// it can fall back to the original, decode data URLs inline, or serve the
// default placeholder. Mirrors v1's `getAppIconPath`.

export const DEFAULT_APP_ICON_SIZE = 256;

// Subdomain where AppIconService publishes generated icons. Mirrors the
// constant in AppIconService; duplicated here to avoid a dependency cycle
// between the util layer and the service layer.
const APP_ICONS_SUBDOMAIN = 'puter-app-icons';

// MIME types accepted on the write path for `data:` icon URLs. Anything
// outside this allowlist is rejected so a malicious caller can't stash,
// e.g., `data:text/html` or `data:application/javascript` in the icon
// column and get it echoed back by the server.
export const ICON_DATA_URL_MIME_ALLOWLIST = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
] as const;

interface AppIconDeps {
    apiBaseUrl?: string;
}

interface TrustedIconHostConfig {
    static_hosting_domain?: string;
    static_hosting_domain_alt?: string;
    api_base_url?: string;
}

const RAW_BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;
const APP_ICON_ENDPOINT_PATH_REGEX = /^\/app-icon\/[^/?#]+(?:\/\d+)?\/?$/;
// Direct subdomain file shape written by AppIconService:
//   /app-<uid>.png            (original)
//   /app-<uid>-<size>.png     (sized variant)
// Allowed on trusted hosts only — see isAppIconEndpointUrl.
const APP_ICON_SUBDOMAIN_PATH_REGEX = /^\/app-[A-Za-z0-9_-]+(?:-\d+)?\.png$/;

/**
 * v1-compatible raw-base64 detector. Legacy puter-js callers pass the
 * base64 payload without a `data:` prefix; v1 accepted it and normalized
 * to `data:image/png;base64,<raw>` before storage. We mirror that here
 * so clients that worked on v1 keep working.
 *
 * Rejects anything shorter than 16 chars, not aligned to base64 length,
 * or that doesn't round-trip through Buffer — catches random strings
 * that happen to match the charset.
 */
export function isRawBase64ImageString(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed.length < 16) return false;
    if (!RAW_BASE64_REGEX.test(trimmed)) return false;
    if (trimmed.length % 4 !== 0) return false;
    try {
        const decoded = Buffer.from(trimmed, 'base64');
        if (decoded.length === 0) return false;
        const stripped = trimmed.replace(/=+$/, '');
        const reencoded = decoded.toString('base64').replace(/=+$/, '');
        return stripped === reencoded;
    } catch {
        return false;
    }
}

/** Wrap raw base64 in a `data:image/png;base64,…` URL; pass other values through. */
export function normalizeRawBase64ImageString(value: string): string {
    const trimmed = value.trim();
    if (!isRawBase64ImageString(trimmed)) return value;
    return `data:image/png;base64,${trimmed}`;
}

/**
 * Whether `value` is a reference we own — accepts two shapes:
 *   - `/app-icon/<uid>(/<size>)?`       : the AppController endpoint
 *   - `/app-<uid>(-<size>)?.png`        : the file written by
 *                                         AppIconService onto the
 *                                         `puter-app-icons` subdomain
 *
 * Relative paths must use the endpoint shape (the subdomain-file shape
 * is only meaningful when paired with a trusted host). Absolute URLs
 * accept either shape but only on a trusted host — without the host
 * check an authenticated user could set `icon` to an attacker URL and
 * turn `/app-icon/:uid` into a Puter-branded open redirector.
 */
export function isAppIconEndpointUrl(
    value: string,
    config: TrustedIconHostConfig,
): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    let parsed: URL;
    try {
        parsed = new URL(trimmed, 'http://localhost');
    } catch {
        return false;
    }
    const isEndpointPath = APP_ICON_ENDPOINT_PATH_REGEX.test(parsed.pathname);
    const isSubdomainPath = APP_ICON_SUBDOMAIN_PATH_REGEX.test(parsed.pathname);
    if (!isEndpointPath && !isSubdomainPath) return false;

    // Relative paths (our placeholder base won't survive if the input
    // was absolute). Detect absolute-vs-relative by scheme presence.
    if (!/^[a-z][a-z0-9+\-.]*:/i.test(trimmed) && !trimmed.startsWith('//')) {
        return isEndpointPath;
    }
    return isTrustedIconHost(trimmed, config);
}

/**
 * Whether `url` points at a host we control for app-icon hosting.
 *
 * Used to gate both the legacy redirect fallback in `/app-icon/:uid` and
 * the write-path validator in AppDriver — without this check an
 * authenticated user can set `icon` to an arbitrary attacker URL and
 * turn the unauthenticated `/app-icon/:uid` route into a Puter-branded
 * open redirector (cached publicly for 15 minutes).
 *
 * Accepts:
 *   - `puter-app-icons.<static_hosting_domain>` (and …_alt)
 *   - The configured `api_base_url` host (AppIconService rewrites icon
 *     columns to `${api_base_url}/app-icon/<uid>`, so it must be trusted
 *     or round-tripped writes would fail validation).
 */
export function isTrustedIconHost(
    url: string,
    config: TrustedIconHostConfig,
): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) return false;

    const trustedBases = [
        config.static_hosting_domain,
        config.static_hosting_domain_alt,
    ].filter((d): d is string => typeof d === 'string' && d.length > 0);

    for (const base of trustedBases) {
        if (hostname === `${APP_ICONS_SUBDOMAIN}.${base.toLowerCase()}`) {
            return true;
        }
    }

    if (config.api_base_url) {
        try {
            const apiBaseHost = new URL(
                config.api_base_url,
            ).hostname.toLowerCase();
            if (apiBaseHost && hostname === apiBaseHost) return true;
        } catch {
            // malformed config — treat as no match rather than throwing
        }
    }

    return false;
}

export function getAppIconUrl(
    app: Record<string, unknown>,
    deps: AppIconDeps,
    size?: number,
): string | null {
    const appUid = (app.uid ?? app.uuid) as string | undefined;
    if (!appUid) return null;

    const normalizedUid = appUid.startsWith('app-') ? appUid : `app-${appUid}`;
    const iconSize = Number.isFinite(Number(size))
        ? Number(size)
        : DEFAULT_APP_ICON_SIZE;

    const normalizedApiBaseUrl = String(deps.apiBaseUrl ?? '').replace(
        /\/+$/,
        '',
    );
    if (!normalizedApiBaseUrl) {
        // No API base URL configured — fall back to the raw `icon` column so
        // something still renders (even if it's the unsized original).
        const appIcon = app.icon;
        if (typeof appIcon === 'string' && /^https?:\/\//i.test(appIcon)) {
            return appIcon;
        }
        return null;
    }
    return `${normalizedApiBaseUrl}/app-icon/${normalizedUid}/${iconSize}`;
}
