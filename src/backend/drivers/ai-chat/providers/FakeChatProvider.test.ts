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
import { describe, expect, it } from 'vitest';
import { Context } from '../../../core/context.js';
import { withTestActor } from '../../integrationTestUtil.js';
import { AIChatStream } from '../utils/Streaming.js';
import { FakeChatProvider } from './FakeChatProvider.js';

describe('fake chat streaming lifecycle', () => {
    it('cancels the simulated delay before writing output', async () => {
        await withTestActor(async () => {
            const abort = new AbortController();
            Context.set('abortSignal', abort.signal);
            const result = await new FakeChatProvider().complete({
                model: 'fake',
                stream: true,
                messages: [],
            });
            const stream = new PassThrough();
            const chatStream = new AIChatStream({ stream });
            const pump = result.init_chat_stream!({ chatStream });
            abort.abort();
            await expect(pump).rejects.toMatchObject({ name: 'AbortError' });
            expect(stream.readableLength).toBe(0);
        });
    });
    it('writes text and a terminal usage event on normal completion', async () => {
        const result = await new FakeChatProvider().complete({
            model: 'fake',
            stream: true,
            messages: [],
        });
        const stream = new PassThrough();
        const chatStream = new AIChatStream({ stream });
        await result.init_chat_stream!({ chatStream });
        let body = '';
        for await (const chunk of stream) body += chunk.toString();
        const events = body
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(events.map((event) => event.type)).toEqual(['text', 'usage']);
    });
    it('does not write after the chat stream was aborted independently', async () => {
        const result = await new FakeChatProvider().complete({
            model: 'fake',
            stream: true,
            messages: [],
        });
        const stream = new PassThrough();
        const chatStream = new AIChatStream({ stream });
        chatStream.abort();
        await result.init_chat_stream!({ chatStream });
        expect(stream.readableLength).toBe(0);
    });
});
