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

import { describe, expect, it, vi } from 'vitest';

import type { EventClient } from '../../../clients/event/EventClient.js';
import { emitMediaLog, loggedParameters } from './mediaLog.js';

describe('loggedParameters', () => {
    it('summarizes data URIs wherever they sit', () => {
        const uri = 'data:audio/mpeg;base64,AAAA';
        expect(
            loggedParameters({
                file: uri,
                images: [uri, '/alice/a.png'],
                nested: { source: uri },
            }),
        ).toEqual({
            file: `[data URI audio/mpeg, ${uri.length} chars]`,
            images: [
                `[data URI audio/mpeg, ${uri.length} chars]`,
                '/alice/a.png',
            ],
            nested: { source: `[data URI audio/mpeg, ${uri.length} chars]` },
        });
    });

    it('summarizes byte buffers by size', () => {
        expect(
            loggedParameters({
                buffer: Buffer.from('abc'),
                bytes: new Uint8Array(5),
                raw: new ArrayBuffer(7),
            }),
        ).toEqual({
            buffer: '[3 bytes]',
            bytes: '[5 bytes]',
            raw: '[7 bytes]',
        });
    });

    it('keeps text, paths, URLs, numbers, and flags as they are', () => {
        const params = {
            text: 'hello',
            file: { path: '/alice/a.mp3' },
            url: 'https://example.com/a.mp3',
            seconds: 4,
            stream: false,
            missing: null,
        };
        expect(loggedParameters(params)).toEqual(params);
    });

    it('names an unknown media type', () => {
        expect(loggedParameters('data:,hi')).toBe(
            '[data URI unknown, 8 chars]',
        );
    });
});

describe('emitMediaLog', () => {
    it('emits one ai.log.media event with a fresh completion id', () => {
        const emit = vi.fn();
        const events = { emit } as unknown as EventClient;
        const actor = { user: { id: 1, uuid: 'u', username: 'alice' } };

        emitMediaLog(events, {
            kind: 'tts',
            actor: actor as never,
            parameters: { text: 'hi' },
            model: null,
            provider: 'openai',
        });
        emitMediaLog(events, {
            kind: 'tts',
            actor: actor as never,
            parameters: { text: 'hi' },
            model: null,
            provider: 'openai',
        });

        expect(emit).toHaveBeenCalledTimes(2);
        const [[key, first, meta], [, second]] = emit.mock.calls;
        expect(key).toBe('ai.log.media');
        expect(meta).toEqual({});
        expect(first).toEqual({
            kind: 'tts',
            actor,
            completionId: expect.stringMatching(/^[0-9a-f]{25}$/),
            parameters: { text: 'hi' },
            model_used: null,
            service_used: 'openai',
        });
        expect(second.completionId).not.toBe(first.completionId);
    });
});
