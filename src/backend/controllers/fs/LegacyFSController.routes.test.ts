/**
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

import type { Request, RequestHandler, Response } from 'express';
import { Readable, Writable } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { signFile } from '../../util/fileSigning.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { LegacyFSController } from './LegacyFSController.js';

// Second suite for the v1 FS shim: the signed-URL routes, the multipart
// `/batch` parser, and the small inline handlers registered straight onto
// the router. `LegacyFSController.test.ts` covers the direct-handler core.

let server: PuterServer;
let controller: LegacyFSController;
let routes: PuterRouter['routes'];

beforeAll(async () => {
    server = await setupTestServer();
    controller = server.controllers.legacyFs as unknown as LegacyFSController;
    const router = new PuterRouter();
    controller.registerRoutes(router);
    routes = router.routes;

    const config = (
        controller as unknown as {
            config: { api_base_url?: string; url_signature_secret?: string };
        }
    ).config;
    config.api_base_url ??= 'http://api.test.local';
    config.url_signature_secret ??= 'test-signing-secret';
});

afterAll(async () => {
    await server?.shutdown();
});

const routeHandler = (method: string, path: string): RequestHandler => {
    const route = routes.find(
        (candidate) =>
            candidate.path === path &&
            String(candidate.method).toLowerCase() === method.toLowerCase(),
    );
    if (!route) throw new Error(`Route not registered: ${method} ${path}`);
    return route.handler as RequestHandler;
};

const signingCfg = () => {
    const config = (
        controller as unknown as {
            config: { api_base_url: string; url_signature_secret: string };
        }
    ).config;
    return {
        secret: config.url_signature_secret,
        apiBaseUrl: config.api_base_url,
    };
};

const makeUser = async (): Promise<{
    actor: Actor;
    userId: number;
    username: string;
}> => {
    const username = `lfr-${Math.random().toString(36).slice(2, 10)}`;
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
                email: refreshed.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        },
    };
};

interface CapturedResponse {
    statusCode: number;
    body: unknown;
    sentText: string | undefined;
    headers: Map<string, string>;
}

const makeReq = (init: {
    body?: unknown;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
    actor?: Actor;
}): Request =>
    ({
        body: init.body ?? {},
        query: init.query ?? {},
        headers: init.headers ?? {},
        actor: init.actor,
    }) as unknown as Request;

const makeRes = () => {
    const captured: CapturedResponse = {
        statusCode: 200,
        body: undefined,
        sentText: undefined,
        headers: new Map(),
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
        send: vi.fn((value: unknown) => {
            captured.sentText = String(value ?? '');
            return res;
        }),
        setHeader: vi.fn((key: string, value: string) => {
            captured.headers.set(key.toLowerCase(), String(value));
            return res;
        }),
    };
    return { res: res as unknown as Response, captured };
};

/** A response double that is also a Writable, for the streaming routes. */
const makeStreamRes = () => {
    const chunks: Buffer[] = [];
    const captured = {
        statusCode: 200,
        headers: new Map<string, string>(),
        body: undefined as unknown,
        text: () => Buffer.concat(chunks).toString('utf8'),
    };
    const sink = new Writable({
        write(chunk, _encoding, callback) {
            chunks.push(Buffer.from(chunk as Buffer));
            callback();
        },
    });
    const res = Object.assign(sink, {
        status: (code: number) => {
            captured.statusCode = code;
            return res;
        },
        setHeader: (key: string, value: string) => {
            captured.headers.set(key.toLowerCase(), String(value));
            return res;
        },
        json: (value: unknown) => {
            captured.body = value;
            return res;
        },
        send: (value: unknown) => {
            captured.body = value;
            return res;
        },
    });
    const finished = new Promise<void>((resolve) => sink.on('finish', resolve));
    return { res: res as unknown as Response, captured, finished };
};

const withActor = async <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

