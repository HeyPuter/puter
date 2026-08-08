// This suite tests basic features of puter webdav. it is not a comprehensive webdav test suite unlike litmus
// but rather it performs some common sense checks to ensure that WebDAV support isn't irrevocably broken in puter
import type { Request, Response } from 'express';
import { Readable, Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { hash as bcryptHash } from 'bcrypt';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { WebDAVController } from './WebDAVController.js';

let server: PuterServer;
let controller: WebDAVController;
let dispatchMiddleware: Function;

beforeAll(async () => {
    server = await setupTestServer();
    controller = server.controllers.webdav as unknown as WebDAVController;

    const router = new PuterRouter();
    controller.registerRoutes(router);

    // WebDAVController registers a single `use()` middleware on the `dav`
    // subdomain. Grab it to call directly in tests.
    dispatchMiddleware = router.routes[0]!.handler;
});

afterAll(async () => {
    await server?.shutdown();
});

interface CapturedResponse {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    ended: boolean;
}

const makeReq = (init: {
    method: string;
    path?: string;
    body?: unknown;
    headers?: Record<string, string>;
    actor?: unknown;
    socket?: unknown;
}): Request => {
    return {
        method: init.method,
        path: init.path ?? '/',
        body: init.body ?? {},
        query: {},
        headers: init.headers ?? {},
        actor: init.actor,
        socket: init.socket ?? {},
    } as unknown as Request;
};

const makeRes = () => {
    const captured: CapturedResponse = {
        statusCode: 200,
        body: undefined,
        headers: {},
        ended: false,
    };
    const listeners: Record<string, Array<() => void>> = {};
    const res = {
        // The DAV mount holds a concurrency slot for the life of the request
        // and releases it on `finish` / `close`, so the stub has to behave
        // like an emitter or every dispatch throws.
        once: vi.fn((event: string, fn: () => void) => {
            (listeners[event] ??= []).push(fn);
            return res;
        }),
        emit: vi.fn((event: string) => {
            const fns = listeners[event] ?? [];
            listeners[event] = [];
            for (const fn of fns) fn();
        }),
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        set: vi.fn((obj: Record<string, string> | string, val?: string) => {
            if (typeof obj === 'string') {
                captured.headers[obj.toLowerCase()] = val!;
            } else {
                for (const [k, v] of Object.entries(obj)) {
                    captured.headers[k.toLowerCase()] = v;
                }
            }
            return res;
        }),
        setHeader: vi.fn((key: string, val: string) => {
            captured.headers[key.toLowerCase()] = val;
            return res;
        }),
        send: vi.fn((value: unknown) => {
            captured.body = value;
            res.emit('finish');
            return res;
        }),
        end: vi.fn(() => {
            captured.ended = true;
            res.emit('finish');
            return res;
        }),
        headersSent: false,
    };
    return { res: res as unknown as Response, captured };
};

const basicAuth = (user: string, pass: string) =>
    `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

const noop = vi.fn();

const makeUser = async () => {
    const username = `webdav-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    const refreshed = (await server.stores.user.getById(created.id))!;
    return {
        userId: refreshed.id,
        username: refreshed.username,
        actor: {
            user: {
                id: refreshed.id,
                uuid: refreshed.uuid,
                username: refreshed.username,
            },
        },
    };
};

