import * as utils from '../../../lib/utils.js';
import stat from './stat.js';

const getReadURL = async function (path, expiresIn = '24h') {
    return new Promise(async (resolve, reject) => {
        // If auth token is not provided and we are in the web environment,
        // try to authenticate with Puter
        if ( !puter.authToken && puter.env === 'web' ) {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                reject('Authentication failed.');
            }
        }
        try {
            const { uid, is_dir } = (await stat.call(this, path));
            if ( is_dir ) {
                reject('Cannot create readUrl for directory');
                return;
            }

            const xhr = utils.initXhr('/auth/create-access-token', this.APIOrigin, this.authToken);

            utils.setupXhrEventHandlers(xhr, () => {
            }, () => {
            }, ({ token }) => {
                resolve(`${this.APIOrigin}/token-read?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`);
            }, reject);

            xhr.send(JSON.stringify({
                expiresIn,
                permissions: [
                    `fs:${uid}:read`,
                ],
            }));

        } catch (e) {
            reject(e);
        }
    });
};

export default getReadURL;
