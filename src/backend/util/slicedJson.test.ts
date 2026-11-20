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

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_DEPTH,
    parseJsonInSlices,
    SLICE_BYTES,
    STRING_PIECE_BYTES,
} from './slicedJson.js';

type Outcome = { value: unknown } | { error: string };

const native = (body: Buffer): Outcome => {
    try {
        return { value: JSON.parse(body.toString('utf8')) };
    } catch (e) {
        return { error: (e as Error).name };
    }
};

const sliced = async (body: Buffer): Promise<Outcome> => {
    try {
        return { value: await parseJsonInSlices(body) };
    } catch (e) {
        return { error: (e as Error).name };
    }
};

/** Key order, own `__proto__` keys and lone surrogates all show in the text. */
const shown = (outcome: Outcome): string =>
    'error' in outcome ? outcome.error : JSON.stringify(outcome.value);

const expectSameAsNative = async (body: Buffer | string): Promise<void> => {
    const buffer = typeof body === 'string' ? Buffer.from(body) : body;
    expect(shown(await sliced(buffer))).toBe(shown(native(buffer)));
};

/** Whitespace that pushes `text` onto the sliced path without changing it. */
const padded = (text: string): string => `${' '.repeat(SLICE_BYTES)}${text}`;

// mulberry32: the cases must be the same on every run.
const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const STRING_PARTS = [
    'a',
    'word ',
    '"',
    '\\',
    '\\\\"',
    '\n',
    '\u0001',
    'é',
    '日本',
    '😀',
    '\ud83d',
    '\u2028',
    '/',
    '\\u00e9',
];
const KEYS = ['id', 'name', '__proto__', '7', '3', 'constructor', 'a b', ''];
// No key holds a backslash: with one in a key seen earlier, some V8 versions
// misread a later escaped key, in `JSON.parse` itself.
const KEY_PARTS = STRING_PARTS.filter((part) => !part.includes('\\'));
const SCALARS = [
    '0',
    '-0',
    '1.5e300',
    '-12.25',
    '1e-7',
    '9007199254740993',
    'true',
    'false',
    'null',
];
const GAPS = ['', '', '', ' ', '\n\t', '\r\n  '];

/** A random JSON document, written as text so spacing and escapes vary. */
const randomDocument = (
    random: () => number,
    targetBytes: number,
    { plainKeys = false } = {},
): string => {
    const pick = <T>(items: readonly T[]): T =>
        items[Math.floor(random() * items.length)]!;
    const gap = () => pick(GAPS);
    const string = (maxParts: number, from = STRING_PARTS): string => {
        let text = '';
        const parts = Math.floor(random() * maxParts);
        for (let i = 0; i < parts; i++) text += pick(from);
        return JSON.stringify(text);
    };
    let written = 0;
    const value = (depth: number): string => {
        const roll = random();
        let text: string;
        if (depth > 0 && roll < 0.25) {
            const count = Math.floor(random() * 12);
            const items: string[] = [];
            for (let i = 0; i < count; i++) items.push(value(depth - 1));
            text = `[${gap()}${items.join(`${gap()},${gap()}`)}${gap()}]`;
        } else if (depth > 0 && roll < 0.5) {
            const count = Math.floor(random() * 12);
            const members: string[] = [];
            for (let i = 0; i < count; i++) {
                const key =
                    plainKeys || random() < 0.7
                        ? JSON.stringify(pick(KEYS))
                        : string(6, KEY_PARTS);
                members.push(`${key}${gap()}:${gap()}${value(depth - 1)}`);
            }
            text = `{${gap()}${members.join(`${gap()},${gap()}`)}${gap()}}`;
        } else if (roll < 0.75) {
            // Now and then one long enough to be read in pieces.
            text = string(random() < 0.002 ? 3 * SLICE_BYTES : 20);
        } else {
            text = pick(SCALARS);
        }
        written += text.length;
        return text;
    };
    const items: string[] = [];
    while (written < targetBytes) items.push(value(6));
    return random() < 0.5
        ? `[${items.join(',')}]`
        : `{${items.map((item, i) => `"k${i % 50}":${item}`).join(',')}}`;
};

