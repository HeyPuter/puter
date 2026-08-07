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

import { describe, expect, it, vi } from 'vitest';
import { EventClient } from '../../clients/event/EventClient.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import { FSEntryCacheInvalidationEventHandler } from './cacheInvalidation.js';

type StoreDouble = FSEntryStore & {
    invalidateEntryCacheByPathForUser: ReturnType<typeof vi.fn>;
    invalidateEntryCacheByUuid: ReturnType<typeof vi.fn>;
};

const setupHandler = (
    over: Partial<Record<string, unknown>> = {},
): { eventClient: EventClient; fsEntryStore: StoreDouble } => {
    const eventClient = new EventClient({} as never);
    const fsEntryStore = {
        invalidateEntryCacheByPathForUser: vi.fn(async () => undefined),
        invalidateEntryCacheByUuid: vi.fn(async () => undefined),
        ...over,
    } as unknown as StoreDouble;

    new FSEntryCacheInvalidationEventHandler(fsEntryStore, eventClient);
    return { eventClient, fsEntryStore };
};

/**
 * The shape `FSNodeContext` presents: an async `get(key)` that throws for keys
 * it doesn't recognize, which is what the handler probes around.
 */
const makeRemoveTarget = (values: Record<string, unknown>) => ({
    get: vi.fn(async (key: string) => {
        if (!(key in values)) {
            throw new Error(`unrecognize key for FSNodeContext.get: ${key}`);
        }
        return values[key];
    }),
});

