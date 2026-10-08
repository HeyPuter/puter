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

import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { pipeNdjsonStream } from './ndjsonStream.js';

const capture = () => {
    const stream = new PassThrough();
    const events: Record<string, unknown>[] = [];
    const onEnd = vi.fn();
    const onError = vi.fn();
    pipeNdjsonStream(stream, (event) => events.push(event), {
        onEnd,
        onError,
    });
    return { stream, events, onEnd, onError };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('chat NDJSON termination', () => {
    it('accepts a terminal event without a final newline', async () => {
        const h = capture();
        h.stream.end('{"type":"usage"}');
        await settle();
        expect(h.events).toEqual([{ type: 'usage' }]);
        expect(h.onEnd).toHaveBeenCalledOnce();
        expect(h.onError).not.toHaveBeenCalled();
    });
    it('decodes split UTF-8 characters without corruption', async () => {
        const h = capture();
        const bytes = Buffer.from('{"type":"text","text":"😀"}\n');
        const split = bytes.indexOf(Buffer.from('😀')) + 2;
        h.stream.write(bytes.subarray(0, split));
        h.stream.write(bytes.subarray(split));
        h.stream.end('{"type":"usage"}\n');
        await settle();
        expect(h.events[0].text).toBe('😀');
        expect(h.onEnd).toHaveBeenCalledOnce();
    });
    it.each(['{bad json}\n', 'null\n', '{"type":"text","text":"partial"}\n'])(
        'fails an invalid or incomplete stream: %s',
        async (body) => {
            const h = capture();
            h.stream.end(body);
            await settle();
            expect(h.onError).toHaveBeenCalledOnce();
            expect(h.onEnd).not.toHaveBeenCalled();
        },
    );
    it('reports a close without an end event', async () => {
        const h = capture();
        h.stream.destroy();
        await settle();
        expect(h.onError).toHaveBeenCalledOnce();
        expect(h.onEnd).not.toHaveBeenCalled();
    });
    it('does not report successful completion after an error event', async () => {
        const h = capture();
        h.stream.emit('error', new Error('broken'));
        h.stream.end('{"type":"usage"}\n');
        await settle();
        expect(h.onError).toHaveBeenCalledOnce();
        expect(h.onEnd).not.toHaveBeenCalled();
    });
    it('ignores events after an in-band error', async () => {
        const h = capture();
        h.stream.end(
            '{"type":"error","message":"failed"}\n{"type":"text","text":"late"}\n',
        );
        await settle();
        expect(h.events).toHaveLength(1);
        expect(h.onEnd).not.toHaveBeenCalled();
        expect(h.onError).not.toHaveBeenCalled();
    });
});
