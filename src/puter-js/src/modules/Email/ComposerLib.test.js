import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PostalMime from 'postal-mime';
import {
    combineParts,
    compose,
    composeAttachment,
    determineTopLevelMimeType,
    emlHeader,
    getRFC822DateUTC,
    isASCII,
} from './ComposerLib.js';

/**
 * ComposerLib hand-rolls RFC 822 output with no MIME library, so these pin
 * both the structure of each MIME shape and that a real parser recovers the
 * bodies and attachments from what it produces.
 */

const origPuter = globalThis.puter;

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const b64 = (str) => btoa(str);
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes));

let fsRead;
let getUser;

beforeEach(() => {
    fsRead = vi.fn(async () => new Blob([PNG_BYTES], { type: 'image/png' }));
    getUser = vi.fn(async () => ({ username: 'alice' }));
    globalThis.puter = { fs: { read: fsRead }, getUser };
});

afterEach(() => {
    globalThis.puter = origPuter;
    vi.restoreAllMocks();
    vi.useRealTimers();
});

// -- EML structure helpers --

/** Split one message or part into its header block and body at the first blank line. */
const splitEml = (eml) => {
    const i = eml.indexOf('\r\n\r\n');
    expect(i, 'blank line between headers and body').toBeGreaterThan(-1);
    return { head: eml.slice(0, i), body: eml.slice(i + 4) };
};

/** Header block -> Map of lower-cased name -> every value seen for it. */
const parseHeaders = (head) => {
    const headers = new Map();
    for ( const line of head.split('\r\n') ) {
        const i = line.indexOf(': ');
        expect(i, `header line "${line}"`).toBeGreaterThan(0);
        const key = line.slice(0, i).toLowerCase();
        if ( !headers.has(key) ) headers.set(key, []);
        headers.get(key).push(line.slice(i + 2));
    }
    return headers;
};

/** The single value of a header, failing if it is missing or repeated. */
const header = (headers, name) => {
    const values = headers.get(name.toLowerCase());
    expect(values, `header ${name}`).toHaveLength(1);
    return values[0];
};

const boundaryOf = (contentType) => {
    const match = contentType.match(/^multipart\/\w+; boundary="([^"]+)"$/);
    expect(match, `multipart content-type "${contentType}"`).not.toBeNull();
    return match[1];
};

/** Body of a multipart entity -> the raw parts between its delimiters. */
const splitParts = (body, boundary) => {
    const closing = `--${boundary}--\r\n`;
    expect(body.endsWith(closing), 'closing delimiter').toBe(true);
    const chunks = body.slice(0, -closing.length).split(`--${boundary}\r\n`);
    expect(chunks[0], 'nothing before the first delimiter').toBe('');
    // The CRLF before each delimiter belongs to the delimiter.
    return chunks.slice(1).map((chunk) => {
        expect(chunk.endsWith('\r\n')).toBe(true);
        return chunk.slice(0, -2);
    });
};

/** A raw part -> its parsed headers and body. */
const parsePart = (part) => {
    const { head, body } = splitEml(part);
    return { headers: parseHeaders(head), body };
};

/** Parse a message or part and, when multipart, its children. */
const parseEntity = (raw) => {
    const entity = parsePart(raw);
    const contentType = header(entity.headers, 'Content-Type');
    if ( contentType.startsWith('multipart/') ) {
        entity.boundary = boundaryOf(contentType);
        entity.children = splitParts(entity.body, entity.boundary).map(parseEntity);
    }
    return entity;
};

const contentTypeOf = (entity) => header(entity.headers, 'Content-Type');
const mediaTypeOf = (entity) => contentTypeOf(entity).split(';')[0];

const baseOptions = { to: 'bob@example.com', subject: 'hi' };
const regular = { filename: 'a.txt', contentType: 'text/plain', content: b64('AAA') };
const inline = { path: '~/pics/x.png', cid: 'img1' };

