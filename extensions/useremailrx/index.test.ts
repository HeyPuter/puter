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
        homeRegion?: string;
    }>,
}));

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
                        { fileMetadata }: { fileMetadata: { path: string } },
                        _uploadTracker?: unknown,
                        _storageAllowanceMax?: number,
                        homeRegion?: string,
                    ) {
                        state.writes.push({
                            userId,
                            path: fileMetadata.path,
                            homeRegion,
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
    over: { secret?: string; contentLength?: string | null } = {},
) => {
    const route = state.routes.find((r) => r.path === '/email/ingress');
    if (!route) throw new Error('route not registered');

    const body = Buffer.from('From: someone@example.com\r\n\r\nhello\r\n');
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
    req.query = { SECRET: over.secret ?? SECRET, to, subject: 'hi' };

    let status = 200;
    let ended = false;
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
        drained: (req as unknown as Readable).readableFlowing,
        destroyed: (req as unknown as Readable).destroyed,
    };
};

beforeEach(() => {
    state.users.clear();
    state.writes.length = 0;
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
