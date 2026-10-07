import path from 'path-browserify';

const reLooksLikeUUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export const looksLikeUid = (value) =>
    typeof value === 'string' && reLooksLikeUUID.test(value);

const getAbsolutePathForApp = (relativePath, puter = globalThis.puter) => {
    // preserve previous behavior for falsy values when env is gui
    if ( puter.env === 'gui' && !relativePath )
    {
        return relativePath;
    }

    // if no relative path is provided, use the current working directory
    if ( ! relativePath )
    {
        relativePath = '.';
    }

    // If relativePath is not provided, or it's not starting with a slash or tilde,
    // it means it's a relative path. In that case, prepend the app's root directory.
    if ( !relativePath || (!relativePath.startsWith('/') && !relativePath.startsWith('~')) ) {
        if ( puter.appID ) {
            relativePath = path.join('~/AppData', puter.appID, relativePath);
        } else {
            relativePath = path.join('~/', relativePath);
        }
    }

    return relativePath;
};

/**
 * For request fields the backend reads as either a path or a uid: a
 * UID-shaped string is sent as-is (a uid), anything else is resolved as a
 * path. A relative name that looks like a UID needs a `./` prefix.
 *
 * @param {string} pathOrUid
 * @param {unknown} [puter]
 * @returns {string}
 */
export const getAbsolutePathOrUidForApp = (pathOrUid, puter = globalThis.puter) =>
    looksLikeUid(pathOrUid) ? pathOrUid : getAbsolutePathForApp(pathOrUid, puter);

export default getAbsolutePathForApp;