describe('determineTopLevelMimeType', () => {
    it('picks text/plain for text alone', () => {
        expect(determineTopLevelMimeType({ text: 'hi' }))
            .toEqual({ isMultiPart: false, mimeType: 'text/plain; charset=UTF-8' });
    });

    it('picks text/html for html alone', () => {
        expect(determineTopLevelMimeType({ html: '<p>hi</p>' }))
            .toEqual({ isMultiPart: false, mimeType: 'text/html; charset=UTF-8' });
    });

    it('picks multipart/alternative for text plus html with no attachments', () => {
        expect(determineTopLevelMimeType({ text: 'hi', html: '<p>hi</p>', attachments: [] }))
            .toEqual({ isMultiPart: true, mimeType: 'multipart/alternative' });
    });

    it('picks multipart/mixed whenever a regular attachment is present', () => {
        expect(determineTopLevelMimeType({ text: 'hi', attachments: [regular] }).mimeType)
            .toBe('multipart/mixed');
        expect(determineTopLevelMimeType({ text: 'hi', html: '<p>hi</p>', attachments: [regular] }).mimeType)
            .toBe('multipart/mixed');
    });

    it('picks multipart/related when every attachment is inline', () => {
        expect(determineTopLevelMimeType({ html: '<p>hi</p>', attachments: [inline] }))
            .toEqual({ isMultiPart: true, mimeType: 'multipart/related' });
    });

    it('lets a regular attachment win over inline ones', () => {
        expect(determineTopLevelMimeType({ html: '<p>hi</p>', attachments: [inline, regular] }).mimeType)
            .toBe('multipart/mixed');
    });

    it('throws when there is no text, html, or attachment', () => {
        expect(() => determineTopLevelMimeType({})).toThrow(/text, html, or an attachment/);
        expect(() => determineTopLevelMimeType({ attachments: [] })).toThrow(/text, html, or an attachment/);
    });

    it('treats an omitted attachments list as empty', () => {
        expect(() => determineTopLevelMimeType({ text: 'hi' })).not.toThrow();
    });
});

describe('emlHeader', () => {
    it('formats a scalar value as one CRLF-terminated line', () => {
        expect(emlHeader('Subject', 'hello')).toBe('Subject: hello\r\n');
    });

    it('joins array values with a comma and space', () => {
        expect(emlHeader('To', ['a@x.com', 'b@x.com'])).toBe('To: a@x.com, b@x.com\r\n');
    });

    it('rejects a non-ASCII key', () => {
        expect(() => emlHeader('Sujét', 'x')).toThrow(/key .* is not valid ASCII/);
    });

    it('rejects a non-ASCII scalar value with a message naming it', () => {
        expect(() => emlHeader('Subject', 'héllo')).toThrow(Error);
        expect(() => emlHeader('Subject', 'héllo')).toThrow(/value héllo is not valid ASCII/);
    });

    it('rejects a non-ASCII value inside an array', () => {
        expect(() => emlHeader('To', ['a@x.com', 'ü@x.com'])).toThrow(/value ü@x.com is not valid ASCII/);
    });

    it('allows an empty value', () => {
        expect(emlHeader('Subject', '')).toBe('Subject: \r\n');
    });
});

describe('isASCII', () => {
    it('accepts printable ASCII', () => {
        expect(isASCII('Hello, World! ~')).toBe(true);
    });

    it('accepts the empty string', () => {
        expect(isASCII('')).toBe(true);
    });

    it('rejects accented and non-Latin characters', () => {
        expect(isASCII('héllo')).toBe(false);
        expect(isASCII('日本語')).toBe(false);
        expect(isASCII('hi 👋')).toBe(false);
    });

    it('rejects control characters', () => {
        expect(isASCII('a\nb')).toBe(false);
        expect(isASCII('a\tb')).toBe(false);
    });
});

describe('getRFC822DateUTC', () => {
    it('formats a fixed date with a numeric UTC offset', () => {
        const date = new Date(Date.UTC(2026, 8, 11, 21, 30, 0));
        expect(getRFC822DateUTC(date)).toBe('Fri, 11 Sep 2026 21:30:00 +0000');
    });

    it('defaults to now', () => {
        vi.useFakeTimers({ now: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) });
        expect(getRFC822DateUTC()).toBe('Fri, 02 Jan 2026 03:04:05 +0000');
    });
});

