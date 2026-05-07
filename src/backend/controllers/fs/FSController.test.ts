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
