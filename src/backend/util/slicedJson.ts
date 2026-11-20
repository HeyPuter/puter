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

import { setImmediate as nextTurn } from 'node:timers/promises';

/**
 * Text handed to one native `JSON.parse` call stays within a few multiples of
 * this, which bounds how long the call can run. Shorter input parses whole.
 */
export const SLICE_BYTES = 32 * 1024;
/** Bytes of a long string decoded per turn. */
export const STRING_PIECE_BYTES = 512 * 1024;
/** Deeper nesting is refused. No mainstream serializer writes this deep. */
export const MAX_DEPTH = 10_000;
/** How long a parse runs before the event loop gets a turn. */
const TURN_BUDGET_MS = 3;
/** Bytes scanned between clock reads. */
const CLOCK_INTERVAL_BYTES = 16 * 1024;
/** Bytes of a string scanned one at a time before a native search takes over. */
const BYTEWISE_BYTES = 64;
/** Rounds of a string scan between clock reads. */
const CLOCK_INTERVAL_ROUNDS = 64;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;

// Byte classes. Anything unlisted is part of a number or literal.
const C_SCALAR = 0;
const C_SPACE = 1;
const C_QUOTE = 2;
const C_OPEN_ARRAY = 3;
const C_OPEN_OBJECT = 4;
const C_CLOSE_ARRAY = 5;
const C_CLOSE_OBJECT = 6;
const C_COMMA = 7;
const C_COLON = 8;
const BYTE_CLASS = new Uint8Array(256);
for (const byte of [0x20, 0x09, 0x0a, 0x0d]) BYTE_CLASS[byte] = C_SPACE;
BYTE_CLASS[QUOTE] = C_QUOTE;
BYTE_CLASS[0x5b] = C_OPEN_ARRAY;
BYTE_CLASS[0x7b] = C_OPEN_OBJECT;
BYTE_CLASS[0x5d] = C_CLOSE_ARRAY;
BYTE_CLASS[0x7d] = C_CLOSE_OBJECT;
BYTE_CLASS[0x2c] = C_COMMA;
BYTE_CLASS[0x3a] = C_COLON;

const ROOT = 0;
const ARRAY = 1;
const OBJECT = 2;

/** Just opened: a member or the close. */
const S_FIRST = 0;
/** After a comma: a member. */
const S_MEMBER = 1;
/** After an object key. */
const S_COLON = 2;
/** After a colon, and the root before its value. */
const S_VALUE = 3;
/** After a value: a comma or the close. The root is done. */
const S_AFTER = 4;

const DONE = 0;
const TURN = 1;
const LONG_STRING = 2;

/**
 * One open container, or the root. Members are scanned, not parsed: `pending`
 * marks text handed to `JSON.parse` once enough of it has built up, and a
 * container too large for one call gets its `out` filled a batch at a time.
 */
class Frame {
    kind = ROOT;
    state = S_VALUE;
    /** Offset of the opening bracket. */
    start = 0;
    /** The container under construction, once it is known to be large. */
    out: unknown[] | Record<string, unknown> | null = null;
    /** Where the members not yet parsed start, or -1. */
    pending = -1;
    /** Where the last complete member ended. */
    lastEnd = -1;
    /** Bounds of the member being scanned. */
    memberStart = -1;
    keyStart = -1;
    keyEnd = -1;
    valueStart = -1;
    /** The current member's key, when the member is parsed apart from `pending`. */
    ownKey: string | null = null;
    /** Bytes of the parent's `pending` waiting behind this container. */
    backlog = 0;

    open(kind: number, start: number): void {
        this.kind = kind;
        this.state = kind === ROOT ? S_VALUE : S_FIRST;
        this.start = start;
        this.out = null;
        this.pending = -1;
        this.lastEnd = -1;
        this.memberStart = -1;
        this.keyStart = -1;
        this.keyEnd = -1;
        this.valueStart = -1;
        this.ownKey = null;
        this.backlog = 0;
    }
}

const unexpected = (at: number): SyntaxError =>
    new SyntaxError(`Unexpected token in JSON at position ${at}`);

/** `JSON.parse` keeps `__proto__` as an own property; assignment would not. */
const setOwn = (
    target: Record<string, unknown>,
    key: string,
    value: unknown,
): void => {
    if (key === '__proto__') {
        Object.defineProperty(target, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
        });
    } else {
        target[key] = value;
    }
};

class SlicedJsonParser {
    result: unknown;
    /** Bounds of the string `run` stopped at, quotes included. */
    longStart = -1;
    longEnd = -1;