describe('composeAttachment', () => {
    it('builds a base64 attachment part from inline content', async () => {
        const part = await composeAttachment(regular);
        expect(part).toBe(
            'Content-Type: text/plain;name="a.txt"\r\n' +
            'Content-Transfer-Encoding: base64\r\n' +
            'Content-Disposition: attachment;filename="a.txt"\r\n' +
            '\r\n' +
            b64('AAA'),
        );
    });

    it('separates the Content-Type key and value with exactly one colon', async () => {
        const { headers } = parsePart(await composeAttachment(regular));
        expect(header(headers, 'Content-Type')).toBe('text/plain;name="a.txt"');
        expect(header(headers, 'Content-Type')).not.toMatch(/^:/);
    });

    it('marks a cid attachment inline and carries the cid in Content-ID', async () => {
        const { headers } = parsePart(await composeAttachment({ ...regular, cid: 'logo@puter' }));
        expect(header(headers, 'Content-ID')).toBe('<logo@puter>');
        expect(header(headers, 'Content-Disposition')).toBe('inline;filename="a.txt"');
    });

    it('reads a path from the filesystem and infers the type from the blob', async () => {
        const { headers, body } = parsePart(await composeAttachment({ path: '~/docs/report.pdf' }));
        expect(fsRead).toHaveBeenCalledWith('~/docs/report.pdf');
        expect(header(headers, 'Content-Type')).toBe('image/png;name="report.pdf"');
        expect(body).toBe(bytesToB64(PNG_BYTES));
    });

    it('lets an explicit contentType override the blob type', async () => {
        const { headers } = parsePart(await composeAttachment({
            path: '~/docs/report.pdf',
            filename: 'report.pdf',
            contentType: 'application/pdf',
        }));
        expect(header(headers, 'Content-Type')).toBe('application/pdf;name="report.pdf"');
    });

    it('derives the filename from the last path segment', async () => {
        const { headers } = parsePart(await composeAttachment({ path: '~/docs/report.pdf' }));
        expect(header(headers, 'Content-Disposition')).toBe('attachment;filename="report.pdf"');
    });

    it('escapes quotes and backslashes in the filename', async () => {
        const { headers } = parsePart(await composeAttachment({
            ...regular,
            filename: 'a"b\\c.txt',
        }));
        expect(header(headers, 'Content-Type')).toBe('text/plain;name="a\\"b\\\\c.txt"');
        expect(header(headers, 'Content-Disposition')).toBe('attachment;filename="a\\"b\\\\c.txt"');
    });

    it('rejects content without a filename', async () => {
        await expect(composeAttachment({ content: b64('AAA') }))
            .rejects.toThrow(/filename cannot be determined automatically/);
    });

    it('rejects content with a filename but no contentType', async () => {
        await expect(composeAttachment({ content: b64('AAA'), filename: 'a.txt' }))
            .rejects.toThrow(/mimetype cannot be determined automatically/);
    });

    it('rejects contentType without a filename', async () => {
        await expect(composeAttachment({ content: b64('AAA'), contentType: 'text/plain' }))
            .rejects.toThrow(/filename parameter required for contentType/);
    });

    it('rejects path together with content', async () => {
        await expect(composeAttachment({ ...regular, path: '~/a.txt' }))
            .rejects.toThrow(/mutually exclusive/);
    });

    it('rejects an attachment with no content, path, or uid', async () => {
        await expect(composeAttachment({ filename: 'a.txt', contentType: 'text/plain' }))
            .rejects.toThrow(/requires content, path, or uid/);
    });

    it('rejects a non-ASCII filename', async () => {
        await expect(composeAttachment({ ...regular, filename: 'résumé.txt' }))
            .rejects.toThrow(/filename must be ascii/);
    });

    it('rejects a uid attachment until that branch exists', async () => {
        await expect(composeAttachment({ uid: 'uid-1' })).rejects.toThrow(/not supported yet/);
    });

    // The FS-uid branch is declared in the typedef but not implemented.
    it.todo('reads a uid attachment from the filesystem');
});

describe('combineParts', () => {
    it('fences each part with the boundary and closes the body', () => {
        expect(combineParts(['partA', 'partB'], 'B'))
            .toBe('--B\r\npartA\r\n--B\r\npartB\r\n--B--\r\n');
    });

    it('supplies the CRLF before every delimiter itself', () => {
        // A part ending without a line break still starts the next delimiter on its own line.
        const body = combineParts(['no trailing newline'], 'B');
        expect(body).toBe('--B\r\nno trailing newline\r\n--B--\r\n');
    });

    it('fences a single part', () => {
        expect(splitParts(combineParts(['only'], 'B'), 'B')).toEqual(['only']);
    });

    it('produces only the closing delimiter for no parts', () => {
        expect(combineParts([], 'B')).toBe('--B--\r\n');
    });
});