const writeFileEntry = async (
    actor: Actor,
    path: string,
    content: string,
): Promise<{ uuid: string }> => {
    const response = await server.services.fs.write(actor.user!.id!, {
        fileMetadata: {
            path,
            size: content.length,
            contentType: 'text/plain',
            createMissingParents: true,
            overwrite: true,
        },
        fileContent: content,
    } as never);
    return { uuid: response.fsEntry.uuid };
};

// -- multipart helper --------------------------------------------------

type MultipartPart =
    | { kind: 'field'; name: string; value: string }
    | {
          kind: 'file';
          name: string;
          filename: string;
          content: string;
          mimeType?: string;
      };

const multipartReq = (
    parts: MultipartPart[],
    init: { actor: Actor; query?: Record<string, unknown>; body?: unknown },
): Request => {
    const boundary = '----legacyFsRoutesBoundary';
    const chunks: string[] = [];
    for (const part of parts) {
        chunks.push(`--${boundary}\r\n`);
        if (part.kind === 'field') {
            chunks.push(
                `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
            );
        } else {
            chunks.push(
                `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
                    `Content-Type: ${part.mimeType ?? 'application/octet-stream'}\r\n\r\n` +
                    `${part.content}\r\n`,
            );
        }
    }
    chunks.push(`--${boundary}--\r\n`);
    const req = Readable.from([
        Buffer.from(chunks.join(''), 'utf8'),
    ]) as unknown as Request;
    Object.assign(req, {
        headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        query: init.query ?? {},
        body: init.body ?? {},
        actor: init.actor,
    });
    return req;
};

// -- Inline router handlers -------------------------------------------

describe('LegacyFSController inline routes', () => {
    it('reports /itemMetadata as gone', async () => {
        const { res, captured } = makeRes();
        await routeHandler('get', '/itemMetadata')(
            makeReq({}),
            res,
            (() => {}) as never,
        );
        expect(captured.statusCode).toBe(410);
        expect(captured.body).toEqual({
            error: 'itemMetadata is deprecated; use /fs/stat',
        });
    });

    it('returns an empty recents list for an unauthenticated request', async () => {
        const { res, captured } = makeRes();
        await routeHandler('get', '/get-launch-apps')(
            makeReq({}),
            res,
            (() => {}) as never,
        );
        expect(captured.body).toMatchObject({ recent: [] });
    });

    it('lists recently opened apps most-recent-first with launch metadata', async () => {
        const { actor, userId } = await makeUser();
        const app = (await (
            server.stores.app.create as unknown as (
                fields: Record<string, unknown>,
                opts: { ownerUserId: number },
            ) => Promise<{ uid: string; name: string }>
        )(
            {
                name: `recent-${uuidv4()}`,
                title: 'Recent App',
                index_url: 'https://recent.example.test/',
            },
            { ownerUserId: userId },
        ))!;
        await server.clients.db.write(
            'INSERT INTO `app_opens` (`app_uid`, `user_id`, `ts`) VALUES (?, ?, ?)',
            [app.uid, userId, Math.floor(Date.now() / 1000)],
        );

        const { res, captured } = makeRes();
        await routeHandler('get', '/get-launch-apps')(
            makeReq({ actor }),
            res,
            (() => {}) as never,
        );
        const body = captured.body as {
            recent: Array<Record<string, unknown>>;
        };
        expect(body.recent.map((entry) => entry.uuid)).toContain(app.uid);
        const entry = body.recent.find((item) => item.uuid === app.uid)!;
        expect(entry.name).toBe(app.name);
        expect(entry.external).toBe(false);
        // Owner ids are internal and must not ride along.
        expect(entry).not.toHaveProperty('owner_user_id');
    });

    it('reports a zero cache timestamp when unauthenticated', async () => {
        const { res, captured } = makeRes();
        await routeHandler('get', '/cache/last-change-timestamp')(
            makeReq({}),
            res,
            (() => {}) as never,
        );
        expect(captured.body).toEqual({ timestamp: 0 });
    });

    it('reports a numeric cache timestamp for a signed-in user', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await routeHandler('get', '/cache/last-change-timestamp')(
            makeReq({ actor }),
            res,
            (() => {}) as never,
        );
        expect(typeof (captured.body as { timestamp: number }).timestamp).toBe(
            'number',
        );
    });
});

