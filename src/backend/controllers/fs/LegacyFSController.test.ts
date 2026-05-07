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
import type { LegacyFSController } from './LegacyFSController.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one real PuterServer per test file (in-memory sqlite + dynamo +
// s3 + mock redis). Each test gets its own fresh user via `makeUser` so
// state doesn't leak between cases.

let server: PuterServer;
let controller: LegacyFSController;

beforeAll(async () => {
    server = await setupTestServer();
    // Pull the live controller off the wired server — same instance the
    // request pipeline uses, so tests exercise the real services / stores.
    controller = server.controllers.legacyFs as unknown as LegacyFSController;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `lfs-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    // Provision /<username>, Trash, Documents, etc. Without this the
    // resolveNode lookups for `/<username>/...` paths return 404.
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

// Express handlers only read `body` / `query` / `headers` / `actor` and
// write to `res.json` / `res.status` / `res.send`. A field bag plus a
// recorder for the response covers every code path in the controller.
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
    actor: Actor;
}): Request => {
    return {
        body: init.body ?? {},
        query: init.query ?? {},
        headers: init.headers ?? {},
        actor: init.actor,
    } as unknown as Request;
};
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
        setHeader: vi.fn((k: string, v: string) => {
            captured.headers.set(k.toLowerCase(), String(v));
            return res;
        }),
    };
    return { res: res as unknown as Response, captured };
};

// `resolveV1Selector` reads the actor's username out of ALS — controllers
// do this implicitly because the request middleware sets it; tests have to
// run handlers inside `runWithContext` so tilde expansion lookups work.
const withActor = async <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

// ── Tests ───────────────────────────────────────────────────────────

describe('LegacyFSController.df', () => {
    it('reports zero used and a positive capacity for a fresh user', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        const req = makeReq({ body: {}, actor });
        await withActor(actor, () => controller.df(req, res));
        // Default test config has `is_storage_limited: false`, so `max`
        // resolves from device-free-space rather than the user-row
        // free_storage. Just sanity-check the shape and signs.
        const body = captured.body as { used: number; capacity: number };
        expect(body.used).toBe(0);
        expect(body.capacity).toBeGreaterThan(0);
    });
});

describe('LegacyFSController.mkdir', () => {
    it('rejects a missing `path` with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const req = makeReq({ body: {}, actor });
        await expect(
            withActor(actor, () => controller.mkdir(req, res)),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('creates a directory under the user home and persists it', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        const target = `/${actor.user!.username}/Documents/notes`;
        const req = makeReq({
            body: { path: target },
            actor,
        });
        await withActor(actor, () => controller.mkdir(req, res));

        const body = captured.body as Record<string, unknown>;
        expect(body).toMatchObject({
            path: target,
            name: 'notes',
            is_dir: true,
        });

        // Confirm the row landed in the DB rather than just trusting the
        // controller's response.
        const fetched = await server.stores.fsEntry.getEntryByPath(target);
        expect(fetched?.path).toBe(target);
        expect(fetched?.isDir).toBe(true);
    });

    it('joins a relative `path` onto the `parent` path', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const { res } = makeRes();
        const req = makeReq({
            body: {
                parent: `/${username}/Documents`,
                path: 'sub',
            },
            actor,
        });
        await withActor(actor, () => controller.mkdir(req, res));

        const fetched = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents/sub`,
        );
        expect(fetched).not.toBeNull();
        expect(fetched?.isDir).toBe(true);
    });

    it("rejects writing into another user's home with a 4xx", async () => {
        const a = await makeUser();
        const b = await makeUser();
        const { res } = makeRes();
        const req = makeReq({
            body: {
                path: `/${b.actor.user!.username}/Documents/intruder`,
            },
            actor: a.actor,
        });
        // ACLService maps "can't even `see`" to 404 (don't leak existence
        // of sibling users' files) and "can see but not write" to 403 —
        // either is a valid denial here, both block the mkdir.
        await expect(
            withActor(a.actor, () => controller.mkdir(req, res)),
        ).rejects.toMatchObject({
            statusCode: expect.any(Number),
        });
        const err = await withActor(a.actor, () =>
            controller.mkdir(req, res).then(
                () => null,
                (e: unknown) => e,
            ),
        );
        expect(err).toMatchObject({});
        const status = (err as { statusCode?: number } | null)?.statusCode;
        expect([403, 404]).toContain(status);
    });
});

describe('LegacyFSController.stat', () => {
    it('returns the legacy snake_case shape with type, owner, and is_dir', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        // Bootstrap a directory to stat.
        const dirRes = makeRes();
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({
                    body: { path: `/${username}/Documents/folder` },
                    actor,
                }),
                dirRes.res,
            ),
        );

        const { res, captured } = makeRes();
        const req = makeReq({
            body: { path: `/${username}/Documents/folder` },
            actor,
        });
        await withActor(actor, () => controller.stat(req, res));

        const body = captured.body as Record<string, unknown>;
        expect(body).toMatchObject({
            path: `/${username}/Documents/folder`,
            name: 'folder',
            is_dir: true,
            // Directories report `type: 'folder'` per the legacy contract.
            type: 'folder',
        });
        expect(body.owner).toMatchObject({ username });
    });

    it('hydrates `size` for a directory when `return_size` is set', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const dirRes = makeRes();
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({
                    body: { path: `/${username}/Pictures/empty` },
                    actor,
                }),
                dirRes.res,
            ),
        );

        const { res, captured } = makeRes();
        const req = makeReq({
            body: {
                path: `/${username}/Pictures/empty`,
                return_size: true,
            },
            actor,
        });
        await withActor(actor, () => controller.stat(req, res));
        const body = captured.body as Record<string, unknown>;
        // No files in the dir → subtree size is 0.
        expect(body.size).toBe(0);
    });

    it('throws 401 when the request has no actor', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        // Strip actor — controllers should refuse rather than fault on null.
        const req = {
            ...makeReq({ body: { path: '/x' }, actor }),
            actor: undefined,
        } as unknown as Request;
        await expect(controller.stat(req, res)).rejects.toMatchObject({
            statusCode: 401,
        });
    });
});

