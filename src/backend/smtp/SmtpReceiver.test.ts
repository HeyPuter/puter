import http from 'node:http';
import type { AddressInfo } from 'node:net';
import SMTPConnection from 'nodemailer/lib/smtp-connection/index.js';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { ResolvedSmtpConfig } from './config.js';
import { SmtpReceiver } from './SmtpReceiver.js';

interface IngressCall {
    to: string | null;
    subject: string | null;
    from: string | null;
    messageid: string | null;
    secret: string | null;
    contentLength: string | undefined;
    contentType: string | undefined;
    body: string;
}

let ingress: http.Server;
let ingressUrl: string;
let calls: IngressCall[] = [];
let statusFor: (to: string) => number = () => 200;

let receiver: SmtpReceiver;
let smtpPort: number;

const baseConfig = (
    over: Partial<ResolvedSmtpConfig> = {},
): ResolvedSmtpConfig => ({
    host: '127.0.0.1',
    port: 0,
    hostname: 'mx.example.com',
    domains: ['example.com'],
    ingressUrl,
    ingressHost: null,
    secret: 'ingress-secret',
    maxMessageBytes: 2048,
    maxRecipients: 3,
    maxClients: 20,
    ...over,
});

const startReceiver = async (over: Partial<ResolvedSmtpConfig> = {}) => {
    receiver = new SmtpReceiver(baseConfig(over));
    smtpPort = (await receiver.listen()).port;
};

/** Deliver one message and resolve with the SMTP reply code. */
const deliver = async (opts: {
    to: string[];
    message?: string;
}): Promise<{ code: number; message: string }> => {
    const conn = new SMTPConnection({
        host: '127.0.0.1',
        port: smtpPort,
        secure: false,
        ignoreTLS: true,
        tls: { rejectUnauthorized: false },
    });
    return await new Promise((resolve, reject) => {
        conn.on('error', reject);
        conn.connect(() => {
            conn.send(
                {
                    from: 'sender@elsewhere.test',
                    to: opts.to,
                },
                opts.message ??
                    'Subject: Hello\r\nFrom: sender@elsewhere.test\r\n\r\nbody\r\n',
                (err: (Error & { responseCode?: number }) | null) => {
                    conn.close();
                    if (err) {
                        resolve({
                            code: err.responseCode ?? 0,
                            message: err.message,
                        });
                        return;
                    }
                    resolve({ code: 250, message: 'ok' });
                },
            );
        });
    });
};

/**
 * Drive the server with raw SMTP. nodemailer refuses an oversize declaration
 * client-side, which would never reach the server being tested.
 */
const rawExchange = async (commands: string[]): Promise<string[]> => {
    const { createConnection } = await import('node:net');
    return await new Promise((resolve, reject) => {
        const replies: string[] = [];
        const socket = createConnection(smtpPort, '127.0.0.1');
        let next = 0;
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => {
            replies.push(chunk.trim());
            if (next < commands.length) {
                socket.write(`${commands[next++]}\r\n`);
            } else {
                socket.end();
            }
        });
        socket.on('error', reject);
        socket.on('close', () => resolve(replies));
    });
};

beforeAll(async () => {
    ingress = http.createServer((req, res) => {
        const url = new URL(req.url ?? '', 'http://ingress.test');
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c as Buffer));
        req.on('end', () => {
            const to = url.searchParams.get('to') ?? '';
            calls.push({
                to,
                subject: url.searchParams.get('subject'),
                from: url.searchParams.get('from'),
                messageid: url.searchParams.get('messageid'),
                secret: url.searchParams.get('SECRET'),
                contentLength: req.headers['content-length'],
                contentType: req.headers['content-type'],
                body: Buffer.concat(chunks).toString(),
            });
            res.statusCode = statusFor(to);
            res.end();
        });
    });
    await new Promise<void>((r) => ingress.listen(0, '127.0.0.1', r));
    ingressUrl = `http://127.0.0.1:${(ingress.address() as AddressInfo).port}/email/ingress`;
    await startReceiver();
});

afterAll(async () => {
    await receiver.close();
    await new Promise<void>((r) => ingress.close(() => r()));
});

afterEach(() => {
    calls = [];
    statusFor = () => 200;
});

