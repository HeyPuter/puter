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