    readonly #body: Buffer;
    readonly #end: number;
    #pos = 0;
    #frames = [new Frame()];
    #depth = 0;
    /** Frames below this depth have an `out`; the root counts as one. */
    #filling = 1;
    /** Bytes of `pending` in frames below the top one. */
    #backlog = 0;
    #inScalar = false;
    /** The string being scanned, and where its scan resumes. */
    #stringStart = -1;
    #stringPos = 0;
    /** Next quote and backslash at or after the last search origin. */
    #quoteAt = -1;
    #backslashAt = -1;
    #longIsKey = false;

    constructor(body: Buffer) {
        this.#body = body;
        this.#end = body.length;
    }

    /** Scans until the input ends, `deadline` passes, or a long string starts. */
    run(deadline: number): number {
        const body = this.#body;
        const end = this.#end;
        let i = this.#pos;
        let frame = this.#frames[this.#depth]!;
        let clockAt = i + CLOCK_INTERVAL_BYTES;

        for (;;) {
            if (this.#stringStart !== -1) {
                const close = this.#stringEnd(deadline);
                if (close === -1) return TURN;
                const start = this.#stringStart;
                this.#stringStart = -1;
                i = close + 1;
                if (this.#string(frame, start, close)) {
                    this.#pos = i;
                    return LONG_STRING;
                }
                continue;
            }
            if (i >= clockAt) {
                clockAt = i + CLOCK_INTERVAL_BYTES;
                if (performance.now() >= deadline) {
                    this.#pos = i;
                    return TURN;
                }
            }
            if (i >= end) break;

            const byteClass = BYTE_CLASS[body[i]!]!;
            if (byteClass === C_SCALAR) {
                if (!this.#inScalar) {
                    this.#valueStart(frame, i);
                    this.#inScalar = true;
                }
                const stop = Math.min(end, clockAt);
                i++;
                while (i < stop && BYTE_CLASS[body[i]!] === C_SCALAR) i++;
                continue;
            }
            if (this.#inScalar) {
                this.#inScalar = false;
                this.#valueEnd(frame, i);
            }

            switch (byteClass) {
                case C_SPACE: {
                    const stop = Math.min(end, clockAt);
                    i++;
                    while (i < stop && BYTE_CLASS[body[i]!] === C_SPACE) i++;
                    break;
                }
                case C_QUOTE:
                    this.#stringStart = i;
                    this.#stringPos = i + 1;
                    break;
                case C_OPEN_ARRAY:
                case C_OPEN_OBJECT: {
                    this.#valueStart(frame, i);
                    if (this.#depth === MAX_DEPTH) {
                        throw new SyntaxError('JSON is nested too deeply');
                    }
                    const parent = frame;
                    // Members before this one wait until it closes or grows.
                    const before =
                        parent.pending !== -1 &&
                        parent.pending !== parent.memberStart
                            ? parent.lastEnd - parent.pending
                            : 0;
                    this.#depth++;
                    frame = this.#frames[this.#depth] ??= new Frame();
                    frame.open(byteClass === C_OPEN_ARRAY ? ARRAY : OBJECT, i);
                    frame.backlog = before;
                    this.#backlog += before;
                    // Parsed now, so deep nesting can't save it all up.
                    if (this.#backlog >= SLICE_BYTES) this.#fill();
                    i++;
                    break;
                }
                case C_CLOSE_ARRAY:
                case C_CLOSE_OBJECT: {
                    if (
                        frame.kind !==
                            (byteClass === C_CLOSE_ARRAY ? ARRAY : OBJECT) ||
                        (frame.state !== S_FIRST && frame.state !== S_AFTER)
                    ) {
                        throw unexpected(i);
                    }
                    let filled = this.#depth < this.#filling;
                    if (!filled && i + 1 - frame.start > SLICE_BYTES) {
                        this.#fill();
                        filled = true;
                    }
                    if (filled) {
                        if (frame.pending !== -1) {
                            this.#parsePending(frame);
                        }
                        frame.out = null;
                        this.#filling = this.#depth;
                    }
                    this.#backlog -= frame.backlog;
                    this.#depth--;
                    frame = this.#frames[this.#depth]!;
                    i++;
                    if (filled) {
                        frame.state = S_AFTER;
                        frame.lastEnd = i;
                    } else {
                        this.#valueEnd(frame, i);
                    }
                    break;
                }
                case C_COMMA:
                    if (frame.kind === ROOT || frame.state !== S_AFTER) {
                        throw unexpected(i);
                    }
                    frame.state = S_MEMBER;
                    i++;
                    break;
                default:
                    if (frame.kind !== OBJECT || frame.state !== S_COLON) {
                        throw unexpected(i);
                    }
                    frame.state = S_VALUE;
                    i++;
            }
        }

        if (this.#inScalar) {
            this.#inScalar = false;
            this.#valueEnd(frame, end);
        }
        if (this.#depth !== 0 || frame.state !== S_AFTER) {
            throw new SyntaxError('Unexpected end of JSON input');
        }
        if (frame.pending !== -1) this.#parsePending(frame);
        return DONE;
    }

    /** Supplies the string `run` stopped at. */
    resolveLongString(value: string): void {
        const frame = this.#frames[this.#depth]!;
        if (this.#longIsKey) {
            frame.ownKey = value;
            return;
        }
        this.#attach(frame, frame.ownKey, value);
        frame.ownKey = null;
        frame.lastEnd = this.longEnd + 1;
        frame.state = S_AFTER;
    }

    /**
     * Offset of the quote closing the string being scanned, or -1 when
     * `deadline` passed first.
     */
    #stringEnd(deadline: number): number {
        const body = this.#body;
        const end = this.#end;
        let at = this.#stringPos;

        for (let round = 1; ; round++) {
            // Bytewise through a short string or a stretch of escapes.
            const near = Math.min(at + BYTEWISE_BYTES, end);
            while (at < near) {
                const byte = body[at]!;
                if (byte === QUOTE) return at;
                at += byte === BACKSLASH ? 2 : 1;
            }
            if (at >= end) throw new SyntaxError('Unterminated string in JSON');

            // Then a native search across text that holds neither.
            if (this.#quoteAt < at) {
                this.#quoteAt = body.indexOf(QUOTE, at);
                if (this.#quoteAt === -1) {
                    throw new SyntaxError('Unterminated string in JSON');
                }
            }
            if (this.#backslashAt < at) {
                const found = body.indexOf(BACKSLASH, at);
                this.#backslashAt = found === -1 ? end : found;
            }
            if (this.#backslashAt > this.#quoteAt) return this.#quoteAt;
            at = this.#backslashAt;

            if (round % CLOCK_INTERVAL_ROUNDS === 0) {
                if (performance.now() >= deadline) {
                    this.#stringPos = at;
                    return -1;
                }
            }
        }
    }

    /** Handles a scanned string; true when `run` must stop for a long one. */
    #string(frame: Frame, start: number, close: number): boolean {
        const long = close - start > SLICE_BYTES;
        if (
            frame.kind === OBJECT &&
            (frame.state === S_FIRST || frame.state === S_MEMBER)
        ) {
            this.#memberStart(frame, start);
            frame.keyStart = start;
            frame.keyEnd = close;
            frame.state = S_COLON;
            if (!long) return false;
            this.#detachMember(frame);
            this.#longIsKey = true;
        } else {
            this.#valueStart(frame, start);
            if (!long) {
                this.#valueEnd(frame, close + 1);
                return false;
            }
            if (frame.ownKey === null) {
                this.#detachMember(frame);
                if (frame.kind === OBJECT) frame.ownKey = this.#key(frame);
            }
            this.#longIsKey = false;
        }
        this.longStart = start;
        this.longEnd = close;
        return true;
    }

