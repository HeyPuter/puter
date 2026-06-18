// This suite tests basic features of puter webdav. it is not a comprehensive webdav test suite unlike litmus 
// but rather it performs some common sense checks to ensure that WebDAV support isn't irrevocably broken in puter
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
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
    const res = {
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
            return res;
        }),
        end: vi.fn(() => {
            captured.ended = true;
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
            await dispatchMiddleware(
                makeReq({ method: 'OPTIONS' }),
                res,
                noop,
            );
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
            let addedCall:
                | (typeof emitSpy.mock.calls)[number]
                | undefined;
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
            const lockToken = cap1.headers['lock-token']!.replace(
                /[<>]/g,
                '',
            );

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
