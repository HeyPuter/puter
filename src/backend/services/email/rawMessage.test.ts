import { Readable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import {
    findSeparator,
    headBlockOf,
    headerFields,
    lineEndingOf,
    readHeadBlock,
    replaceHead,
    stripHeaderFields,
} from './rawMessage.js';

const bytes = (text: string) => Buffer.from(text, 'latin1');

const readAll = async (stream: Readable) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('latin1');
};

/** A byte stream delivered in the given pieces. */
const streamOf = (...pieces: string[]) =>
    Readable.from(pieces.map(bytes), { objectMode: false });

describe('the header block', () => {
    test('ends at the first blank line, CRLF or bare LF', () => {
        expect(findSeparator(bytes('A: 1\r\n\r\nbody'))).toBe(8);
        expect(findSeparator(bytes('A: 1\n\nbody'))).toBe(6);
        expect(findSeparator(bytes('A: 1\r\nB: 2'))).toBe(-1);
        expect(headBlockOf(bytes('A: 1\r\n\r\nbody')).toString()).toBe(
            'A: 1\r\n\r\n',
        );
        expect(headBlockOf(bytes('A: 1')).toString()).toBe('A: 1');
    });

    test('ends where readers end it: a bare-LF line before a CRLF blank line, or an empty first line', () => {
        expect(findSeparator(bytes('A: 1\n\r\nFrom: x\r\n\r\nbody'))).toBe(7);
        expect(findSeparator(bytes('\r\nFrom: x\r\n\r\nbody'))).toBe(2);
        expect(findSeparator(bytes('\nFrom: x\n\nbody'))).toBe(1);
    });

    test('takes its line ending from the message', () => {
        expect(lineEndingOf(bytes('A: 1\r\n\r\n'))).toBe('\r\n');
        expect(lineEndingOf(bytes('A: 1\n\n'))).toBe('\n');
    });

    test('is read off a stream, separator split across chunks, and put back', async () => {
        const stream = streamOf('A: 1\r', '\n\r', '\nbody');
        const block = await readHeadBlock(stream, 1024);
        expect(block?.head.toString()).toBe('A: 1\r\n\r\n');
        expect(block?.spent).toBe(false);
        expect(await readAll(stream)).toBe('A: 1\r\n\r\nbody');
    });

    test('is null once the cap passes without a separator', async () => {
        expect(
            await readHeadBlock(streamOf('A: 1\r\n', 'B: '.repeat(100)), 64),
        ).toBeNull();
    });

    test('is null when it ends past the cap, even within one chunk', async () => {
        expect(
            await readHeadBlock(
                streamOf(`A: ${'x'.repeat(100)}\r\n\r\nbody`),
                64,
            ),
        ).toBeNull();
    });

    test('is all of a message that never reaches a body, and the stream is spent', async () => {
        const stream = streamOf('A: 1\r\n', 'B: 2\r\n');
        const block = await readHeadBlock(stream, 1024);
        expect(block?.head.toString()).toBe('A: 1\r\nB: 2\r\n');
        expect(block?.spent).toBe(true);
    });

    test('leaves the stream paused, so a refused body can still be drained', async () => {
        const stream = streamOf('A: 1\r\n\r\n', 'body');
        await readHeadBlock(stream, 1024);
        stream.resume();
        expect(stream.readableFlowing).toBe(true);
    });
});

describe('replaceHead', () => {
    test('swaps the first bytes of a stream, wherever the chunks fall', async () => {
        const stream = streamOf('Old: 1\r', '\n\r\nbo', 'dy');
        expect(
            await readAll(replaceHead(stream, 10, bytes('New: 2\r\n\r\n'))),
        ).toBe('New: 2\r\n\r\nbody');
    });
});

