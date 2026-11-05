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
 * Paces the settles a delivery starts when it finds background consent
 * withdrawn. A settle ends rows for good, so a permission check that wrongly
 * answers no must not end every row a delivery reaches: past a small budget per
 * window the rest only defer. A pair a fresh read just found consented is not
 * read again for a while, so a stale cached no costs one primary read, not one
 * per delivery. Per process, and not a published limit.
 */

export const CONSENT_SETTLES_PER_WINDOW = 20;
export const CONSENT_SETTLE_WINDOW_MS = 60_000;
export const CONSENT_CONFIRMED_TTL_MS = 60_000;
export const CONSENT_CONFIRMED_MAX_ENTRIES = 10_000;

/** `spent`: the window's budget is gone, which is worth an alarm. */
export type ConsentCheckStart = 'start' | 'skip' | 'spent';

export class ConsentSettles {
    readonly #inFlight = new Set<string>();
    /** Insertion order is time order: re-confirming moves a key to the tail. */
    readonly #confirmedAt = new Map<string, number>();
    #windowStart = 0;
    #taken = 0;

    /** Whether to check `key` now; `start` must be paired with `end`. */
    begin(key: string): ConsentCheckStart {
        if (this.#inFlight.has(key)) return 'skip';
        const confirmedAt = this.#confirmedAt.get(key);
        if (confirmedAt !== undefined) {
            if (Date.now() - confirmedAt <= CONSENT_CONFIRMED_TTL_MS)
                return 'skip';
            this.#confirmedAt.delete(key);
        }
        if (this.#left() === 0) return 'spent';
        this.#inFlight.add(key);
        return 'start';
    }

    end(key: string): void {
        this.#inFlight.delete(key);
    }

    /** A fresh read found the consent standing. */
    confirm(key: string): void {
        this.#confirmedAt.delete(key);
        this.#confirmedAt.set(key, Date.now());
        this.#prune();
    }

    /** One settle from this window's budget; false once it is spent. */
    take(): boolean {
        if (this.#left() === 0) return false;
        this.#taken++;
        return true;
    }

    #left(): number {
        if (Date.now() - this.#windowStart >= CONSENT_SETTLE_WINDOW_MS) {
            this.#windowStart = Date.now();
            this.#taken = 0;
        }
        return CONSENT_SETTLES_PER_WINDOW - this.#taken;
    }

    #prune(): void {
        for (const [key, confirmedAt] of this.#confirmedAt) {
            const overCap =
                this.#confirmedAt.size > CONSENT_CONFIRMED_MAX_ENTRIES;
            const headExpired =
                Date.now() - confirmedAt > CONSENT_CONFIRMED_TTL_MS;
            if (!overCap && !headExpired) break;
            this.#confirmedAt.delete(key);
        }
    }
}
