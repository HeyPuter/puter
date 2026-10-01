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

/**
 * One delivery per (subscription, subject) per window.
 *
 * A multipart upload, a save loop and a recursive delete are each one thing a
 * user did that reaches the write path many times; a subscriber wants to hear
 * about it once. The window starts at the first event rather than restarting on
 * each one — a sustained writer would otherwise hold the timer open
 * indefinitely and the subscriber would hear nothing at all. Later events in
 * the window replace the payload, so what arrives is the newest state.
 *
 * Filtering runs before this, so a filtered-out event never opens a window;
 * whatever comes out the far side is a delivery, which is what makes this the
 * right place to count one.
 */

type Timer = ReturnType<typeof setTimeout>;

interface Pending<T> {
    payload: T;
    timer: Timer;
}

/** Coalescing is per (subscription, subject), which is what the key says. */
export const coalesceKey = (group: string, rest: string): string =>
    `${group}|${rest}`;

/** Everything before a key's first separator — the subscription it belongs to. */
const groupOf = (key: string): string => {
    const i = key.indexOf('|');
    return i === -1 ? key : key.slice(0, i);
};

export class DeliveryCoalescer<T> {
    readonly #pending = new Map<string, Pending<T>>();
    /** Pending keys by subscription, so asking about one is not a scan of all. */
    readonly #byGroup = new Map<string, Set<string>>();
    readonly #windowMs: number;
    readonly #flush: (key: string, payload: T) => void;

    constructor(windowMs: number, flush: (key: string, payload: T) => void) {
        this.#windowMs = windowMs;
        this.#flush = flush;
    }

    get pendingCount(): number {
        return this.#pending.size;
    }

    /** Whether a subscription still has anything queued. */
    hasGroup(group: string): boolean {
        return this.#byGroup.has(group);
    }

    /** Queue an event, opening a window if this key does not already have one. */
    push(key: string, payload: T): void {
        const existing = this.#pending.get(key);
        if (existing) {
            existing.payload = payload;
            return;
        }

        const timer = setTimeout(() => this.#release(key), this.#windowMs);
        timer.unref?.();
        this.#pending.set(key, { payload, timer });

        const group = groupOf(key);
        const keys = this.#byGroup.get(group) ?? new Set<string>();
        keys.add(key);
        this.#byGroup.set(group, keys);
    }

    /** Drop everything a subscription had queued, without delivering. */
    cancelGroup(group: string): void {
        const keys = this.#byGroup.get(group);
        if (!keys) return;
        for (const key of keys) {
            const pending = this.#pending.get(key);
            if (!pending) continue;
            clearTimeout(pending.timer);
            this.#pending.delete(key);
        }
        this.#byGroup.delete(group);
    }

    #release(key: string): void {
        const pending = this.#pending.get(key);
        if (!pending) return;
        this.#pending.delete(key);

        const group = groupOf(key);
        const keys = this.#byGroup.get(group);
        if (keys) {
            keys.delete(key);
            if (keys.size === 0) this.#byGroup.delete(group);
        }

        this.#flush(key, pending.payload);
    }
}
