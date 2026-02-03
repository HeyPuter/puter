import * as utils from '../../../lib/utils.js';

/**
 * Revokes a read URL (or the access token / token UUID used by it).
 * After revocation, the URL will no longer allow reading the file.
 *
 * @param {string} urlOrTokenOrUuid - The read URL (e.g. from getReadURL), the JWT access token, or the token UUID.
 * @returns {Promise<void>}
 */
const revokeReadURL = async function (urlOrTokenOrUuid) {
    return new Promise(async (resolve, reject) => {
        if ( !puter.authToken && puter.env === 'web' ) {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                reject('Authentication failed.');
                return;
            }
        }
        try {
            const xhr = utils.initXhr('/auth/revoke-access-token', this.APIOrigin, this.authToken);

            utils.setupXhrEventHandlers(xhr, () => {
            }, () => {
            }, () => resolve(), reject);

            xhr.send(JSON.stringify({
                tokenOrUuid: typeof urlOrTokenOrUuid === 'string' ? urlOrTokenOrUuid.trim() : String(urlOrTokenOrUuid),
            }));
        } catch (e) {
            reject(e);
        }
    });
};

export default revokeReadURL;
