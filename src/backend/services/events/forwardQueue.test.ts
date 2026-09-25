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
import { PeerForwardQueue, type ForwardItem } from './forwardQueue.js';

/**
 * One request per window per peer, never one per event, and nothing lost
 * without somebody being told.
 */

const queues: PeerForwardQueue[] = [];

const delivery = (subId: string, id = subId): ForwardItem => ({
    kind: 'delivery',
    userId: 7,
    appUid: 'app-a',
    subId,
    event: {
        id,
        subject: 'fs:/u7/Documents',
        op: 'write',
        uid: 'node-1',
        path: '/u7/Documents/notes.txt',
        self: true,
        seq: 0,
        ts: 1,
    },
});

const makeQueue = (
    over: Partial<ConstructorParameters<typeof PeerForwardQueue>[0]> = {},
) => {
    const sent: Array<{ peerId: string; items: ForwardItem[] }> = [];
    const overflowed: Array<{ peerId: string; dropped: ForwardItem[] }> = [];
    const queue = new PeerForwardQueue({
        flushMs: 10,
        send: async (peerId, items) => {
            sent.push({ peerId, items });
        },
        onOverflow: (peerId, dropped) => overflowed.push({ peerId, dropped }),
        ...over,
    });
    queues.push(queue);
    return { queue, sent, overflowed };
};

const settled = (
    sent: Array<{ peerId: string; items: ForwardItem[] }>,
    count = 1,
): Promise<void> =>
    vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(count), {
        timeout: 2_000,
        interval: 5,
    });

afterEach(() => {
    while (queues.length) queues.pop()?.stop();
});

