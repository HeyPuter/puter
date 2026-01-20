import path from '../../../lib/path.js';

const getAbsolutePathForApp = (relativePath) => {
    // preserve previous behavior for falsy values when env is gui
    if ( puter.env === 'gui' && !relativePath )
    {
        return relativePath;
    }

    const reLooksLikeUUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const isUUID = reLooksLikeUUID.test(relativePath);
    if ( isUUID ) {
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

export default getAbsolutePathForApp;