describe('WebDAVController', () => {
    describe('route registration', () => {
        it('registers a single catch-all use() route', () => {
            const router = new PuterRouter();
            controller.registerRoutes(router);
            expect(router.routes.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('authentication', () => {
        it('returns 401 when no auth is provided and no session actor', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(makeReq({ method: 'OPTIONS' }), res, noop);
            expect(captured.statusCode).toBe(401);
            expect(captured.headers['www-authenticate']).toContain('Basic');
        });

        it('returns 401 for malformed Basic auth (no colon)', async () => {
            const { res, captured } = makeRes();
            const encoded = Buffer.from('no-colon-here').toString('base64');
            await dispatchMiddleware(
                makeReq({
                    method: 'OPTIONS',
                    headers: { authorization: `Basic ${encoded}` },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(401);
        });

        it('returns 401 for invalid -token auth', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'OPTIONS',
                    headers: {
                        authorization: basicAuth('-token', 'bad-token-value'),
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(401);
        });

        it('returns 401 for non-existent username', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'OPTIONS',
                    headers: {
                        authorization: basicAuth(
                            'nonexistent-user-xyz',
                            'password',
                        ),
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(401);
        });
    });

    describe('OPTIONS (with session actor)', () => {
        it('returns 200 with DAV headers when actor is present', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'OPTIONS',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(200);
            expect(captured.headers['dav']).toContain('1');
            expect(captured.headers['allow']).toContain('PROPFIND');
            expect(captured.headers['allow']).toContain('GET');
            expect(captured.headers['allow']).toContain('PUT');
            expect(captured.headers['allow']).toContain('DELETE');
        });
    });

    describe('pending-verification gate', () => {
        // WebDAV must enforce the same gate every other authenticated route
        // gets from requireVerifiedAccount — it dispatches off a single use()
        // with no route options, so the middleware is never wired in and it
        // has to call assertVerifiedAccount itself. Without it, an account
        // still pending email/phone/card verification could read/write its
        // whole filesystem over the `dav` subdomain.
        const gatedActor = (flags: Record<string, unknown>) => ({
            user: {
                id: 1,
                uuid: 'gated-uuid',
                username: 'gated',
                ...flags,
            },
        });

        it('rejects a session actor pending phone verification with 403', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PROPFIND',
                    actor: gatedActor({ requires_phone_verification: true }),
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(403);
        });

        it('rejects a session actor pending card verification with 403', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'GET',
                    actor: gatedActor({ requires_card_verification: true }),
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(403);
        });

        it('rejects a session actor with an unconfirmed email with 403', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PROPFIND',
                    actor: gatedActor({
                        requires_email_confirmation: true,
                        email_confirmed: false,
                    }),
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(403);
        });

        it('enforces the gate on the Basic-auth path (flags carried onto the built actor)', async () => {
            const username = `webdav-gated-${Math.random()
                .toString(36)
                .slice(2, 10)}`;
            const created = await server.stores.user.create({
                username,
                uuid: uuidv4(),
                password: await bcryptHash('correct-horse', 4),
                email: `${username}@test.local`,
                free_storage: 100 * 1024 * 1024,
                requires_email_confirmation: false,
            });
            await server.stores.user.update(created.id, {
                requires_phone_verification: 1,
            });

            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PROPFIND',
                    headers: {
                        authorization: basicAuth(username, 'correct-horse'),
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(403);
        });

        it('lets a fully-verified session actor through the gate', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'OPTIONS',
                    actor: gatedActor({
                        requires_phone_verification: false,
                        requires_card_verification: false,
                        requires_email_confirmation: false,
                    }),
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(200);
        });
    });

    describe('suspension gate', () => {
        // WebDAV must also enforce the suspension gate every other authenticated
        // route gets from requireAuthGate. Same single-use() dispatch means that
        // middleware is never wired in, so #dispatch calls assertNotSuspended
        // itself. Without it, a suspended account could read/write/delete its
        // whole filesystem over the `dav` subdomain.
        it('rejects a suspended session actor with 403', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PROPFIND',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'suspended-uuid',
                            username: 'suspended',
                            suspended: true,
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(403);
        });

        it('rejects a suspended user on the Basic-auth path with 403', async () => {
            const username = `webdav-suspended-${Math.random()
                .toString(36)
                .slice(2, 10)}`;
            const created = await server.stores.user.create({
                username,
                uuid: uuidv4(),
                password: await bcryptHash('correct-horse', 4),
                email: `${username}@test.local`,
                free_storage: 100 * 1024 * 1024,
                requires_email_confirmation: false,
            });
            await server.stores.user.update(created.id, {
                suspended: 1,
            });

            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PROPFIND',
                    headers: {
                        authorization: basicAuth(username, 'correct-horse'),
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(403);
        });
    });

    describe('unsupported methods', () => {
        it('returns 405 for unknown HTTP methods', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PATCH',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(405);
            expect(captured.headers['allow']).toContain('PROPFIND');
        });
    });

    describe('GET', () => {
        it('returns 404 for a non-existent path', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'GET',
                    path: '/nonexistent-file-that-does-not-exist.txt',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(404);
        });
    });

    describe('PROPFIND', () => {
        it('returns 207 multistatus for root path', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PROPFIND',
                    path: '/',
                    headers: { depth: '0' },
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(207);
            expect(captured.headers['content-type']).toContain(
                'application/xml',
            );
            expect(captured.body).toContain('multistatus');
        });

        it('returns 404 for a non-existent path', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PROPFIND',
                    path: '/does-not-exist',
                    headers: { depth: '0' },
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(404);
        });

        it('includes DAV XML properties in the root PROPFIND response', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PROPFIND',
                    path: '/',
                    headers: { depth: '0' },
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            const xml = captured.body as string;
            expect(xml).toContain('<D:response>');
            expect(xml).toContain('<D:href>');
            expect(xml).toContain('<D:resourcetype>');
            expect(xml).toContain('<D:collection/>');
        });
    });

    describe('MKCOL', () => {
        it('rejects creating a collection at root', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'MKCOL',
                    path: '/',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(403);
        });

        it('rejects MKCOL with a body', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'MKCOL',
                    path: '/new-collection',
                    headers: { 'content-length': '10' },
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(415);
        });
    });

    describe('PUT', () => {
        it('rejects macOS junk files (.DS_Store)', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PUT',
                    path: '/some/dir/.DS_Store',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(422);
        });

        it('rejects macOS resource fork files (._prefix)', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'PUT',
                    path: '/some/dir/._myfile.txt',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(422);
        });

        it('emits GUI-safe item events without leaking numeric fsentry ids', async () => {
            const { actor, userId, username } = await makeUser();
            const target = `/${username}/Documents/webdav-event.txt`;
            const { res, captured } = makeRes();
            const req = Object.assign(
                Readable.from(['hello']),
                makeReq({
                    method: 'PUT',
                    path: target,
                    headers: { 'content-length': '5' },
                    actor,
                }),
            ) as Request;

            const emitSpy = vi.spyOn(server.clients.event, 'emit');
            let addedCall: (typeof emitSpy.mock.calls)[number] | undefined;
            try {
                await dispatchMiddleware(req, res, noop);
                await new Promise((resolve) => setTimeout(resolve, 0));
                addedCall = emitSpy.mock.calls.find(
                    ([eventName]) => eventName === 'outer.gui.item.added',
                );
            } finally {
                emitSpy.mockRestore();
            }

            expect(captured.statusCode).toBe(201);
            expect(addedCall).toBeTruthy();
            const payload = addedCall?.[1] as {
                user_id_list?: number[];
                response?: Record<string, unknown>;
            };
            expect(payload.user_id_list).toEqual([userId]);
            expect(payload.response).toMatchObject({
                id: expect.any(String),
                uid: expect.any(String),
                uuid: expect.any(String),
                path: target,
                from_new_service: true,
            });
            expect(typeof payload.response?.id).toBe('string');
            expect(payload.response?.id).toBe(payload.response?.uuid);
            expect(payload.response).not.toHaveProperty('userId');
        });
    });

    describe('DELETE', () => {
        it('rejects delete when ACL denies write access', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'DELETE',
                    path: '/nonexistent-file-to-delete.txt',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(403);
        });
    });

    describe('COPY', () => {
        it('returns 400 when Destination header is missing', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'COPY',
                    path: '/some/file.txt',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(400);
        });
    });

    describe('MOVE', () => {
        it('returns 400 when Destination header is missing', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'MOVE',
                    path: '/some/file.txt',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(400);
        });
    });

    describe('UNLOCK', () => {
        it('returns 400 when Lock-Token header is missing', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'UNLOCK',
                    path: '/some/file.txt',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(400);
        });

        it('returns 204 for an expired/unknown lock token (idempotent)', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'UNLOCK',
                    path: '/some/file.txt',
                    headers: {
                        'lock-token':
                            '<urn:uuid:00000000-0000-0000-0000-000000000099>',
                    },
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(204);
        });
    });

    describe('LOCK', () => {
        it('creates a new exclusive lock and returns XML with lock token', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'LOCK',
                    path: '/test/lockable-file.txt',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(200);
            expect(captured.headers['content-type']).toContain(
                'application/xml',
            );
            const xml = captured.body as string;
            expect(xml).toContain('lockdiscovery');
            expect(xml).toContain('urn:uuid:');
            expect(xml).toContain('<D:exclusive/>');
            expect(captured.headers['lock-token']).toContain('urn:uuid:');
        });

        it('rejects locking a path the user has no write access to (e.g. root)', async () => {
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'LOCK',
                    path: '/',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(403);
        });

        it('rejects a second exclusive lock on the same path', async () => {
            const uniquePath = `/test/double-lock-${Date.now()}.txt`;

            // First lock
            const { res: res1, captured: cap1 } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'LOCK',
                    path: uniquePath,
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res1,
                noop,
            );
            expect(cap1.statusCode).toBe(200);

            // Second lock — should be 423 Locked
            const { res: res2, captured: cap2 } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'LOCK',
                    path: uniquePath,
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res2,
                noop,
            );
            expect(cap2.statusCode).toBe(423);
        });

        it('refreshes an existing lock when If header provides the token', async () => {
            const uniquePath = `/test/refresh-lock-${Date.now()}.txt`;
            const { res: res1, captured: cap1 } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'LOCK',
                    path: uniquePath,
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res1,
                noop,
            );
            expect(cap1.statusCode).toBe(200);
            const lockToken = cap1.headers['lock-token']!.replace(/[<>]/g, '');

            // Refresh
            const { res: res2, captured: cap2 } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'LOCK',
                    path: uniquePath,
                    headers: { if: `(<${lockToken}>)` },
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res2,
                noop,
            );
            expect(cap2.statusCode).toBe(200);
            const xml = cap2.body as string;
            expect(xml).toContain(lockToken);
        });
    });

    describe('error handling', () => {
        it('catches HttpError and returns its status code', async () => {
            // GET on a non-existent file → HttpError(404) → 404 response
            const { res, captured } = makeRes();
            await dispatchMiddleware(
                makeReq({
                    method: 'GET',
                    path: '/no-such-file',
                    actor: {
                        user: {
                            id: 1,
                            uuid: 'test-uuid',
                            username: 'test',
                        },
                    },
                }),
                res,
                noop,
            );
            expect(captured.statusCode).toBe(404);
        });
    });
});

