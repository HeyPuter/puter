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

import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallSlot } from './callSlot.js';

const handle = () => ({
    release: vi.fn(() => Promise.resolve()),
    renew: vi.fn(() => Promise.resolve()),
});

const deferred = () => {
    let resolve = () => {};
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

afterEach(() => {
    vi.useRealTimers();
});

describe('CallSlot', () => {
    it('renews a slot held by a long call and stops once it is released', async () => {
        vi.useFakeTimers();
        const slot = new CallSlot();
        const slotHandle = handle();
        const res = new EventEmitter();
        const call = deferred();
        slot.keep(call.promise);
        slot.attach(slotHandle, res as unknown as Response);

        res.emit('close');
        await vi.advanceTimersByTimeAsync(25 * 60 * 1000);
        expect(slotHandle.renew).toHaveBeenCalledTimes(2);
        expect(slotHandle.release).not.toHaveBeenCalled();

        call.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(slotHandle.release).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(25 * 60 * 1000);
        expect(slotHandle.renew).toHaveBeenCalledTimes(2);
    });

    it('releases once the response is done if no work is outstanding', async () => {
        const slot = new CallSlot();
        const slotHandle = handle();
        const res = new EventEmitter();
        slot.attach(slotHandle, res as unknown as Response);
        res.emit('finish');
        expect(slotHandle.release).toHaveBeenCalledOnce();
        expect(slotHandle.renew).not.toHaveBeenCalled();
    });
});