describe('the addressed peer queue', () => {
    it('carries a window of events in one request', async () => {
        const { queue, sent } = makeQueue();

        for (let i = 0; i < 8; i++) queue.push('east', delivery(`sub-${i}`));
        await settled(sent);

        expect(sent).toHaveLength(1);
        expect(sent[0].peerId).toBe('east');
        expect(sent[0].items).toHaveLength(8);
    });

    it('keeps each peer to its own batch', async () => {
        const { queue, sent } = makeQueue();

        queue.push('east', delivery('a'));
        queue.push('south', delivery('b'));
        await settled(sent, 2);

        expect(sent.map((call) => call.peerId).sort()).toEqual([
            'east',
            'south',
        ]);
        for (const call of sent) expect(call.items).toHaveLength(1);
    });

    it('ships early once the item bound trips', async () => {
        const { queue, sent } = makeQueue({ maxItems: 3, flushMs: 60_000 });

        for (let i = 0; i < 3; i++) queue.push('east', delivery(`sub-${i}`));
        await settled(sent);

        expect(sent[0].items).toHaveLength(3);
    });

    it('ships early once the byte bound trips', async () => {
        const { queue, sent } = makeQueue({ maxBytes: 200, flushMs: 60_000 });

        queue.push('east', delivery('a'));
        queue.push('east', delivery('b'));
        await settled(sent);

        expect(sent[0].items.length).toBeGreaterThan(0);
    });

    it('reports what it could not hold rather than dropping it quietly', async () => {
        const { queue, overflowed } = makeQueue({
            maxQueued: 2,
            flushMs: 60_000,
        });

        queue.push('east', delivery('a'));
        queue.push('east', delivery('b'));
        queue.push('east', delivery('c'));
        queue.push('east', delivery('d'));

        expect(overflowed).toHaveLength(2);
        expect(overflowed[0].peerId).toBe('east');
        expect(
            overflowed.flatMap((call) =>
                call.dropped.map((item) =>
                    item.kind === 'delivery' ? item.subId : item.kind,
                ),
            ),
        ).toEqual(['a', 'b']);
    });

    it('sheds by held bytes as well as by count', async () => {
        // A down peer holding items under the count cap could still hold
        // unbounded memory if nothing else capped how large those items were
        // allowed to be — the byte bound is the other half of "shed on
        // overflow", independent of `maxQueued`.
        const size = JSON.stringify(delivery('x')).length;
        const { queue, overflowed } = makeQueue({
            maxQueued: 100, // never trips on its own here
            maxQueuedBytes: size * 2 + 1, // room for two items, not three
            flushMs: 60_000,
        });

        queue.push('east', delivery('a'));
        queue.push('east', delivery('b'));
        queue.push('east', delivery('c'));

        expect(overflowed).toHaveLength(1);
        expect(overflowed[0].peerId).toBe('east');
        expect(
            overflowed[0].dropped.map((item) =>
                item.kind === 'delivery' ? item.subId : item.kind,
            ),
        ).toEqual(['a']);
    });

    it('does not lose the rest of a window to one failed send', async () => {
        const failures: string[] = [];
        const { queue, sent } = makeQueue({
            send: async (peerId, items) => {
                if (failures.length === 0) {
                    failures.push(peerId);
                    throw new Error('peer unreachable');
                }
                sentAfter.push({ peerId, items });
            },
        });
        const sentAfter: Array<{ peerId: string; items: ForwardItem[] }> = [];

        queue.push('east', delivery('a'));
        await vi.waitFor(() => expect(failures).toHaveLength(1));

        queue.push('east', delivery('b'));
        await settled(sentAfter);

        expect(sentAfter[0].items).toHaveLength(1);
        expect(sent).toHaveLength(0);
    });

    it('gives what arrived mid-flight the next window instead of the current one', async () => {
        let release: (() => void) | null = null;
        const sent: Array<{ peerId: string; items: ForwardItem[] }> = [];
        const { queue } = makeQueue({
            maxItems: 1,
            send: async (peerId, items) => {
                sent.push({ peerId, items });
                if (sent.length === 1)
                    await new Promise<void>((resolve) => {
                        release = resolve;
                    });
            },
        });

        queue.push('east', delivery('a'));
        await vi.waitFor(() => expect(release).not.toBeNull());
        queue.push('east', delivery('b'));
        release!();

        await settled(sent, 2);
        expect(
            sent[0].items.map((item) => (item as { subId: string }).subId),
        ).toEqual(['a']);
        expect(
            sent[1].items.map((item) => (item as { subId: string }).subId),
        ).toEqual(['b']);
    });

    it('sends nothing more once it is stopped', async () => {
        const { queue, sent } = makeQueue();
        queue.stop();

        queue.push('east', delivery('a'));
        await new Promise((resolve) => setTimeout(resolve, 40));

        expect(sent).toHaveLength(0);
    });
    it('queues what the overflow handler returns without shedding again', async () => {
        let overflows = 0;
        const { queue, sent } = makeQueue({
            maxQueued: 2,
            onOverflow: (_peerId, dropped) => {
                overflows++;
                return dropped.map((item) => ({
                    ...(item as Extract<ForwardItem, { kind: 'delivery' }>),
                    event: {
                        ...(item as Extract<ForwardItem, { kind: 'delivery' }>)
                            .event,
                        op: 'gap',
                    },
                })) as ForwardItem[];
            },
        });

        queue.push('east', delivery('a'));
        queue.push('east', delivery('b'));
        queue.push('east', delivery('c'));
        await settled(sent);

        // One shed, one marker for it — not a marker per item down the queue.
        expect(overflows).toBe(1);
        expect(
            sent[0].items.map((item) =>
                item.kind === 'delivery'
                    ? `${item.subId}:${item.event.op}`
                    : item.kind,
            ),
        ).toEqual(['b:write', 'c:write', 'a:gap']);
    });

    it('sheds deliveries before the markers that report them', async () => {
        const { queue, sent, overflowed } = makeQueue({
            maxQueued: 2,
            onOverflow: (_peerId, dropped) => {
                overflowed.push({ peerId: 'east', dropped });
                return dropped.map((item) => ({
                    ...(item as Extract<ForwardItem, { kind: 'delivery' }>),
                    event: {
                        ...(item as Extract<ForwardItem, { kind: 'delivery' }>)
                            .event,
                        op: 'gap',
                    },
                })) as ForwardItem[];
            },
        });

        queue.push('east', delivery('a'));
        queue.push('east', delivery('b'));
        queue.push('east', delivery('c')); // sheds a, queues a:gap
        queue.push('east', delivery('d')); // sheds b and c, never the marker
        await settled(sent);

        expect(
            overflowed.flatMap((call) =>
                call.dropped.map((item) =>
                    item.kind === 'delivery' ? item.subId : item.kind,
                ),
            ),
        ).toEqual(['a', 'b', 'c']);
        expect(
            sent[0].items.some(
                (item) =>
                    item.kind === 'delivery' &&
                    item.event.op === 'gap' &&
                    item.subId === 'a',
            ),
        ).toBe(true);
    });
});
