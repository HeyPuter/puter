import { request } from './lib/api.js';
import { toDevice } from './lib/shapes.js';

/**
 * The user's devices registered for pushes. For Puter's own apps.
 *
 * @this {import('./index.js').NotificationsModule}
 * @returns {Promise<import('./types.js').PushDevice[]>}
 */
export async function listDevices() {
    const result = await request(this.puter, 'GET', '/push/devices');
    const devices = Array.isArray(result.devices) ? result.devices : [];
    return devices.map(toDevice);
}
