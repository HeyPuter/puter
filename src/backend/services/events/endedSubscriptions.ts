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
 * Subscriptions a dispatch must not queue for, for a short while after they
 * ended. A dispatch that already read a row before its `remove` reaches the
 * coalescer afterwards — this is what tells it not to. Covers one dispatch's
 * tail, not the subscription's life, so it is not a published limit and
 * `rate-limits-and-quotas.md` does not change for it.
 */

export const ENDED_SUBSCRIPTIONS_TTL_MS = 60_000;
export const ENDED_SUBSCRIPTIONS_MAX_ENTRIES = 20_000;

export class EndedSubscriptions {
    /** Insertion order is time order: re-marking moves an id to the tail. */
    readonly #endedAt = new Map<string, number>();

    mark(subId: string): void {
        this.#endedAt.delete(subId);
        this.#endedAt.set(subId, Date.now());
        this.#prune();
    }

    /** Whether `subId` ended within the window; an expired entry is dropped. */
    has(subId: string): boolean {
        const endedAt = this.#endedAt.get(subId);
        if (endedAt === undefined) return false;
        if (Date.now() - endedAt > ENDED_SUBSCRIPTIONS_TTL_MS) {
            this.#endedAt.delete(subId);
            return false;
        }
        return true;
    }

    get size(): number {
        return this.#endedAt.size;
    }

    #prune(): void {
        for (const [subId, endedAt] of this.#endedAt) {
            const overCap =
                this.#endedAt.size > ENDED_SUBSCRIPTIONS_MAX_ENTRIES;
            const headExpired =
                Date.now() - endedAt > ENDED_SUBSCRIPTIONS_TTL_MS;
            if (!overCap && !headExpired) break;
            this.#endedAt.delete(subId);
        }
    }
}
