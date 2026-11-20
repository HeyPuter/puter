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

import { Readable } from 'node:stream';

/**
 * Header-block helpers for raw RFC 5322 messages. They match on the bytes (read
 * as latin1) rather than on a parsed message, so nothing rests on a parser and
 * the eventual reader agreeing about what counts as a header.
 */

/**
 * Ceiling on a header block read off a stream; one that never ends is an
 * unbounded accumulate.
 */
export const MAX_HEADER_BYTES = 256 * 1024;

/**
 * Index just past the header/body separator, or -1. The first empty line ends
 * the block, whatever line ending it and the line before it use, and an empty
 * first line leaves the block empty: where readers and DKIM verifiers end it.
 */
export const findSeparator = (buf: Buffer, from = 0): number => {
    if (from === 0 && buf[0] === 0x0a) return 1;
    if (from === 0 && buf[0] === 0x0d && buf[1] === 0x0a) return 2;
    const lf = buf.indexOf('\n\n', from);
    const crlf = buf.indexOf('\n\r\n', from);
    if (crlf !== -1 && (lf === -1 || crlf < lf)) return crlf + 3;
    if (lf !== -1) return lf + 2;
    return -1;
};

/**
 * The header block of a whole message through its blank line; all of it when
 * there is no body.
 */
export const headBlockOf = (message: Buffer): Buffer => {
    const end = findSeparator(message);
    return end === -1 ? message : message.subarray(0, end);
};

/** CRLF unless the block has none, so an added line matches the message's own. */
export const lineEndingOf = (head: Buffer): '\r\n' | '\n' =>
    head.includes('\r\n') ? '\r\n' : '\n';

export interface HeadBlock {
    head: Buffer;
    /**
     * The stream ended inside the header block: `head` is the whole message and
     * the stream is spent, since nothing can be put back after its end.
     */
    spent: boolean;
}

/**
 * Read `stream` as far as the header/body separator and return that block,
 * having put every byte read back onto the stream (left paused) so it can still
 * be consumed in full afterwards. Null when the block runs past `cap`.
 *
 * Read with `data` events and `pause()` rather than an async iterator: an
 * iterator leaves the stream where a `resume()` in the same tick does nothing,
 * so a caller draining a refused body would leave it unread.
 */
export function readHeadBlock(
    stream: Readable,
    cap: number,
): Promise<HeadBlock | null> {
    return new Promise((resolve, reject) => {
        let accumulated = Buffer.alloc(0);
        let searchedTo = 0;

        const settle = (result: HeadBlock | null) => {
            stream.off('data', onData);
            stream.off('end', onEnd);
            stream.off('error', onError);
            resolve(result);
        };
        const onData = (chunk: Buffer) => {
            accumulated = Buffer.concat([accumulated, chunk]);
            // Rewind three bytes so a separator split across chunks is found.
            const end = findSeparator(accumulated, Math.max(0, searchedTo - 3));
            searchedTo = accumulated.length;
            if (end === -1 && accumulated.length <= cap) return;
            stream.pause();
            if (end === -1 || end > cap) {
                settle(null);
                return;
            }
            stream.unshift(accumulated);
            settle({ head: accumulated.subarray(0, end), spent: false });
        };
        // Headers only, no body; nothing can be put back after the end.
        const onEnd = () => settle({ head: accumulated, spent: true });
        const onError = (err: Error) => {
            stream.off('data', onData);
            stream.off('end', onEnd);
            reject(err);
        };

        stream.on('data', onData);
        stream.once('end', onEnd);
        stream.once('error', onError);
        stream.resume();
    });
}

/** `stream` with its first `skip` bytes replaced by `head`. */
export const replaceHead = (
    stream: Readable,
    skip: number,
    head: Buffer,
): Readable =>
    Readable.from(
        (async function* () {
            yield head;
            let left = skip;
            for await (const chunk of stream) {
                const bytes = chunk as Buffer;
                if (left >= bytes.length) {
                    left -= bytes.length;
                    continue;
                }
                yield left > 0 ? bytes.subarray(left) : bytes;
                left = 0;
            }
        })(),
        { objectMode: false },
    );