    #memberStart(frame: Frame, at: number): void {
        if (frame.pending !== -1 && at - frame.pending >= SLICE_BYTES) {
            this.#fill();
            this.#parsePending(frame);
        }
        frame.memberStart = at;
        if (frame.pending === -1) frame.pending = at;
    }

    #valueStart(frame: Frame, at: number): void {
        if (frame.kind === OBJECT) {
            if (frame.state !== S_VALUE) throw unexpected(at);
            // A long gap after the key would reach `JSON.parse` with it.
            if (frame.ownKey === null && at - frame.memberStart > SLICE_BYTES) {
                this.#detachMember(frame);
                frame.ownKey = this.#key(frame);
            }
        } else {
            if (
                frame.kind === ROOT
                    ? frame.state !== S_VALUE
                    : frame.state > S_MEMBER
            ) {
                throw unexpected(at);
            }
            this.#memberStart(frame, at);
        }
        frame.valueStart = at;
    }

    #valueEnd(frame: Frame, at: number): void {
        frame.lastEnd = at;
        frame.state = S_AFTER;
        if (frame.ownKey !== null) {
            this.#attach(
                frame,
                frame.ownKey,
                JSON.parse(this.#text(frame.valueStart, at)),
            );
            frame.ownKey = null;
        }
    }

    /** Takes the current member out of `pending`; its value is attached alone. */
    #detachMember(frame: Frame): void {
        this.#fill();
        if (frame.pending !== -1 && frame.pending !== frame.memberStart) {
            this.#parsePending(frame);
        }
        frame.pending = -1;
    }

    /**
     * Gives every open container an `out`, attached to its parent after the
     * members that precede it.
     */
    #fill(): void {
        const frames = this.#frames;
        for (let level = this.#filling; level <= this.#depth; level++) {
            const parent = frames[level - 1]!;
            const child = frames[level]!;
            if (
                parent.pending !== -1 &&
                parent.pending !== parent.memberStart
            ) {
                this.#parsePending(parent);
            }
            parent.pending = -1;
            const key =
                parent.kind === OBJECT
                    ? (parent.ownKey ?? this.#key(parent))
                    : null;
            parent.ownKey = null;
            child.out = child.kind === ARRAY ? [] : {};
            child.backlog = 0;
            this.#attach(parent, key, child.out);
        }
        this.#filling = this.#depth + 1;
        this.#backlog = 0;
    }

    /** Parses the complete members in `pending` into the frame's container. */
    #parsePending(frame: Frame): void {
        const text = this.#text(frame.pending, frame.lastEnd);
        frame.pending = -1;
        if (frame.kind === ROOT) {
            this.result = JSON.parse(text);
        } else if (frame.kind === ARRAY) {
            const out = frame.out as unknown[];
            const items = JSON.parse(`[${text}]`) as unknown[];
            for (let k = 0; k < items.length; k++) out.push(items[k]);
        } else {
            const out = frame.out as Record<string, unknown>;
            const members = JSON.parse(`{${text}}`) as Record<string, unknown>;
            for (const key of Object.keys(members)) {
                setOwn(out, key, members[key]);
            }
        }
    }

    #attach(frame: Frame, key: string | null, value: unknown): void {
        if (frame.kind === ROOT) this.result = value;
        else if (frame.kind === ARRAY) (frame.out as unknown[]).push(value);
        else setOwn(frame.out as Record<string, unknown>, key!, value);
    }

    #key(frame: Frame): string {
        return JSON.parse(
            this.#text(frame.keyStart, frame.keyEnd + 1),
        ) as string;
    }

    #text(from: number, to: number): string {
        return this.#body.toString('utf8', from, to);
    }
}

