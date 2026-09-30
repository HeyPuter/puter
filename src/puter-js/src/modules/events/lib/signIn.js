import { PuterJSError } from '../../../lib/PuterJSError.js';

/**
 * Whether this call has to sign the visitor in first.
 * @param {import('../../../index.js').Puter} puter
 * @returns {boolean}
 */
export const needsSignIn = (puter) => ! puter.authToken && puter.env === 'web';

/**
 * Opens the sign-in flow other `puter.*` calls use.
 * @param {import('../../../index.js').Puter} puter
 * @returns {Promise<void>}
 */
export const signInVisitor = async (puter) => {
    try {
        await puter.ui.authenticateWithPuter();
    } catch {
        throw new PuterJSError('Authentication canceled', 'auth_canceled');
    }
};