export interface HeaderField {
    /**
     * The name as the most lenient reader takes it: folds removed, spaces and
     * tabs around it trimmed, ASCII lowercase. A field without a colon is named
     * by all of its text.
     */
    name: string;
    /** Everything after the first colon, unfolded and trimmed. */
    value: string;
    /** Byte span in the block, its folded lines and line endings included. */
    start: number;
    end: number;
}

const isWsp = (char: string | undefined) => char === ' ' || char === '\t';

const trimWsp = (text: string): string => {
    let start = 0;
    let end = text.length;
    while (start < end && isWsp(text[start])) start++;
    while (end > start && isWsp(text[end - 1])) end--;
    return text.slice(start, end);
};

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Raw header bytes (here as latin1 text) as readers decode them: UTF-8, else
 * one byte per character.
 */
const decodeValue = (latin1: string): string => {
    if (!/[\x80-\xff]/.test(latin1)) return latin1;
    try {
        return utf8.decode(Buffer.from(latin1, 'latin1'));
    } catch {
        return latin1;
    }
};

const asciiLower = (text: string) =>
    text.replace(/[A-Z]+/g, (s) => s.toLowerCase());

/**
 * The fields of a raw header block, read the widest way any reader does: the
 * first line always opens a field, a line starting with a space or tab
 * continues one, and so does a line starting with the colon of a name folded
 * onto the line above. Linear in the block.
 */
export function headerFields(head: Buffer): HeaderField[] {
    const text = head.toString('latin1');
    const raw: Array<{
        start: number;
        end: number;
        text: string;
        colon: boolean;
    }> = [];
    for (let pos = 0; pos < text.length; ) {
        const lf = text.indexOf('\n', pos);
        const end = lf === -1 ? text.length : lf + 1;
        let stop = lf === -1 ? end : lf;
        while (stop > pos && text[stop - 1] === '\r') stop--;
        if (stop === pos) break;
        const line = text.slice(pos, stop);
        const last = raw.at(-1);
        if (last && (isWsp(line[0]) || (line[0] === ':' && !last.colon))) {
            last.text += line;
            last.end = end;
            last.colon ||= line.includes(':');
        } else {
            raw.push({
                start: pos,
                end,
                text: line,
                colon: line.includes(':'),
            });
        }
        pos = end;
    }
    return raw.map(({ start, end, text: field }) => {
        const colon = field.indexOf(':');
        return {
            name: asciiLower(
                trimWsp(colon === -1 ? field : field.slice(0, colon)),
            ),
            value:
                colon === -1
                    ? ''
                    : trimWsp(decodeValue(field.slice(colon + 1))),
            start,
            end,
        };
    });
}

/**
 * `head` without the given fields (from {@link headerFields} of it); `head`
 * itself when there are none.
 */
export function removeHeaderFields(
    head: Buffer,
    fields: readonly HeaderField[],
): Buffer {
    if (fields.length === 0) return head;
    const kept: Buffer[] = [];
    let at = 0;
    for (const field of [...fields].sort((a, b) => a.start - b.start)) {
        kept.push(head.subarray(at, field.start));
        at = field.end;
    }
    kept.push(head.subarray(at));
    return Buffer.concat(kept);
}

/**
 * Remove every field named in `names` (by {@link headerFields}' reading) from a
 * raw header block, leaving every other byte alone. Returns `head` itself when
 * nothing matched.
 */
export function stripHeaderFields(
    head: Buffer,
    names: readonly string[],
): Buffer {
    const wanted = new Set(names.map(asciiLower));
    return removeHeaderFields(
        head,
        headerFields(head).filter((f) => wanted.has(f.name)),
    );
}