/**
 * Where a string's content can be cut at or before `target` without splitting
 * an escape or a UTF-8 sequence. `from` starts a character or an escape.
 */
const pieceEnd = (body: Buffer, from: number, target: number): number => {
    // Far enough back that a `\uXXXX` reaching `target` starts after it.
    let at = Math.max(from, target - 8);
    // An odd run of backslashes before `at` means `at` is an escaped byte.
    let run = 0;
    while (at - run > from && body[at - run - 1] === BACKSLASH) run++;
    at -= run % 2;
    for (;;) {
        const length =
            body[at] !== BACKSLASH ? 1 : body[at + 1] === 0x75 ? 6 : 2;
        if (at + length > target) break;
        at += length;
    }
    // A sequence has at most three continuation bytes; more are stray.
    for (let back = 0; back < 3 && (body[at]! & 0xc0) === 0x80; back++) at--;
    return at;
};

/** The string literal at `[start, close]`, decoded a piece per turn. */
const readLongString = async (
    body: Buffer,
    start: number,
    close: number,
): Promise<string> => {
    const pieces: string[] = [];
    let at = start + 1;
    while (at < close) {
        const end =
            close - at <= STRING_PIECE_BYTES
                ? close
                : pieceEnd(body, at, at + STRING_PIECE_BYTES);
        pieces.push(
            JSON.parse(`"${body.toString('utf8', at, end)}"`) as string,
        );
        at = end;
        await nextTurn();
    }
    return pieces.join('');
};

/**
 * `JSON.parse` of UTF-8 `body`, done in slices with the event loop running
 * between them, so no input holds it for long. Throws a `SyntaxError` for
 * malformed JSON, and for nesting deeper than `MAX_DEPTH`.
 */
export async function parseJsonInSlices(body: Buffer): Promise<unknown> {
    if (body.length <= SLICE_BYTES) return JSON.parse(body.toString('utf8'));

    const parser = new SlicedJsonParser(body);
    for (;;) {
        const signal = parser.run(performance.now() + TURN_BUDGET_MS);
        if (signal === DONE) return parser.result;
        if (signal === LONG_STRING) {
            parser.resolveLongString(
                await readLongString(body, parser.longStart, parser.longEnd),
            );
        } else {
            await nextTurn();
        }
    }
}
