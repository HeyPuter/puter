/**
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

describe('FSEntryCacheInvalidationEventHandler', () => {
    it('reads exact outer GUI event payloads from the EventClient data argument', async () => {
        const eventClient = new EventClient({} as never);
        const fsEntryStore = {
            invalidateEntryCacheByPathForUser: vi.fn(async () => undefined),
            invalidateEntryCacheByUuid: vi.fn(async () => undefined),
        } as unknown as FSEntryStore;

        new FSEntryCacheInvalidationEventHandler(fsEntryStore, eventClient);

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
});
