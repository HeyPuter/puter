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

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AckedAsk, SocketService } from '../socket/SocketService.js';
import type { EventClient } from '../../clients/event/EventClient.js';
import {
    NOTIF_RECEIPT_EVENT,
    NotificationSocketAdapter,
    regionReceiptOf,
    type PeerReceiptAsk,
    type RegionReceipt,
} from './notificationSocket.js';

const asked = (over: Partial<AckedAsk> = {}): AckedAsk => ({
    responses: [],
    timedOut: false,
    others: false,
    complete: true,
    ...over,
});

const answered = (over: Partial<RegionReceipt> = {}): RegionReceipt => ({
    held: true,
    responses: 0,
    timedOut: false,
    others: false,
    complete: true,
    responders: [],
    ...over,
});

type PeerAnswer = RegionReceipt | null | 'throws';

/** An adapter over fake sockets here and fake peer regions. */
const adapterWith = (opts: {
    ask?: AckedAsk;
    hasSocket?: boolean;
    heldInRegion?: boolean;
    peerReceipts?: boolean;
    regions?: string[];
    regionsAfterMs?: number;
    peers?: Record<string, PeerAnswer>;
}) => {
    const askWithAck = vi.fn(async () => opts.ask ?? asked());
    const emit = vi.fn();
    const askPeer = vi.fn(
        async (
            region: string,
            _ask: PeerReceiptAsk,
            _timeoutMs: number,
        ): Promise<RegionReceipt | null> => {
            const answer = opts.peers?.[region] ?? null;
            if (answer === 'throws') throw new Error('peer down');
            return answer;
        },
    );
    const adapter = new NotificationSocketAdapter({
        event: { on: vi.fn(), emit } as unknown as EventClient,
        socket: {
            askWithAck,
            has: () => opts.hasSocket ?? false,
        } as unknown as SocketService,
        foldIn: () => false,
        ackTimeoutMs: () => 5_000,
        peerReceipts: () => opts.peerReceipts ?? true,
        peerRegions: (): Promise<string[]> =>
            new Promise((resolve) => {
                const regions = opts.regions ?? [];
                if (opts.regionsAfterMs === undefined) resolve(regions);
                else setTimeout(() => resolve(regions), opts.regionsAfterMs);
            }),
        askPeer,
        heldInRegion: async () => opts.heldInRegion ?? false,
    });
    const receipt = () =>
        adapter.receipt({
            userId: 7,
            appUid: null,
            uid: 'n-1',
            type: 'share.received',
        });
    return { adapter, askWithAck, askPeer, emit, receipt };
};

describe('settling a receipt across regions', () => {
    it.each<
        [string, Parameters<typeof adapterWith>[0], Record<string, unknown>]
    >([
        [
            'received from a page here',
            {
                ask: asked({ responses: [{ visibilityState: 'visible' }] }),
                regions: ['b'],
            },
            {
                outcome: 'received',
                peersUnheard: ['b'],
                responders: [{ visibilityState: 'visible' }],
            },
        ],
        [
            'received from a page in a peer region, named by region',
            {
                regions: ['b'],
                peers: {
                    b: answered({
                        responses: 1,
                        responders: [{ visibilityState: 'hidden' }],
                    }),
                },
            },
            {
                outcome: 'received',
                ackCapable: true,
                peersAsked: ['b'],
                peersUnheard: [],
                responders: [{ visibilityState: 'hidden', region: 'b' }],
            },
        ],
        [
            'unreceived when a peer page answered without it',
            { regions: ['b'], peers: { b: answered({ responses: 1 }) } },
            { outcome: 'unreceived', ackCapable: true, responders: [] },
        ],
        [
            'unreceived when a peer page let the ask time out',
            { regions: ['b'], peers: { b: answered({ timedOut: true }) } },
            { outcome: 'unreceived', ackCapable: true },
        ],
        [
            'unreceived when a peer holds a page that does not acknowledge',
            { regions: ['b'], peers: { b: answered({ others: true }) } },
            {
                outcome: 'unreceived',
                ackCapable: false,
                everySocketAcks: false,
            },
        ],
        [
            'unreceived when a peer could not count its nodes',
            { regions: ['b'], peers: { b: answered({ complete: false }) } },
            { outcome: 'unreceived', complete: false },
        ],
        [
            'unreceived when a page here timed out, even with a peer unheard',
            { ask: asked({ timedOut: true }), regions: ['b'] },
            { outcome: 'unreceived', peersUnheard: ['b'] },
        ],
        [
            'remote-only when a peer did not answer',
            { regions: ['b'], peers: { b: null } },
            {
                outcome: 'remote-only',
                ackCapable: false,
                everySocketAcks: true,
                complete: true,
                peerRegions: true,
                peersAsked: ['b'],
                peersUnheard: ['b'],
            },
        ],
        [
            'remote-only when asking a peer threw',
            { regions: ['b'], peers: { b: 'throws' } },
            { outcome: 'remote-only', peersUnheard: ['b'] },
        ],
        [
            'remote-only when one peer holds nothing and another is unheard',
            { regions: ['b', 'c'], peers: { b: answered({ held: false }) } },
            {
                outcome: 'remote-only',
                peersAsked: ['b', 'c'],
                peersUnheard: ['c'],
            },
        ],
        [
            'no-socket when every peer holds nothing',
            {
                regions: ['b', 'c'],
                peers: {
                    b: answered({ held: false }),
                    c: answered({ held: false }),
                },
            },
            {
                outcome: 'no-socket',
                peerRegions: true,
                peersAsked: ['b', 'c'],
                peersUnheard: [],
            },
        ],
        [
            'no-socket with no peer region at all',
            {},
            {
                outcome: 'no-socket',
                peerRegions: false,
                peersAsked: [],
                peersUnheard: [],
            },
        ],
    ])('%s', async (_name, opts, expected) => {
        const { receipt, emit } = adapterWith(opts);

        const settled = await receipt();

        expect(settled).toMatchObject(expected);
        expect(emit).toHaveBeenCalledWith(
            'notif.delivery.settled',
            settled,
            {},
        );
    });

    it('asks no peer with peer receipts off, and reads presence as before', async () => {
        const { receipt, askPeer } = adapterWith({
            peerReceipts: false,
            regions: ['b'],
            peers: { b: answered({ held: false }) },
        });

        const settled = await receipt();

        expect(askPeer).not.toHaveBeenCalled();
        expect(settled).toEqual({
            uid: 'n-1',
            userId: 7,
            type: 'share.received',
            outcome: 'remote-only',
            ackCapable: false,
            everySocketAcks: true,
            complete: true,
            peerRegions: true,
            responders: [],
        });
    });
});

