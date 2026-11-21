/**
 * `href` without the query parameters whose decoded name `shouldRemove`
 * matches, or null when it has none. Works on the raw query string so the
 * parameters that stay keep their exact encoding.
 *
 * @param {string} href
 * @param {(name: string) => boolean} shouldRemove
 * @returns {string | null}
 */
export const urlWithoutQueryParams = (href, shouldRemove) => {
    let url;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    const isTarget = (part) => {
        const rawKey = part.split('=', 1)[0].replace(/\+/g, ' ');
        try {
            return shouldRemove(decodeURIComponent(rawKey));
        } catch {
            return shouldRemove(rawKey);
        }
    };
    const parts = url.search.slice(1).split('&');
    if (!parts.some(isTarget)) return null;
    const kept = parts.filter((part) => part && !isTarget(part));
    url.search = kept.length ? `?${kept.join('&')}` : '';
    return url.toString();
};

/**
 * Whether a decoded token payload is a godmode app's launch token: full access
 * for the account, renewed by the desktop before it expires.
 *
 * @param {Record<string, unknown> | null} payload
 * @returns {boolean}
 */
export const isGodmodeTokenPayload = (payload) =>
    typeof payload?.godmode_app_uid === 'string' &&
    payload.godmode_app_uid.length > 0;

/**
 * Whether a decoded token payload carries the user's own session reach (the
 * desktop's session, a plain session token, or a godmode app's launch token)
 * rather than one minted for an app. These never persist on an app's origin.
 *
 * @param {Record<string, unknown> | null} payload
 * @returns {boolean}
 */
export const isUserSessionTokenPayload = (payload) => {
    if (!payload) return false;
    if (isGodmodeTokenPayload(payload)) return true;
    // `t: 's'` is the compressed form of `type: 'session'`.
    const kind = payload.t ?? payload.type;
    return kind === 'gui' || kind === 'session' || kind === 's';
};

// How long a tab waits for the GUI that opened it before signing in on its own.
export const OPENER_LAUNCH_TIMEOUT_MS = 5000;

/**
 * What the GUI hands a tab it opened for an app launch.
 *
 * @typedef {object} OpenerLaunch
 * @property {string | null} token - the app's token
 * @property {Record<string, string> | null} item - `puter.item.*` params of
 *   the item the app was opened with, as a framed launch has in its URL
 */

/** Keeps only `puter.item.*` string params. */
const launchItemParams = (item) => {
    if (!item || typeof item !== 'object') return null;
    const params = Object.fromEntries(
        Object.entries(item).filter(
            ([key, value]) =>
                key.startsWith('puter.item.') && typeof value === 'string',
        ),
    );
    return Object.keys(params).length ? params : null;
};

/**
 * A short fingerprint of a token (cyrb53), to tell tokens apart without
 * keeping one.
 *
 * @param {string} token
 * @returns {string}
 */
