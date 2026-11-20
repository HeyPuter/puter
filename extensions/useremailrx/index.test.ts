import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const SECRET = 'ingress-secret';

// Only `extension` is stubbed; the secret comparison and the routing are the
// real code paths, and the fake service/store layer is the boundary.
const state = vi.hoisted(() => ({
    config: { userEmail: { secret: 'ingress-secret' } } as Record<
        string,
        unknown
    >,
    routes: [] as Array<{
        path: string;
        handler: (req: unknown, res: unknown) => unknown;
    }>,
    users: new Map<string, Record<string, unknown>>(),
    writes: [] as Array<{
        userId: number;
        path: string;
        size: number;
        homeRegion?: string;
        content?: unknown;
    }>,
    feedback: [] as Array<{ to: string; from: string | null; raw: Buffer }>,
    takeFeedback: true,
    validated: [] as Array<ValidateEvent>,
    /** What the `email.ingress.validate` listener does, or null for none. */
    onValidate: null as null | ((event: ValidateEvent) => unknown),
}));

type ValidateEvent = {
    to: string;
    envelopeFrom: string | null;
    head: Buffer;
    size: number;
    readMessage: () => Promise<Buffer>;
    allow: boolean;
    message: string | null;
    senderAuth: {
        result: 'pass' | 'fail' | 'temperror';
        fromDomains: string[];
        signingDomains: string[];
    } | null;
};

vi.mock('@heyputer/backend/src/extensions', () => ({
    extension: {
        get config() {
            return state.config;
        },
        post(
            path: string,
            _opts: unknown,
            handler: (req: unknown, res: unknown) => unknown,
        ) {
            state.routes.push({ path, handler });
        },
        import(layer: string) {
            if (layer === 'client') {
                return {
                    event: {
                        async emitAndWait(
                            key: string,
                            data: unknown,
                            meta: { listener_failed?: boolean },
                            opts: { revertOnFailure?: readonly string[] } = {},
                        ) {
                            if (key === 'email.ingress.validate') {
                                state.validated.push(data as ValidateEvent);
                                const fields = data as Record<string, unknown>;
                                const before = (opts.revertOnFailure ?? []).map(
                                    (name) => [name, fields[name]] as const,
                                );
                                try {
                                    await state.onValidate?.(
                                        data as ValidateEvent,
                                    );
                                } catch {
                                    // What the event client does with a
                                    // listener that throws.
                                    for (const [name, value] of before) {
                                        fields[name] = value;
                                    }
                                    meta.listener_failed = true;
                                }
                                return;
                            }
                            if (key !== 'email.ingress.feedback') return;
                            const feedback = data as {
                                to: string;
                                from: string | null;
                                raw: Buffer;
                                handled: boolean;
                            };
                            state.feedback.push(feedback);
                            if (state.takeFeedback) feedback.handled = true;
                        },
                    },
                };
            }
            if (layer === 'store') {
                return {
                    user: {
                        getByUsername: async (username: string) =>
                            state.users.get(username) ?? null,
                    },
                };
            }
            return {
                fs: {
                    async write(
                        userId: number,
                        {
                            fileMetadata,
                            fileContent,
                        }: {
                            fileMetadata: { path: string; size: number };
                            fileContent: unknown;
                        },
                        _uploadTracker?: unknown,
                        _storageAllowanceMax?: number,
                        homeRegion?: string,
                    ) {
                        state.writes.push({
                            userId,
                            path: fileMetadata.path,
                            size: fileMetadata.size,
                            homeRegion,
                            content: fileContent,
                        });
                        return { fsEntry: { path: fileMetadata.path } };
                    },
                },
            };
        },
    },
}));

import './index.js';

const permanent = (id: number, username: string) => ({
    id,
    username,
    email: `${username}@example.com`,
    password: '$2b$10$hash',
});
/** No password and no email is what makes an account temporary. */
const temp = (id: number, username: string) => ({
    id,
    username,
    email: null,
    password: null,
});

