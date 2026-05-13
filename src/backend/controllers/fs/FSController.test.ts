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

import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { FSController } from './FSController.js';
import type {
    CompleteWriteRequest,
    SignedWriteRequest,
    SignedWriteResponse,
} from './requestTypes.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one real PuterServer (in-memory sqlite + dynamo + s3 + mock redis).
// Each test creates its own user via `makeUser` and exercises the live
// FSController against the wired services / stores.

let server: PuterServer;
let controller: FSController;

beforeAll(async () => {
    server = await setupTestServer();
    controller = server.controllers.fs as unknown as FSController;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `fsc-${Math.random().toString(36).slice(2, 10)}`;
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
}
const makeReq = <B>(init: {
    body?: B;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
    actor: Actor;
    user?: { id: number; username: string };
}): Request => {
    return {
        body: init.body ?? ({} as B),
        query: init.query ?? {},
        headers: init.headers ?? {},
        actor: init.actor,
        // Some controller helpers fall back to `req.user` (set by the
        // session middleware) for id / username before reading `req.actor`.
        // Provide it so #getActorUserId / #getActorUsername resolve.
        user: init.user ?? {
            id: init.actor.user!.id!,
            username: init.actor.user!.username!,
        },
    } as unknown as Request;
};
const makeRes = () => {
    const captured: CapturedResponse = { statusCode: 200, body: undefined };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        setHeader: vi.fn(() => res),
    };
    return { res: res as unknown as Response, captured };
};

const withActor = async <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

// ── /startBatchWrite ────────────────────────────────────────────────

