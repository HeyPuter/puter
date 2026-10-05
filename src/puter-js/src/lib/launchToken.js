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
 * Whether a decoded token payload is a user session token (the desktop's own
 * session, or a plain session token) rather than one minted for an app.
 *
 * @param {Record<string, unknown> | null} payload
 * @returns {boolean}
 */
export const isUserSessionTokenPayload = (payload) => {
    if (!payload) return false;
    // `t: 's'` is the compressed form of `type: 'session'`.
    const kind = payload.t ?? payload.type;
    return kind === 'gui' || kind === 'session' || kind === 's';
};