const ingress = async (
    to: string,
    over: {
        secret?: string;
        contentLength?: string | null;
        body?: string;
        query?: Record<string, string>;
    } = {},
) => {
    const route = state.routes.find((r) => r.path === '/email/ingress');
    if (!route) throw new Error('route not registered');

    const body = Buffer.from(
        over.body ?? 'From: someone@example.com\r\n\r\nhello\r\n',
    );
    const req = Readable.from([body], { objectMode: false }) as unknown as {
        headers: Record<string, string>;
        query: Record<string, string>;
    };
    // `contentLength: null` sends no length header at all, which is the one
    // framing the HTTP parser does not bound for us.
    req.headers =
        over.contentLength === null
            ? {}
            : {
                  'content-length': over.contentLength ?? String(body.length),
              };
    req.query = {
        SECRET: over.secret ?? SECRET,
        to,
        from: 'someone@example.com',
        subject: 'hi',
        ...over.query,
    };

    let status = 200;
    let ended = false;
    let responseBody: string | undefined;
    // `end` takes (chunk, encoding) and no callback, the way the compression
    // middleware leaves it, and emits `finish` — which is what the refusal
    // paths hang their drain/destroy on. A stub that accepts a callback
    // instead hides the bug that took the 413 path to production as a 500.
    const emitter = new EventEmitter();
    const res = {
        status(code: number) {
            status = code;
            return res;
        },
        end(chunk?: unknown, encoding?: BufferEncoding) {
            if (chunk) Buffer.byteLength(chunk as string, encoding);
            if (typeof chunk === 'string') responseBody = chunk;
            ended = true;
            emitter.emit('finish');
        },
        once(event: string, listener: () => void) {
            emitter.once(event, listener);
            return res;
        },
    } as unknown as Response;

    await route.handler(req as unknown as Request, res);
    return {
        status,
        ended,
        body: responseBody,
        drained: (req as unknown as Readable).readableFlowing,
        destroyed: (req as unknown as Readable).destroyed,
    };
};

/** The bytes the nth write stored, whether handed over whole or as a stream. */
const stored = async (n: number): Promise<string> => {
    const content = state.writes[n].content;
    if (Buffer.isBuffer(content)) return content.toString('latin1');
    const chunks: Buffer[] = [];
    for await (const chunk of content as Readable) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('latin1');
};

beforeEach(() => {
    state.users.clear();
    state.writes.length = 0;
    state.feedback.length = 0;
    state.takeFeedback = true;
    state.validated.length = 0;
    state.onValidate = null;
});