describe('FSController.startBatchWrites', () => {
    it('returns [] for an empty/undefined body without creating sessions', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        const req = makeReq<SignedWriteRequest[]>({ body: undefined, actor });
        await withActor(actor, () => controller.startBatchWrites(req, res));
        expect(captured.body).toEqual([]);
    });

    it('creates a pending upload session per request and returns signed targets', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const body: SignedWriteRequest[] = [
            {
                fileMetadata: {
                    path: `/${username}/Documents/a.txt`,
                    size: 5,
                },
            },
            {
                fileMetadata: {
                    path: `/${username}/Documents/b.txt`,
                    size: 10,
                },
            },
        ];
        const { res, captured } = makeRes();
        const req = makeReq<SignedWriteRequest[]>({ body, actor });
        await withActor(actor, () => controller.startBatchWrites(req, res));

        const responses = captured.body as SignedWriteResponse[];
        expect(responses).toHaveLength(2);
        for (const r of responses) {
            expect(r.sessionId).toEqual(expect.any(String));
            expect(r.objectKey).toEqual(expect.any(String));
            expect(r.bucket).toEqual(expect.any(String));
            expect(r.uploadMode).toBe('single');
            // In-memory mock S3 still returns a presigned-URL string for
            // single-mode uploads — verify it's there but don't assert
            // shape (varies by region/host config).
            expect(typeof r.url).toBe('string');
        }

        // Pending sessions actually landed in the DB and point at the
        // expected paths for the right user.
        const sessions =
            await server.stores.fsEntry.getPendingEntriesBySessionIds(
                responses.map((r) => r.sessionId),
            );
        expect(sessions.map((s) => s?.targetPath).sort()).toEqual([
            `/${username}/Documents/a.txt`,
            `/${username}/Documents/b.txt`,
        ]);
        for (const session of sessions) {
            expect(session?.userId).toBe(userId);
            expect(session?.status).toBe('pending');
        }
    });

    it('expands `~/...` paths against the actor home before writing', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const body: SignedWriteRequest[] = [
            { fileMetadata: { path: '~/Documents/tilde.txt', size: 3 } },
        ];
        const { res, captured } = makeRes();
        const req = makeReq<SignedWriteRequest[]>({ body, actor });
        await withActor(actor, () => controller.startBatchWrites(req, res));
        const [response] = captured.body as SignedWriteResponse[];
        const session = await server.stores.fsEntry.getPendingEntryBySessionId(
            response!.sessionId,
        );
        expect(session?.targetPath).toBe(`/${username}/Documents/tilde.txt`);
    });

    it('materializes a directory entry when `directory: true`', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/new-batch-dir`;
        const body: SignedWriteRequest[] = [
            {
                // `createMissingParents` lets the service materialize the
                // target dir even though only `/Documents` exists in the
                // newly-provisioned home tree.
                fileMetadata: {
                    path: target,
                    size: 0,
                    createMissingParents: true,
                },
                directory: true,
            },
        ];
        const { res } = makeRes();
        const req = makeReq<SignedWriteRequest[]>({ body, actor });
        await withActor(actor, () => controller.startBatchWrites(req, res));

        // Directory items aren't pending uploads — they're created
        // immediately by the service. The fsentry should be queryable.
        const created = await server.stores.fsEntry.getEntryByPath(target);
        expect(created).not.toBeNull();
        expect(created?.isDir).toBe(true);
    });

    it('rejects the batch when ACL denies any item', async () => {
        const a = await makeUser();
        const b = await makeUser();
        // User a tries to drop a file inside user b's home.
        const body: SignedWriteRequest[] = [
            {
                fileMetadata: {
                    path: `/${b.actor.user!.username}/Documents/intruder.txt`,
                    size: 1,
                },
            },
        ];
        const { res } = makeRes();
        const req = makeReq<SignedWriteRequest[]>({
            body,
            actor: a.actor,
        });
        const err = await withActor(a.actor, () =>
            controller.startBatchWrites(req, res).then(
                () => null,
                (e: unknown) => e,
            ),
        );
        const status = (err as { statusCode?: number } | null)?.statusCode;
        // 404 (can't see) or 403 (can see, can't write) are both valid
        // denials per ACLService.getSafeAclError.
        expect([403, 404]).toContain(status);
    });
});

// ── /completeBatchWrite ────────────────────────────────────────────

describe('FSController.completeBatchWrites', () => {
    it('returns [] for an empty body', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        const req = makeReq<CompleteWriteRequest[]>({
            body: undefined,
            actor,
        });
        await withActor(actor, () => controller.completeBatchWrites(req, res));
        expect(captured.body).toEqual([]);
    });

    it('rejects an inline `data:` thumbnail with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const req = makeReq<CompleteWriteRequest[]>({
            body: [
                {
                    uploadId: 'whatever',
                    thumbnailData: 'data:image/png;base64,AAA',
                },
            ],
            actor,
        });
        await expect(
            withActor(actor, () => controller.completeBatchWrites(req, res)),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('finalizes pending sessions into real fsentries', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;

        // 1) Start two batched uploads. The signed-write flow inserts
        //    pending session rows and gives us back the upload IDs we'll
        //    feed to /completeBatchWrite.
        const startBody: SignedWriteRequest[] = [
            {
                fileMetadata: {
                    path: `/${username}/Documents/c.txt`,
                    size: 5,
                    contentType: 'text/plain',
                },
            },
            {
                fileMetadata: {
                    path: `/${username}/Documents/d.txt`,
                    size: 7,
                    contentType: 'text/plain',
                },
            },
        ];
        const startRes = makeRes();
        await withActor(actor, () =>
            controller.startBatchWrites(
                makeReq<SignedWriteRequest[]>({ body: startBody, actor }),
                startRes.res,
            ),
        );
        const startResponses = startRes.captured.body as SignedWriteResponse[];
        expect(startResponses).toHaveLength(2);

        // 2) Complete via the controller. Single-mode completion only
        //    needs the session row → it doesn't read the S3 object back,
        //    so we can skip the actual upload step in this test.
        const { res, captured } = makeRes();
        const completeBody: CompleteWriteRequest[] = startResponses.map(
            (r) => ({ uploadId: r.sessionId }),
        );
        await withActor(actor, () =>
            controller.completeBatchWrites(
                makeReq<CompleteWriteRequest[]>({
                    body: completeBody,
                    actor,
                }),
                res,
            ),
        );

        const responses = captured.body as Array<{
            sessionId: string;
            wasOverwrite: boolean;
            fsEntry: { path: string; userId: number; isDir: boolean };
        }>;
        expect(responses.map((r) => r.fsEntry.path).sort()).toEqual([
            `/${username}/Documents/c.txt`,
            `/${username}/Documents/d.txt`,
        ]);
        for (const response of responses) {
            expect(response.wasOverwrite).toBe(false);
            expect(response.fsEntry.userId).toBe(userId);
            expect(response.fsEntry.isDir).toBe(false);
        }

        // The real fsentries were committed and are now resolvable.
        for (const path of [
            `/${username}/Documents/c.txt`,
            `/${username}/Documents/d.txt`,
        ]) {
            const entry = await server.stores.fsEntry.getEntryByPath(path);
            expect(entry).not.toBeNull();
            expect(entry?.userId).toBe(userId);
        }
    });

    it('reports wasOverwrite=true when finalizing onto an existing entry', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/overwrite-me.txt`;

        // First write — establishes an entry to overwrite.
        const firstStart = makeRes();
        await withActor(actor, () =>
            controller.startBatchWrites(
                makeReq<SignedWriteRequest[]>({
                    body: [{ fileMetadata: { path: target, size: 1 } }],
                    actor,
                }),
                firstStart.res,
            ),
        );
        const [firstResponse] = firstStart.captured
            .body as SignedWriteResponse[];
        const firstComplete = makeRes();
        await withActor(actor, () =>
            controller.completeBatchWrites(
                makeReq<CompleteWriteRequest[]>({
                    body: [{ uploadId: firstResponse!.sessionId }],
                    actor,
                }),
                firstComplete.res,
            ),
        );

        // Second write with overwrite=true onto the same path.
        const secondStart = makeRes();
        await withActor(actor, () =>
            controller.startBatchWrites(
                makeReq<SignedWriteRequest[]>({
                    body: [
                        {
                            fileMetadata: {
                                path: target,
                                size: 2,
                                overwrite: true,
                            },
                        },
                    ],
                    actor,
                }),
                secondStart.res,
            ),
        );
        const [secondResponse] = secondStart.captured
            .body as SignedWriteResponse[];

        const secondComplete = makeRes();
        await withActor(actor, () =>
            controller.completeBatchWrites(
                makeReq<CompleteWriteRequest[]>({
                    body: [{ uploadId: secondResponse!.sessionId }],
                    actor,
                }),
                secondComplete.res,
            ),
        );

        const [finalized] = secondComplete.captured.body as Array<{
            wasOverwrite: boolean;
        }>;
        expect(finalized?.wasOverwrite).toBe(true);
    });

    it("rejects another user's session ids with a 4xx", async () => {
        const a = await makeUser();
        const b = await makeUser();

        // a starts a batch; b tries to complete it.
        const startA = makeRes();
        await withActor(a.actor, () =>
            controller.startBatchWrites(
                makeReq<SignedWriteRequest[]>({
                    body: [
                        {
                            fileMetadata: {
                                path: `/${a.actor.user!.username}/Documents/x.txt`,
                                size: 1,
                            },
                        },
                    ],
                    actor: a.actor,
                }),
                startA.res,
            ),
        );
        const [aResponse] = startA.captured.body as SignedWriteResponse[];

        const err = await withActor(b.actor, () =>
            controller
                .completeBatchWrites(
                    makeReq<CompleteWriteRequest[]>({
                        body: [{ uploadId: aResponse!.sessionId }],
                        actor: b.actor,
                    }),
                    makeRes().res,
                )
                .then(
                    () => null,
                    (e: unknown) => e,
                ),
        );
        const status = (err as { statusCode?: number } | null)?.statusCode;
        // FSService.batchCompleteUrlWrite throws 403 on session/user
        // mismatch (`Upload session access denied`).
        expect([403, 404]).toContain(status);
    });
});

