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

import type { DeliverableEvent } from './registry.js';

/**
 * The addressed peer queue: one batch per peer per window, never one request
 * per event.
 *
 * Separate from the all-peers generation fan because almost nothing about that
 * queue suits this traffic. Its window is sized for cache invalidations and is
 * far too long for a delivery a client is waiting on; its transport opens a
 * fresh connection per send, which is invisible at that cadence and dominant at
 * this one; and it drops the oldest entries on overflow behind a log line,
 * which would break the one promise this system makes about loss — that it is
 * always observable. Here an overflow is reported to the subscriptions that
 * lost events, and alarms.
 *
 * Batching also amortises the two fixed costs of a signed send, the shared
 * counter that allocates the anti-replay nonce and the signature over the body,
 * across everything in the window instead of paying both per event.
 */

// -- Wire ------------------------------------------------------------

/** One event handed to whichever region holds the socket for it. */
export interface ForwardDelivery {
    kind: 'delivery';
    /** Who the delivery is for, and which app's room it lands in. */
    userId: number;
    appUid: string | null;
    subId: string;
    event: DeliverableEvent;
    /** Set on a `single`: the far side asks the client to settle it. */
    ackRequired?: true;
    ackId?: string;
    /** The region holding the lease, which is where the ack has to end up. */
    origin?: string;
}

/** A client's settle, on its way back to the region that owns the lease. */
export interface ForwardAck {
    kind: 'ack';
    userId: number;
    subId: string;
    entryId: string;
}

export type ForwardItem = ForwardDelivery | ForwardAck;

/** One batch, as a peer receives it. */
export interface ForwardBatch {
    /** Sending region, so the receiver can address a reply. */
    from: string;
    items: ForwardItem[];
}

/**
 * What a peer answers. `noSocket` names the pairs it holds no connection for,
 * read off its own socket registry — the only signal that authorises a repair.
 */
export interface ForwardReply {
    noSocket?: Array<{ userId: number; appUid: string | null }>;
}

// -- Bounds ----------------------------------------------------------

/**
 * How long items wait for company. Deliveries are already debounced an order of
 * magnitude longer upstream, so nothing perceives this.
 */
export const FORWARD_FLUSH_MS = 25;

/** Items and bytes one batch carries, whichever bound trips first. */
export const FORWARD_MAX_ITEMS = 200;
export const FORWARD_MAX_BYTES = 256 * 1024;

/** Items held for one peer before the oldest are shed with markers. */
export const FORWARD_MAX_QUEUED = 5_000;

/**
 * Bytes held for one peer before the oldest are shed with markers. The count
 * bound alone leaves memory unbounded, since nothing caps an item's own size.
 */
export const FORWARD_MAX_QUEUED_BYTES = 32 * 1024 * 1024;

export interface ForwardQueueOptions {
    flushMs?: number;
    maxItems?: number;
    maxBytes?: number;
    maxQueued?: number;
    maxQueuedBytes?: number;
    /** Ships one batch. Rejection is a lost batch, not a retry. */
    send: (peerId: string, items: ForwardItem[]) => Promise<void>;
    /**
     * Items the queue could not hold. Never silent. Whatever it returns is
     * queued in their place — the markers that say something was lost — and is
     * not itself held to the bound, so a shed cannot cascade.
     */
    onOverflow: (
        peerId: string,
        dropped: ForwardItem[],
    ) => ForwardItem[] | void;
}

interface PeerQueue {
    items: ForwardItem[];
    bytes: number;
    timer: ReturnType<typeof setTimeout> | null;
    flushing: boolean;
}

export class PeerForwardQueue {
    readonly #peers = new Map<string, PeerQueue>();
    readonly #options: Required<
        Omit<ForwardQueueOptions, 'send' | 'onOverflow'>
    > &
        Pick<ForwardQueueOptions, 'send' | 'onOverflow'>;
    #stopped = false;