describe('temporary accounts cannot receive', () => {
    test('mail for a temp account is accepted and dropped', async () => {
        state.users.set('tempy', temp(1, 'tempy'));

        const { status, ended, drained } = await ingress('tempy@puter.email');
        // Accepted, so the relay neither retries nor bounces to the sender.
        expect(status).toBe(200);
        expect(ended).toBe(true);
        // The body is read off the wire rather than left unconsumed.
        expect(drained).toBe(true);
        expect(state.writes).toEqual([]);
    });

    test('mail for a permanent account still lands in the mailbox', async () => {
        state.users.set('bob', permanent(2, 'bob'));

        const { status } = await ingress('bob@puter.email');
        expect(status).toBe(200);
        expect(state.writes).toHaveLength(1);
        expect(state.writes[0].userId).toBe(2);
        expect(state.writes[0].path).toMatch(/^\/bob\/\.mail\/objects\//);
    });

    test('an unknown address is still rejected outright', async () => {
        const { status } = await ingress('nobody@puter.email');
        expect(status).toBe(404);
        expect(state.writes).toEqual([]);
    });
});

describe('inbound mail is placed in the recipient home region', () => {
    /** A permanent account with explicit placement columns. */
    const placed = (
        id: number,
        username: string,
        over: { home?: string | null; signup_server?: string | null },
    ) => ({
        ...permanent(id, username),
        home: null,
        signup_server: null,
        ...over,
    });

    test("uses the recipient's own home region when they have one", async () => {
        state.users.set('bob', placed(2, 'bob', { home: 'frankfurt' }));

        await ingress('bob@puter.email');
        expect(state.writes[0].homeRegion).toBe('frankfurt');
    });

    test('falls back to the server that served their signup', async () => {
        // Every account that predates the `home` column is this case.
        state.users.set(
            'bob',
            placed(2, 'bob', { home: null, signup_server: 'london' }),
        );

        await ingress('bob@puter.email');
        expect(state.writes[0].homeRegion).toBe('london');
    });

    test('falls back to the primary region when neither is set', async () => {
        state.users.set('bob', placed(2, 'bob', {}));

        await ingress('bob@puter.email');
        expect(state.writes[0].homeRegion).toBe('oregon');
    });

    test('home wins over signup_server when both are set', async () => {
        state.users.set(
            'bob',
            placed(2, 'bob', { home: 'sydney', signup_server: 'london' }),
        );

        await ingress('bob@puter.email');
        expect(state.writes[0].homeRegion).toBe('sydney');
    });
});

describe('refusals dispose of the body nobody read', () => {
    test('an unknown recipient drains it and keeps the connection', async () => {
        // The secret checked out and the length is under the cap, so the body
        // was ours to read: discard it rather than resetting a usable socket.
        const { status, drained, destroyed } =
            await ingress('nobody@puter.email');
        expect(status).toBe(404);
        expect(drained).toBe(true);
        expect(destroyed).toBe(false);
    });

    test('a bad secret closes rather than reading the upload', async () => {
        state.users.set('bob', permanent(2, 'bob'));

        const { status, destroyed } = await ingress('bob@puter.email', {
            secret: 'not-the-secret',
        });
        expect(status).toBe(403);
        // Nothing authenticated this caller; their bytes are not worth reading.
        expect(destroyed).toBe(true);
        expect(state.writes).toEqual([]);
    });

    test('no content-length is refused with 411', async () => {
        state.users.set('bob', permanent(2, 'bob'));

        const { status, destroyed } = await ingress('bob@puter.email', {
            contentLength: null,
        });
        expect(status).toBe(411);
        expect(destroyed).toBe(true);
        expect(state.writes).toEqual([]);
    });

    test('a declared length over the cap is refused with 413', async () => {
        state.users.set('bob', permanent(2, 'bob'));

        const { status, destroyed } = await ingress('bob@puter.email', {
            contentLength: String(25 * 1024 * 1024 + 1),
        });
        expect(status).toBe(413);
        expect(destroyed).toBe(true);
        expect(state.writes).toEqual([]);
    });
});

describe('feedback addresses', () => {
    test('are handed to a listener and reach no mailbox', async () => {
        const { status, ended } = await ingress('fbl@puter.email');
        expect(status).toBe(200);
        expect(ended).toBe(true);
        expect(state.feedback).toHaveLength(1);
        expect(state.feedback[0].to).toBe('fbl@puter.email');
        expect(state.feedback[0].from).toBe('someone@example.com');
        expect(state.feedback[0].raw.toString()).toContain('hello');
        expect(state.writes).toEqual([]);
    });

    test('match the local part case-insensitively', async () => {
        await ingress('Abuse@puter.email');
        expect(state.feedback).toHaveLength(1);
    });

    test('fall through to normal routing when nobody takes them', async () => {
        state.takeFeedback = false;
        state.users.set('abuse', permanent(3, 'abuse'));

        const { status } = await ingress('abuse@puter.email');
        expect(status).toBe(200);
        expect(state.feedback).toHaveLength(1);
        // The body was already read, so the buffered copy is what is stored.
        expect(state.writes).toHaveLength(1);
        expect(Buffer.isBuffer(state.writes[0].content)).toBe(true);
    });

    test('an unclaimed one with no such account is still a 404', async () => {
        state.takeFeedback = false;
        const { status } = await ingress('postmaster@puter.email');
        expect(status).toBe(404);
    });

    test('only count on a Puter mail domain', async () => {
        state.users.set('abuse', permanent(3, 'abuse'));
        await ingress('abuse@example.com');
        expect(state.feedback).toEqual([]);
    });

    test('are refused over the feedback size cap without being read', async () => {
        const { status, destroyed } = await ingress('fbl@puter.email', {
            contentLength: String(5 * 1024 * 1024 + 1),
        });
        expect(status).toBe(413);
        expect(destroyed).toBe(true);
        expect(state.feedback).toEqual([]);
    });
});

describe('the sender check', () => {
    // Two forged copies of the header only the ingress may write: one with
    // whitespace before its colon, one folded over two lines.
    const FORGED = [
        'From: no-reply@puter.com',
        'X-Puter-Sender-Auth: pass; from=puter.com; signed-by=puter.com',
        'Subject: hi',
        'x-puter-sender-auth \t: pass',
        '  ; from=puter.com',
        '',
        'hello',
        '',
    ].join('\r\n');
    const CLEAN = 'From: no-reply@puter.com\r\nSubject: hi\r\n\r\nhello\r\n';

    test('a copy of its header the sender wrote is stripped, checked or not', async () => {
        state.users.set('bob', permanent(2, 'bob'));

        const { status } = await ingress('bob@puter.email', { body: FORGED });
        expect(status).toBe(200);
        const bytes = await stored(0);
        expect(bytes).toBe(CLEAN);
        expect(state.writes[0].size).toBe(Buffer.byteLength(bytes, 'latin1'));
    });

    test("a listener's outcome is the one copy the stored message carries", async () => {
        state.users.set('bob', permanent(2, 'bob'));
        state.onValidate = (event) => {
            event.senderAuth = {
                result: 'fail',
                fromDomains: ['puter.com'],
                signingDomains: [],
            };
        };

        await ingress('bob@puter.email', { body: FORGED });
        const bytes = await stored(0);
        expect(bytes).toBe(
            `X-Puter-Sender-Auth: fail; from=puter.com; signed-by=none\r\n${CLEAN}`,
        );
        expect(state.writes[0].size).toBe(Buffer.byteLength(bytes, 'latin1'));
    });

    test('a listener reading the whole message gets it as received, and the copy filed is built from it', async () => {
        state.users.set('bob', permanent(2, 'bob'));
        let seen = '';
        state.onValidate = async (event) => {
            const [first, second] = await Promise.all([
                event.readMessage(),
                event.readMessage(),
            ]);
            expect(second).toBe(first);
            seen = first.toString('latin1');
            event.senderAuth = {
                result: 'pass',
                fromDomains: ['puter.com'],
                signingDomains: ['puter.com'],
            };
        };

        await ingress('bob@puter.email', { body: FORGED });
        expect(seen).toBe(FORGED);
        expect(Buffer.isBuffer(state.writes[0].content)).toBe(true);
        expect(await stored(0)).toBe(
            `X-Puter-Sender-Auth: pass; from=puter.com; signed-by=puter.com\r\n${CLEAN}`,
        );
    });

    test('the listener sees the envelope, the head as received and the size', async () => {
        state.users.set('bob', permanent(2, 'bob'));

        await ingress('bob@puter.email', {
            body: FORGED,
            query: { mailfrom: 'bounce@sender.example' },
        });
        const [event] = state.validated;
        expect(event.to).toBe('bob@puter.email');
        expect(event.envelopeFrom).toBe('bounce@sender.example');
        expect(event.head.toString('latin1')).toBe(
            FORGED.slice(0, FORGED.indexOf('\r\n\r\n') + 4),
        );
        expect(event.size).toBe(Buffer.byteLength(FORGED));
    });

    test('mail with nothing to strip or record streams through untouched', async () => {
        state.users.set('bob', permanent(2, 'bob'));

        await ingress('bob@puter.email', { body: CLEAN });
        expect(Buffer.isBuffer(state.writes[0].content)).toBe(false);
        expect(await stored(0)).toBe(CLEAN);
        expect(state.writes[0].size).toBe(Buffer.byteLength(CLEAN));
    });

    test('a listener that fails is no opinion: the message is filed, unmarked, and that is logged', async () => {
        state.users.set('bob', permanent(2, 'bob'));
        state.onValidate = (event) => {
            // Whatever it set before failing is undone.
            event.allow = false;
            event.senderAuth = {
                result: 'pass',
                fromDomains: ['puter.com'],
                signingDomains: ['puter.com'],
            };
            throw new Error('verifier down');
        };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { status } = await ingress('bob@puter.email', {
                body: FORGED,
            });
            expect(status).toBe(200);
            expect(await stored(0)).toBe(CLEAN);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain(
                'email.ingress.validate',
            );
        } finally {
            warn.mockRestore();
        }
    });

    test('a forged copy a lenient reader still reads as the header is stripped too', async () => {
        state.users.set('bob', permanent(2, 'bob'));
        const body = [
            ' X-Puter-Sender-Auth: pass; from=puter.com',
            'From: no-reply@puter.com',
            'X-Puter-Sender-Auth',
            ' : pass; from=puter.com',
            'X-PUTER-SENDER-AUTH',
            ': pass; from=puter.com',
            'Subject: hi',
            '',
            'hello',
            '',
        ].join('\r\n');

        await ingress('bob@puter.email', { body });
        expect(await stored(0)).toBe(CLEAN);
    });

    test('a refusal is a 422 carrying one line of its reason, and nothing is filed', async () => {
        state.users.set('bob', permanent(2, 'bob'));
        state.onValidate = (event) => {
            event.allow = false;
            event.message =
                'Unauthenticated mail from puter.com is not accepted\r\nX-Injected: 1';
        };

        const { status, body, drained } = await ingress('bob@puter.email', {
            body: FORGED,
        });
        expect(status).toBe(422);
        expect(body).toBe(
            'Unauthenticated mail from puter.com is not accepted X-Injected: 1',
        );
        expect(drained).toBe(true);
        expect(state.writes).toEqual([]);
    });

    test('a refusal with no reason still says why it failed', async () => {
        state.users.set('bob', permanent(2, 'bob'));
        state.onValidate = (event) => {
            event.allow = false;
        };

        const { status, body } = await ingress('bob@puter.email');
        expect(status).toBe(422);
        expect(body).toBe('Message refused');
    });

    test('a header block past the cap is refused with 413', async () => {
        state.users.set('bob', permanent(2, 'bob'));

        const { status, destroyed } = await ingress('bob@puter.email', {
            body: `From: a@example.com\r\nX-Pad: ${'a'.repeat(300 * 1024)}\r\n\r\nhello`,
        });
        expect(status).toBe(413);
        expect(destroyed).toBe(true);
        expect(state.validated).toEqual([]);
        expect(state.writes).toEqual([]);
    });

    test('feedback nobody took is held to the same header cap', async () => {
        state.takeFeedback = false;
        state.users.set('abuse', permanent(3, 'abuse'));

        const { status } = await ingress('abuse@puter.email', {
            body: `From: a@example.com\r\nX-Pad: ${'a'.repeat(300 * 1024)}\r\n\r\nhello`,
        });
        expect(status).toBe(413);
        expect(state.validated).toEqual([]);
        expect(state.writes).toEqual([]);
    });

    test('feedback nobody took is stripped like any other mail', async () => {
        state.takeFeedback = false;
        state.users.set('abuse', permanent(3, 'abuse'));

        await ingress('abuse@puter.email', { body: FORGED });
        expect(await stored(0)).toBe(CLEAN);
        expect(state.validated[0].size).toBe(Buffer.byteLength(FORGED));
    });
});
