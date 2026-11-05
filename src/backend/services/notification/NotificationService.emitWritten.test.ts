import { expect, it } from 'vitest';
import { EventClient } from '../../clients/event/EventClient.js';
import type { EventMap } from '../../clients/event/types.js';
import { NotificationService } from './NotificationService.js';

it.each([undefined, 0, 1_700_000_000_000])(
    'emits replacement metadata for replacedAt %s',
    async (replacedAt) => {
        const event = new EventClient({} as never);
        const written: EventMap['notif.written'][] = [];
        event.on('notif.written', (_key, value) => {
            written.push(value);
        });
        const service = new NotificationService(
            {} as never,
            { event } as never,
            {} as never,
        );

        await service.emitWritten(
            {
                userId: 1,
                uid: 'notification-1',
                type: 'app.message',
                audience: 'app-user',
                appUid: 'app-1',
                value: { title: 'A message' },
                updated: replacedAt !== undefined,
                replacedAt,
            },
            { sendId: 'send-1' },
        );

        expect(written).toHaveLength(1);
        if (replacedAt === undefined)
            expect(written[0]).not.toHaveProperty('replaced');
        else expect(written[0].replaced).toBe(true);
    },
);
