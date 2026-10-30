/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * The notification endpoints the GUI talks to. The desktop's toasts and the
 * dashboard's notification center share these so the wire shape lives in
 * one place.
 */

const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${window.auth_token ?? window.puter?.authToken}`,
});

/**
 * Tell the backend the user dismissed a notification. Resolves once the
 * server has recorded it; rejects on a network or HTTP failure so callers
 * can roll back an optimistic removal.
 *
 * @param {string} uid
 * @returns {Promise<void>}
 */
export async function markNotificationAcknowledged (uid) {
    const res = await fetch(`${window.api_origin}/notif/mark-ack`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ uid }),
    });
    if ( ! res.ok ) {
        throw new Error(`mark-ack failed (${res.status})`);
    }
}

/**
 * Claim a notification as shown. Distinct from dismissing it: the mailbox
 * records that it reached someone, which is what keeps a replay from raising
 * it in every tab. Resolves `true` only for the client that got there first,
 * and `false` — never a rejection — when it was already shown or the call
 * failed, since nothing about a toast is worth failing over.
 *
 * @param {string} uid
 * @returns {Promise<boolean>}
 */
export async function markNotificationShown (uid) {
    try {
        const res = await fetch(`${window.api_origin}/drivers/call`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                interface: 'puter-notifications',
                driver: 'es:notification',
                method: 'mark_shown',
                args: { uid },
            }),
        });
        if ( ! res.ok ) return false;
        const body = await res.json();
        return body?.success !== false && body?.result?.success === true;
    } catch {
        return false;
    }
}

/**
 * @typedef {Object} NotificationRow
 * @property {string} uid
 * @property {Object} value - The notification payload: `{ source, title, text?, icon?, template?, fields? }`
 * @property {string|null} [app_uid] - The app the row is about
 * @property {number|null} shown
 * @property {number|null} acknowledged
 * @property {string|number|null} created_at
 */

/**
 * The user's notifications, newest first. `'all'` lists them regardless of
 * state; the driver treats no predicate as everything.
 *
 * @param {{ predicate?: 'unacknowledged'|'unseen'|'acknowledged'|'all', limit?: number }} [opts]
 * @returns {Promise<NotificationRow[]>}
 */
export async function listNotifications ({ predicate = 'unacknowledged', limit = 200 } = {}) {
    const res = await fetch(`${window.api_origin}/drivers/call`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
            interface: 'puter-notifications',
            driver: 'es:notification',
            method: 'select',
            args: predicate === 'all' ? { limit } : { predicate, limit },
        }),
    });
    if ( ! res.ok ) {
        throw new Error(`notification listing failed (${res.status})`);
    }
    const body = await res.json();
    if ( body?.success === false ) {
        throw new Error(body?.error?.message ?? 'notification listing failed');
    }
    return Array.isArray(body?.result) ? body.result : [];
}

/**
 * @param {string} uid
 * @returns {Promise<NotificationRow|null>} The user's own row, or null
 */
export async function getNotification (uid) {
    try {
        const res = await fetch(`${window.api_origin}/drivers/call`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                interface: 'puter-notifications',
                driver: 'es:notification',
                method: 'read',
                args: { uid },
            }),
        });
        if ( ! res.ok ) return null;
        const body = await res.json();
        const row = body?.result;
        return body?.success !== false && row?.uid === uid ? row : null;
    } catch {
        return null;
    }
}

/** @typedef {{ uid: string, platform: 'webpush'|'ios'|'android', label: string|null, user_agent: string|null, created_at: number, last_seen_at: number, current: boolean }} PushDevice */

/** `puterDevices` is false for an app whose grant came from a website's Web Push confirmation, which reaches only that website's browsers. @typedef {{ uid: string, name: string, title: string, icon: string|null, puterDevices?: boolean }} PushApp */

export const PUSH_UNAVAILABLE = 'push_unavailable';

/**
 * Rejects with the server's `code` and `status` on a failed call, and with
 * `push_unavailable` when no `/push` route answered.
 */
const pushCall = async (method, path, body) => {
    const res = await fetch(`${window.api_origin}${path}`, {
        method,
        headers: authHeaders(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await res.json().catch(() => ({}));
    if ( ! res.ok ) {
        const error = new Error(data?.message ?? `${path} failed (${res.status})`);
        error.status = res.status;
        // The push routes name what they can't find; a bare not_found is core's.
        error.code = res.status === 404 && (data?.code ?? 'not_found') === 'not_found'
            ? PUSH_UNAVAILABLE
            : data?.code;
        throw error;
    }
    return data;
};

/** @returns {Promise<PushDevice[]>} */
export async function listPushDevices () {
    const { devices } = await pushCall('GET', '/push/devices');
    return Array.isArray(devices) ? devices : [];
}

/** @param {string} uid */
export async function removePushDevice (uid) {
    await pushCall('DELETE', `/push/devices/${encodeURIComponent(uid)}`);
}

/** @param {string} uid */
export async function sendTestPush (uid) {
    await pushCall('POST', `/push/devices/${encodeURIComponent(uid)}/test`);
}

/** @returns {Promise<PushApp[]>} */
export async function listPushApps () {
    const { apps } = await pushCall('GET', '/push/apps');
    return Array.isArray(apps) ? apps : [];
}

/** @param {string} appUid */
export async function revokePushApp (appUid) {
    await pushCall('POST', '/auth/revoke-user-app', { app_uid: appUid, permission: 'notifications:push' });
}

/** @returns {Promise<boolean>} Whether Puter's own notifications are pushed */
export async function getPuterPushPreference () {
    const { puter } = await pushCall('GET', '/push/preferences');
    return puter !== false;
}

/** @param {boolean} enabled */
export async function setPuterPushPreference (enabled) {
    await pushCall('POST', '/push/preferences', { puter: enabled });
}
