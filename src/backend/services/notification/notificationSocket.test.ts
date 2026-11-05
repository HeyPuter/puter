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
import type { AckedAsk, SocketService } from '../socket/SocketService.js';
import type { EventClient } from '../../clients/event/EventClient.js';
import {
    NOTIF_RECEIPT_EVENT,
    NotificationSocketAdapter,
} from './notificationSocket.js';

const asked = (over: Partial<AckedAsk> = {}): AckedAsk => ({
    responses: [],
    timedOut: false,
    others: false,
    complete: true,
    ...over,
});

/** An adapter over fake sockets that answer `ask` here. */
const adapterWith = (opts: {
    ask?: AckedAsk;
    hasSocket?: boolean;
    heldInRegion?: boolean;
}) => {
    const askWithAck = vi.fn(async () => opts.ask ?? asked());
    const emit = vi.fn();
    const adapter = new NotificationSocketAdapter({
        event: { on: vi.fn(), emit } as unknown as EventClient,
        socket: {
            askWithAck,
            has: () => opts.hasSocket ?? false,
        } as unknown as SocketService,
        foldIn: () => false,
        ackTimeoutMs: () => 5_000,
        heldInPeerRegion: async () => false,
        heldInRegion: async () => opts.heldInRegion ?? false,
    });
    return { adapter, askWithAck, emit };
};

describe('answering a peer region`s receipt ask', () => {
    const ask = { userId: 7, appUid: null, uid: 'n-1', timeoutMs: 1_200 };

    it('answers held:false without asking when no node here holds a socket', async () => {
        const { adapter, askWithAck, emit } = adapterWith({});

        expect(await adapter.askHere(ask)).toEqual({
            held: false,
            responses: 0,
            timedOut: false,
            others: false,
            complete: true,
            responders: [],
        });
        expect(askWithAck).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('asks the region`s sockets for the given wait and settles nothing', async () => {
        const { adapter, askWithAck, emit } = adapterWith({
            heldInRegion: true,
            ask: asked({
                responses: [
                    { visibilityState: 'hidden', focused: false },
                    { received: false },
                ],
                others: true,
            }),
        });

        expect(await adapter.askHere(ask)).toEqual({
            held: true,
            responses: 2,
            timedOut: false,
            others: true,
            complete: true,
            responders: [{ visibilityState: 'hidden', focused: false }],
        });
        expect(askWithAck).toHaveBeenCalledWith(
            { room: 7 },
            NOTIF_RECEIPT_EVENT,
            { uid: 'n-1' },
            { timeoutMs: 1_200 },
        );
        expect(emit).not.toHaveBeenCalled();
    });

    it('asks a socket on this node even when presence says nothing', async () => {
        const { adapter, askWithAck } = adapterWith({
            hasSocket: true,
            ask: asked({ timedOut: true, responses: [] }),
        });

        expect(
            await adapter.askHere({ ...ask, appUid: 'app-x' }),
        ).toMatchObject({ held: true, timedOut: true, responders: [] });
        expect(askWithAck).toHaveBeenCalledWith(
            { room: expect.stringContaining('app-x') },
            NOTIF_RECEIPT_EVENT,
            { uid: 'n-1' },
            { timeoutMs: 1_200 },
        );
    });
});