describe('reading a peer`s answer', () => {
    it('keeps only what a responder may carry, and drops the rest', () => {
        expect(
            regionReceiptOf({
                ok: true,
                receipt: {
                    ...answered({ responses: 2 }),
                    responders: [
                        { visibilityState: 'visible', region: 'z', x: 1 },
                        { received: false },
                    ],
                },
            }),
        ).toEqual(
            answered({
                responses: 2,
                responders: [{ visibilityState: 'visible' }],
            }),
        );
    });

    it('takes at most a hundred responders from one peer', () => {
        const receipt = regionReceiptOf({
            receipt: answered({
                responses: 150,
                responders: Array.from({ length: 150 }, () => ({
                    visibilityState: 'hidden' as const,
                })),
            }),
        });

        expect(receipt!.responders).toHaveLength(100);
    });

    it.each([
        ['no reply', null],
        ['a reply without a receipt', { ok: true, ignored: 'self-peer' }],
        ['a receipt missing a field', { receipt: { held: true } }],
        [
            'a count that is not a number',
            { receipt: { ...answered(), responses: '1' } },
        ],
        [
            'responders that are not a list',
            { receipt: { ...answered(), responders: {} } },
        ],
    ])('reads %s as no answer', (_name, reply) => {
        expect(regionReceiptOf(reply)).toBeNull();
    });
});

describe('the receipt window a peer is asked inside', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const settleAfter = async (regionsAfterMs: number) => {
        vi.useFakeTimers();
        const fixture = adapterWith({
            regions: ['b'],
            regionsAfterMs,
            peers: { b: answered({ held: false }) },
        });
        const settling = fixture.receipt();
        await vi.advanceTimersByTimeAsync(regionsAfterMs);
        return { ...fixture, settled: await settling };
    };

    it('gives a peer the window less the margin, and the window to answer', async () => {
        const { askPeer, settled } = await settleAfter(0);

        expect(askPeer).toHaveBeenCalledWith(
            'b',
            { userId: 7, appUid: null, uid: 'n-1', timeoutMs: 4_250 },
            5_000,
        );
        expect(settled).toMatchObject({ outcome: 'no-socket' });
    });

    it('gives a peer only what is left once presence answered', async () => {
        const { askPeer } = await settleAfter(3_700);

        expect(askPeer).toHaveBeenCalledWith(
            'b',
            expect.objectContaining({ timeoutMs: 550 }),
            1_300,
        );
    });

    it('leaves a peer unasked, and unheard, with too little time left', async () => {
        const { askPeer, settled } = await settleAfter(3_800);

        expect(askPeer).not.toHaveBeenCalled();
        expect(settled).toMatchObject({
            outcome: 'remote-only',
            peersUnheard: ['b'],
        });
    });
});

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
