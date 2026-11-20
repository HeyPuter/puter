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
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onResponseClose } from './onResponseClose.js';

let server: Server | undefined;
afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve) ?? resolve(null));
    server = undefined;
});

describe('onResponseClose', () => {
    it('shares one close listener and runs every callback once, in order', () => {
        const res = new EventEmitter();
        const calls: string[] = [];
        onResponseClose(res, () => calls.push('a'));
        onResponseClose(res, () => calls.push('b'));
        onResponseClose(res, () => calls.push('c'));
        expect(res.listenerCount('close')).toBe(1);

        res.emit('close');
        res.emit('close');
        expect(calls).toEqual(['a', 'b', 'c']);
        expect(res.listenerCount('close')).toBe(0);
    });

    it('keeps responses apart', () => {
        const first = new EventEmitter();
        const second = new EventEmitter();
        const onFirst = vi.fn();
        const onSecond = vi.fn();
        onResponseClose(first, onFirst);
        onResponseClose(second, onSecond);

        first.emit('close');
        expect(onFirst).toHaveBeenCalledOnce();
        expect(onSecond).not.toHaveBeenCalled();
    });

    it('runs the rest when one callback throws, and still surfaces the error', async () => {
        const res = new EventEmitter();
        const after = vi.fn();
        const failure = new Error('callback broke');
        const uncaught = vi.fn();
        const listeners = process.listeners('uncaughtException');
        process.removeAllListeners('uncaughtException');
        process.on('uncaughtException', uncaught);
        try {
            onResponseClose(res, () => {
                throw failure;
            });
            onResponseClose(res, after);
            res.emit('close');
            expect(after).toHaveBeenCalledOnce();
            await vi.waitFor(() =>
                expect(uncaught).toHaveBeenCalledWith(
                    failure,
                    expect.anything(),
                ),
            );
        } finally {
            process.off('uncaughtException', uncaught);
            for (const listener of listeners)
                process.on('uncaughtException', listener);
        }
    });

    it('fires when a client hangs up on a real response', async () => {
        const closed = new Promise<boolean>((resolve) => {
            server = createServer((_req, res) => {
                onResponseClose(res, () => resolve(res.writableFinished));
                res.write('partial');
            });
        });
        await new Promise<void>((resolve) => server!.listen(0, resolve));
        const { port } = server!.address() as AddressInfo;
        const req = get(`http://127.0.0.1:${port}/`, (res) => {
            res.once('data', () => req.destroy());
        });
        req.on('error', () => {});

        expect(await closed).toBe(false);
    });
});
