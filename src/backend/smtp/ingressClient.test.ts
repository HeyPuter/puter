import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import {
    buildIngressUrl,
    deliver,
    describeTarget,
    readHeaderFields,
    replyForStatus,
} from './ingressClient.js';

const SECRET = 'ingress-secret';

describe('building the request url', () => {
    const url = (over: Partial<Parameters<typeof buildIngressUrl>[1]> = {}) =>
        buildIngressUrl('https://api.example.com/email/ingress', {
            to: 'dan@example.com',
            subject: 'Hi & bye',
            from: 'sender@elsewhere.test',
            messageId: '<abc@x>',
            secret: SECRET,
            ...over,
        });

    test('carries the metadata the endpoint reads', () => {
        const u = url();
        expect(u.searchParams.get('to')).toBe('dan@example.com');
        expect(u.searchParams.get('subject')).toBe('Hi & bye');
        expect(u.searchParams.get('from')).toBe('sender@elsewhere.test');
        expect(u.searchParams.get('messageid')).toBe('<abc@x>');
        expect(u.searchParams.get('SECRET')).toBe(SECRET);
    });

    test('encodes a unicode subject', () => {
        const u = url({ subject: 'héllo → wörld' });
        expect(u.searchParams.get('subject')).toBe('héllo → wörld');
        expect(u.toString()).not.toContain('→');
    });
});

describe('describing the target for a log', () => {
    test('never includes the secret', () => {
        const described = describeTarget(
            `https://api.example.com/email/ingress?SECRET=${SECRET}`,
        );
        expect(described).toBe('https://api.example.com/email/ingress');
        expect(described).not.toContain(SECRET);
    });

    test('does not throw on an unusable url', () => {
        expect(describeTarget('not a url')).not.toContain('not a url');
    });
});

describe('reading header fields', () => {
    test('reads subject, from and message id', async () => {
        const fields = await readHeaderFields(
            Buffer.from(
                'Subject: Hello there\r\nFrom: Dan <dan@example.com>\r\nMessage-ID: <abc@x>\r\n\r\nbody',
            ),
        );
        expect(fields).toEqual({
            subject: 'Hello there',
            from: 'dan@example.com',
            messageId: '<abc@x>',
        });
    });

    test('decodes an encoded-word subject', () => {
        // The subject becomes part of the stored object name, so it has to be
        // decoded the same way the hosted receiver's pre-parsed header was.
        return expect(
            readHeaderFields(
                Buffer.from('Subject: =?UTF-8?B?SGVsbG8gd29ybGQ=?=\r\n\r\nx'),
            ),
        ).resolves.toMatchObject({ subject: 'Hello world' });
    });

    test('falls back the way the hosted receiver does', async () => {
        expect(await readHeaderFields(Buffer.from('X-Other: v\r\n\r\nx'))).toEqual(
            {
                subject: '',
                from: 'anonymous@example.com',
                messageId: 'NO-ID',
            },
        );
    });
});

describe('turning a status into an SMTP reply', () => {
    test.each([
        [200, 250],
        [204, 250],
        [404, 550],
        [413, 552],
        [403, 451],
        [411, 451],
        [429, 451],
        [500, 451],
    ])('%i becomes %i', (status, code) => {
        expect(replyForStatus(status).code).toBe(code);
    });

    test('a rejected secret is temporary, so mail is held not bounced', () => {
        // 403 means this end is misconfigured; bouncing would discard the mail.
        expect(replyForStatus(403).code).toBe(451);
    });
});

describe('delivering to the endpoint', () => {
    let server: http.Server;
    let base: string;
    let received: Array<{
        url: string;
        headers: http.IncomingHttpHeaders;
        body: Buffer;
    }> = [];
    let status = 200;
    let hang = false;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c as Buffer));
            req.on('end', () => {
                received.push({
                    url: req.url ?? '',
                    headers: req.headers,
                    body: Buffer.concat(chunks),
                });
                if (hang) return;
                res.statusCode = status;
                res.end();
            });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/email/ingress`;
    });

    afterAll(async () => {
        await new Promise<void>((r) => server.close(() => r()));
    });

    afterEach(() => {
        received = [];
        status = 200;
        hang = false;
    });

    const fields = {
        subject: 'Hi',
        from: 'sender@elsewhere.test',
        messageId: '<m@x>',
    };
    const send = (target: Partial<{ url: string; host: string | null }> = {}) =>
        deliver(Buffer.from('Subject: Hi\r\n\r\nthe body'), 'dan@example.com', fields, {
            url: base,
            secret: SECRET,
            timeoutMs: 2000,
            ...target,
        });

    test('posts the message with an exact content length', async () => {
        const reply = await send();
        expect(reply.code).toBe(250);
        expect(received).toHaveLength(1);
        expect(received[0].headers['content-type']).toBe('message/rfc822');
        expect(received[0].headers['content-length']).toBe(
            String(received[0].body.byteLength),
        );
        expect(received[0].body.toString()).toBe('Subject: Hi\r\n\r\nthe body');
        expect(received[0].url).toContain('to=dan%40example.com');
    });

    test('sends the configured host so the api vhost is addressed', async () => {
        await send({ host: 'api.example.com' });
        expect(received[0].headers.host).toBe('api.example.com');
    });

    test('falls back to the url host when none is configured', async () => {
        await send();
        expect(received[0].headers.host).toContain('127.0.0.1');
    });

    test('maps a refusal from the endpoint', async () => {
        status = 404;
        expect((await send()).code).toBe(550);
    });

    test('treats an unreachable endpoint as temporary', async () => {
        const reply = await send({ url: 'http://127.0.0.1:1/email/ingress' });
        expect(reply.code).toBe(451);
    });

    test('treats a hung endpoint as temporary', async () => {
        hang = true;
        const reply = await deliver(
            Buffer.from('x'),
            'dan@example.com',
            fields,
            { url: base, secret: SECRET, timeoutMs: 150 },
        );
        expect(reply.code).toBe(451);
    });
});