// -- readdir-subdomains + thumbnails ----------------------------------

describe('LegacyFSController.readdirSubdomains', () => {
    it('returns the caller-owned subdomain rows', async () => {
        const { actor, userId } = await makeUser();
        await server.clients.db.write(
            'INSERT INTO `subdomains` (`uuid`, `subdomain`, `user_id`) VALUES (?, ?, ?)',
            [uuidv4(), `sd-${Math.random().toString(36).slice(2, 8)}`, userId],
        );
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.readdirSubdomains(makeReq({ actor }), res),
        );
        expect((captured.body as unknown[]).length).toBe(1);
    });

    it('returns nothing for an app-under-user actor', async () => {
        const { actor, userId } = await makeUser();
        await server.clients.db.write(
            'INSERT INTO `subdomains` (`uuid`, `subdomain`, `user_id`) VALUES (?, ?, ?)',
            [uuidv4(), `sd-${Math.random().toString(36).slice(2, 8)}`, userId],
        );
        const appActor = makeActor({ ...actor, app: { uid: `app-${uuidv4()}` } });
        const { res, captured } = makeRes();
        await withActor(appActor, () =>
            controller.readdirSubdomains(makeReq({ actor: appActor }), res),
        );
        expect(captured.body).toEqual([]);
    });
});

describe('LegacyFSController.updateFsentryThumbnail', () => {
    it('rejects a missing uid', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.updateFsentryThumbnail(
                    makeReq({
                        body: { thumbnail: 'data:image/png;base64,AA' },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400, message: 'Missing `uid`' });
    });

    it('rejects a missing thumbnail', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.updateFsentryThumbnail(
                    makeReq({ body: { uid: uuidv4() }, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Missing `thumbnail`',
        });
    });

    it('refuses a storage pointer in place of inline image data', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        // Accepting a pointer would let a caller name an object the server
        // then signs reads of on their behalf.
        await expect(
            withActor(actor, () =>
                controller.updateFsentryThumbnail(
                    makeReq({
                        body: { uid: uuidv4(), thumbnail: 's3://bucket/key' },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: '`thumbnail` must be a data: URL',
        });
    });

    it('404s an unknown uid', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.updateFsentryThumbnail(
                    makeReq({
                        body: {
                            uid: uuidv4(),
                            thumbnail: 'data:image/png;base64,AA',
                        },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
        });
    });

    it('stores the thumbnail on an entry the caller can write', async () => {
        const { actor, username } = await makeUser();
        const path = `/${username}/Documents/thumbnailed.txt`;
        const { uuid } = await writeFileEntry(actor, path, 'body');

        const thumbnail = 'data:image/png;base64,aGVsbG8=';
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.updateFsentryThumbnail(
                makeReq({ body: { uid: uuid, thumbnail }, actor }),
                res,
            ),
        );
        expect(captured.body).toEqual({ thumbnail });
        // The handler writes the column directly, so read it back from the
        // database rather than through the (cached) entry store.
        const [row] = (await server.clients.db.read(
            'SELECT `thumbnail` FROM `fsentries` WHERE `uuid` = ?',
            [uuid],
        )) as Array<{ thumbnail: string | null }>;
        expect(row?.thumbnail).toBe(thumbnail);
    });

    it("refuses to retag another user's entry", async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const path = `/${owner.username}/Documents/owned.txt`;
        const { uuid } = await writeFileEntry(owner.actor, path, 'body');

        const { res } = makeRes();
        await expect(
            withActor(stranger.actor, () =>
                controller.updateFsentryThumbnail(
                    makeReq({
                        body: {
                            uid: uuid,
                            thumbnail: 'data:image/png;base64,AA',
                        },
                        actor: stranger.actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

// -- suggest_apps / touch / readdir edges ------------------------------

describe('LegacyFSController.suggestApps', () => {
    it('returns suggestions for a resolvable entry', async () => {
        const { actor, username } = await makeUser();
        const path = `/${username}/Documents/suggest.txt`;
        await writeFileEntry(actor, path, 'x');
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.suggestApps(makeReq({ body: { path }, actor }), res),
        );
        expect(Array.isArray(captured.body)).toBe(true);
    });

    it('swallows an unresolvable selector and still answers', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.suggestApps(
                makeReq({ body: { uid: uuidv4() }, actor }),
                res,
            ),
        );
        expect(Array.isArray(captured.body)).toBe(true);
    });
});

describe('LegacyFSController.touch validation', () => {
    it('rejects a missing path', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.touch(makeReq({ body: {}, actor }), res),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: '`path` is required',
        });
    });
});

describe('LegacyFSController.readdir envelopes', () => {
    it('wraps the root listing and reports a total when asked', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.readdir(
                makeReq({ body: { path: '/', includeTotal: true }, actor }),
                res,
            ),
        );
        const body = captured.body as { items: unknown[]; total: number };
        expect(Array.isArray(body.items)).toBe(true);
        expect(body.total).toBe(body.items.length);
    });

    it('honors sort_by / sort_order aliases', async () => {
        const { actor, username } = await makeUser();
        const dir = `/${username}/Documents/sorted-${Date.now()}`;
        for (const name of ['b.txt', 'a.txt', 'c.txt']) {
            await writeFileEntry(actor, `${dir}/${name}`, name);
        }
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.readdir(
                makeReq({
                    body: { path: dir, sort_by: 'NAME', sort_order: 'DESC' },
                    actor,
                }),
                res,
            ),
        );
        const names = (captured.body as Array<{ name: string }>).map(
            (entry) => entry.name,
        );
        expect(names).toEqual(['c.txt', 'b.txt', 'a.txt']);
    });
});