    constructor(options: ForwardQueueOptions) {
        this.#options = {
            flushMs: options.flushMs ?? FORWARD_FLUSH_MS,
            maxItems: options.maxItems ?? FORWARD_MAX_ITEMS,
            maxBytes: options.maxBytes ?? FORWARD_MAX_BYTES,
            maxQueued: options.maxQueued ?? FORWARD_MAX_QUEUED,
            maxQueuedBytes: options.maxQueuedBytes ?? FORWARD_MAX_QUEUED_BYTES,
            send: options.send,
            onOverflow: options.onOverflow,
        };
    }

    /** Queue one item for one peer, flushing early once a bound trips. */
    push(peerId: string, item: ForwardItem): void {
        if (this.#stopped) return;
        const queue = this.#queueFor(peerId);
        queue.items.push(item);
        queue.bytes += sizeOf(item);

        const { maxQueued, maxQueuedBytes, maxItems, maxBytes, flushMs } =
            this.#options;
        // Independent bounds: either can trip with the other well under.
        let dropped: ForwardItem[] = [];
        if (queue.items.length > maxQueued)
            dropped = dropped.concat(
                shed(queue, queue.items.length - maxQueued),
            );
        if (queue.bytes > maxQueuedBytes)
            dropped = dropped.concat(shedBytes(queue, maxQueuedBytes));
        if (dropped.length > 0) {
            // Appended here, past the bound check: a replacement sent back
            // through `push` would trip the bound it just made room under and
            // shed the next item, and so on down the whole queue.
            const replacements = this.#options.onOverflow(peerId, dropped);
            if (Array.isArray(replacements))
                for (const item of replacements) {
                    queue.items.push(item);
                    queue.bytes += sizeOf(item);
                }
        }

        if (
            !queue.flushing &&
            (queue.items.length >= maxItems || queue.bytes >= maxBytes)
        ) {
            void this.flush(peerId);
            return;
        }
        if (queue.timer) return;
        queue.timer = setTimeout(() => {
            queue.timer = null;
            void this.flush(peerId);
        }, flushMs);
        queue.timer.unref?.();
    }

    /** Ship whatever is held for one peer. */
    async flush(peerId: string): Promise<void> {
        const queue = this.#peers.get(peerId);
        if (!queue || queue.flushing || queue.items.length === 0) return;
        if (queue.timer) {
            clearTimeout(queue.timer);
            queue.timer = null;
        }

        queue.flushing = true;
        const batch = queue.items;
        queue.items = [];
        queue.bytes = 0;
        try {
            await this.#options.send(peerId, batch);
        } catch (err) {
            // A lost batch is a lost at-most-once delivery, and a `single`
            // still has its lease to pace the next attempt. Re-queuing would
            // hand the client an event whose moment has passed.
            console.warn(`[events] forward to ${peerId} failed`, err);
        } finally {
            queue.flushing = false;
            // Anything that arrived mid-flush gets the next window.
            if (queue.items.length > 0 && !queue.timer && !this.#stopped) {
                queue.timer = setTimeout(() => {
                    queue.timer = null;
                    void this.flush(peerId);
                }, this.#options.flushMs);
                queue.timer.unref?.();
            }
        }
    }

    async flushAll(): Promise<void> {
        await Promise.all([...this.#peers.keys()].map((id) => this.flush(id)));
    }

    stop(): void {
        this.#stopped = true;
        for (const queue of this.#peers.values()) {
            if (queue.timer) clearTimeout(queue.timer);
            queue.timer = null;
        }
    }

    #queueFor(peerId: string): PeerQueue {
        const held = this.#peers.get(peerId);
        if (held) return held;
        const queue: PeerQueue = {
            items: [],
            bytes: 0,
            timer: null,
            flushing: false,
        };
        this.#peers.set(peerId, queue);
        return queue;
    }
}

const sizeOf = (item: ForwardItem): number => {
    try {
        return JSON.stringify(item).length;
    } catch {
        return 0;
    }
};

const isGapMarker = (item: ForwardItem): boolean =>
    item.kind === 'delivery' && item.event.op === 'gap';

/**
 * Take `count` items off the old end, deliveries before markers: a marker is
 * the one thing saying events were lost, so it is the last thing to go. Bytes
 * come off per dropped item rather than being re-summed over the queue, which
 * at the bound would walk every held item for every drop.
 */
const shed = (queue: PeerQueue, count: number): ForwardItem[] => {
    const dropped: ForwardItem[] = [];
    for (let i = 0; i < queue.items.length && dropped.length < count; ) {
        if (isGapMarker(queue.items[i])) {
            i++;
            continue;
        }
        dropped.push(queue.items[i]);
        queue.items.splice(i, 1);
    }
    // Nothing but markers left to give: the oldest of those go too.
    while (dropped.length < count && queue.items.length > 0)
        dropped.push(queue.items.shift() as ForwardItem);
    for (const item of dropped) queue.bytes -= sizeOf(item);
    if (queue.bytes < 0) queue.bytes = 0;
    return dropped;
};

/**
 * `shed`'s priority order — oldest first, deliveries before markers — bounded
 * by held bytes instead of item count.
 */
const shedBytes = (queue: PeerQueue, maxBytesHeld: number): ForwardItem[] => {
    const dropped: ForwardItem[] = [];
    let remaining = queue.bytes;
    for (let i = 0; i < queue.items.length && remaining > maxBytesHeld; ) {
        if (isGapMarker(queue.items[i])) {
            i++;
            continue;
        }
        remaining -= sizeOf(queue.items[i]);
        dropped.push(queue.items[i]);
        queue.items.splice(i, 1);
    }
    // Nothing but markers left to give: the oldest of those go too.
    while (remaining > maxBytesHeld && queue.items.length > 0) {
        const item = queue.items.shift() as ForwardItem;
        remaining -= sizeOf(item);
        dropped.push(item);
    }
    queue.bytes = Math.max(0, remaining);
    return dropped;
};
