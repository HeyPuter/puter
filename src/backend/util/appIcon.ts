/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
const BASE64_CHARS_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;
// `data:<type>/<subtype>[;param[=value]]…,<payload>`. The parameter list is
// matched as a group of its own so it can be checked exhaustively — the
// previous prefix-scan only looked at the bytes before the first `;` or `,`
// and never inspected the payload at all.
const DATA_URL_REGEX =
    /^data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*)((?:;[a-z0-9!#$&^_.+-]+(?:=[^;,]*)?)*),([\s\S]*)$/i;
// Cap on how far into a payload we look for the `<svg` root element. SVG is
// the one allow-listed type without a fixed-offset magic number; a file that
// buries its root past this much leading comment/PI text is not something we
// need to accept.
const SVG_SNIFF_WINDOW = 8 * 1024;

/**
 * Decode strict base64 — no whitespace, correct padding, and byte-for-byte
 * round-trip. `Buffer.from(s, 'base64')` silently skips characters it doesn't
 * recognise, so `iVBORw0KGgo=" onerror=alert(1)` decodes without complaint; the
 * round-trip is what rejects it.
 */
function decodeStrictBase64(value: string): Buffer | null {
    if (!BASE64_CHARS_REGEX.test(value)) return null;
    if (value.length === 0 || value.length % 4 !== 0) return null;
    try {
        const decoded = Buffer.from(value, 'base64');
        if (decoded.length === 0) return null;
        const stripped = value.replace(/=+$/, '');
        const reencoded = decoded.toString('base64').replace(/=+$/, '');
        return stripped === reencoded ? decoded : null;
    } catch {
        return null;
    }
}

/** `image/jpg` is a common misspelling of `image/jpeg`; treat them as one. */
function canonicalImageMime(mime: string): string {
    return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

function looksLikeSvg(bytes: Buffer): boolean {
    let head = bytes.subarray(0, SVG_SNIFF_WINDOW).toString('utf8');
    if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
    // Must open as markup (rules out arbitrary text that merely mentions
    // `<svg` somewhere), and must actually contain an `<svg` root.
    if (!head.trimStart().startsWith('<')) return false;
    return /<svg[\s/>]/i.test(head);
}

/**
 * Identify image bytes by content, returning a canonical allow-listed MIME type
 * or null. Signature-based: the declared MIME on a data URL is caller input and
 * cannot be trusted to describe the payload.
 */
export function sniffImageMime(bytes: Buffer): string | null {
    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
    ) {
        return 'image/png';
    }
    if (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
    ) {
        return 'image/jpeg';
    }
    if (bytes.length >= 6) {
        const head = bytes.subarray(0, 6).toString('latin1');
        if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
    }
    if (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
        bytes.subarray(8, 12).toString('latin1') === 'WEBP'
    ) {
        return 'image/webp';
    }
    if (looksLikeSvg(bytes)) return 'image/svg+xml';
    return null;
}

export interface IconDataUrlVerdict {
    ok: boolean;
    /** Human-readable failure clause, suffixed onto "`icon` …". */
    reason?: string;
    /** Canonical MIME sniffed from the payload (on success). */
    mime?: string;
    /** Canonical, whitespace-stripped data URL to store (on success). */
    normalized?: string;
}

/**
 * Validate an `icon` data URL end to end — MIME, encoding, _and_ payload.
 *
 * The write path used to check only the MIME prefix, so everything after the
 * comma was stored verbatim. `data:image/png;base64,` is a valid prefix, which
 * meant up to 5 MB of arbitrary text — including `"` and `<` — could be parked
 * in the icon column and later interpolated into a Dev Center template — stored
 * XSS in a first-party app that holds the user's session token.
 *
 * Requirements, in order:
 *
 * - Well-formed `data:` URL with an allow-listed image MIME type
 * - `;base64` and nothing else for the parameter list. Every Puter client
 *   produces base64 (`FileReader.readAsDataURL` always does); requiring it is
 *   what makes the payload checkable at all. Percent-encoded payloads — the
 *   only shape that can carry raw `<`/`"` — are rejected; callers with literal
 *   SVG markup must base64 it.
 * - Strictly valid base64 (round-tripped, so smuggled non-base64 bytes fail)
 * - Decoded bytes that sniff as an image whose type matches the declaration
 */
export function validateIconDataUrl(value: unknown): IconDataUrlVerdict {
    if (typeof value !== 'string') {
        return { ok: false, reason: 'must be a string' };
    }
    const match = DATA_URL_REGEX.exec(value.trim());
    if (!match) {
        return { ok: false, reason: 'is not a well-formed data: URL' };
    }
    const declaredMime = match[1].toLowerCase();
    const params = match[2].toLowerCase();
    const payload = match[3];

    if (
        !(ICON_DATA_URL_MIME_ALLOWLIST as readonly string[]).includes(
            declaredMime,
        )
    ) {
        return { ok: false, reason: 'data URL must use an image MIME type' };
    }
    if (params !== ';base64') {
        return {
            ok: false,
            reason: 'data URL must be base64-encoded (`;base64`) with no other parameters',
        };
    }

    // Line-wrapped base64 is tolerated, but only whitespace may be stripped —
    // any other character outside the base64 alphabet fails below.
    const compact = payload.replace(/[\s]+/g, '');
    const bytes = decodeStrictBase64(compact);
    if (!bytes) {
        return { ok: false, reason: 'data URL payload is not valid base64' };
    }

    const sniffed = sniffImageMime(bytes);
    if (!sniffed) {
        return {
            ok: false,
            reason: 'data URL payload is not a recognized image',
        };
    }
    if (sniffed !== canonicalImageMime(declaredMime)) {
        return {
            ok: false,
            reason: `data URL declares ${declaredMime} but the payload is ${sniffed}`,
        };
    }

    return {
        ok: true,
        mime: sniffed,
        normalized: `data:${declaredMime};base64,${compact}`,
    };
}
const APP_ICON_ENDPOINT_PATH_REGEX = /^\/app-icon\/[^/?#]+(?:\/\d+)?\/?$/;
// Direct subdomain file shape written by AppIconService:
//   /app-<uid>.png            (original)
//   /app-<uid>-<size>.png     (sized variant)
// Allowed on trusted hosts only — see isAppIconEndpointUrl.
const APP_ICON_SUBDOMAIN_PATH_REGEX = /^\/app-[A-Za-z0-9_-]+(?:-\d+)?\.png$/;

/**
 * Decode a bare base64 string and sniff it, or null if it isn't base64 at all
 * or doesn't decode to a recognized image.
 */
function sniffRawBase64Image(
    value: unknown,
): { bytes: Buffer; mime: string; compact: string } | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length < 16) return null;
    if (!RAW_BASE64_REGEX.test(trimmed)) return null;
    const bytes = decodeStrictBase64(trimmed);
    if (!bytes) return null;
    const mime = sniffImageMime(bytes);
    if (!mime) return null;
    return { bytes, mime, compact: trimmed };
}

/**
 * V1-compatible raw-base64 detector. Legacy puter-js callers pass the base64
 * payload without a `data:` prefix; v1 accepted it and normalized to
 * `data:image/png;base64,<raw>` before storage. We mirror that here so clients
 * that worked on v1 keep working.
 *
 * Rejects anything shorter than 16 chars, not aligned to base64 length, or that
 * doesn't round-trip through Buffer — catches random strings that happen to
 * match the charset. Also rejects base64 that decodes to something other than a
 * recognized image: v1 wrapped any base64 as `image/png` regardless of content,
 * which let non-image bytes into the icon column under an image MIME type.
 */
export function isRawBase64ImageString(value: unknown): value is string {
    return sniffRawBase64Image(value) !== null;
}

/**
 * Wrap raw base64 in a `data:<sniffed-mime>;base64,…` URL; pass other values
 * through unchanged (the caller then rejects them — a bare string that isn't a
 * valid image is not one of the accepted `icon` shapes).
 */
export function normalizeRawBase64ImageString(value: string): string {
    const sniffed = sniffRawBase64Image(value);
    if (!sniffed) return value;
    return `data:${sniffed.mime};base64,${sniffed.compact}`;
}

/**
 * Whether `value` is a reference we own — accepts two shapes:
 *
 * - `/app-icon/<uid>(/<size>)?` : the AppController endpoint
 * - `/app-<uid>(-<size>)?.png` : the file written by AppIconService onto the
 *   `puter-app-icons` subdomain
 *
 * Relative paths must use the endpoint shape (the subdomain-file shape is only
 * meaningful when paired with a trusted host). Absolute URLs accept either
 * shape but only on a trusted host — without the host check an authenticated
 * user could set `icon` to an attacker URL and turn `/app-icon/:uid` into a
 * Puter-branded open redirector.
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
 * Used to gate both the legacy redirect fallback in `/app-icon/:uid` and the
 * write-path validator in AppDriver — without this check an authenticated user
 * can set `icon` to an arbitrary attacker URL and turn the unauthenticated
 * `/app-icon/:uid` route into a Puter-branded open redirector (cached publicly
 * for 15 minutes).
 *
 * Accepts:
 *
 * - `puter-app-icons.<static_hosting_domain>` (and …_alt)
 * - The configured `api_base_url` host (AppIconService rewrites icon columns to
 *   `${api_base_url}/app-icon/<uid>`, so it must be trusted or round-tripped
 *   writes would fail validation).
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