describe('LegacyFSController.mkdir parent selectors', () => {
    it('resolves a `parent` object selector before joining the relative path', async () => {
        const { actor, username } = await makeUser();
        const parent = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents`,
        );
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({
                    body: { parent: { uid: parent!.uuid }, path: 'from-uid' },
                    actor,
                }),
                res,
            ),
        );
        expect((captured.body as { path: string }).path).toBe(
            `/${username}/Documents/from-uid`,
        );
    });
});

// -- /file (signed read) ----------------------------------------------

describe('LegacyFSController.file (signed streaming)', () => {
    const signedQuery = async (actor: Actor, path: string, content: string) => {
        await writeFileEntry(actor, path, content);
        const entry = (await server.stores.fsEntry.getEntryByPath(path))!;
        const url = new URL(signFile(entry as never, signingCfg()).read_url);
        return {
            entry,
            query: {
                uid: url.searchParams.get('uid')!,
                expires: url.searchParams.get('expires')!,
                signature: url.searchParams.get('signature')!,
            },
        };
    };

    it('streams the bytes inline with content headers', async () => {
        const { actor, username } = await makeUser();
        const { query } = await signedQuery(
            actor,
            `/${username}/Documents/signed-read.txt`,
            'signed-bytes',
        );
        const { res, captured, finished } = makeStreamRes();
        await withActor(actor, () =>
            controller.file(makeReq({ query, actor }), res),
        );
        await finished;
        expect(captured.statusCode).toBe(200);
        expect(captured.text()).toBe('signed-bytes');
        expect(captured.headers.get('content-disposition')).toContain('inline');
        expect(captured.headers.get('content-length')).toBe('12');
    });

    it('serves a byte range as 206', async () => {
        const { actor, username } = await makeUser();
        const { query } = await signedQuery(
            actor,
            `/${username}/Documents/signed-range.txt`,
            '0123456789',
        );
        const { res, captured, finished } = makeStreamRes();
        await withActor(actor, () =>
            controller.file(
                makeReq({ query, actor, headers: { range: 'bytes=0-3' } }),
                res,
            ),
        );
        await finished;
        expect(captured.statusCode).toBe(206);
        expect(captured.headers.get('content-range')).toBe('bytes 0-3/10');
        expect(captured.text()).toBe('0123');
    });

    it('switches to an attachment disposition when download is requested', async () => {
        const { actor, username } = await makeUser();
        const { query } = await signedQuery(
            actor,
            `/${username}/Documents/signed-download.txt`,
            'dl',
        );
        const { res, captured, finished } = makeStreamRes();
        await withActor(actor, () =>
            controller.file(
                makeReq({ query: { ...query, download: 'true' }, actor }),
                res,
            ),
        );
        await finished;
        expect(captured.headers.get('content-disposition')).toContain(
            'attachment',
        );
    });

    it('rejects a signature minted before the owner was suspended', async () => {
        const { actor, userId, username } = await makeUser();
        const { query } = await signedQuery(
            actor,
            `/${username}/Documents/suspended.txt`,
            'x',
        );
        await server.stores.user.update(userId, { suspended: true });
        const { res } = makeStreamRes();
        await expect(
            withActor(actor, () =>
                controller.file(makeReq({ query, actor }), res),
            ),
        ).rejects.toMatchObject({
            statusCode: 401,
            legacyCode: 'account_suspended',
        });
    });
});

// -- /writeFile operation dispatch -------------------------------------

describe('LegacyFSController.writeFile operations', () => {
    const signedFor = async (path: string) => {
        const entry = (await server.stores.fsEntry.getEntryByPath(path))!;
        const url = new URL(signFile(entry as never, signingCfg()).write_url!);
        return {
            entry,
            query: {
                uid: url.searchParams.get('uid')!,
                expires: url.searchParams.get('expires')!,
                signature: url.searchParams.get('signature')!,
            },
        };
    };

    const runOperation = async (
        actor: Actor,
        path: string,
        operation: string,
        body: Record<string, unknown> = {},
    ) => {
        const { query } = await signedFor(path);
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.writeFile(
                makeReq({ query: { ...query, operation }, body, actor }),
                res,
            ),
        );
        return captured;
    };

    it('creates a folder for the `mkdir` operation', async () => {
        const { actor, username } = await makeUser();
        const dir = `/${username}/Documents`;
        const captured = await runOperation(actor, dir, 'mkdir', {
            name: 'signed-mkdir',
        });
        expect((captured.body as { path: string }).path).toBe(
            `${dir}/signed-mkdir`,
        );
        expect(
            await server.stores.fsEntry.getEntryByPath(`${dir}/signed-mkdir`),
        ).not.toBeNull();
    });

    it('renames the signed entry for the `rename` operation', async () => {
        const { actor, username } = await makeUser();
        const path = `/${username}/Documents/rename-src.txt`;
        await writeFileEntry(actor, path, 'x');
        const captured = await runOperation(actor, path, 'rename', {
            new_name: 'renamed.txt',
        });
        expect((captured.body as { path: string }).path).toBe(
            `/${username}/Documents/renamed.txt`,
        );
    });

    it('rejects `rename` with no new_name', async () => {
        const { actor, username } = await makeUser();
        const path = `/${username}/Documents/rename-bad.txt`;
        await writeFileEntry(actor, path, 'x');
        await expect(runOperation(actor, path, 'rename')).rejects.toMatchObject(
            { statusCode: 400, message: '`new_name` required' },
        );
    });

    it.each(['delete', 'trash'])(
        'removes the entry for the `%s` operation',
        async (operation) => {
            const { actor, username } = await makeUser();
            const path = `/${username}/Documents/${operation}-me.txt`;
            await writeFileEntry(actor, path, 'x');
            const captured = await runOperation(actor, path, operation);
            expect(captured.body).toMatchObject({ ok: true });
            expect(await server.stores.fsEntry.getEntryByPath(path)).toBeNull();
        },
    );

    it('copies to the requested destination for the `copy` operation', async () => {
        const { actor, username } = await makeUser();
        const source = `/${username}/Documents/sig-copy-src.txt`;
        const destinationDir = `/${username}/Desktop`;
        await writeFileEntry(actor, source, 'copy-me');
        const captured = await runOperation(actor, source, 'copy', {
            destination: destinationDir,
        });
        expect((captured.body as { path: string }).path).toBe(
            `${destinationDir}/sig-copy-src.txt`,
        );
        expect(
            await server.stores.fsEntry.getEntryByPath(source),
        ).not.toBeNull();
    });

    it('moves to the requested destination for the `move` operation', async () => {
        const { actor, username } = await makeUser();
        const source = `/${username}/Documents/sig-move-src.txt`;
        const destinationDir = `/${username}/Desktop`;
        await writeFileEntry(actor, source, 'move-me');
        const captured = await runOperation(actor, source, 'move', {
            destination: destinationDir,
        });
        expect((captured.body as { path: string }).path).toBe(
            `${destinationDir}/sig-move-src.txt`,
        );
        expect(await server.stores.fsEntry.getEntryByPath(source)).toBeNull();
    });

    it('rejects copy/move with no destination', async () => {
        const { actor, username } = await makeUser();
        const source = `/${username}/Documents/no-dest.txt`;
        await writeFileEntry(actor, source, 'x');
        await expect(runOperation(actor, source, 'copy')).rejects.toMatchObject(
            { statusCode: 400, message: '`destination` required' },
        );
    });

    it('rejects an unknown operation name', async () => {
        const { actor, username } = await makeUser();
        const path = `/${username}/Documents/unknown-op.txt`;
        await writeFileEntry(actor, path, 'x');
        await expect(
            runOperation(actor, path, 'explode'),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: "Unsupported writeFile operation: 'explode'",
        });
    });

    it('restricts structural operations to the owning caller', async () => {
        // A write signature authorises overwriting bytes, not relocating or
        // destroying the file — a write-share recipient must be turned away.
        const owner = await makeUser();
        const sharee = await makeUser();
        const path = `/${owner.username}/Documents/structural.txt`;
        await writeFileEntry(owner.actor, path, 'x');
        const entry = (await server.stores.fsEntry.getEntryByPath(path))!;
        await server.services.permission.grantUserUserPermission(
            owner.actor,
            sharee.username,
            `fs:${entry.uuid}:write`,
            {},
        );

        const { query } = await signedFor(path);
        const { res } = makeRes();
        await expect(
            withActor(sharee.actor, () =>
                controller.writeFile(
                    makeReq({
                        query: { ...query, operation: 'delete' },
                        actor: sharee.actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 403, legacyCode: 'forbidden' });
        expect(await server.stores.fsEntry.getEntryByPath(path)).not.toBeNull();
    });

    it('writes a new child when the signed target is a directory', async () => {
        const { actor, username } = await makeUser();
        const dir = `/${username}/Documents`;
        const { query } = await signedFor(dir);
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.writeFile(
                multipartReq(
                    [
                        {
                            kind: 'file',
                            name: 'file',
                            filename: 'child.txt',
                            content: 'into-dir',
                        },
                    ],
                    {
                        actor,
                        query: { ...query, operation: 'write' },
                        body: { name: 'into-dir.txt' },
                    },
                ),
                res,
            ),
        );
        expect((captured.body as { path: string }).path).toBe(
            `${dir}/into-dir.txt`,
        );
    });

    it('rejects a multipart write with no file part', async () => {
        const { actor, username } = await makeUser();
        const path = `/${username}/Documents/no-part.txt`;
        await writeFileEntry(actor, path, 'x');
        const { query } = await signedFor(path);
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.writeFile(
                    multipartReq(
                        [{ kind: 'field', name: 'name', value: 'ignored' }],
                        { actor, query: { ...query, operation: 'write' } },
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'No file uploaded',
        });
    });

    it('rejects a signed write when the owning account is suspended', async () => {
        const { actor, userId, username } = await makeUser();
        const path = `/${username}/Documents/suspended-write.txt`;
        await writeFileEntry(actor, path, 'x');
        const { query } = await signedFor(path);
        await server.stores.user.update(userId, { suspended: true });
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.writeFile(
                    makeReq({ query: { ...query, operation: 'write' }, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 401,
            legacyCode: 'account_suspended',
        });
    });
});

// -- /batch (multipart) -------------------------------------------------

describe('LegacyFSController.batch (multipart)', () => {
    it('pairs a write op with its file part and fileinfo', async () => {
        const { actor, username } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                multipartReq(
                    [
                        {
                            kind: 'field',
                            name: 'operation',
                            value: JSON.stringify({
                                op: 'write',
                                path: `/${username}/Documents`,
                                item_upload_id: 0,
                            }),
                        },
                        {
                            kind: 'field',
                            name: 'fileinfo',
                            value: JSON.stringify({
                                name: 'batched.txt',
                                type: 'text/plain',
                            }),
                        },
                        {
                            kind: 'file',
                            name: 'file',
                            filename: 'batched.txt',
                            content: 'batch-bytes',
                        },
                    ],
                    { actor },
                ),
                res,
            ),
        );
        expect(captured.statusCode).toBe(200);
        const results = (captured.body as { results: Array<{ path: string }> })
            .results;
        expect(results[0]?.path).toBe(`/${username}/Documents/batched.txt`);
        expect(
            (
                await server.stores.fsEntry.getEntryByPath(
                    `/${username}/Documents/batched.txt`,
                )
            )?.size,
        ).toBe(11);
    });

    it('expands a `~` parent path in a write op', async () => {
        const { actor, username } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                multipartReq(
                    [
                        {
                            kind: 'field',
                            name: 'operation',
                            value: JSON.stringify({
                                op: 'write',
                                path: '~/Documents',
                                name: 'tilde-batch.txt',
                            }),
                        },
                        {
                            kind: 'file',
                            name: 'file',
                            filename: 'tilde-batch.txt',
                            content: 'tilde',
                        },
                    ],
                    { actor },
                ),
                res,
            ),
        );
        expect(captured.statusCode).toBe(200);
        expect(
            (captured.body as { results: Array<{ path: string }> }).results[0]
                ?.path,
        ).toBe(`/${username}/Documents/tilde-batch.txt`);
    });

    it('records a per-op error when a write op has no paired file', async () => {
        const { actor, username } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                multipartReq(
                    [
                        {
                            kind: 'field',
                            name: 'operation',
                            value: JSON.stringify({
                                op: 'write',
                                path: `/${username}/Documents`,
                                name: 'orphan.txt',
                            }),
                        },
                    ],
                    { actor },
                ),
                res,
            ),
        );
        expect(captured.statusCode).toBe(218);
        const [error] = (
            captured.body as { results: Array<Record<string, unknown>> }
        ).results;
        expect(error).toMatchObject({
            error: true,
            status: 400,
            code: 'bad_request',
        });
    });

    it('records a per-op error when a write op has no name anywhere', async () => {
        const { actor, username } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                multipartReq(
                    [
                        {
                            kind: 'field',
                            name: 'operation',
                            value: JSON.stringify({
                                op: 'write',
                                path: `/${username}/Documents`,
                            }),
                        },
                        {
                            kind: 'file',
                            name: 'file',
                            filename: 'anonymous',
                            content: 'x',
                        },
                    ],
                    { actor },
                ),
                res,
            ),
        );
        expect(captured.statusCode).toBe(218);
        expect(
            (captured.body as { results: Array<{ message: string }> })
                .results[0]?.message,
        ).toBe('write op missing `name`');
    });

    it('creates a directory for a multipart mkdir op', async () => {
        const { actor, username } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                multipartReq(
                    [
                        {
                            kind: 'field',
                            name: 'operation',
                            value: JSON.stringify({
                                op: 'mkdir',
                                path: `/${username}/Documents`,
                                name: 'batch-dir',
                            }),
                        },
                    ],
                    { actor },
                ),
                res,
            ),
        );
        expect(captured.statusCode).toBe(200);
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${username}/Documents/batch-dir`,
            ),
        ).not.toBeNull();
    });

    it('rejects the whole request when an operation field is not JSON', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batch(
                    multipartReq(
                        [
                            {
                                kind: 'field',
                                name: 'operation',
                                value: '{nope',
                            },
                        ],
                        { actor },
                    ),
                    res,
                ),
            ),
        ).rejects.toBeInstanceOf(Error);
    });

    it('ignores unrelated multipart fields', async () => {
        const { actor, username } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                multipartReq(
                    [
                        { kind: 'field', name: 'socket_id', value: 'sock-1' },
                        { kind: 'field', name: 'operation_id', value: 'op-1' },
                        {
                            kind: 'field',
                            name: 'operation',
                            value: JSON.stringify({
                                op: 'mkdir',
                                path: `/${username}/Documents`,
                                name: 'ignored-fields',
                            }),
                        },
                    ],
                    { actor },
                ),
                res,
            ),
        );
        expect(captured.statusCode).toBe(200);
    });
});

