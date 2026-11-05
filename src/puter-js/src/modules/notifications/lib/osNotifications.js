import { driverCall } from '../../../lib/networkUtils.js';

/** OS notifications whose state one startup checks in a single request. */
const MAX_NOTIFICATIONS = 50;

/** @param {{ url: string; scope?: string } | null} worker */
const shownNotifications = async (worker) => {
    const container = globalThis.navigator?.serviceWorker;
    // A page using only onNotification may not be controlled by its push worker.
    if (!worker && container?.getRegistrations) {
        const registrations = await container.getRegistrations();
        return (await Promise.all(registrations.map(async (registration) =>
            await registration.getNotifications?.() ?? [],
        ))).flat();
    }
    const registration = await container?.getRegistration(
        worker?.scope ?? worker?.url ?? globalThis.location?.href,
    );
    return await registration?.getNotifications?.() ?? [];
};

/** @param {string} uid @param {{ url: string; scope?: string } | null} worker */
export const closeNotification = async (uid, worker) => {
    for (const notification of await shownNotifications(worker)) {
        if (notification.data?.puter?.uid === uid) notification.close();
    }
};

/**
 * Checks only ids already shown here. Missing or invisible rows stay untouched.
 * @param {import('../../../index.js').Puter} puter
 * @param {{ url: string; scope?: string } | null} worker
 */
export const reconcileDismissed = async (puter, worker) => {
    const token = puter.authToken;
    const shown = (await shownNotifications(worker))
        .filter((notification) => typeof notification.data?.puter?.uid === 'string')
        .slice(0, MAX_NOTIFICATIONS);
    const uids = [...new Set(shown.map((notification) => notification.data.puter.uid))];
    if (uids.length === 0 || puter.authToken !== token) return [];
    const rows = await driverCall({
        puter,
        iface: 'puter-notifications',
        driver: 'es:notification',
        method: 'select',
        args: { subject: 'notif:app-user', uids, limit: MAX_NOTIFICATIONS },
    }, { timeout: 10_000 });
    if (!Array.isArray(rows) || puter.authToken !== token) return [];
    const dismissed = new Set(rows.filter((row) => row?.acknowledged != null).map((row) => row.uid));
    for (const notification of shown) {
        if (dismissed.has(notification.data.puter.uid)) notification.close();
    }
    return [...dismissed];
};
