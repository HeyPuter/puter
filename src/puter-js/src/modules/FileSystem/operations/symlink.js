import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import pathLib from '../../../lib/path.js';

// This only works for absolute symlinks for now
const symlink = async function (target, linkPath) {

    // If auth token is not provided and we are in the web environment,
    // try to authenticate with Puter
    if ( !puter.authToken && puter.env === 'web' ) {
        try {
            await puter.ui.authenticateWithPuter();
        } catch (e) {
            // if authentication fails, throw an error
            throw 'Authentication failed.';
        }
    }

    // convert path to absolute path
    linkPath = getAbsolutePathForApp(linkPath);
    target = getAbsolutePathForApp(target);
    const name = pathLib.basename(linkPath);
    const linkDir = pathLib.dirname(linkPath);

    const op =
        {
            op: 'symlink',
            path: linkDir,
            name: name,
            target: target,
        };

    const formData = new FormData();
    formData.append('operation', JSON.stringify(op));

    try {
        const response = await fetch(`${this.APIOrigin }/batch`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${puter.authToken}` },
            body: formData,
        });
        if ( response.status !== 200 ) {
            const error = await response.text();
            console.error('[symlink] fetch error: ', error);
            throw error;
        }
    } catch (e) {
        console.error('[symlink] fetch error: ', e);
        throw e;
    }

};

export default symlink;