import { PuterJSError } from '../../lib/PuterJSError.js';
import { request } from './lib/api.js';

/**
 * Stops pushes to one of the user's devices. For Puter's own apps.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {string} uid The device's `uid`, from `listDevices()`.
 * @returns {Promise<void>}
 */
export async function removeDevice(uid) {
    if (typeof uid !== 'string' || uid === '') {
        throw new PuterJSError(
            'uid must be a non-empty string',
            'invalid_argument',
        );
    }
    await request(
        this.puter,
        'DELETE',
        `/push/devices/${encodeURIComponent(uid)}`,
    );
}