export const tokenTag = (token) => {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < token.length; i++) {
        const c = token.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

const KEPT_LAUNCH_ITEM_KEY = 'puter.launch.keptItem';
// Covers a sign-in redirect and the app's load, not a later visit.
const KEPT_LAUNCH_ITEM_TTL_MS = 5 * 60 * 1000;

/**
 * Keeps the item a tab launch opened for the next page this tab loads for the
 * same launch, which can't ask the GUI for it again, when that page runs on
 * `token`. sessionStorage keeps it to this tab and origin.
 *
 * @param {object} options
 * @param {string} options.appInstanceID
 * @param {Record<string, string>} options.item - `puter.item.*` params
 * @param {string} options.token
 * @param {typeof globalThis} [options.scope] - Global to use; injectable for tests.
 * @param {number} [options.now]
 */
export const keepLaunchItem = ({
    appInstanceID,
    item,
    token,
    scope = globalThis,
    now = Date.now(),
}) => {
    try {
        // Reading `sessionStorage` itself throws where storage is blocked.
        scope.sessionStorage.setItem(
            KEPT_LAUNCH_ITEM_KEY,
            JSON.stringify({
                appInstanceID,
                item,
                tokenTag: tokenTag(token),
                at: now,
            }),
        );
    } catch {
        // No sessionStorage: the next page opens without the item.
    }
};

/**
 * Removes the kept launch item and returns it when it was kept for
 * `appInstanceID` and `token` within the last few minutes, or null.
 *
 * @param {object} options
 * @param {string} options.appInstanceID
 * @param {string | null | undefined} options.token - the token this page runs on
 * @param {typeof globalThis} [options.scope] - Global to use; injectable for tests.
 * @param {number} [options.now]
 * @returns {Record<string, string> | null}
 */
export const takeKeptLaunchItem = ({
    appInstanceID,
    token,
    scope = globalThis,
    now = Date.now(),
}) => {
    let kept;
    try {
        const storage = scope.sessionStorage;
        const raw = storage.getItem(KEPT_LAUNCH_ITEM_KEY);
        if (raw === null) return null;
        storage.removeItem(KEPT_LAUNCH_ITEM_KEY);
        kept = JSON.parse(raw);
    } catch {
        return null;
    }
    if (kept?.appInstanceID !== appInstanceID) return null;
    if (!token || kept.tokenTag !== tokenTag(token)) return null;
    const age = now - kept.at;
    if (!(age >= 0 && age <= KEPT_LAUNCH_ITEM_TTL_MS)) return null;
    return launchItemParams(kept.item);
};

/**
 * Asks the Puter GUI tab that opened this one for the launch it opened the
 * tab for (the app's token and opened item), so neither has to travel in the
 * tab's URL. Only a reply from the opener itself at `guiOrigin` counts: a
 * crafted link can name an instance id but can't make the GUI answer for it.
 * Whatever the outcome, the opener is then cut off so the app can't reach the
 * GUI tab.
 *
 * @param {object} options
 * @param {string} options.guiOrigin - the configured GUI origin, never one from the URL
 * @param {string} options.appInstanceID
 * @param {typeof globalThis} [options.scope] - Global to use; injectable for tests.
 * @param {number} [options.timeoutMs]
 * @returns {Promise<OpenerLaunch | null> | null} null when there is no GUI
 *   opener to ask, or (resolved) when no answer came
 */
export const requestLaunchFromOpener = ({
    guiOrigin,
    appInstanceID,
    scope = globalThis,
    timeoutMs = OPENER_LAUNCH_TIMEOUT_MS,
}) => {
    let opener = null;
    try {
        opener = scope.opener ?? null;
    } catch {
        opener = null;
    }
    // `closed` is readable cross-origin: a GUI tab that's gone can't answer.
    // Synchronous, so a caller has nothing to wait on (a reloaded tab, say).
    if (!opener || opener.closed || !guiOrigin || !appInstanceID) {
        return null;
    }
    // An opener of this page's own origin is the app itself (a pop-out, say),
    // not the GUI, and is the app's to keep. A cross-origin one throws here.
    try {
        const origin = scope.location.origin;
        if (origin !== guiOrigin && opener.location.origin === origin) {
            return null;
        }
    } catch {
        // Possibly the GUI: ask it.
    }

    return new Promise((resolve) => {
        let timer = null;
        const finish = (launch) => {
            scope.removeEventListener('message', onMessage);
            clearTimeout(timer);
            try {
                scope.opener = null;
            } catch {
                // Nothing more to protect if it can't be cleared.
            }
            resolve(launch);
        };
        const onMessage = (event) => {
            if (event.origin !== guiOrigin || event.source !== opener) return;
            if (event.data?.msg !== 'puter.launch') return;
            if (event.data.appInstanceID !== appInstanceID) return;
            const token = event.data.token;
            finish({
                token: typeof token === 'string' && token ? token : null,
                item: launchItemParams(event.data.item),
            });
        };
        scope.addEventListener('message', onMessage);
        timer = setTimeout(() => finish(null), timeoutMs);
        try {
            // Delivered only if the opener is at guiOrigin. `env` keeps the
            // GUI's app IPC from treating this as a message from a framed app.
            opener.postMessage(
                { msg: 'puter.requestLaunch', env: 'app-tab', appInstanceID },
                guiOrigin,
            );
        } catch {
            finish(null);
        }
    });
};