// -- Full-verb coverage -----------------------------------------------
//
// The suite above pins auth, gates and the cheap rejections. This one drives
// each verb against a real provisioned home directory so the success paths
// (and the 4xx selections between them) are exercised end to end.

describe('WebDAVController verbs', () => {
    /**
     * A response double that is also a Writable, so handlers that end with
     * `body.pipe(res)` (GET) work without a socket.
     */
    const makeStreamRes = () => {
        const chunks: Buffer[] = [];
        const captured = {
            statusCode: 200,
            headers: {} as Record<string, string>,
            body: undefined as unknown,
            ended: false,
            text: () => Buffer.concat(chunks).toString('utf8'),
        };
        const sink = new Writable({
            write(chunk, _encoding, callback) {
                chunks.push(Buffer.from(chunk as Buffer));
                callback();
            },
        });
        sink.on('finish', () => {
            captured.ended = true;
        });
        const res = Object.assign(sink, {
            status: (code: number) => {
                captured.statusCode = code;
                return res;
            },
            set: (key: Record<string, string> | string, value?: string) => {
                if (typeof key === 'string') {
                    captured.headers[key.toLowerCase()] = value!;
                } else {
                    for (const [k, v] of Object.entries(key)) {
                        captured.headers[k.toLowerCase()] = v;
                    }
                }
                return res;
            },
            setHeader: (key: string, value: string) => {
                captured.headers[key.toLowerCase()] = value;
                return res;
            },
            json: (value: unknown) => {
                captured.body = value;
                return res;
            },
            send: (value: unknown) => {
                captured.body = value;
                captured.ended = true;
                // End the underlying Writable so `finish` fires, as it does
                // on a real response. The DAV mount releases its concurrency
                // slot on that event — without it every `send()` path would
                // leak a slot and later requests would 429.
                if (!sink.writableEnded) sink.end();
                return res;
            },
            headersSent: false,
        });
        return { res: res as unknown as Response, captured };
    };

    const dispatch = async (
        init: Parameters<typeof makeReq>[0] & { content?: string },
    ) => {
        const { res, captured } = makeStreamRes();
        const base = makeReq(init);
        const req =
            init.content === undefined
                ? base
                : (Object.assign(
                      Readable.from([init.content]),
                      base,
                  ) as Request);
        await dispatchMiddleware(req, res, noop);
        // GUI events and stream pipes settle on the next tick.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return captured;
    };

    const putFile = async (
        actor: unknown,
        path: string,
        content: string,
    ): Promise<void> => {
        const captured = await dispatch({
            method: 'PUT',
            path,
            headers: { 'content-length': String(content.length) },
            actor,
            content,
        });
        if (captured.statusCode !== 201 && captured.statusCode !== 204) {
            throw new Error(
                `PUT ${path} failed with ${captured.statusCode}: ${String(captured.body)}`,
            );
        }
    };

    describe('GET / HEAD', () => {
        it('streams file bytes with a strong ETag and Last-Modified', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/get-me.txt`;
            await putFile(actor, path, 'webdav-body');

            const captured = await dispatch({ method: 'GET', path, actor });
            expect(captured.statusCode).toBe(200);
            expect(captured.text()).toBe('webdav-body');
            expect(captured.headers['accept-ranges']).toBe('bytes');
            expect(captured.headers['content-length']).toBe('11');
            expect(captured.headers.etag).toMatch(/^"[0-9a-f-]+-\d+"$/);
            expect(captured.headers['last-modified']).toEqual(
                expect.any(String),
            );
        });

        it('answers HEAD with the headers and no body', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/head-me.txt`;
            await putFile(actor, path, 'abcd');

            const captured = await dispatch({ method: 'HEAD', path, actor });
            expect(captured.statusCode).toBe(200);
            expect(captured.text()).toBe('');
            expect(captured.headers['content-length']).toBe('4');
        });

        it('serves a byte range as 206 with Content-Range', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/ranged.txt`;
            await putFile(actor, path, '0123456789');

            const captured = await dispatch({
                method: 'GET',
                path,
                actor,
                headers: { range: 'bytes=2-5' },
            });
            expect(captured.statusCode).toBe(206);
            expect(captured.headers['content-range']).toBe('bytes 2-5/10');
            expect(captured.text()).toBe('2345');
        });

        it('refuses to GET a directory', async () => {
            const { actor, username } = await makeUser();
            const captured = await dispatch({
                method: 'GET',
                path: `/${username}/Documents`,
                actor,
            });
            expect(captured.statusCode).toBe(400);
            expect(captured.body).toBe('Cannot GET a directory');
        });

        it("denies reading another user's file with 403", async () => {
            const owner = await makeUser();
            const stranger = await makeUser();
            const path = `/${owner.username}/Documents/private.txt`;
            await putFile(owner.actor, path, 'secret');

            const captured = await dispatch({
                method: 'GET',
                path,
                actor: stranger.actor,
            });
            expect(captured.statusCode).toBe(403);
            expect(captured.body).toBe('Permission denied');
        });
    });

    describe('PROPFIND', () => {
        it('lists direct children at the default depth', async () => {
            const { actor, username } = await makeUser();
            await putFile(
                actor,
                `/${username}/Documents/propfind-child.txt`,
                'x',
            );

            const captured = await dispatch({
                method: 'PROPFIND',
                path: `/${username}/Documents`,
                actor,
            });
            expect(captured.statusCode).toBe(207);
            const xml = captured.body as string;
            expect(xml).toContain(`<D:href>/${username}/Documents/</D:href>`);
            expect(xml).toContain('propfind-child.txt');
            // A file child carries the two file-only properties.
            expect(xml).toContain('<D:getcontentlength>1</D:getcontentlength>');
            expect(xml).toContain(
                '<D:getcontenttype>text/plain</D:getcontenttype>',
            );
        });

        it('omits children at depth 0', async () => {
            const { actor, username } = await makeUser();
            await putFile(actor, `/${username}/Documents/hidden.txt`, 'x');

            const captured = await dispatch({
                method: 'PROPFIND',
                path: `/${username}/Documents`,
                actor,
                headers: { depth: '0' },
            });
            expect(captured.statusCode).toBe(207);
            expect(captured.body as string).not.toContain('hidden.txt');
        });

        it("lists the caller's home directory under the root collection", async () => {
            const { actor, username } = await makeUser();
            const captured = await dispatch({
                method: 'PROPFIND',
                path: '/',
                actor,
            });
            expect(captured.statusCode).toBe(207);
            expect(captured.body as string).toContain(
                `<D:href>/${username}/</D:href>`,
            );
        });

        it('describes a single file when asked for one', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/single.md`;
            await putFile(actor, path, 'hello');

            const captured = await dispatch({
                method: 'PROPFIND',
                path,
                actor,
            });
            expect(captured.statusCode).toBe(207);
            const xml = captured.body as string;
            expect(xml).toContain('<D:resourcetype></D:resourcetype>');
            expect(xml).toContain(
                '<D:getcontenttype>text/markdown</D:getcontenttype>',
            );
        });
    });

    describe('PROPPATCH', () => {
        it('acknowledges a property update with 207', async () => {
            const { actor, username } = await makeUser();
            const captured = await dispatch({
                method: 'PROPPATCH',
                path: `/${username}/Documents`,
                actor,
            });
            expect(captured.statusCode).toBe(207);
            expect(captured.body as string).toContain('HTTP/1.1 200 OK');
        });
    });

    describe('MKCOL', () => {
        it('creates a collection and reports its Location', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/new-collection`;
            const captured = await dispatch({ method: 'MKCOL', path, actor });
            expect(captured.statusCode).toBe(201);
            expect(captured.headers.location).toBe(`${path}/`);
            const entry = await server.stores.fsEntry.getEntryByPath(path);
            expect(entry?.isDir).toBe(true);
        });

        it('returns 405 when the collection already exists', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/twice`;
            expect(
                (await dispatch({ method: 'MKCOL', path, actor })).statusCode,
            ).toBe(201);
            const second = await dispatch({ method: 'MKCOL', path, actor });
            expect(second.statusCode).toBe(405);
            expect(second.body).toBe('Already exists');
        });

        it("denies creating a collection in another user's home", async () => {
            const owner = await makeUser();
            const stranger = await makeUser();
            const captured = await dispatch({
                method: 'MKCOL',
                path: `/${owner.username}/Documents/intruder`,
                actor: stranger.actor,
            });
            expect(captured.statusCode).toBe(403);
        });
    });

    describe('PUT', () => {
        it('creates with 201 and overwrites with 204', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/put-twice.txt`;

            const created = await dispatch({
                method: 'PUT',
                path,
                headers: { 'content-length': '3' },
                actor,
                content: 'one',
            });
            expect(created.statusCode).toBe(201);
            expect(created.headers.etag).toEqual(expect.any(String));

            const replaced = await dispatch({
                method: 'PUT',
                path,
                headers: { 'content-length': '5' },
                actor,
                content: 'three',
            });
            expect(replaced.statusCode).toBe(204);
            expect(
                (await server.stores.fsEntry.getEntryByPath(path))?.size,
            ).toBe(5);
        });

        it('answers an Expect: 100-continue handshake on the socket', async () => {
            const { actor, username } = await makeUser();
            const written: string[] = [];
            const captured = await dispatch({
                method: 'PUT',
                path: `/${username}/Documents/expect.txt`,
                headers: {
                    'content-length': '2',
                    expect: '100-continue',
                },
                actor,
                content: 'hi',
                socket: { write: (chunk: string) => written.push(chunk) },
            });
            expect(captured.statusCode).toBe(201);
            expect(written).toEqual(['HTTP/1.1 100 Continue\r\n\r\n']);
        });

        it('falls back to X-Expected-Entity-Length when Content-Length is absent', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/finder-style.txt`;
            const captured = await dispatch({
                method: 'PUT',
                path,
                headers: { 'x-expected-entity-length': '4' },
                actor,
                content: 'macs',
            });
            expect(captured.statusCode).toBe(201);
            expect(
                (await server.stores.fsEntry.getEntryByPath(path))?.size,
            ).toBe(4);
        });
    });

    describe('DELETE', () => {
        it('removes an existing entry with 204', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/delete-me.txt`;
            await putFile(actor, path, 'bye');

            const captured = await dispatch({ method: 'DELETE', path, actor });
            expect(captured.statusCode).toBe(204);
            expect(await server.stores.fsEntry.getEntryByPath(path)).toBeNull();
        });

        it('returns 404 for a path the caller may write but that does not exist', async () => {
            const { actor, username } = await makeUser();
            const captured = await dispatch({
                method: 'DELETE',
                path: `/${username}/Documents/never-existed.txt`,
                actor,
            });
            expect(captured.statusCode).toBe(404);
            expect(captured.body).toBe('Not Found');
        });
    });

    describe('COPY', () => {
        it('copies a file to a new destination with 201', async () => {
            const { actor, username } = await makeUser();
            const source = `/${username}/Documents/copy-src.txt`;
            const destination = `/${username}/Documents/copy-dst.txt`;
            await putFile(actor, source, 'copied');

            const captured = await dispatch({
                method: 'COPY',
                path: source,
                actor,
                headers: { destination, host: 'dav.puter.localhost' },
            });
            expect(captured.statusCode).toBe(201);
            expect(
                await server.stores.fsEntry.getEntryByPath(destination),
            ).not.toBeNull();
            expect(
                await server.stores.fsEntry.getEntryByPath(source),
            ).not.toBeNull();
        });

        it('accepts an absolute-URL Destination header', async () => {
            const { actor, username } = await makeUser();
            const source = `/${username}/Documents/copy-abs-src.txt`;
            const destination = `/${username}/Documents/copy-abs-dst.txt`;
            await putFile(actor, source, 'abs');

            const captured = await dispatch({
                method: 'COPY',
                path: source,
                actor,
                headers: {
                    destination: `http://dav.puter.localhost${destination}`,
                    host: 'dav.puter.localhost',
                },
            });
            expect(captured.statusCode).toBe(201);
            expect(
                await server.stores.fsEntry.getEntryByPath(destination),
            ).not.toBeNull();
        });

        it('returns 204 when overwriting an existing destination', async () => {
            const { actor, username } = await makeUser();
            const source = `/${username}/Documents/copy-over-src.txt`;
            const destination = `/${username}/Documents/copy-over-dst.txt`;
            await putFile(actor, source, 'fresh');
            await putFile(actor, destination, 'stale');

            const captured = await dispatch({
                method: 'COPY',
                path: source,
                actor,
                headers: { destination, host: 'dav.puter.localhost' },
            });
            expect(captured.statusCode).toBe(204);
        });

        it('returns 412 when the destination exists and Overwrite is F', async () => {
            const { actor, username } = await makeUser();
            const source = `/${username}/Documents/copy-nf-src.txt`;
            const destination = `/${username}/Documents/copy-nf-dst.txt`;
            await putFile(actor, source, 'a');
            await putFile(actor, destination, 'b');

            const captured = await dispatch({
                method: 'COPY',
                path: source,
                actor,
                headers: {
                    destination,
                    overwrite: 'F',
                    host: 'dav.puter.localhost',
                },
            });
            expect(captured.statusCode).toBe(412);
            expect(captured.body).toBe('Destination exists and Overwrite=F');
        });

        it('returns 404 when the source is missing', async () => {
            const { actor, username } = await makeUser();
            const captured = await dispatch({
                method: 'COPY',
                path: `/${username}/Documents/no-source.txt`,
                actor,
                headers: {
                    destination: `/${username}/Documents/anywhere.txt`,
                    host: 'dav.puter.localhost',
                },
            });
            expect(captured.statusCode).toBe(404);
            expect(captured.body).toBe('Source not found');
        });

        it('returns 409 when the destination parent is not a directory', async () => {
            const { actor, username } = await makeUser();
            const source = `/${username}/Documents/copy-409-src.txt`;
            const blocker = `/${username}/Documents/not-a-dir.txt`;
            await putFile(actor, source, 'a');
            await putFile(actor, blocker, 'b');

            const captured = await dispatch({
                method: 'COPY',
                path: source,
                actor,
                headers: {
                    destination: `${blocker}/child.txt`,
                    host: 'dav.puter.localhost',
                },
            });
            expect(captured.statusCode).toBe(409);
        });
    });

    describe('MOVE', () => {
        it('relocates the entry and leaves nothing behind', async () => {
            const { actor, username } = await makeUser();
            const source = `/${username}/Documents/move-src.txt`;
            const destination = `/${username}/Documents/move-dst.txt`;
            await putFile(actor, source, 'moving');

            const captured = await dispatch({
                method: 'MOVE',
                path: source,
                actor,
                headers: { destination, host: 'dav.puter.localhost' },
            });
            expect(captured.statusCode).toBe(201);
            expect(
                await server.stores.fsEntry.getEntryByPath(source),
            ).toBeNull();
            expect(
                await server.stores.fsEntry.getEntryByPath(destination),
            ).not.toBeNull();
        });

        it('returns 412 when the destination exists and Overwrite is F', async () => {
            const { actor, username } = await makeUser();
            const source = `/${username}/Documents/move-nf-src.txt`;
            const destination = `/${username}/Documents/move-nf-dst.txt`;
            await putFile(actor, source, 'a');
            await putFile(actor, destination, 'b');

            const captured = await dispatch({
                method: 'MOVE',
                path: source,
                actor,
                headers: {
                    destination,
                    overwrite: 'F',
                    host: 'dav.puter.localhost',
                },
            });
            expect(captured.statusCode).toBe(412);
        });

        it('returns 404 when the source is missing', async () => {
            const { actor, username } = await makeUser();
            const captured = await dispatch({
                method: 'MOVE',
                path: `/${username}/Documents/gone.txt`,
                actor,
                headers: {
                    destination: `/${username}/Documents/elsewhere.txt`,
                    host: 'dav.puter.localhost',
                },
            });
            expect(captured.statusCode).toBe(404);
            expect(captured.body).toBe('Source not found');
        });

        it("denies moving into another user's home", async () => {
            const owner = await makeUser();
            const stranger = await makeUser();
            const source = `/${stranger.username}/Documents/mine.txt`;
            await putFile(stranger.actor, source, 'x');

            const captured = await dispatch({
                method: 'MOVE',
                path: source,
                actor: stranger.actor,
                headers: {
                    destination: `/${owner.username}/Documents/yours.txt`,
                    host: 'dav.puter.localhost',
                },
            });
            expect(captured.statusCode).toBe(403);
        });
    });

    describe('locking interaction', () => {
        const lockPath = async (actor: unknown, path: string) => {
            const captured = await dispatch({ method: 'LOCK', path, actor });
            expect(captured.statusCode).toBe(200);
            const token = /<D:href>(urn:uuid:[0-9a-f-]+)<\/D:href>/.exec(
                captured.body as string,
            )?.[1];
            expect(token).toBeTruthy();
            return { token: token!, headers: captured.headers };
        };

        it('advertises the lock token in the Lock-Token header', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/lock-header.txt`;
            const { token, headers } = await lockPath(actor, path);
            expect(headers['lock-token']).toBe(`<${token}>`);
        });

        it('grants a shared lock when the body asks for one', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/shared-lock.txt`;
            const captured = await dispatch({
                method: 'LOCK',
                path,
                actor,
                body: { lockinfo: { lockscope: { shared: {} } } },
            });
            expect(captured.statusCode).toBe(200);
            expect(captured.body as string).toContain('<D:shared/>');
        });

        it('allows a second shared lock on the same path', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/shared-twice.txt`;
            const body = { lockinfo: { lockscope: { shared: {} } } };
            expect(
                (await dispatch({ method: 'LOCK', path, actor, body }))
                    .statusCode,
            ).toBe(200);
            expect(
                (await dispatch({ method: 'LOCK', path, actor, body }))
                    .statusCode,
            ).toBe(200);
        });

        it('returns 412 when refreshing an unknown lock token', async () => {
            const { actor, username } = await makeUser();
            const captured = await dispatch({
                method: 'LOCK',
                path: `/${username}/Documents/refresh-unknown.txt`,
                actor,
                headers: {
                    if: '(<urn:uuid:22222222-2222-2222-2222-222222222222>)',
                },
            });
            expect(captured.statusCode).toBe(412);
            expect(captured.body).toBe('Lock token not found');
        });

        it('blocks PUT, DELETE, MKCOL and PROPPATCH on a locked path with 423', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/locked-target.txt`;
            await putFile(actor, path, 'v1');
            await lockPath(actor, path);

            for (const method of ['PUT', 'DELETE', 'PROPPATCH']) {
                const captured = await dispatch({
                    method,
                    path,
                    actor,
                    headers: { 'content-length': '2' },
                    ...(method === 'PUT' ? { content: 'v2' } : {}),
                });
                expect(captured.statusCode).toBe(423);
                expect(captured.body).toBe('Locked');
            }

            const collection = `/${username}/Documents/locked-collection`;
            await lockPath(actor, collection);
            const mkcol = await dispatch({
                method: 'MKCOL',
                path: collection,
                actor,
            });
            expect(mkcol.statusCode).toBe(423);
        });

        it('lets the lock holder write through with its If token', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/lock-and-write.txt`;
            await putFile(actor, path, 'v1');
            const { token } = await lockPath(actor, path);

            const captured = await dispatch({
                method: 'PUT',
                path,
                actor,
                headers: {
                    'content-length': '2',
                    if: `(<${token}>)`,
                },
                content: 'v2',
            });
            expect(captured.statusCode).toBe(204);
        });

        it('blocks COPY onto a locked destination with 423', async () => {
            const { actor, username } = await makeUser();
            const source = `/${username}/Documents/copy-locked-src.txt`;
            const destination = `/${username}/Documents/copy-locked-dst.txt`;
            await putFile(actor, source, 'a');
            await lockPath(actor, destination);

            const captured = await dispatch({
                method: 'COPY',
                path: source,
                actor,
                headers: { destination, host: 'dav.puter.localhost' },
            });
            expect(captured.statusCode).toBe(423);
        });

        it('releases the lock on UNLOCK and lets writes through again', async () => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/unlock-me.txt`;
            await putFile(actor, path, 'v1');
            const { token } = await lockPath(actor, path);

            const unlocked = await dispatch({
                method: 'UNLOCK',
                path,
                actor,
                headers: { 'lock-token': `<${token}>` },
            });
            expect(unlocked.statusCode).toBe(204);

            const written = await dispatch({
                method: 'PUT',
                path,
                actor,
                headers: { 'content-length': '2' },
                content: 'v2',
            });
            expect(written.statusCode).toBe(204);
        });

        it('refuses to UNLOCK a token minted for a different path', async () => {
            const { actor, username } = await makeUser();
            const locked = `/${username}/Documents/other-lock.txt`;
            const { token } = await lockPath(actor, locked);

            const captured = await dispatch({
                method: 'UNLOCK',
                path: `/${username}/Documents/somewhere-else.txt`,
                actor,
                headers: { 'lock-token': `<${token}>` },
            });
            expect(captured.statusCode).toBe(403);
            expect(captured.body).toBe('Lock token does not match this path');
        });
    });
});
