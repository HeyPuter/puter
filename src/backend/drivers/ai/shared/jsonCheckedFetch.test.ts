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
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonCheckedFetch } from './jsonCheckedFetch.js';

const answer = (response: Response) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('jsonCheckedFetch', () => {
    it('passes a JSON answer through with its status and headers', async () => {
        answer(Response.json({ a: 1 }, { headers: { 'x-request-id': 'r1' } }));
        const response = await jsonCheckedFetch('https://x.test');
        expect(response.status).toBe(200);
        expect(response.headers.get('x-request-id')).toBe('r1');
        expect(await response.json()).toEqual({ a: 1 });
    });

    it.each(['{"id":"x","choices":[{"mess', '', '<html>502</html>'])(
        'turns a 2xx JSON answer with the body %j into a 502',
        async (body) => {
            answer(
                new Response(body, {
                    headers: { 'content-type': 'application/json' },
                }),
            );
            const response = await jsonCheckedFetch('https://x.test');
            expect(response.status).toBe(502);
            expect(await response.json()).toEqual({
                error: { message: expect.any(String) },
            });
        },
    );

    it('rejects a declared JSON body over the cap before reading it', async () => {
        const cancel = vi.fn();
        answer(new Response(new ReadableStream({ cancel }), {
            headers: {
                'content-type': 'application/json',
                'content-length': String(64 * 1024 * 1024 + 1),
            },
        }));
        expect((await jsonCheckedFetch('https://x.test')).status).toBe(502);
        expect(cancel).toHaveBeenCalledOnce();
    });

    it('rejects an undeclared JSON body that exceeds the cap', async () => {
        answer(new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(64 * 1024 * 1024 + 1).fill(32));
                controller.enqueue(new TextEncoder().encode('{}'));
                controller.close();
            },
        }), { headers: { 'content-type': 'application/json' } }));
        expect((await jsonCheckedFetch('https://x.test')).status).toBe(502);
    });

    it('leaves streams, binary bodies and error answers alone', async () => {
        for (const original of [
            new Response('data: {', {
                headers: { 'content-type': 'text/event-stream' },
            }),
            new Response('RIFF', { headers: { 'content-type': 'audio/wav' } }),
            new Response('{', {
                status: 400,
                headers: { 'content-type': 'application/json' },
            }),
        ]) {
            answer(original);
            expect(await jsonCheckedFetch('https://x.test')).toBe(original);
        }
    });
});