describe('compose', () => {
    const composeAndParse = async (options) => {
        const eml = await compose({ ...baseOptions, ...options });
        return { eml, ...parseEntity(eml) };
    };

    it('writes MIME-Version and a Date before the other headers', async () => {
        vi.useFakeTimers({ now: new Date(Date.UTC(2026, 8, 11, 21, 30, 0)) });
        const { eml, headers } = await composeAndParse({ text: 'hi' });
        expect(eml.startsWith('MIME-Version: 1.0\r\n')).toBe(true);
        expect(header(headers, 'Date')).toBe('Fri, 11 Sep 2026 21:30:00 +0000');
        expect(header(headers, 'Subject')).toBe('hi');
        expect(header(headers, 'To')).toBe('bob@example.com');
    });

    it('sends plain text as a single-part text/plain message', async () => {
        const entity = await composeAndParse({ text: 'hello there' });
        expect(contentTypeOf(entity)).toBe('text/plain; charset=UTF-8');
        expect(entity.body).toBe('hello there');
        expect(entity.children).toBeUndefined();
    });

    it('sends html as a single-part text/html message', async () => {
        const entity = await composeAndParse({ html: '<p>hello</p>' });
        expect(contentTypeOf(entity)).toBe('text/html; charset=UTF-8');
        expect(entity.body).toBe('<p>hello</p>');
    });

    it('sends text plus html as multipart/alternative with no attachments key at all', async () => {
        const entity = await composeAndParse({ text: 'hello', html: '<p>hello</p>' });
        expect(mediaTypeOf(entity)).toBe('multipart/alternative');
        expect(entity.children.map(contentTypeOf))
            .toEqual(['text/plain; charset=UTF-8', 'text/html; charset=UTF-8']);
        expect(entity.children.map((c) => c.body)).toEqual(['hello', '<p>hello</p>']);
    });

    it('nests alternative inside related when only inline attachments are present', async () => {
        const entity = await composeAndParse({ text: 'hello', html: '<p>hello</p>', attachments: [inline] });
        expect(mediaTypeOf(entity)).toBe('multipart/related');
        expect(entity.children).toHaveLength(2);

        const [alternative, image] = entity.children;
        expect(mediaTypeOf(alternative)).toBe('multipart/alternative');
        expect(alternative.children.map(mediaTypeOf)).toEqual(['text/plain', 'text/html']);
        expect(alternative.boundary).not.toBe(entity.boundary);

        expect(header(image.headers, 'Content-ID')).toBe('<img1>');
        expect(header(image.headers, 'Content-Disposition')).toBe('inline;filename="x.png"');
        expect(image.body).toBe(bytesToB64(PNG_BYTES));
    });

    it('nests alternative inside mixed when only regular attachments are present', async () => {
        const entity = await composeAndParse({ text: 'hello', html: '<p>hello</p>', attachments: [regular] });
        expect(mediaTypeOf(entity)).toBe('multipart/mixed');
        expect(entity.children).toHaveLength(2);

        const [alternative, attachment] = entity.children;
        expect(mediaTypeOf(alternative)).toBe('multipart/alternative');
        expect(alternative.children.map(mediaTypeOf)).toEqual(['text/plain', 'text/html']);
        expect(header(attachment.headers, 'Content-Disposition')).toBe('attachment;filename="a.txt"');
        expect(attachment.body).toBe(b64('AAA'));
    });

    it('nests mixed > related > alternative with distinct boundaries when everything is present', async () => {
        const entity = await composeAndParse({
            text: 'hello',
            html: '<p>hello</p>',
            attachments: [regular, inline],
        });
        expect(mediaTypeOf(entity)).toBe('multipart/mixed');
        expect(entity.children).toHaveLength(2);

        const [related, attachment] = entity.children;
        expect(mediaTypeOf(related)).toBe('multipart/related');
        expect(related.children).toHaveLength(2);

        const [alternative, image] = related.children;
        expect(mediaTypeOf(alternative)).toBe('multipart/alternative');
        expect(alternative.children.map(mediaTypeOf)).toEqual(['text/plain', 'text/html']);
        expect(header(image.headers, 'Content-ID')).toBe('<img1>');
        expect(header(attachment.headers, 'Content-Disposition')).toBe('attachment;filename="a.txt"');

        const boundaries = [entity.boundary, related.boundary, alternative.boundary];
        expect(new Set(boundaries).size).toBe(3);
    });

    it('puts a bare text leaf under mixed when there is no html', async () => {
        const entity = await composeAndParse({ text: 'hello', attachments: [regular] });
        expect(mediaTypeOf(entity)).toBe('multipart/mixed');
        expect(entity.children.map(mediaTypeOf)).toEqual(['text/plain', 'text/plain']);
        expect(entity.children[0].body).toBe('hello');
        expect(entity.children[0].headers.has('content-disposition')).toBe(false);
    });

    // Documents current behavior: an attachment-only message is accepted and
    // carries no body part. Whether it should be rejected is an open question.
    it('sends an attachment-only message as mixed with just the attachment', async () => {
        const entity = await composeAndParse({ attachments: [regular] });
        expect(mediaTypeOf(entity)).toBe('multipart/mixed');
        expect(entity.children).toHaveLength(1);
        expect(header(entity.children[0].headers, 'Content-Disposition')).toBe('attachment;filename="a.txt"');
    });

    it('keeps every attachment when several share a kind', async () => {
        const regular2 = { ...regular, filename: 'b.txt', content: b64('BBB') };
        const inline2 = { path: '~/pics/y.png', cid: 'img2' };
        const entity = await composeAndParse({
            html: '<p>hello</p>',
            attachments: [regular, inline, regular2, inline2],
        });

        const [related, ...regulars] = entity.children;
        expect(regulars.map((r) => header(r.headers, 'Content-Disposition')))
            .toEqual(['attachment;filename="a.txt"', 'attachment;filename="b.txt"']);
        expect(regulars.map((r) => r.body)).toEqual([b64('AAA'), b64('BBB')]);

        const [htmlLeaf, ...inlines] = related.children;
        expect(mediaTypeOf(htmlLeaf)).toBe('text/html');
        expect(inlines.map((i) => header(i.headers, 'Content-ID'))).toEqual(['<img1>', '<img2>']);
        expect(fsRead.mock.calls.map(([path]) => path)).toEqual(['~/pics/x.png', '~/pics/y.png']);
    });

    it('writes cc, bcc, Reply-To, and From once each when given', async () => {
        const { headers } = await composeAndParse({
            text: 'hi',
            cc: ['c1@example.com', 'c2@example.com'],
            bcc: 'hidden@example.com',
            replyTo: 'reply@example.com',
            from: 'sender@example.com',
        });
        expect(header(headers, 'cc')).toBe('c1@example.com, c2@example.com');
        expect(header(headers, 'bcc')).toBe('hidden@example.com');
        expect(header(headers, 'Reply-To')).toBe('reply@example.com');
        expect(header(headers, 'From')).toBe('sender@example.com');
        expect(getUser).not.toHaveBeenCalled();
    });

    it('omits cc, bcc, and Reply-To when not given', async () => {
        const { headers } = await composeAndParse({ text: 'hi' });
        expect(headers.has('cc')).toBe(false);
        expect(headers.has('bcc')).toBe(false);
        expect(headers.has('reply-to')).toBe(false);
    });

    it('falls back to the signed-in user for From', async () => {
        const { headers } = await composeAndParse({ text: 'hi' });
        expect(getUser).toHaveBeenCalledTimes(1);
        expect(header(headers, 'From')).toBe('alice@puter.email');
    });

    it('accepts a list of recipients', async () => {
        const { headers } = await composeAndParse({ to: ['a@example.com', 'b@example.com'], text: 'hi' });
        expect(header(headers, 'To')).toBe('a@example.com, b@example.com');
    });

    it('writes exactly one Content-Type header for every shape', async () => {
        for ( const options of [
            { text: 'hi' },
            { text: 'hi', html: '<p>hi</p>' },
            { text: 'hi', html: '<p>hi</p>', attachments: [regular, inline] },
        ] ) {
            const { headers } = await composeAndParse(options);
            expect(headers.get('content-type')).toHaveLength(1);
            expect(headers.get('mime-version')).toEqual(['1.0']);
        }
    });

    it('rejects a message with no recipient before looking up the sender', async () => {
        await expect(compose({ subject: 'hi', text: 'hi' })).rejects.toThrow(/without recipient/);
        expect(getUser).not.toHaveBeenCalled();
    });

    it('rejects a message with no text, html, or attachments', async () => {
        await expect(compose({ ...baseOptions })).rejects.toThrow(/text, html, or an attachment/);
        await expect(compose({ ...baseOptions, attachments: [] })).rejects.toThrow(/text, html, or an attachment/);
    });

    it('rejects a non-ASCII subject', async () => {
        await expect(compose({ ...baseOptions, subject: 'héllo', text: 'hi' })).rejects.toThrow(/not valid ASCII/);
    });
});