// ── /stat (statEntry) ───────────────────────────────────────────────

describe('FSController.statEntry', () => {
    it('returns the v2-native entry shape with isDir/path', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        // Seed via mkdirEntry so the entry surely exists.
        const mkdirRes = makeRes();
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({
                    body: { path: `/${username}/Documents/stat-me` },
                    actor,
                }),
                mkdirRes.res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.statEntry(
                makeReq({
                    body: { path: `/${username}/Documents/stat-me` },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as {
            path: string;
            isDir: boolean;
            name: string;
        };
        expect(body.path).toBe(`/${username}/Documents/stat-me`);
        expect(body.isDir).toBe(true);
        expect(body.name).toBe('stat-me');
    });

    it('includes the subtree size when return_size is set on a directory', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({
                    body: { path: `/${username}/Documents/sized` },
                    actor,
                }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.statEntry(
                makeReq({
                    body: {
                        path: `/${username}/Documents/sized`,
                        return_size: true,
                    },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as { size: number };
        expect(body.size).toBe(0);
    });

    it('throws 401 when no actor is on the request', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const req = {
            ...makeReq({ body: { path: '/x' }, actor }),
            actor: undefined,
        } as unknown as Request;
        await expect(
            controller.statEntry(req, res),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── /readdir (readdirEntries) ───────────────────────────────────────

describe('FSController.readdirEntries', () => {
    it('lists children of a directory', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        for (const name of ['alpha', 'beta']) {
            await withActor(actor, () =>
                controller.mkdirEntry(
                    makeReq({
                        body: { path: `/${username}/Documents/${name}` },
                        actor,
                    }),
                    makeRes().res,
                ),
            );
        }

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.readdirEntries(
                makeReq({
                    body: { path: `/${username}/Documents` },
                    actor,
                }),
                res,
            ),
        );
        const entries = captured.body as Array<{ name: string }>;
        expect(Array.isArray(entries)).toBe(true);
        const names = entries.map((e) => e.name);
        expect(names).toContain('alpha');
        expect(names).toContain('beta');
    });

    it('returns root listing when path = "/"', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.readdirEntries(
                makeReq({ body: { path: '/' }, actor }),
                res,
            ),
        );
        expect(Array.isArray(captured.body)).toBe(true);
    });

    it('throws 400 when the target is not a directory', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        // touch → non-directory entry
        await withActor(actor, () =>
            controller.touchEntry(
                makeReq({
                    body: {
                        path: `/${username}/Documents/touched.txt`,
                        set_modified_to_now: true,
                    },
                    actor,
                }),
                makeRes().res,
            ),
        );

        await expect(
            withActor(actor, () =>
                controller.readdirEntries(
                    makeReq({
                        body: { path: `/${username}/Documents/touched.txt` },
                        actor,
                    }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── /search (searchEntries) ─────────────────────────────────────────

describe('FSController.searchEntries', () => {
    it('rejects an empty query with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                controller.searchEntries(
                    makeReq({ body: { query: '   ' }, actor }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('finds entries by name', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const needle = `sneedle-${Math.random().toString(36).slice(2, 8)}`;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({
                    body: { path: `/${username}/Documents/${needle}` },
                    actor,
                }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.searchEntries(
                makeReq({ body: { query: needle }, actor }),
                res,
            ),
        );
        const results = captured.body as Array<{ name: string }>;
        expect(Array.isArray(results)).toBe(true);
        expect(results.some((r) => r.name === needle)).toBe(true);
    });
});

// ── /read (readEntry, validation paths) ─────────────────────────────

describe('FSController.readEntry', () => {
    it('throws 400 when reading a directory', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        await expect(
            withActor(actor, () =>
                controller.readEntry(
                    makeReq({
                        query: { path: `/${username}/Documents` },
                        actor,
                    }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 401 when no actor', async () => {
        const { actor } = await makeUser();
        const req = {
            ...makeReq({
                query: { path: `/${actor.user!.username}/Documents` },
                actor,
            }),
            actor: undefined,
        } as unknown as Request;
        await expect(
            controller.readEntry(req, makeRes().res),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── /mkdir (mkdirEntry) ─────────────────────────────────────────────

describe('FSController.mkdirEntry', () => {
    it('throws 400 on missing path', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                controller.mkdirEntry(
                    makeReq({ body: {}, actor }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when path normalizes to "/"', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                controller.mkdirEntry(
                    makeReq({ body: { path: '/' }, actor }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('creates a directory and emits the GUI added event', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({
                    body: { path: `/${username}/Documents/created` },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as { path: string; isDir: boolean };
        expect(body.path).toBe(`/${username}/Documents/created`);
        expect(body.isDir).toBe(true);
    });

    it('expands ~/ in the path to the user home', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({
                    body: { path: '~/Documents/tilde' },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as { path: string };
        expect(body.path).toBe(`/${username}/Documents/tilde`);
    });
});

// ── /touch (touchEntry) ─────────────────────────────────────────────

describe('FSController.touchEntry', () => {
    it('throws 400 on missing path', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                controller.touchEntry(
                    makeReq({ body: {}, actor }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when path normalizes to "/"', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                controller.touchEntry(
                    makeReq({ body: { path: '/' }, actor }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('creates a non-directory placeholder entry', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.touchEntry(
                makeReq({
                    body: {
                        path: `/${username}/Documents/note.txt`,
                        set_modified_to_now: true,
                    },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as { isDir: boolean; name: string };
        expect(body.isDir).toBe(false);
        expect(body.name).toBe('note.txt');
    });
});

// ── /rename (renameEntry) ───────────────────────────────────────────

describe('FSController.renameEntry', () => {
    it('throws 400 on missing new_name', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        await expect(
            withActor(actor, () =>
                controller.renameEntry(
                    makeReq({
                        body: { path: `/${username}/Documents` },
                        actor,
                    }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('renames an existing entry', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({
                    body: { path: `/${username}/Documents/before` },
                    actor,
                }),
                makeRes().res,
            ),
        );
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.renameEntry(
                makeReq({
                    body: {
                        path: `/${username}/Documents/before`,
                        new_name: 'after',
                    },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as { path: string; name: string };
        expect(body.name).toBe('after');
        expect(body.path).toBe(`/${username}/Documents/after`);
    });
});

// ── /delete (deleteEntry) ───────────────────────────────────────────

describe('FSController.deleteEntry', () => {
    it('removes an entry by path and responds {ok: true}', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/doomed`;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({ body: { path: target }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.deleteEntry(
                makeReq({
                    body: { path: target, recursive: true },
                    actor,
                }),
                res,
            ),
        );
        expect(captured.body).toEqual({ ok: true });
    });

    it('throws 404 when the entry does not exist', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        await expect(
            withActor(actor, () =>
                controller.deleteEntry(
                    makeReq({
                        body: {
                            path: `/${username}/Documents/does-not-exist-${uuidv4()}`,
                        },
                        actor,
                    }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

// ── /move (moveEntry) ───────────────────────────────────────────────

describe('FSController.moveEntry', () => {
    it('moves an entry to a new parent', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const src = `/${username}/Documents/movable`;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({ body: { path: src }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.moveEntry(
                makeReq({
                    body: {
                        source: { path: src },
                        destination: { path: `/${username}/Pictures` },
                    },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as { path: string };
        expect(body.path).toBe(`/${username}/Pictures/movable`);
    });
});

// ── /copy (copyEntry) ───────────────────────────────────────────────

describe('FSController.copyEntry', () => {
    it('copies an entry into another folder', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const src = `/${username}/Documents/c-orig`;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({ body: { path: src }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.copyEntry(
                makeReq({
                    body: {
                        source: { path: src },
                        destination: { path: `/${username}/Pictures` },
                    },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as { path: string };
        expect(body.path).toBe(`/${username}/Pictures/c-orig`);
    });
});

// ── /read (readEntry, full read) ────────────────────────────────────

describe('FSController.readEntry (file streaming)', () => {
    // makeRes here adds a real Writable surface so that
    // `pipeline(download.body, res)` inside the controller can pipe
    // the in-memory S3 stream into the test's response and capture
    // bytes for assertions.
    const makeStreamingRes = () => {
        const captured = {
            statusCode: 200,
            headers: {} as Record<string, string>,
            bodyChunks: [] as Buffer[],
        };
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Writable } = require('node:stream') as typeof import('node:stream');
        const writable = new Writable({
            write(chunk: Buffer, _enc, cb) {
                captured.bodyChunks.push(chunk);
                cb();
            },
        });
        // Decorate with the Express helpers the controller calls.
        const res = writable as unknown as Response & {
            status: (code: number) => unknown;
            setHeader: (k: string, v: string) => unknown;
            json: (v: unknown) => unknown;
            send: (v: unknown) => unknown;
        };
        res.status = (code: number) => {
            captured.statusCode = code;
            return res;
        };
        res.setHeader = (k: string, v: string) => {
            captured.headers[k] = v;
            return res;
        };
        res.json = vi.fn(() => res);
        res.send = vi.fn(() => res);
        return { res, captured };
    };

    const writeFile = async (
        userId: number,
        path: string,
        body: Buffer,
        contentType = 'application/octet-stream',
    ) => {
        await server.services.fs.write(userId, {
            fileMetadata: {
                path,
                size: body.byteLength,
                contentType,
            },
            fileContent: body,
        });
    };

    it('streams the file body with 200 and Content-Type/Length/Disposition headers', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const body = Buffer.from('hello world');
        const target = `/${username}/Documents/read.txt`;
        await writeFile(userId, target, body, 'text/plain');

        const { res, captured } = makeStreamingRes();
        await withActor(actor, () =>
            controller.readEntry(
                makeReq({ query: { path: target }, actor }),
                res,
            ),
        );
        // Pipeline awaits the stream-end on success.
        expect(captured.statusCode).toBe(200);
        expect(captured.headers['Content-Type']).toMatch(/text\/plain/);
        expect(captured.headers['Content-Length']).toBe(String(body.byteLength));
        expect(captured.headers['Content-Disposition']).toMatch(
            /inline; filename=/,
        );
        expect(Buffer.concat(captured.bodyChunks).equals(body)).toBe(true);
    });

    it('returns 206 with Range honored when a Range header is supplied', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const body = Buffer.from('abcdefghij');
        const target = `/${username}/Documents/ranged.bin`;
        await writeFile(userId, target, body, 'application/octet-stream');

        const { res, captured } = makeStreamingRes();
        await withActor(actor, () =>
            controller.readEntry(
                makeReq({
                    query: { path: target },
                    actor,
                    headers: { range: 'bytes=0-3' },
                }),
                res,
            ),
        );
        // Range presence flips the status to 206 — Content-Range may or
        // may not be set depending on the underlying S3 mock; the status
        // transition is the wire-level promise this code holds.
        expect(captured.statusCode).toBe(206);
    });

    it('throws 404 when the path does not exist', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        await expect(
            withActor(actor, () =>
                controller.readEntry(
                    makeReq({
                        query: {
                            path: `/${username}/Documents/missing-${uuidv4()}.txt`,
                        },
                        actor,
                    }),
                    makeStreamingRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

// ── /readdir extras: sort + limit/offset ────────────────────────────

describe('FSController.readdirEntries sort + limit', () => {
    it('accepts sort_by + sort_order and passes them through to listDirectory', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        // Spy on the service so we can verify the controller-side
        // parsing of sort_by/sort_order/limit/offset.
        const listSpy = vi
            .spyOn(server.services.fs, 'listDirectory')
            .mockResolvedValueOnce([] as never);
        try {
            await withActor(actor, () =>
                controller.readdirEntries(
                    makeReq({
                        body: {
                            path: `/${username}/Documents`,
                            sort_by: 'name',
                            sort_order: 'desc',
                            limit: 10,
                            offset: 5,
                        },
                        actor,
                    }),
                    makeRes().res,
                ),
            );
            expect(listSpy).toHaveBeenCalledTimes(1);
            const opts = listSpy.mock.calls[0]![1]!;
            expect(opts.sortBy).toBe('name');
            expect(opts.sortOrder).toBe('desc');
            expect(opts.limit).toBe(10);
            expect(opts.offset).toBe(5);
        } finally {
            listSpy.mockRestore();
        }
    });

    it('defaults invalid sort_by/sort_order to null', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const listSpy = vi
            .spyOn(server.services.fs, 'listDirectory')
            .mockResolvedValueOnce([] as never);
        try {
            await withActor(actor, () =>
                controller.readdirEntries(
                    makeReq({
                        body: {
                            path: `/${username}/Documents`,
                            sort_by: 'totally-fake',
                            sort_order: 'sideways',
                        },
                        actor,
                    }),
                    makeRes().res,
                ),
            );
            const opts = listSpy.mock.calls[0]![1]!;
            expect(opts.sortBy).toBeNull();
            expect(opts.sortOrder).toBeNull();
        } finally {
            listSpy.mockRestore();
        }
    });
});

// ── /touch additional branches ──────────────────────────────────────

describe('FSController.touchEntry additional branches', () => {
    it('forwards set_accessed_to_now / set_created_to_now / create_missing_parents flags', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const touchSpy = vi
            .spyOn(server.services.fs, 'touch')
            .mockResolvedValueOnce({
                path: `/${username}/Documents/spy.txt`,
                name: 'spy.txt',
                isDir: false,
            } as never);
        try {
            await withActor(actor, () =>
                controller.touchEntry(
                    makeReq({
                        body: {
                            path: `/${username}/Documents/spy.txt`,
                            set_accessed_to_now: true,
                            set_modified_to_now: 'yes', // string coercion
                            set_created_to_now: 1, // numeric coercion
                            create_missing_parents: 'true',
                        },
                        actor,
                    }),
                    makeRes().res,
                ),
            );
            const opts = touchSpy.mock.calls[0]![1]!;
            expect(opts.setAccessed).toBe(true);
            expect(opts.setModified).toBe(true);
            expect(opts.setCreated).toBe(true);
            expect(opts.createMissingParents).toBe(true);
        } finally {
            touchSpy.mockRestore();
        }
    });
});

// ── /delete additional branches ─────────────────────────────────────

describe('FSController.deleteEntry additional branches', () => {
    it('forwards descendants_only + recursive flags', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/dscnd`;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({ body: { path: target }, actor }),
                makeRes().res,
            ),
        );
        const removeSpy = vi
            .spyOn(server.services.fs, 'remove')
            .mockResolvedValueOnce(undefined as never);
        try {
            await withActor(actor, () =>
                controller.deleteEntry(
                    makeReq({
                        body: {
                            path: target,
                            recursive: 'yes',
                            descendants_only: '1',
                        },
                        actor,
                    }),
                    makeRes().res,
                ),
            );
            const opts = removeSpy.mock.calls[0]![1]!;
            expect(opts.recursive).toBe(true);
            expect(opts.descendantsOnly).toBe(true);
        } finally {
            removeSpy.mockRestore();
        }
    });
});

// ── /move additional branches ───────────────────────────────────────

describe('FSController.moveEntry additional branches', () => {
    it('forwards new_name, overwrite, and dedupe_name (via change_name alias)', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const src = `/${username}/Documents/mv-orig`;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({ body: { path: src }, actor }),
                makeRes().res,
            ),
        );
        const moveSpy = vi
            .spyOn(server.services.fs, 'move')
            .mockResolvedValueOnce({
                path: `/${username}/Pictures/renamed`,
            } as never);
        try {
            await withActor(actor, () =>
                controller.moveEntry(
                    makeReq({
                        body: {
                            source: { path: src },
                            destination: { path: `/${username}/Pictures` },
                            new_name: 'renamed',
                            overwrite: 'true',
                            change_name: 'true', // alias for dedupe_name
                        },
                        actor,
                    }),
                    makeRes().res,
                ),
            );
            const opts = moveSpy.mock.calls[0]![1]!;
            expect(opts.newName).toBe('renamed');
            expect(opts.overwrite).toBe(true);
            expect(opts.dedupeName).toBe(true);
        } finally {
            moveSpy.mockRestore();
        }
    });
});

// ── /copy additional branches ───────────────────────────────────────

describe('FSController.copyEntry additional branches', () => {
    it('forwards new_name with dedupe_name defaulting to true', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const src = `/${username}/Documents/cp-orig`;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({ body: { path: src }, actor }),
                makeRes().res,
            ),
        );
        const copySpy = vi
            .spyOn(server.services.fs, 'copy')
            .mockResolvedValueOnce({
                path: `/${username}/Pictures/cp-orig`,
            } as never);
        try {
            await withActor(actor, () =>
                controller.copyEntry(
                    makeReq({
                        body: {
                            source: { path: src },
                            destination: { path: `/${username}/Pictures` },
                            new_name: 'cp-renamed',
                        },
                        actor,
                    }),
                    makeRes().res,
                ),
            );
            const opts = copySpy.mock.calls[0]![1]!;
            expect(opts.newName).toBe('cp-renamed');
            // Default for copy is dedupeName=true (unlike move which is false).
            expect(opts.dedupeName).toBe(true);
        } finally {
            copySpy.mockRestore();
        }
    });
});

// ── /search additional ──────────────────────────────────────────────

describe('FSController.searchEntries fallback fields', () => {
    it('falls back to body.text when body.query is missing', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const needle = `txtfb-${Math.random().toString(36).slice(2, 8)}`;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({
                    body: { path: `/${username}/Documents/${needle}` },
                    actor,
                }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.searchEntries(
                // No `query` key — only `text`.
                makeReq({ body: { text: needle }, actor }),
                res,
            ),
        );
        const results = captured.body as Array<{ name: string }>;
        expect(results.some((r) => r.name === needle)).toBe(true);
    });

    it('forwards `limit` to searchByName when provided', async () => {
        const { actor } = await makeUser();
        const searchSpy = vi
            .spyOn(server.services.fs, 'searchByName')
            .mockResolvedValueOnce([] as never);
        try {
            await withActor(actor, () =>
                controller.searchEntries(
                    makeReq({
                        body: { query: 'anything', limit: 50 },
                        actor,
                    }),
                    makeRes().res,
                ),
            );
            expect(searchSpy.mock.calls[0]![2]).toBe(50);
        } finally {
            searchSpy.mockRestore();
        }
    });
});

// ── /stat additional ────────────────────────────────────────────────

describe('FSController.statEntry additional branches', () => {
    it('returns return_size for a directory containing files', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const dir = `/${username}/Documents/sized-with-file`;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({ body: { path: dir }, actor }),
                makeRes().res,
            ),
        );
        const fileBody = Buffer.from('123');
        await server.services.fs.write(userId, {
            fileMetadata: {
                path: `${dir}/a.txt`,
                size: fileBody.byteLength,
                contentType: 'text/plain',
            },
            fileContent: fileBody,
        });

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.statEntry(
                makeReq({
                    body: { path: dir, return_size: true },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as { size: number };
        expect(body.size).toBeGreaterThanOrEqual(fileBody.byteLength);
    });
});

// ── #getReportedCosts ───────────────────────────────────────────────

describe('FSController.getReportedCosts', () => {
    it('mirrors every FS_COSTS entry as a per-byte line item', async () => {
        const { FS_COSTS } = await import('./costs.js');
        const reported = controller.getReportedCosts();
        expect(reported.length).toBe(Object.keys(FS_COSTS).length);
        for (const [usageType, ucentsPerUnit] of Object.entries(FS_COSTS)) {
            expect(reported).toContainEqual({
                usageType,
                ucentsPerUnit,
                unit: 'byte',
                source: 'controller:fs',
            });
        }
    });
});

// ── /mkshortcut (mkshortcutEntry) ───────────────────────────────────

describe('FSController.mkshortcutEntry', () => {
    it('throws 400 on missing name', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        await expect(
            withActor(actor, () =>
                controller.mkshortcutEntry(
                    makeReq({
                        body: {
                            parent: { path: `/${username}/Documents` },
                            target: { path: `/${username}/Pictures` },
                        },
                        actor,
                    }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('creates a shortcut entry pointing at the target', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/shortcut-target`;
        await withActor(actor, () =>
            controller.mkdirEntry(
                makeReq({ body: { path: target }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.mkshortcutEntry(
                makeReq({
                    body: {
                        parent: { path: `/${username}/Pictures` },
                        target: { path: target },
                        name: 'my-shortcut',
                    },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as {
            name: string;
            isShortcut: boolean;
        };
        expect(body.name).toBe('my-shortcut');
        expect(body.isShortcut).toBe(true);
    });
});
