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

import { StringDecoder } from 'node:string_decoder';

interface NdjsonPipeOptions {
    onEnd?: () => void;
    onError: (error: Error) => void;
}

/** A usage or error event terminates the chat driver's NDJSON contract. */
export const pipeNdjsonStream = (
    stream: NodeJS.ReadableStream,
    onEvent: (event: Record<string, unknown>) => void,
    opts: NdjsonPipeOptions,
): void => {
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let settled = false;
    let terminal = false;
    const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        opts.onError(error);
    };
    const consumeLine = (line: string) => {
        if (settled || terminal || !line.trim()) return;
        let event: Record<string, unknown>;
        try {
            event = JSON.parse(line);
            if (!event || typeof event !== 'object' || Array.isArray(event)) {
                throw new Error();
            }
        } catch {
            fail(new Error('Invalid chat stream event'));
            return;
        }
        onEvent(event);
        if (event.type === 'error') settled = true;
        if (event.type === 'usage') terminal = true;
    };
    stream.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            consumeLine(buffer.slice(0, newlineIndex));
            buffer = buffer.slice(newlineIndex + 1);
        }
    });
    stream.on('end', () => {
        if (settled) return;
        consumeLine(buffer + decoder.end());
        buffer = '';
        if (settled) return;
        if (!terminal) {
            fail(new Error('Stream ended before completion'));
            return;
        }
        settled = true;
        opts.onEnd?.();
    });
    stream.on('error', fail);
    stream.on('close', () =>
        fail(new Error('Stream closed before completion')),
    );
};