describe('accepting mail', () => {
    test('delivers a message and reports 250', async () => {
        const reply = await deliver({ to: ['dan@example.com'] });
        expect(reply.code).toBe(250);
        expect(calls).toHaveLength(1);
        expect(calls[0].to).toBe('dan@example.com');
        expect(calls[0].subject).toBe('Hello');
        expect(calls[0].from).toBe('sender@elsewhere.test');
        expect(calls[0].secret).toBe('ingress-secret');
        expect(calls[0].contentType).toBe('message/rfc822');
        expect(calls[0].contentLength).toBe(
            String(Buffer.byteLength(calls[0].body)),
        );
    });

    test('sends NO-ID when the message has no Message-ID', async () => {
        await deliver({ to: ['dan@example.com'] });
        expect(calls[0].messageid).toBe('NO-ID');
    });

    test('posts once per envelope recipient with identical bytes', async () => {
        const reply = await deliver({
            to: ['dan@example.com', 'sam@example.com'],
        });
        expect(reply.code).toBe(250);
        expect(calls.map((c) => c.to).sort()).toEqual([
            'dan@example.com',
            'sam@example.com',
        ]);
        expect(calls[0].body).toBe(calls[1].body);
    });

    test('delivers to the envelope recipient, not the To: header', async () => {
        // A blind-copied recipient never appears in the To: header, so reading
        // the header instead of the envelope misdelivers the message.
        await deliver({
            to: ['hidden@example.com'],
            message:
                'Subject: Bcc test\r\nTo: someone-else@example.com\r\n\r\nbody\r\n',
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].to).toBe('hidden@example.com');
    });

    test('delivers one copy when an address is repeated', async () => {
        await deliver({ to: ['dan@example.com', 'dan@example.com'] });
        expect(calls).toHaveLength(1);
    });
});

describe('refusing recipients', () => {
    test('refuses a domain it does not accept, and posts nothing', async () => {
        const reply = await deliver({ to: ['someone@elsewhere.test'] });
        expect(reply.code).toBe(550);
        expect(reply.message).toContain('Relay access denied');
        expect(calls).toHaveLength(0);
    });

    test('refuses more recipients than the cap allows', async () => {
        const reply = await deliver({
            to: [
                'a@example.com',
                'b@example.com',
                'c@example.com',
                'd@example.com',
            ],
        });
        // The first three are accepted, so the message still goes through.
        expect(reply.code).toBe(250);
        expect(calls).toHaveLength(3);
    });
});

describe('message size', () => {
    test('refuses before the body when the sender declares an oversize', async () => {
        const replies = await rawExchange([
            'EHLO test.local',
            'MAIL FROM:<sender@elsewhere.test> SIZE=99999999',
            'QUIT',
        ]);
        expect(replies.join('\n')).toMatch(/^552/m);
        expect(calls).toHaveLength(0);
    });

    test('advertises the SIZE limit so senders can check before sending', async () => {
        const replies = await rawExchange(['EHLO test.local', 'QUIT']);
        expect(replies.join('\n')).toContain('SIZE 2048');
    });

    test('refuses an oversize body that was never declared', async () => {
        const big = `Subject: big\r\n\r\n${'x'.repeat(4096)}\r\n`;
        const reply = await deliver({ to: ['dan@example.com'], message: big });
        expect(reply.code).toBe(552);
        expect(calls).toHaveLength(0);
    });
});

describe('reporting what the ingress endpoint said', () => {
    test('an unknown user becomes a permanent 550', async () => {
        statusFor = () => 404;
        const reply = await deliver({ to: ['nobody@example.com'] });
        expect(reply.code).toBe(550);
    });

    test('a rejected secret becomes a temporary 451', async () => {
        statusFor = () => 403;
        const reply = await deliver({ to: ['dan@example.com'] });
        expect(reply.code).toBe(451);
    });

    test('an unreachable endpoint becomes a temporary 451', async () => {
        await receiver.close();
        await startReceiver({ ingressUrl: 'http://127.0.0.1:1/email/ingress' });
        const reply = await deliver({ to: ['dan@example.com'] });
        expect(reply.code).toBe(451);
        await receiver.close();
        await startReceiver();
    });

    test('reports the first failure when recipients differ', async () => {
        // One reply covers the whole message; the sender is told about the
        // first address that could not be delivered to.
        statusFor = (to) => (to.startsWith('nobody') ? 404 : 200);
        const reply = await deliver({
            to: ['dan@example.com', 'nobody@example.com'],
        });
        expect(reply.code).toBe(550);
    });
});