describe('parseJsonInSlices', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('parses what JSON.parse parses, the same way', async () => {
        const random = seeded(1);
        for (let i = 0; i < 60; i++) {
            const size = SLICE_BYTES * (1 + Math.floor(random() * 12));
            await expectSameAsNative(randomDocument(random, size));
        }
    }, 60_000);

    it('parses the same when every clock read ends the turn', async () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => (now += 1000));
        const random = seeded(3);
        for (let i = 0; i < 30; i++) {
            await expectSameAsNative(randomDocument(random, 6 * SLICE_BYTES));
        }
        // Strings long enough for a turn to end inside them.
        await expectSameAsNative(
            `["${'ab\\n'.repeat(SLICE_BYTES)}",{"k":"${'\\\\'.repeat(SLICE_BYTES)}"},${'1234567890'.repeat(SLICE_BYTES / 2)}]`,
        );
    }, 60_000);

    it('rejects what JSON.parse rejects', async () => {
        const random = seeded(2);
        const replacements = Buffer.from('[]{},:"\\ 0a\néx-.e');
        for (let i = 0; i < 40; i++) {
            // Plain keys, so no edit can leave a backslash in one.
            const valid = Buffer.from(
                randomDocument(random, 2 * SLICE_BYTES, { plainKeys: true }),
            );
            for (let edit = 0; edit < 12; edit++) {
                const body = Buffer.from(valid);
                const at = Math.floor(random() * body.length);
                const roll = random();
                if (roll < 0.4) {
                    body[at] =
                        replacements[
                            Math.floor(random() * replacements.length)
                        ]!;
                    await expectSameAsNative(body);
                } else if (roll < 0.7) {
                    await expectSameAsNative(
                        Buffer.concat([
                            body.subarray(0, at),
                            body.subarray(at + 1),
                        ]),
                    );
                } else {
                    await expectSameAsNative(body.subarray(0, at));
                }
            }
        }
    }, 120_000);

    it.each([
        ['an empty body', ''],
        ['only whitespace', ' \n '],
        ['two values', '[1] [2]'],
        ['a trailing comma in an array', '[1,2,]'],
        ['a trailing comma in an object', '{"a":1,}'],
        ['a leading comma', '[,1]'],
        ['a doubled comma', '[1,,2]'],
        ['a missing colon', '{"a" 1}'],
        ['a missing value', '{"a":}'],
        ['a bare key', '{a:1}'],
        ['a colon in an array', '[1:2]'],
        ['mismatched brackets', '[1}'],
        ['an extra close', '[1]]'],
        ['an unterminated string', '["abc'],
        ['an unterminated array', '[1,2'],
        ['a byte order mark', '\ufeff[1]'],
        ['a comment', '[1/* x */]'],
        ['a bad literal', '[tru]'],
        ['a bad number', '[01]'],
        ['a bad escape', '["\\x"]'],
        ['a raw control character in a string', '["a\tb"]'],
        ['a wide space between values', '[1,\u00a02]'],
    ])('rejects %s', async (_name, text) => {
        await expectSameAsNative(text);
        // Short input takes the native path, so check the sliced one too.
        await expectSameAsNative(padded(text));
        await expectSameAsNative(
            `[${'1,'.repeat(SLICE_BYTES)}${text},${'2,'.repeat(SLICE_BYTES)}3]`,
        );
    });

    it('reads a string longer than one piece, wherever a piece ends', async () => {
        const units = [
            '\\u00e9',
            '\\n',
            '\\\\',
            '\\"',
            'é',
            '日',
            '😀',
            '\\ud83d\\ude00',
        ];
        for (const unit of units) {
            for (let shift = 0; shift < 9; shift++) {
                const lead = 'a'.repeat(STRING_PIECE_BYTES - 12 + shift);
                const text = `{"text":"${lead}${unit.repeat(8)}${lead}","n":1}`;
                await expectSameAsNative(text);
            }
        }
    }, 60_000);

    it('reads long runs of escapes and stray UTF-8 bytes', async () => {
        const length = STRING_PIECE_BYTES + SLICE_BYTES;
        await expectSameAsNative(`["${'\\\\'.repeat(length)}"]`);
        await expectSameAsNative(`["${'\\"'.repeat(length)}"]`);
        await expectSameAsNative(`["${'\\'.repeat(2 * length + 1)}"]`);
        await expectSameAsNative(
            Buffer.concat([
                Buffer.from('["'),
                Buffer.alloc(2 * length, 0x80),
                Buffer.from([0xe2, 0x82]),
                Buffer.from('"]'),
            ]),
        );
    }, 60_000);

    it('reads a long key', async () => {
        const key = 'k'.repeat(2 * SLICE_BYTES);
        await expectSameAsNative(`{"a":1,"${key}":{"b":[2]},"${key}x":"v"}`);
        await expectSameAsNative(`{"${key}\\n":2,"z":3}`);
    });

    it('reads long gaps of whitespace', async () => {
        const gap = ' '.repeat(2 * SLICE_BYTES);
        await expectSameAsNative(
            `${gap}{${gap}"a"${gap}:${gap}1${gap},${gap}"b":[${gap}2${gap},3${gap}]${gap}}${gap}`,
        );
        await expectSameAsNative(`[1,${gap}2${gap}]`);
    });

    it('reads a scalar or a string at the top level', async () => {
        await expectSameAsNative(padded('12.5'));
        await expectSameAsNative(padded('null'));
        await expectSameAsNative(`"${'x'.repeat(4 * SLICE_BYTES)}"`);
    });

    it('keeps the last of a repeated key, in its first position', async () => {
        const filler = `"f":"${'x'.repeat(SLICE_BYTES)}"`;
        await expectSameAsNative(`{"a":1,"b":2,${filler},"a":3,"7":4,"3":5}`);
        const value = (await parseJsonInSlices(
            Buffer.from(`{"a":1,"b":2,${filler},"a":3}`),
        )) as Record<string, unknown>;
        expect(Object.keys(value)).toEqual(['a', 'b', 'f']);
        expect(value.a).toBe(3);
    });

    it('keeps __proto__ as a plain own property', async () => {
        const filler = `"f":"${'x'.repeat(SLICE_BYTES)}"`;
        const bodies = [
            // In a batch of members, as a container of its own, and alone.
            `{${filler},"__proto__":{"polluted":true},"z":1}`,
            `{"__proto__":{"polluted":true,${filler}}}`,
            `{"__proto__":"${'y'.repeat(2 * SLICE_BYTES)}"}`,
        ];
        for (const body of bodies) {
            const value = (await parseJsonInSlices(
                Buffer.from(body),
            )) as Record<string, unknown>;
            expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
            expect(Object.hasOwn(value, '__proto__')).toBe(true);
            expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
        }
    });

    it('keeps the sign of negative zero', async () => {
        const value = (await parseJsonInSlices(
            Buffer.from(`[${'0,'.repeat(SLICE_BYTES)}-0]`),
        )) as number[];
        expect(Object.is(value.at(-1), -0)).toBe(true);
    });

    it('reads nesting up to the depth limit and refuses more', async () => {
        const nested = (depth: number) =>
            padded(`${'['.repeat(depth)}${']'.repeat(depth)}`);
        // The root is not a level of nesting.
        let value = await parseJsonInSlices(Buffer.from(nested(MAX_DEPTH)));
        let depth = 0;
        while (Array.isArray(value)) {
            depth++;
            value = value[0];
        }
        expect(depth).toBe(MAX_DEPTH);

        await expect(
            parseJsonInSlices(Buffer.from(nested(MAX_DEPTH + 1))),
        ).rejects.toThrow(SyntaxError);
    });

    it('reads members spread thinly across many levels', async () => {
        // No level holds a slice of members, but together they hold many.
        const members = '1,'.repeat(SLICE_BYTES / 8);
        const depth = 200;
        await expectSameAsNative(
            `${`[${members}`.repeat(depth)}0${']'.repeat(depth)}`,
        );
        await expectSameAsNative(
            `${`{"a":[${members}0],"b":`.repeat(depth)}0${'}'.repeat(depth)}`,
        );
    });

    it('lets the event loop run while it parses', async () => {
        // Dense input: the slowest kind to parse for its size.
        const body = Buffer.from(`[${'[],'.repeat(1_000_000)}[]]`);
        let turns = 0;
        let running = true;
        const tick = () => {
            turns++;
            if (running) setImmediate(tick);
        };
        setImmediate(tick);
        const value = (await parseJsonInSlices(body)) as unknown[];
        running = false;
        expect(value).toHaveLength(1_000_001);
        expect(turns).toBeGreaterThan(5);
    });
});