describe('LegacyFSController.delete', () => {
    it('removes a single entry by uid and returns `{ ok, uid }`', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/doomed`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: target }, actor }),
                makeRes().res,
            ),
        );
        const before = await server.stores.fsEntry.getEntryByPath(target);
        expect(before).not.toBeNull();

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.delete(
                makeReq({ body: { uid: before!.uuid }, actor }),
                res,
            ),
        );

        expect(captured.body).toEqual({ ok: true, uid: before!.uuid });
        const after = await server.stores.fsEntry.getEntryByPath(target);
        expect(after).toBeNull();
    });

    it('bulk-deletes via `paths` and returns one entry per path', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const a = `/${username}/Documents/a`;
        const b = `/${username}/Documents/b`;
        for (const p of [a, b]) {
            await withActor(actor, () =>
                controller.mkdir(
                    makeReq({ body: { path: p }, actor }),
                    makeRes().res,
                ),
            );
        }

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.delete(
                makeReq({
                    body: { paths: [a, b], recursive: true },
                    actor,
                }),
                res,
            ),
        );

        const responseBody = captured.body as Array<Record<string, unknown>>;
        expect(responseBody).toHaveLength(2);
        expect(responseBody[0]?.path).toBe(a);
        expect(responseBody[1]?.path).toBe(b);
        expect(await server.stores.fsEntry.getEntryByPath(a)).toBeNull();
        expect(await server.stores.fsEntry.getEntryByPath(b)).toBeNull();
    });
});

describe('LegacyFSController.rename', () => {
    it('rejects a missing `new_name` with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const req = makeReq({
            body: { path: `/${actor.user!.username}/Documents` },
            actor,
        });
        await expect(
            withActor(actor, () => controller.rename(req, res)),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('renames an existing entry and reports the new path', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const orig = `/${username}/Documents/orig`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: orig }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.rename(
                makeReq({
                    body: { path: orig, new_name: 'renamed' },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as Record<string, unknown>;
        expect(body.path).toBe(`/${username}/Documents/renamed`);
        expect(body.name).toBe('renamed');
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${username}/Documents/renamed`,
            ),
        ).not.toBeNull();
    });
});

describe('LegacyFSController.touch', () => {
    it('rejects touching at the root with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const req = makeReq({ body: { path: '/foo' }, actor });
        await expect(
            withActor(actor, () => controller.touch(req, res)),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('creates a placeholder fsentry at the requested path', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/note.txt`;
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.touch(
                makeReq({
                    body: { path: target, set_modified_to_now: true },
                    actor,
                }),
                res,
            ),
        );
        // /touch returns an empty body — the side effect is the new entry.
        expect(captured.sentText).toBe('');
        const created = await server.stores.fsEntry.getEntryByPath(target);
        expect(created).not.toBeNull();
    });
});

describe('LegacyFSController.batch (json mode)', () => {
    it('runs each op against the real fs and aggregates results on 200', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const { res, captured } = makeRes();
        const req = makeReq({
            body: {
                operations: [
                    {
                        op: 'mkdir',
                        path: `/${username}/Documents`,
                        name: 'batch-folder',
                    },
                ],
            },
            headers: { 'content-type': 'application/json' },
            actor,
        });
        await withActor(actor, () => controller.batch(req, res));

        expect(captured.statusCode).toBe(200);
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${username}/Documents/batch-folder`,
            ),
        ).not.toBeNull();
    });

    it('returns 218 with a serialized error when one op fails, but commits the others', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;

        const { res, captured } = makeRes();
        // First op deletes a path that doesn't exist (resolveV1Selector
        // throws 404). Second op must still run and persist its mkdir.
        const req = makeReq({
            body: {
                operations: [
                    {
                        op: 'delete',
                        path: `/${username}/Documents/does-not-exist`,
                    },
                    {
                        op: 'mkdir',
                        path: `/${username}/Documents`,
                        name: 'good',
                    },
                ],
            },
            headers: { 'content-type': 'application/json' },
            actor,
        });
        await withActor(actor, () => controller.batch(req, res));

        expect(captured.statusCode).toBe(218);
        const body = captured.body as {
            results: Array<Record<string, unknown>>;
        };
        expect(body.results).toHaveLength(2);
        expect(body.results[0]).toMatchObject({ error: true });
        // The second op still ran — verify by reading the resulting entry.
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${username}/Documents/good`,
            ),
        ).not.toBeNull();
    });

    it('records a 400 per-op error for an unknown op-type', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        const req = makeReq({
            body: {
                operations: [{ op: 'evaporate', path: '/x' }],
            },
            headers: { 'content-type': 'application/json' },
            actor,
        });
        await withActor(actor, () => controller.batch(req, res));
        expect(captured.statusCode).toBe(218);
        const body = captured.body as {
            results: Array<Record<string, unknown>>;
        };
        expect(body.results[0]).toMatchObject({
            error: true,
            status: 400,
        });
    });
});
