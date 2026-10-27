import EventListener from '../../lib/EventListener.js';
import { enablePush } from './enablePush.js';
import { toClick } from './lib/shapes.js';
import { listDevices } from './listDevices.js';
import { notify } from './notify.js';
import { onNotification } from './onNotification.js';
import { registerDevice } from './registerDevice.js';
import { removeDevice } from './removeDevice.js';
import { hasPermission, requestPermission } from './requestPermission.js';

/** The desktop's broadcast for a click on one of this app's notifications. */
export const CLICK_BROADCAST = 'notificationClick';

/**
 * An app's notifications to the user it runs for.
 *
 * @extends {EventListener<{ click: import('./types.js').NotificationClick }>}
 */
export class NotificationsModule extends EventListener {
    // Rebound in the constructor so destructured calls keep `this`.
    notify = notify;
    onNotification = onNotification;
    requestPermission = requestPermission;
    hasPermission = hasPermission;
    enablePush = enablePush;
    registerDevice = registerDevice;
    listDevices = listDevices;
    removeDevice = removeDevice;

    #listening = false;

    /** @param {import('../../index.js').Puter} puter */
    constructor(puter) {
        super(['click']);
        /** @type {import('../../index.js').Puter} */
        this.puter = puter;

        const methods = /** @type {Record<string, Function>} */ (
            /** @type {unknown} */ (this)
        );
        for (const name of [
            'notify',
            'onNotification',
            'requestPermission',
            'hasPermission',
            'enablePush',
            'registerDevice',
            'listDevices',
            'removeDevice',
        ]) {
            methods[name] = methods[name].bind(this);
        }
    }

    /**
     * Listens for clicks on this app's notifications. A click that came in
     * before the first handler was added is delivered to that handler.
     *
     * @param {'click'} eventName
     * @param {(click: import('./types.js').NotificationClick) => void} handler
     *   Called with `{ uid, target, data }`.
     * @returns {this | undefined}
     */
    on(eventName, handler) {
        const result = super.on(eventName, handler);
        if (result && eventName === 'click' && !this.#listening) {
            this.#listening = true;
            let replaying = true;
            // `puter.ui` replays its last broadcast here, before `on()` returns.
            this.puter.ui?.on?.(CLICK_BROADCAST, (data) => {
                const click = toClick(data);
                if (!click) return;
                const first = replaying ? handler : null;
                queueMicrotask(() =>
                    first ? first(click) : this.emit('click', click),
                );
            });
            replaying = false;
        }
        return result;
    }
}

/**
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof NotificationsModule,
 *     'puter' | 'emit'
 * >} NotificationsConstructor
 */

export const Notifications = /** @type {NotificationsConstructor} */ (
    NotificationsModule
);

export default Notifications;