describe('LegacyFSController.batch actor gates', () => {
    it('throws 401 without an actor', async () => {
        const { res } = makeRes();
        await expect(
            controller.batch(makeReq({ body: { operations: [] } }), res),
        ).rejects.toMatchObject({
            statusCode: 401,
            legacyCode: 'unauthorized',
        });
    });

    it('throws 401 when the actor carries a non-numeric id', async () => {
        const actor = { user: { id: 'not-a-number', username: 'x' } } as never;
        const { res } = makeRes();
        await expect(
            controller.batch(makeReq({ body: { operations: [] }, actor }), res),
        ).rejects.toMatchObject({
            statusCode: 401,
            legacyCode: 'unauthorized',
        });
    });

    it('accepts the `ops` alias for the JSON operations array', async () => {
        const { actor, username } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                makeReq({
                    body: {
                        ops: [
                            {
                                op: 'mkdir',
                                path: `/${username}/Documents`,
                                name: 'ops-alias',
                            },
                        ],
                    },
                    actor,
                }),
                res,
            ),
        );
        expect(captured.statusCode).toBe(200);
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${username}/Documents/ops-alias`,
            ),
        ).not.toBeNull();
    });
});

// -- tokenRead ---------------------------------------------------------

describe('LegacyFSController.tokenRead', () => {
    it('streams the file with its real MIME type for a valid access token', async () => {
        const { actor, username, userId } = await makeUser();
        const path = `/${username}/Documents/token-read.txt`;
        await writeFileEntry(actor, path, 'token-bytes');
        const entry = (await server.stores.fsEntry.getEntryByPath(path))!;

        const user = (await server.stores.user.getById(userId))!;
        const token = await server.services.auth.createAccessToken(
            { user } as never,
            [[`fs:${entry.uuid}:read`]],
            { label: 'legacy-fs-token-read' },
        );

        const { res, captured, finished } = makeStreamRes();
        await withActor(actor, () =>
            controller.tokenRead(
                makeReq({ query: { token, uid: entry.uuid } }),
                res,
            ),
        );
        await finished;
        expect(captured.statusCode).toBe(200);
        expect(captured.text()).toBe('token-bytes');
        expect(captured.headers.get('content-type')).toContain('text/plain');
    });
});
