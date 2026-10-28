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

import type { Response } from 'express';

// Under the concurrency store's one-hour orphan TTL.
const SLOT_RENEW_MS = 10 * 60 * 1000;

interface SlotHandle {
    release(): Promise<void>;
    renew?(): Promise<void>;
}

/**
 * A driver call's concurrency slot, held until the response is done and the
 * call's work has settled, including work a driver carries on after the caller
 * hung up or was answered.
 */
export class CallSlot {
    #handle?: SlotHandle;
    #work = new Set<Promise<unknown>>();
    #responded = false;
    #released = false;
    #renew?: NodeJS.Timeout;

    attach(handle: SlotHandle, res: Response): void {
        this.#handle = handle;
        const responded = () => {
            this.#responded = true;
            this.#maybeRelease();
        };
        res.once('finish', responded);
        res.once('close', responded);
        if (res.destroyed || res.writableFinished) responded();
    }

    keep(work: Promise<unknown>): void {
        if (this.#released) return;
        this.#work.add(work);
        if (this.#handle && !this.#renew) this.#startRenewing();
        const settled = () => {
            this.#work.delete(work);
            this.#maybeRelease();
        };
        work.then(settled, settled);
    }

    #startRenewing(): void {
        this.#renew = setInterval(() => {
            void this.#handle?.renew?.();
        }, SLOT_RENEW_MS);
        this.#renew.unref?.();
    }

    #maybeRelease(): void {
        if (this.#released || !this.#handle) return;
        if (!this.#responded || this.#work.size > 0) return;
        this.#released = true;
        clearInterval(this.#renew);
        void this.#handle.release();
    }
}