describe('FSEntryCacheInvalidationEventHandler', () => {
    it('reads exact outer GUI event payloads from the EventClient data argument', async () => {
        const { eventClient, fsEntryStore } = setupHandler();

        await eventClient.emitAndWait(
            'outer.gui.item.updated',
            {
                user_id_list: [123],
                response: {
                    path: '/alice/Documents/file.txt',
                    uuid: 'entry-uuid',
                },
            },
            {},
        );

        expect(
            fsEntryStore.invalidateEntryCacheByPathForUser,
        ).toHaveBeenCalledWith(123, '/alice/Documents/file.txt');
        expect(fsEntryStore.invalidateEntryCacheByUuid).toHaveBeenCalledWith(
            'entry-uuid',
        );
    });

    it.each(['outer.gui.item.added', 'outer.gui.item.moved'])(
        'invalidates on %s as well as on update',
        async (eventName) => {
            const { eventClient, fsEntryStore } = setupHandler();

            await eventClient.emitAndWait(
                eventName,
                {
                    user_id_list: [5],
                    response: { path: '/alice/a.txt', uid: 'uid-a' },
                },
                {},
            );

            expect(
                fsEntryStore.invalidateEntryCacheByPathForUser,
            ).toHaveBeenCalledWith(5, '/alice/a.txt');
            expect(
                fsEntryStore.invalidateEntryCacheByUuid,
            ).toHaveBeenCalledWith('uid-a');
        },
    );

    it('invalidates both the old and the new path of a move, for every listed user', async () => {
        const { eventClient, fsEntryStore } = setupHandler();

        await eventClient.emitAndWait(
            'outer.gui.item.moved',
            {
                user_id_list: [1, '2'],
                response: {
                    path: '/alice/Documents/b.txt',
                    old_path: '/alice/b.txt',
                    id: 'uid-b',
                },
            },
            {},
        );

        expect(
            fsEntryStore.invalidateEntryCacheByPathForUser.mock.calls,
        ).toEqual([
            [1, '/alice/Documents/b.txt'],
            [1, '/alice/b.txt'],
            [2, '/alice/Documents/b.txt'],
            [2, '/alice/b.txt'],
        ]);
        expect(fsEntryStore.invalidateEntryCacheByUuid).toHaveBeenCalledWith(
            'uid-b',
        );
    });

    it('skips an old path identical to the new path', async () => {
        const { eventClient, fsEntryStore } = setupHandler();

        await eventClient.emitAndWait(
            'outer.gui.item.moved',
            {
                user_id_list: [1],
                response: { path: '/alice/b.txt', old_path: '/alice/b.txt' },
            },
            {},
        );

        expect(
            fsEntryStore.invalidateEntryCacheByPathForUser,
        ).toHaveBeenCalledTimes(1);
        expect(fsEntryStore.invalidateEntryCacheByUuid).not.toHaveBeenCalled();
    });

    it('ignores non-positive and non-numeric user ids and a missing response', async () => {
        const { eventClient, fsEntryStore } = setupHandler();

        await eventClient.emitAndWait(
            'outer.gui.item.added',
            { user_id_list: [0, -3, 'abc', 1.5], response: undefined },
            {},
        );
        await eventClient.emitAndWait(
            'outer.gui.item.added',
            { user_id_list: 'not-an-array' },
            {},
        );

        expect(
            fsEntryStore.invalidateEntryCacheByPathForUser,
        ).not.toHaveBeenCalled();
        expect(fsEntryStore.invalidateEntryCacheByUuid).not.toHaveBeenCalled();
    });

    it('treats a blank path or uid as absent', async () => {
        const { eventClient, fsEntryStore } = setupHandler();

        await eventClient.emitAndWait(
            'outer.gui.item.updated',
            { user_id_list: [1], response: { path: '   ', uid: '  ' } },
            {},
        );

        expect(
            fsEntryStore.invalidateEntryCacheByPathForUser,
        ).not.toHaveBeenCalled();
        expect(fsEntryStore.invalidateEntryCacheByUuid).not.toHaveBeenCalled();
    });

    it('swallows a store failure so the emitting mutation is not rolled back', async () => {
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const { eventClient } = setupHandler({
            invalidateEntryCacheByUuid: vi.fn(async () => {
                throw new Error('redis down');
            }),
        });

        await expect(
            eventClient.emitAndWait(
                'outer.gui.item.updated',
                { user_id_list: [1], response: { uid: 'uid-a' } },
                {},
            ),
        ).resolves.not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining('outer.gui.item.updated'),
            expect.any(Error),
        );
        consoleError.mockRestore();
    });

    it('invalidates path and uid caches on fs.remove.node', async () => {
        const { eventClient, fsEntryStore } = setupHandler();
        const target = makeRemoveTarget({
            user_id: 7,
            path: '/alice/gone.txt',
            uid: 'uid-gone',
        });

        await eventClient.emitAndWait('fs.remove.node', { target }, {});

        expect(
            fsEntryStore.invalidateEntryCacheByPathForUser,
        ).toHaveBeenCalledWith(7, '/alice/gone.txt');
        expect(fsEntryStore.invalidateEntryCacheByUuid).toHaveBeenCalledWith(
            'uid-gone',
        );
    });

    it('falls back through uuid and then the entry object when uid is unavailable', async () => {
        const { eventClient, fsEntryStore } = setupHandler();

        await eventClient.emitAndWait(
            'fs.remove.node',
            {
                target: makeRemoveTarget({
                    user_id: 7,
                    path: '/alice/a.txt',
                    uuid: 'uid-from-uuid-key',
                }),
            },
            {},
        );
        expect(fsEntryStore.invalidateEntryCacheByUuid).toHaveBeenCalledWith(
            'uid-from-uuid-key',
        );

        fsEntryStore.invalidateEntryCacheByUuid.mockClear();
        await eventClient.emitAndWait(
            'fs.remove.node',
            {
                target: makeRemoveTarget({
                    user_id: 7,
                    path: '/alice/b.txt',
                    entry: { uuid: 'uid-from-entry' },
                }),
            },
            {},
        );
        expect(fsEntryStore.invalidateEntryCacheByUuid).toHaveBeenCalledWith(
            'uid-from-entry',
        );
    });

    it('ignores a remove event with no usable target', async () => {
        const { eventClient, fsEntryStore } = setupHandler();

        await eventClient.emitAndWait('fs.remove.node', {}, {});
        await eventClient.emitAndWait('fs.remove.node', { target: {} }, {});

        expect(
            fsEntryStore.invalidateEntryCacheByPathForUser,
        ).not.toHaveBeenCalled();
        expect(fsEntryStore.invalidateEntryCacheByUuid).not.toHaveBeenCalled();
    });

    it('skips the path invalidation when the removed node has no owner id', async () => {
        const { eventClient, fsEntryStore } = setupHandler();

        await eventClient.emitAndWait(
            'fs.remove.node',
            {
                target: makeRemoveTarget({
                    path: '/alice/a.txt',
                    uid: 'uid-a',
                }),
            },
            {},
        );

        expect(
            fsEntryStore.invalidateEntryCacheByPathForUser,
        ).not.toHaveBeenCalled();
        expect(fsEntryStore.invalidateEntryCacheByUuid).toHaveBeenCalledWith(
            'uid-a',
        );
    });

    it('propagates a target read failure that is not an unknown-key probe', async () => {
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const { eventClient, fsEntryStore } = setupHandler();

        await eventClient.emitAndWait(
            'fs.remove.node',
            {
                target: {
                    get: vi.fn(async () => {
                        throw new Error('node context exploded');
                    }),
                },
            },
            {},
        );

        expect(
            fsEntryStore.invalidateEntryCacheByPathForUser,
        ).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining('fs.remove.node'),
            expect.objectContaining({ message: 'node context exploded' }),
        );
        consoleError.mockRestore();
    });
});