describe('stripHeaderFields', () => {
    const strip = (head: string) =>
        stripHeaderFields(bytes(head), ['X-Secret']).toString('latin1');

    test('removes the field in any case, with whitespace before the colon', () => {
        expect(
            strip(
                'A: 1\r\nx-secret: a\r\nX-SECRET \t: b\r\nB: 2\r\nX-Secret:c\r\n\r\n',
            ),
        ).toBe('A: 1\r\nB: 2\r\n\r\n');
    });

    test('takes folded continuation lines with it', () => {
        expect(strip('X-Secret: a\r\n  folded\r\n\tmore\r\nB: 2\r\n\r\n')).toBe(
            'B: 2\r\n\r\n',
        );
    });

    test('leaves a continuation of another field alone', () => {
        const head = 'Subject: hi\r\n X-Secret: inside a value\r\n\r\n';
        expect(strip(head)).toBe(head);
    });

    test('keeps every other byte, mixed line endings included', () => {
        expect(strip('A: 1\nX-Secret: a\r\nB: 2\r\n\n')).toBe(
            'A: 1\nB: 2\r\n\n',
        );
    });

    test('hands back the same buffer when nothing matches', () => {
        const head = bytes('A: 1\r\nX-Secretive: no\r\n\r\n');
        expect(stripHeaderFields(head, ['X-Secret'])).toBe(head);
    });

    // Each of these is the field to a reader that unfolds before naming it,
    // trims the name, or reads the first line as a field of its own.
    test.each([
        ['a name folded onto a whitespace line', 'X-Secret\r\n : a\r\n'],
        ['a name folded onto its colon', 'X-Secret\r\n: a\r\n'],
        ['a name folded twice', 'X-Secret\r\n \r\n\t: a\r\n'],
        ['a name with no colon at all', 'X-Secret\r\n'],
        ['tab before the colon, in capitals', 'X-SECRET\t: a\r\n'],
    ])('removes %s', (_name, field) => {
        expect(strip(`A: 1\r\n${field}B: 2\r\n\r\n`)).toBe(
            'A: 1\r\nB: 2\r\n\r\n',
        );
    });

    test('removes a first line that starts with whitespace', () => {
        expect(strip(' X-Secret: a\r\nB: 2\r\n\r\n')).toBe('B: 2\r\n\r\n');
    });
});

describe('headerFields', () => {
    const fields = (head: string) =>
        headerFields(bytes(head)).map(({ name, value }) => [name, value]);

    test('names each field the way the most lenient reader does', () => {
        expect(
            fields(
                [
                    'From: a@example.com',
                    'FROM : b@example.com',
                    'From',
                    ' : c@example.com',
                    'From',
                    ': d@example.com',
                    'Subject: one',
                    '  two',
                    '',
                    'From: body@example.com',
                ].join('\r\n'),
            ),
        ).toEqual([
            ['from', 'a@example.com'],
            ['from', 'b@example.com'],
            ['from', 'c@example.com'],
            ['from', 'd@example.com'],
            ['subject', 'one  two'],
        ]);
    });

    test('reads a whitespace-led first line as a field, and a later one as a fold', () => {
        expect(fields(' From: a@example.com\n To: b@example.com\n\n')).toEqual([
            ['from', 'a@example.com To: b@example.com'],
        ]);
    });

    test('decodes a raw UTF-8 value the way readers do, and other bytes one per character', () => {
        const head = Buffer.concat([
            Buffer.from(
                'From: a@\uff50\uff55\uff54\uff45\uff52.test\r\n',
                'utf8',
            ),
            Buffer.from('Subject: caf\xe9\r\n\r\n', 'latin1'),
        ]);
        expect(headerFields(head).map((f) => f.value)).toEqual([
            'a@\uff50\uff55\uff54\uff45\uff52.test',
            'caf\xe9',
        ]);
    });

    test('spans every byte of a field, its folds and line endings', () => {
        const head = bytes('A: 1\r\nB: 2\r\n  more\nC: 3\r\n\r\n');
        expect(
            headerFields(head).map(({ start, end }) =>
                head.subarray(start, end).toString('latin1'),
            ),
        ).toEqual(['A: 1\r\n', 'B: 2\r\n  more\n', 'C: 3\r\n']);
    });

    test('stays linear on a line of nothing but carriage returns', () => {
        const head = bytes(`A: ${'\r'.repeat(200_000)}x\r\n\r\n`);
        const started = performance.now();
        expect(headerFields(head)).toHaveLength(1);
        expect(performance.now() - started).toBeLessThan(500);
    });
});
