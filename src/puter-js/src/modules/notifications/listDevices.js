import { request } from './lib/api.js';
import { toDevice } from './lib/shapes.js';

/**
 * The user's devices registered for pushes. For Puter's own apps. Rejects with
 * `push_unavailable` where the deployment doesn't send pushes.
 *
 * @this {import('./index.js').NotificationsModule}
 * @returns {Promise<import('./types.js').PushDevice[]>}
 */
export async function listDevices() {
    return (await readDevices(this.puter)) ?? [];
}

/** `listDevices()`, or null when the reply has no device list. */
export async function readDevices(puter, { interactiveReauth = true } = {}) {
    const result = await request(puter, 'GET', '/push/devices', undefined, {
        interactiveReauth,
    });
    return Array.isArray(result?.devices) ? result.devices.map(toDevice) : null;
}
