import type { Puter } from '../../index.js';

export const send = async (puter: Puter): Promise<void> => {
    await puter.notifications.notify({
        title: 'Call',
        priority: 'high',
        ttl: 30,
    });
    await puter.notifications.notify({ title: 'Message', priority: 'normal' });
    await puter.notifications.notify({
        title: 'Call',
        priority: 'high',
        to: { handle: 'share-handle' },
        sendAt: Date.now() + 60_000,
    });
    // @ts-expect-error Unsupported priority.
    await puter.notifications.notify({ title: 'Message', priority: 'urgent' });
};
