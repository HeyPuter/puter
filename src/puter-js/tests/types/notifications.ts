import type { NotificationAction, Puter, PushShown } from '../../index.js';

export const shown: PushShown = { requireInteraction: true };
// @ts-expect-error The display hint must be a boolean.
export const invalidShown: PushShown = { requireInteraction: 'true' };

export const accept: NotificationAction = { action: 'accept', title: 'Accept', icon: '/accept.png' };
export const withActions: PushShown = { actions: [accept, { action: 'decline', title: 'Decline' }] };
// @ts-expect-error Actions must be an array.
export const invalidActions: PushShown = { actions: accept };
// @ts-expect-error Button labels must be strings.
export const invalidAction: NotificationAction = { action: 'accept', title: 3 };
// @ts-expect-error Badge is an image URL, not a count.
export const numericBadge: PushShown = { badge: 3 };

export const mark = async (puter: Puter): Promise<void> => {
    const { markShown, dismiss } = puter.notifications;
    const wasShown: boolean = await markShown('notification-id');
    const wasDismissed: boolean = await dismiss('notification-id');
    // @ts-expect-error A notification uid must be a string.
    await markShown(123);
    // @ts-expect-error A notification uid is required.
    await dismiss();
    void [wasShown, wasDismissed];
};

export const listen = (puter: Puter): void => {
    puter.notifications.on('dismiss', (event) => {
        const uid: string = event.uid;
        // @ts-expect-error Dismissals carry no notification content.
        void event.data;
        void uid;
    });
    puter.notifications.on('click', (event) => {
        const action: string | null = event.action;
        void [event.target, action];
    });
    // @ts-expect-error Unsupported event name.
    puter.notifications.on('shown', () => {});
};
