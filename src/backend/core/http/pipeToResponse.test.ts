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
import http from 'node:http';
import { Socket, type AddressInfo } from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { pipeToResponse } from './pipeToResponse.js';

interface Served {
    res: http.ServerResponse;
    piped: Promise<void>;
    closeListeners: { before: number; after: number };
}

/** One request against a server that pipes `makeBody()` into its response. */
const serve = (makeBody: () => Readable) => {
    let onServed!: (served: Served) => void;
    const served = new Promise<Served>((resolve) => {
        onServed = resolve;
    });
    const server = http.createServer((_req, res) => {
        const before = res.listenerCount('close');
        const piped = pipeToResponse(makeBody(), res as unknown as Response);
        onServed({
            res,
            piped,
            closeListeners: { before, after: res.listenerCount('close') },
        });
    });
    servers.push(server);
    const listening = new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () =>
            resolve((server.address() as AddressInfo).port),
        );
    });
    return { served, listening };
};

const servers: http.Server[] = [];
afterEach(async () => {
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});

describe('pipeToResponse', () => {
    it('streams the body byte for byte and resolves once the response is done', async () => {
        const { served, listening } = serve(() =>
            Readable.from([Buffer.from('a'), Buffer.from('bc')]),
        );
        const response = await fetch(`http://127.0.0.1:${await listening}/`);
        expect(await response.text()).toBe('abc');
        const { res, piped } = await served;
        await piped;
        expect(res.writableFinished).toBe(true);
    });

    it("adds no 'close' listener beyond the one pipe adds", async () => {
        const { served, listening } = serve(() => Readable.from(['x']));
        const response = await fetch(`http://127.0.0.1:${await listening}/`);
        await response.text();
        const { closeListeners } = await served;
        expect(closeListeners.after - closeListeners.before).toBe(1);
    });

    it('releases the body when the client hangs up mid-stream', async () => {
        const body = new PassThrough();
        const { served, listening } = serve(() => body);
        const abort = new AbortController();
        const pending = fetch(`http://127.0.0.1:${await listening}/`, {
            signal: abort.signal,
        });
        body.write('first');
        const response = await pending;
        await response.body!.getReader().read();
        abort.abort();

        const { piped } = await served;
        await piped;
        expect(body.destroyed).toBe(true);
    });

    it('cuts the response off when the body fails mid-stream', async () => {
        const body = new PassThrough();
        const { served, listening } = serve(() => body);
        const pending = fetch(`http://127.0.0.1:${await listening}/`);
        body.write('partial');
        const response = await pending;
        const reader = response.body!.getReader();
        await reader.read();
        body.destroy(new Error('upstream broke'));

        const outcome = await (async () => {
            try {
                while (!(await reader.read()).done);
                return 'ended';
            } catch {
                return 'cut off';
            }
        })();
        expect(outcome).toBe('cut off');
        const { res, piped } = await served;
        await piped;
        expect(res.destroyed).toBe(true);
    });

    it('releases the body at once when the response already closed', async () => {
        const res = new http.ServerResponse(
            new http.IncomingMessage(new Socket()),
        );
        res.destroy();
        const body = new PassThrough();
        await pipeToResponse(body, res as unknown as Response);
        expect(body.destroyed).toBe(true);
    });
});
