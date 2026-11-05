import { driverCall } from '../../../lib/networkUtils.js';
import { PuterJSError } from '../../../lib/PuterJSError.js';
import { toDriverError } from './errors.js';

/**
 * @param {import('../../../index.js').Puter} puter
 * @param {'mark_shown' | 'mark_acknowledged'} method
 * @param {string} uid
 * @returns {Promise<boolean>}
 */
export async function markNotification(puter, method, uid) {
    if (typeof uid !== 'string' || uid === '') {
        throw new PuterJSError(
            'uid must be a non-empty string',
            'invalid_argument',
        );
    }
    let answer;
    try {
        answer = /** @type {{ success?: unknown } | null} */ (
            await driverCall({
                puter,
                iface: 'puter-notifications',
                driver: 'es:notification',
                method,
                args: { uid },
            })
        );
    } catch (error) {
        throw toDriverError(error);
    }
    if (typeof answer?.success !== 'boolean') {
        throw new PuterJSError(
            'The server did not return the mark result',
            'notifications_failed',
        );
    }
    return answer.success;
}
