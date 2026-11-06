/**
 * `href` with every `name` query parameter removed, or null when it has none.
 * Works on the raw query string so the parameters that stay keep their exact
 * encoding.
 *
 * @param {string} href
 * @param {string} name
 * @returns {string | null}
 */
export const urlWithoutQueryParam = (href, name) => {
    let url;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    const isTarget = (part) => {
        const rawKey = part.split('=', 1)[0].replace(/\+/g, ' ');
        try {
            return decodeURIComponent(rawKey) === name;
        } catch {
            return rawKey === name;
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