describe('compose round-trips through a MIME parser', () => {
    const parse = async (options) => PostalMime.parse(await compose({ ...baseOptions, ...options }));
    const bytesOf = (attachment) => Array.from(new Uint8Array(attachment.content));
    // The parser terminates every text body with a newline of its own.
    const bodyOf = (str) => str?.replace(/\n$/, '');

    it('recovers a plain text body', async () => {
        const parsed = await parse({ text: 'hello there' });
        expect(bodyOf(parsed.text)).toBe('hello there');
        expect(parsed.html).toBeUndefined();
        expect(parsed.subject).toBe('hi');
        expect(parsed.to).toEqual([{ address: 'bob@example.com', name: '' }]);
        expect(parsed.from).toEqual({ address: 'alice@puter.email', name: '' });
    });

    it('recovers an html body', async () => {
        const parsed = await parse({ html: '<p>hello</p>' });
        expect(bodyOf(parsed.html)).toBe('<p>hello</p>');
        expect(parsed.text).toBeUndefined();
    });

    it('recovers both alternatives', async () => {
        const parsed = await parse({ text: 'hello', html: '<p>hello</p>' });
        expect(bodyOf(parsed.text)).toBe('hello');
        expect(bodyOf(parsed.html)).toBe('<p>hello</p>');
        expect(parsed.attachments).toEqual([]);
    });

    it('recovers both alternatives and an inline image by cid', async () => {
        const parsed = await parse({ text: 'hello', html: '<p>hello</p>', attachments: [inline] });
        expect(bodyOf(parsed.text)).toBe('hello');
        expect(bodyOf(parsed.html)).toBe('<p>hello</p>');
        expect(parsed.attachments).toHaveLength(1);
        const [image] = parsed.attachments;
        expect(image).toMatchObject({
            filename: 'x.png',
            mimeType: 'image/png',
            disposition: 'inline',
            related: true,
            contentId: '<img1>',
        });
        expect(bytesOf(image)).toEqual(Array.from(PNG_BYTES));
    });

    it('recovers both alternatives and a regular attachment', async () => {
        const parsed = await parse({ text: 'hello', html: '<p>hello</p>', attachments: [regular] });
        expect(bodyOf(parsed.text)).toBe('hello');
        expect(bodyOf(parsed.html)).toBe('<p>hello</p>');
        expect(parsed.attachments).toHaveLength(1);
        expect(parsed.attachments[0]).toMatchObject({
            filename: 'a.txt',
            mimeType: 'text/plain',
            disposition: 'attachment',
        });
        expect(new TextDecoder().decode(parsed.attachments[0].content)).toBe('AAA');
    });

    it('recovers everything from the fully nested shape', async () => {
        const parsed = await parse({
            text: 'hello',
            html: '<p>hello</p>',
            cc: 'c1@example.com',
            attachments: [regular, inline],
        });
        expect(bodyOf(parsed.text)).toBe('hello');
        expect(bodyOf(parsed.html)).toBe('<p>hello</p>');
        expect(parsed.cc).toEqual([{ address: 'c1@example.com', name: '' }]);

        const byName = Object.fromEntries(parsed.attachments.map((a) => [a.filename, a]));
        expect(Object.keys(byName).sort()).toEqual(['a.txt', 'x.png']);
        expect(byName['x.png']).toMatchObject({ disposition: 'inline', related: true, contentId: '<img1>' });
        expect(bytesOf(byName['x.png'])).toEqual(Array.from(PNG_BYTES));
        expect(byName['a.txt']).toMatchObject({ disposition: 'attachment', mimeType: 'text/plain' });
        expect(new TextDecoder().decode(byName['a.txt'].content)).toBe('AAA');
    });

    it('recovers every attachment when several share a kind', async () => {
        const regular2 = { ...regular, filename: 'b.txt', content: b64('BBB') };
        const inline2 = { path: '~/pics/y.png', cid: 'img2' };
        const parsed = await parse({
            html: '<p>hello</p>',
            attachments: [regular, inline, regular2, inline2],
        });
        expect(bodyOf(parsed.html)).toBe('<p>hello</p>');
        expect(parsed.attachments.map((a) => a.filename).sort()).toEqual(['a.txt', 'b.txt', 'x.png', 'y.png']);
        expect(parsed.attachments.filter((a) => a.related).map((a) => a.contentId).sort())
            .toEqual(['<img1>', '<img2>']);
    });
});
