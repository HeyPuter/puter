import { PuterJSError } from '../../lib/PuterJSError.js';
import { request } from './lib/api.js';
import { toDevice } from './lib/shapes.js';

/**
 * Registers this device for the user's pushes. For Puter's own apps. Rejects
 * with `push_unavailable` where the deployment doesn't send pushes.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {import('./types.js').PushDeviceRegistration} registration
 * @returns {Promise<import('./types.js').PushDevice>}
 */
export async function registerDevice(registration) {
    if (!registration || typeof registration !== 'object') {
        throw new PuterJSError(
            'registration must be an object',
            'invalid_argument',
        );
    }
    const { platform, token, label } = registration;
    const result = await request(this.puter, 'POST', '/push/devices', {
        platform,
        token,
        ...(label !== undefined ? { label } : {}),
    });
    return toDevice(
        /** @type {Record<string, unknown>} */ (result.device ?? {}),
    );
}
