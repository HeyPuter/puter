import path from '../../../lib/path.js';

const getAbsolutePathForApp = (relativePath) => {
    // if we are in the gui environment, return the relative path as is
    if ( puter.env === 'gui' )
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
    if ( !relativePath || (!relativePath.startsWith('/') && !relativePath.startsWith('~') && puter.appID) ) {
        relativePath = path.join('~/AppData', puter.appID, relativePath);
    }

    return relativePath;
};

export default getAbsolutePathForApp;