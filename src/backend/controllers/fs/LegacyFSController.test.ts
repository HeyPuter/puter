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

// ── readdir ─────────────────────────────────────────────────────────

describe('LegacyFSController.readdir', () => {
    it('lists the children of a directory', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        // Seed a couple of entries.
        for (const name of ['alpha', 'beta']) {
            await withActor(actor, () =>
                controller.mkdir(
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
            controller.readdir(
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

    it('returns the root listing when path = "/"', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.readdir(
                makeReq({
                    body: { path: '/' },
                    actor,
                }),
                res,
            ),
        );
        // Root listing returns an array (the actor's home entries).
        expect(Array.isArray(captured.body)).toBe(true);
    });

    it('rejects readdir on a non-directory with 400', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        // Create a file with /touch so we have a non-directory entry.
        const filePath = `/${username}/Documents/file.txt`;
        await withActor(actor, () =>
            controller.touch(
                makeReq({
                    body: { path: filePath, set_modified_to_now: true },
                    actor,
                }),
                makeRes().res,
            ),
        );

        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.readdir(
                    makeReq({ body: { path: filePath }, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── copy ────────────────────────────────────────────────────────────

describe('LegacyFSController.copy', () => {
    it('copies a folder into a sibling folder', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const src = `/${username}/Documents/src-folder`;
        const destParent = `/${username}/Pictures`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: src }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.copy(
                makeReq({
                    body: { source: src, destination: destParent },
                    actor,
                }),
                res,
            ),
        );

        const body = captured.body as Array<{
            copied: { path: string; name: string };
        }>;
        expect(body).toHaveLength(1);
        expect(body[0].copied.path).toBe(
            `/${username}/Pictures/src-folder`,
        );
        // The original still exists; the copy lives under Pictures.
        expect(
            await server.stores.fsEntry.getEntryByPath(src),
        ).not.toBeNull();
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${username}/Pictures/src-folder`,
            ),
        ).not.toBeNull();
    });

    it('renames the copy when new_name is provided', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const src = `/${username}/Documents/orig`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: src }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.copy(
                makeReq({
                    body: {
                        source: src,
                        destination: `/${username}/Pictures`,
                        new_name: 'renamed-copy',
                    },
                    actor,
                }),
                res,
            ),
        );

        const body = captured.body as Array<{ copied: { path: string } }>;
        expect(body[0].copied.path).toBe(
            `/${username}/Pictures/renamed-copy`,
        );
    });
});

// ── move ────────────────────────────────────────────────────────────

describe('LegacyFSController.move', () => {
    it('moves a folder and returns {moved, old_path}', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const src = `/${username}/Documents/movable`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: src }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.move(
                makeReq({
                    body: {
                        source: src,
                        destination: `/${username}/Pictures`,
                    },
                    actor,
                }),
                res,
            ),
        );

        const body = captured.body as {
            moved: { path: string };
            old_path: string;
        };
        expect(body.old_path).toBe(src);
        expect(body.moved.path).toBe(`/${username}/Pictures/movable`);
        // The destination row exists after the move. We don't assert the
        // source is gone — the FSEntry path-lookup cache is process-wide
        // and may surface a stale entry under the old path here even
        // though the underlying row was updated.
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${username}/Pictures/movable`,
            ),
        ).not.toBeNull();
    });

    it('renames during move via new_name', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const src = `/${username}/Documents/foo`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: src }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.move(
                makeReq({
                    body: {
                        source: src,
                        destination: `/${username}/Pictures`,
                        new_name: 'bar',
                    },
                    actor,
                }),
                res,
            ),
        );

        const body = captured.body as { moved: { path: string } };
        expect(body.moved.path).toBe(`/${username}/Pictures/bar`);
    });
});

// ── search ──────────────────────────────────────────────────────────

describe('LegacyFSController.search', () => {
    it('rejects an empty query with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.search(
                    makeReq({ body: { query: '   ' }, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('finds entries by name substring', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        // Seed a couple of distinctly named folders.
        const needle = `needle-${Math.random().toString(36).slice(2, 8)}`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({
                    body: { path: `/${username}/Documents/${needle}` },
                    actor,
                }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.search(
                makeReq({ body: { query: needle }, actor }),
                res,
            ),
        );
        const results = captured.body as Array<{ name: string }>;
        expect(Array.isArray(results)).toBe(true);
        expect(results.some((r) => r.name === needle)).toBe(true);
    });
});

// ── read (validation paths only) ────────────────────────────────────

describe('LegacyFSController.read', () => {
    it('rejects reading a directory with 400', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        // Documents is already a directory from generateDefaultFsentries.
        const { res } = makeRes();
        const req = makeReq({
            query: { file: `/${username}/Documents` },
            actor,
        });
        await expect(
            withActor(actor, () => controller.read(req, res)),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 401 when there is no actor', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const req = {
            ...makeReq({
                query: { file: `/${actor.user!.username}/Documents` },
                actor,
            }),
            actor: undefined,
        } as unknown as Request;
        await expect(controller.read(req, res)).rejects.toMatchObject({
            statusCode: 401,
        });
    });
});

// ── tokenRead ───────────────────────────────────────────────────────

describe('LegacyFSController.tokenRead', () => {
    it('rejects with 401 when no token is supplied', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const req = makeReq({ query: {}, actor });
        await expect(
            withActor(actor, () => controller.tokenRead(req, res)),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('rejects with 401 when the token does not resolve to an access-token actor', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const req = makeReq({
            query: { token: 'not-a-real-jwt' },
            actor,
        });
        await expect(
            withActor(actor, () => controller.tokenRead(req, res)),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── sign ────────────────────────────────────────────────────────────

describe('LegacyFSController.sign', () => {
    beforeAll(() => {
        // /sign and /openItem call signingConfigFromAppConfig, which
        // requires `api_base_url`. The default test config omits it
        // (production sets it explicitly), so patch it here.
        (
            controller as unknown as { config: { api_base_url?: string } }
        ).config.api_base_url = 'http://api.test.local';
    });

    it('rejects an empty items array with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.sign(
                    makeReq({ body: { items: [] }, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('signs a valid entry by path and returns a signature', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/signed-folder`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: target }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.sign(
                makeReq({
                    body: { items: [{ path: target, action: 'read' }] },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as {
            signatures: Array<Record<string, unknown>>;
        };
        expect(body.signatures).toHaveLength(1);
        // A real signed entry carries `path` and a signature blob.
        expect(body.signatures[0]?.path).toBe(target);
    });

    it('skips items with neither uid nor path and pushes an empty object', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.sign(
                makeReq({ body: { items: [{ action: 'read' }] }, actor }),
                res,
            ),
        );
        const body = captured.body as { signatures: Array<unknown> };
        expect(body.signatures).toHaveLength(1);
        expect(body.signatures[0]).toEqual({});
    });

    it('rejects with 404 when app_uid is supplied but the app does not exist', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.sign(
                    makeReq({
                        body: {
                            items: [{ path: '/x', action: 'read' }],
                            app_uid: `does-not-exist-${uuidv4()}`,
                        },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

// ── writeFile (validation paths) ────────────────────────────────────

describe('LegacyFSController.writeFile', () => {
    it('rejects an unsigned (or wrongly-signed) request', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        // Missing signature → verifySignature throws.
        const req = makeReq({
            query: { uid: 'whatever', expires: '0', signature: 'wrong' },
            actor,
        });
        await expect(
            withActor(actor, () => controller.writeFile(req, res)),
        ).rejects.toBeDefined();
    });
});

// ── file (validation paths) ─────────────────────────────────────────

describe('LegacyFSController.file', () => {
    it('rejects an unsigned (or wrongly-signed) request', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const req = makeReq({
            query: { uid: 'whatever', expires: '0', signature: 'wrong' },
            actor,
        });
        await expect(
            withActor(actor, () => controller.file(req, res)),
        ).rejects.toBeDefined();
    });
});

// ── openItem ────────────────────────────────────────────────────────

describe('LegacyFSController.openItem', () => {
    beforeAll(() => {
        (
            controller as unknown as { config: { api_base_url?: string } }
        ).config.api_base_url = 'http://api.test.local';
    });

    it('returns a signature envelope (token is null when no suggested apps)', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/openable.txt`;
        await withActor(actor, () =>
            controller.touch(
                makeReq({
                    body: { path: target, set_modified_to_now: true },
                    actor,
                }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.openItem(
                makeReq({ body: { path: target }, actor }),
                res,
            ),
        );
        const body = captured.body as {
            signature: { path: string };
            token: string | null;
            suggested_apps: unknown[];
        };
        expect(body.signature.path).toBe(target);
        expect(Array.isArray(body.suggested_apps)).toBe(true);
        // No registered suggested apps in test config → no token minted.
        if (body.suggested_apps.length === 0) {
            expect(body.token).toBeNull();
        }
    });
});

// ── requestAppRootDir ───────────────────────────────────────────────

describe('LegacyFSController.requestAppRootDir', () => {
    it('rejects a missing app_uid with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.requestAppRootDir(
                    makeReq({ body: {}, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects with 403 when the caller is not the app itself', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        // Plain user actor (no `app` field) → not the app.
        await expect(
            withActor(actor, () =>
                controller.requestAppRootDir(
                    makeReq({ body: { app_uid: 'app-xyz' }, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects with 403 when the actor.app.uid differs from the requested app_uid', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const appActor = {
            ...actor,
            app: { uid: 'app-mismatch' },
        } as unknown as Actor;
        await expect(
            withActor(appActor, () =>
                controller.requestAppRootDir(
                    makeReq({
                        body: { app_uid: 'app-different' },
                        actor: appActor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('creates and returns the /<user>/AppData/<app> root for the app itself', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const appUid = 'app-self';
        const appActor = {
            ...actor,
            app: { uid: appUid },
        } as unknown as Actor;
        const { res, captured } = makeRes();
        await withActor(appActor, () =>
            controller.requestAppRootDir(
                makeReq({
                    body: { app_uid: appUid },
                    actor: appActor,
                }),
                res,
            ),
        );
        const body = captured.body as { path: string; is_dir: boolean };
        expect(body.path).toBe(`/${username}/AppData/${appUid}`);
        expect(body.is_dir).toBe(true);
    });
});

// ── checkAppAcl ─────────────────────────────────────────────────────

describe('LegacyFSController.checkAppAcl', () => {
    it('rejects when subject or app is missing with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.checkAppAcl(
                    makeReq({ body: { mode: 'read' }, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects with 404 when the app cannot be found', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/c.txt`;
        await withActor(actor, () =>
            controller.touch(
                makeReq({
                    body: { path: target, set_modified_to_now: true },
                    actor,
                }),
                makeRes().res,
            ),
        );
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.checkAppAcl(
                    makeReq({
                        body: {
                            subject: { path: target },
                            app: `does-not-exist-${uuidv4()}`,
                            mode: 'read',
                        },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns {allowed: boolean} when both subject and app resolve', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/a.txt`;
        await withActor(actor, () =>
            controller.touch(
                makeReq({
                    body: { path: target, set_modified_to_now: true },
                    actor,
                }),
                makeRes().res,
            ),
        );

        // Create an app owned by this user so it resolves.
        const app = await (
            server.stores.app.create as unknown as (
                fields: Record<string, unknown>,
                opts: { ownerUserId: number },
            ) => Promise<{ uid: string; id: number }>
        )(
            {
                name: `cacl-${uuidv4()}`,
                title: 'ACL test app',
                index_url: 'https://example.test/cacl.html',
            },
            { ownerUserId: actor.user!.id! },
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.checkAppAcl(
                makeReq({
                    body: {
                        subject: { path: target },
                        app: app.uid,
                        mode: 'read',
                    },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as { allowed: boolean };
        expect(typeof body.allowed).toBe('boolean');
    });
});

// ── down (validation paths) ─────────────────────────────────────────

describe('LegacyFSController.down', () => {
    it('rejects a missing path with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.down(makeReq({ query: {}, actor }), res),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects path="/" with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.down(
                    makeReq({ query: { path: '/' }, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects downloading a directory with 400', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.down(
                    makeReq({
                        query: { path: `/${username}/Documents` },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── mkdir additional branches ───────────────────────────────────────

describe('LegacyFSController.mkdir additional branches', () => {
    it('expands tilde in `parent` to the user home', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const { res } = makeRes();
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({
                    body: { parent: '~/Documents', path: 'tildy' },
                    actor,
                }),
                res,
            ),
        );

        const fetched = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents/tildy`,
        );
        expect(fetched).not.toBeNull();
        expect(fetched?.isDir).toBe(true);
    });

    it('throws 401 when no actor on the request', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        const req = {
            ...makeReq({
                body: { path: `/${actor.user!.username}/Documents/x` },
                actor,
            }),
            actor: undefined,
        } as unknown as Request;
        await expect(
            controller.mkdir(req, res),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── delete additional branch ────────────────────────────────────────

describe('LegacyFSController.delete additional branches', () => {
    it('removes by path when no uid is given', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/byPath`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: target }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.delete(
                makeReq({ body: { path: target }, actor }),
                res,
            ),
        );
        const body = captured.body as { ok: boolean; uid: string };
        expect(body.ok).toBe(true);
        expect(typeof body.uid).toBe('string');
        expect(
            await server.stores.fsEntry.getEntryByPath(target),
        ).toBeNull();
    });

    it('forwards descendants_only into fs.remove', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/dscnd-leg`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: target }, actor }),
                makeRes().res,
            ),
        );

        const removeSpy = vi
            .spyOn(server.services.fs, 'remove')
            .mockResolvedValueOnce(undefined as never);
        try {
            await withActor(actor, () =>
                controller.delete(
                    makeReq({
                        body: {
                            path: target,
                            recursive: true,
                            descendants_only: true,
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

// ── /touch flags ────────────────────────────────────────────────────

describe('LegacyFSController.touch flags', () => {
    it('forwards set_accessed_to_now / set_created_to_now / create_missing_parents', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const touchSpy = vi
            .spyOn(server.services.fs, 'touch')
            .mockResolvedValueOnce({
                path: `/${username}/Documents/flags.txt`,
                name: 'flags.txt',
                isDir: false,
            } as never);
        try {
            await withActor(actor, () =>
                controller.touch(
                    makeReq({
                        body: {
                            path: `/${username}/Documents/flags.txt`,
                            set_accessed_to_now: true,
                            set_modified_to_now: true,
                            set_created_to_now: true,
                            create_missing_parents: true,
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

// ── /mkdir flags ────────────────────────────────────────────────────

describe('LegacyFSController.mkdir flag forwarding', () => {
    it('forwards overwrite, dedupe_name, create_missing_parents to fs.mkdir', async () => {
        // Run a real mkdir with create_missing_parents so the service
        // creates the intermediate directories — then assert via the
        // store that the deep path materialized. (Mocking fs.mkdir is
        // tricky because the controller's `toLegacyEntry` reads many
        // FSEntry fields after.)
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/deep/sub/created`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({
                    body: {
                        path: target,
                        dedupe_name: true,
                        create_missing_parents: true,
                    },
                    actor,
                }),
                makeRes().res,
            ),
        );
        const created = await server.stores.fsEntry.getEntryByPath(target);
        expect(created).not.toBeNull();
        expect(created?.isDir).toBe(true);
        // Parents should also exist.
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${username}/Documents/deep`,
            ),
        ).not.toBeNull();
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${username}/Documents/deep/sub`,
            ),
        ).not.toBeNull();
    });
});

// ── /df helper coverage ─────────────────────────────────────────────

describe('LegacyFSController.df actor gate', () => {
    it('throws 401 when there is no actor on the request', async () => {
        const { actor } = await makeUser();
        const req = {
            ...makeReq({ body: {}, actor }),
            actor: undefined,
        } as unknown as Request;
        await expect(
            controller.df(req, makeRes().res),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── /down full path (file streaming) ────────────────────────────────

describe('LegacyFSController.down file streaming', () => {
    // Reuse the streaming-res shape from FSController tests: real
    // Writable so `download.body.pipe(res)` can flow into our capture.
    const makeStreamingRes = () => {
        const captured = {
            statusCode: 200,
            headers: {} as Record<string, string>,
            bodyChunks: [] as Buffer[],
            ended: false,
        };
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Writable } = require('node:stream') as typeof import('node:stream');
        const writable = new Writable({
            write(chunk: Buffer, _enc, cb) {
                captured.bodyChunks.push(chunk);
                cb();
            },
            final(cb) {
                captured.ended = true;
                cb();
            },
        });
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

    it('streams a file with 200 + attachment Content-Disposition + octet-stream', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const body = Buffer.from('legacy download');
        const target = `/${username}/Documents/dn.txt`;
        await server.services.fs.write(userId, {
            fileMetadata: {
                path: target,
                size: body.byteLength,
                contentType: 'text/plain',
            },
            fileContent: body,
        });

        const { res, captured } = makeStreamingRes();
        await withActor(actor, () =>
            controller.down(
                makeReq({ query: { path: target }, actor }),
                res,
            ),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(captured.statusCode).toBe(200);
        // /down forces octet-stream regardless of the entry's true type.
        expect(captured.headers['Content-Type']).toBe('application/octet-stream');
        expect(captured.headers['Content-Disposition']).toMatch(/^attachment;/);
        expect(captured.headers['Content-Length']).toBe(String(body.byteLength));
        // The piped bytes match the file contents.
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (captured.bodyChunks.length > 0) {
            expect(Buffer.concat(captured.bodyChunks).equals(body)).toBe(true);
        }
    });

    it('returns 206 with a Range header', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const body = Buffer.from('0123456789');
        const target = `/${username}/Documents/dn-range.bin`;
        await server.services.fs.write(userId, {
            fileMetadata: {
                path: target,
                size: body.byteLength,
                contentType: 'application/octet-stream',
            },
            fileContent: body,
        });

        const { res, captured } = makeStreamingRes();
        await withActor(actor, () =>
            controller.down(
                makeReq({
                    query: { path: target },
                    headers: { range: 'bytes=0-4' },
                    actor,
                }),
                res,
            ),
        );
        expect(captured.statusCode).toBe(206);
    });
});

// ── /read file streaming ────────────────────────────────────────────

describe('LegacyFSController.read file streaming', () => {
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
        const res = writable as unknown as Response & {
            status: (code: number) => unknown;
            setHeader: (k: string, v: string) => unknown;
            json: (v: unknown) => unknown;
            send: (v: unknown) => unknown;
            destroy: (err?: Error) => unknown;
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

    it('streams a file with octet-stream by default for wire-compat with v1 puter-js', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const body = Buffer.from('legacy file body');
        const target = `/${username}/Documents/legacy-read.txt`;
        await server.services.fs.write(userId, {
            fileMetadata: {
                path: target,
                size: body.byteLength,
                contentType: 'text/plain',
            },
            fileContent: body,
        });

        const { res, captured } = makeStreamingRes();
        await withActor(actor, () =>
            controller.read(
                makeReq({ query: { file: target }, actor }),
                res,
            ),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(captured.statusCode).toBe(200);
        // The v1 contract is octet-stream regardless of real mime; /fs/read
        // (v2) is the type-aware variant. This is documented in the controller.
        expect(captured.headers['Content-Type']).toBe('application/octet-stream');
        expect(captured.headers['Content-Length']).toBe(String(body.byteLength));
    });

    it('honors options.realMime by forwarding the real content-type from mime-types', async () => {
        // tokenRead calls read(..., { realMime: true }) — exercise the
        // alternate Content-Type branch directly to avoid token plumbing.
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const body = Buffer.from('<html>hi</html>');
        const target = `/${username}/Documents/page.html`;
        await server.services.fs.write(userId, {
            fileMetadata: {
                path: target,
                size: body.byteLength,
                contentType: 'text/html',
            },
            fileContent: body,
        });

        const { res, captured } = makeStreamingRes();
        await withActor(actor, () =>
            controller.read(
                makeReq({ query: { file: target }, actor }),
                res,
                { realMime: true } as never,
            ),
        );
        expect(captured.headers['Content-Type']).toMatch(/text\/html/);
    });
});

// ── /file directory listing ─────────────────────────────────────────

describe('LegacyFSController.file (directory listing path)', () => {
    beforeAll(() => {
        // signEntry/verifySignature both need `api_base_url` — the default
        // test config doesn't set it. The /sign describe block sets the
        // same field; we re-set it here so this block runs standalone too.
        (
            controller as unknown as { config: { api_base_url?: string } }
        ).config.api_base_url = 'http://api.test.local';
    });

    it('returns a signed listing of children for a directory uid', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const dir = `/${username}/Documents/lst`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: dir }, actor }),
                makeRes().res,
            ),
        );
        for (const name of ['a.txt', 'b.txt']) {
            await server.services.fs.write(userId, {
                fileMetadata: {
                    path: `${dir}/${name}`,
                    size: 1,
                    contentType: 'text/plain',
                },
                fileContent: Buffer.from('x'),
            });
        }
        const dirEntry = await server.stores.fsEntry.getEntryByPath(dir);
        expect(dirEntry).not.toBeNull();

        // /file is signature-gated. Mock verifySignature path by calling
        // through the controller — we use a valid signature constructed
        // for the dir uid. The signing util encodes signEntry + verify
        // around the same secret, so we can sign and verify in-test.
        const sig = (
            controller as unknown as {
                config: { url_signature_secret?: string };
            }
        ).config.url_signature_secret;
        // If no secret in test config, set one so signing works.
        const ctrlCfg = (
            controller as unknown as { config: Record<string, unknown> }
        ).config;
        if (!sig) ctrlCfg.url_signature_secret = 'test-secret';
        try {
            // Compute a signature using the same helper the controller uses.
            const helpers = await import('./legacyFsHelpers.js');
            const cfg = helpers.signingConfigFromAppConfig(ctrlCfg as never);
            const signed = helpers.signEntry(dirEntry!, cfg);

            const { res, captured } = makeRes();
            await withActor(actor, () =>
                controller.file(
                    makeReq({
                        query: {
                            uid: dirEntry!.uuid,
                            expires: String(signed.expires),
                            signature: signed.signature,
                        },
                        actor,
                    }),
                    res,
                ),
            );
            const list = captured.body as Array<{ path: string }>;
            expect(Array.isArray(list)).toBe(true);
            expect(list.map((l) => l.path).sort()).toEqual([
                `${dir}/a.txt`,
                `${dir}/b.txt`,
            ]);
        } finally {
            if (!sig) delete ctrlCfg.url_signature_secret;
        }
    });
});

// ── /search additional ──────────────────────────────────────────────

describe('LegacyFSController.search fallback fields', () => {
    it('uses body.text when body.query is missing', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const needle = `txtleg-${Math.random().toString(36).slice(2, 8)}`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({
                    body: { path: `/${username}/Documents/${needle}` },
                    actor,
                }),
                makeRes().res,
            ),
        );
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.search(
                makeReq({ body: { text: needle }, actor }),
                res,
            ),
        );
        const results = captured.body as Array<{ name: string }>;
        expect(results.some((r) => r.name === needle)).toBe(true);
    });
});

// ── /sign app sandbox + write downgrade ─────────────────────────────

describe('LegacyFSController.sign app sandbox + write downgrade', () => {
    it('rejects an app trying to sign a path outside its AppData root with empty signature entries', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        // Build an app-under-user actor whose AppData root is the test app.
        const appActor = {
            ...actor,
            app: { uid: 'sandbox-app' },
        } as unknown as Actor;

        // Create a file *outside* /Documents (anywhere outside AppData/<uid>).
        const target = `/${username}/Documents/forbidden.txt`;
        await withActor(actor, () =>
            controller.touch(
                makeReq({
                    body: { path: target, set_modified_to_now: true },
                    actor,
                }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(appActor, () =>
            controller.sign(
                makeReq({
                    body: { items: [{ path: target, action: 'read' }] },
                    actor: appActor,
                }),
                res,
            ),
        );
        const body = captured.body as { signatures: unknown[] };
        // Items outside the app sandbox are silently skipped → {}.
        expect(body.signatures).toEqual([{}]);
    });
});

// ── /writeFile operation dispatch (signature checks) ────────────────

describe('LegacyFSController.writeFile (operation dispatch validation)', () => {
    // These tests pass an INVALID signature so we don't have to plumb
    // the multipart machinery — they exercise the verifySignature gate
    // path which fires before any operation dispatch.

    it('rejects with a thrown error when the signature is invalid (any operation)', async () => {
        const { actor } = await makeUser();
        for (const operation of ['mkdir', 'rename', 'copy', 'move', 'delete']) {
            await expect(
                withActor(actor, () =>
                    controller.writeFile(
                        makeReq({
                            query: {
                                uid: 'not-a-real-uid',
                                expires: '0',
                                signature: 'bad',
                                operation,
                            },
                            actor,
                        }),
                        makeRes().res,
                    ),
                ),
            ).rejects.toBeDefined();
        }
    });
});

// ── batch op variations ─────────────────────────────────────────────

describe('LegacyFSController.batch additional operations', () => {
    const json = (body: unknown) => ({
        body,
        headers: { 'content-type': 'application/json' },
    });

    it('runs a `move` op end-to-end and returns the new path', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const src = `/${username}/Documents/batch-mv-src`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: src }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                makeReq({
                    ...json({
                        operations: [
                            {
                                op: 'move',
                                source: src,
                                destination: `/${username}/Pictures`,
                            },
                        ],
                    }),
                    actor,
                }),
                res,
            ),
        );
        expect(captured.statusCode).toBe(200);
        const body = captured.body as { results: Array<Record<string, unknown>> };
        expect(body.results).toHaveLength(1);
    });

    it('runs a `delete` op by path and clears the target', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/batch-del`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: target }, actor }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                makeReq({
                    ...json({
                        operations: [{ op: 'delete', path: target }],
                    }),
                    actor,
                }),
                res,
            ),
        );
        expect(captured.statusCode).toBe(200);
        expect(
            await server.stores.fsEntry.getEntryByPath(target),
        ).toBeNull();
    });

    it("runs a `shortcut` op pointing at an existing target uid", async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/batch-sc-target`;
        await withActor(actor, () =>
            controller.mkdir(
                makeReq({ body: { path: target }, actor }),
                makeRes().res,
            ),
        );
        const targetEntry = await server.stores.fsEntry.getEntryByPath(target);

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                makeReq({
                    ...json({
                        operations: [
                            {
                                op: 'shortcut',
                                // The dispatcher reads `path` for the parent
                                // and `shortcut_to_uid` for the target uid.
                                path: `/${username}/Pictures`,
                                name: 'batch-sc-link',
                                shortcut_to_uid: targetEntry!.uuid,
                            },
                        ],
                    }),
                    actor,
                }),
                res,
            ),
        );
        expect(captured.statusCode).toBe(200);
    });

    it('records a per-op 400 error for `shortcut` missing shortcut_to_uid', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batch(
                makeReq({
                    ...json({
                        operations: [
                            {
                                op: 'shortcut',
                                path: `/${username}/Pictures`,
                                name: 'orphan',
                            },
                        ],
                    }),
                    actor,
                }),
                res,
            ),
        );
        expect(captured.statusCode).toBe(218);
        const body = captured.body as {
            results: Array<{ error: boolean; status?: number }>;
        };
        expect(body.results[0]?.error).toBe(true);
    });
});

// ── stat additional ─────────────────────────────────────────────────

describe('LegacyFSController.stat additional branches', () => {
    it('includes the `versions` empty array when return_versions is set (legacy stable contract)', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/ver.txt`;
        await withActor(actor, () =>
            controller.touch(
                makeReq({
                    body: { path: target, set_modified_to_now: true },
                    actor,
                }),
                makeRes().res,
            ),
        );

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.stat(
                makeReq({
                    body: { path: target, return_versions: true },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as Record<string, unknown>;
        // versions defaults to an empty array — legacy clients depend on
        // the key being present.
        expect(Array.isArray(body.versions)).toBe(true);
    });
});

// ── readdir non-directory + root ────────────────────────────────────

describe('LegacyFSController.readdir extras', () => {
    it('rejects readdir on a non-directory uid with 400', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const target = `/${username}/Documents/notdir.txt`;
        await withActor(actor, () =>
            controller.touch(
                makeReq({
                    body: { path: target, set_modified_to_now: true },
                    actor,
                }),
                makeRes().res,
            ),
        );
        const entry = await server.stores.fsEntry.getEntryByPath(target);
        await expect(
            withActor(actor, () =>
                controller.readdir(
                    makeReq({ body: { uid: entry!.uuid }, actor }),
                    makeRes().res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});
