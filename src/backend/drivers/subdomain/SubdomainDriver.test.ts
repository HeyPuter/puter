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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { SubdomainDriver } from './SubdomainDriver.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one PuterServer (in-memory sqlite + dynamo + s3 + mock redis)
// and exercises the live SubdomainDriver against the real wired stores.
// Each test makes its own user via `makeUser` so subdomain rows / quota
// counts don't leak across cases.

let server: PuterServer;
let driver: SubdomainDriver;

beforeAll(async () => {
    server = await setupTestServer();
    driver = server.drivers.subdomains as unknown as SubdomainDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `sd-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    // Driver checks ACL on `root_dir`, which requires the home tree to
    // exist — without provisioning, every create call would 400.
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

const withActor = async <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

const uniqueSubdomain = (prefix: string) =>
    `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

// ── create ──────────────────────────────────────────────────────────

describe('SubdomainDriver.create', () => {
    it('creates a subdomain pointing at an owned fs path', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const sub = uniqueSubdomain('site');

        const result = (await withActor(actor, () =>
            driver.create({
                object: {
                    subdomain: sub,
                    root_dir: `/${username}/Public`,
                },
            }),
        )) as Record<string, unknown> | null;

        expect(result).not.toBeNull();
        expect(result?.subdomain).toBe(sub);
        // Owner is hydrated as `{ username, uuid }`, not a numeric id.
        expect(result?.owner).toMatchObject({ username });

        const row =
            await server.stores.subdomain.getBySubdomain(sub);
        expect(row?.user_id).toBe(userId);
    });

    it('expands `~/Public` against the actor home before resolving root_dir', async () => {
        const { actor } = await makeUser();
        const sub = uniqueSubdomain('tilde');

        await withActor(actor, () =>
            driver.create({
                object: { subdomain: sub, root_dir: '~/Public' },
            }),
        );

        const row =
            await server.stores.subdomain.getBySubdomain(sub);
        expect(row).not.toBeNull();
    });

    it('rejects an invalid subdomain format with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        subdomain: 'NOT_VALID!',
                        root_dir: `/${actor.user!.username}/Public`,
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a reserved subdomain word with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        subdomain: 'admin',
                        root_dir: `/${actor.user!.username}/Public`,
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a duplicate subdomain with 409', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const sub = uniqueSubdomain('dup');

        await withActor(a.actor, () =>
            driver.create({
                object: {
                    subdomain: sub,
                    root_dir: `/${a.actor.user!.username}/Public`,
                },
            }),
        );

        await expect(
            withActor(b.actor, () =>
                driver.create({
                    object: {
                        subdomain: sub,
                        root_dir: `/${b.actor.user!.username}/Public`,
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('rejects when root_dir does not exist', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        subdomain: uniqueSubdomain('missing'),
                        root_dir: `/${actor.user!.username}/does-not-exist`,
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects pointing root_dir at another user's tree", async () => {
        const a = await makeUser();
        const b = await makeUser();
        await expect(
            withActor(a.actor, () =>
                driver.create({
                    object: {
                        subdomain: uniqueSubdomain('intruder'),
                        root_dir: `/${b.actor.user!.username}/Public`,
                    },
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: expect.any(Number),
        });
    });

    it('rejects a missing object body with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({} as Record<string, unknown>),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 401 with no actor in context', async () => {
        await expect(
            driver.create({
                object: {
                    subdomain: uniqueSubdomain('noctx'),
                    root_dir: '/x',
                },
            }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── read / select ───────────────────────────────────────────────────

describe('SubdomainDriver.read / select', () => {
    it('reads a subdomain by uid for its owner', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const sub = uniqueSubdomain('read');

        const created = (await withActor(actor, () =>
            driver.create({
                object: { subdomain: sub, root_dir: `/${username}/Public` },
            }),
        )) as Record<string, unknown>;

        const fetched = (await withActor(actor, () =>
            driver.read({ uid: created.uid }),
        )) as Record<string, unknown> | null;

        expect(fetched?.subdomain).toBe(sub);
    });

    it('reads via id object with `{ subdomain }`', async () => {
        const { actor } = await makeUser();
        const sub = uniqueSubdomain('read-by-name');
        await withActor(actor, () =>
            driver.create({
                object: {
                    subdomain: sub,
                    root_dir: `/${actor.user!.username}/Public`,
                },
            }),
        );

        const fetched = (await withActor(actor, () =>
            driver.read({ id: { subdomain: sub } }),
        )) as Record<string, unknown> | null;

        expect(fetched?.subdomain).toBe(sub);
    });

    it("rejects reading another user's subdomain with 403", async () => {
        const a = await makeUser();
        const b = await makeUser();
        const sub = uniqueSubdomain('private');

        const created = (await withActor(a.actor, () =>
            driver.create({
                object: {
                    subdomain: sub,
                    root_dir: `/${a.actor.user!.username}/Public`,
                },
            }),
        )) as Record<string, unknown>;

        await expect(
            withActor(b.actor, () => driver.read({ uid: created.uid })),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 404 when reading a missing subdomain', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.read({ uid: 'nonexistent-uuid' }),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('select returns only the actor-owned subdomains', async () => {
        const a = await makeUser();
        const b = await makeUser();
        await withActor(a.actor, () =>
            driver.create({
                object: {
                    subdomain: uniqueSubdomain('mine'),
                    root_dir: `/${a.actor.user!.username}/Public`,
                },
            }),
        );
        await withActor(b.actor, () =>
            driver.create({
                object: {
                    subdomain: uniqueSubdomain('theirs'),
                    root_dir: `/${b.actor.user!.username}/Public`,
                },
            }),
        );

        const result = (await withActor(a.actor, () =>
            driver.select({}),
        )) as Array<Record<string, unknown>>;

        // Owners surface as `{ username, uuid }`; assert we only see a's.
        for (const row of result) {
            expect((row.owner as { username: string }).username).toBe(
                a.actor.user!.username,
            );
        }
    });
});

// ── update ──────────────────────────────────────────────────────────

describe('SubdomainDriver.update', () => {
    it('updates root_dir to another owned path', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const sub = uniqueSubdomain('upd');

        const created = (await withActor(actor, () =>
            driver.create({
                object: { subdomain: sub, root_dir: `/${username}/Public` },
            }),
        )) as Record<string, unknown>;

        const updated = (await withActor(actor, () =>
            driver.update({
                uid: created.uid,
                object: { root_dir: `/${username}/Documents` },
            }),
        )) as Record<string, unknown> | null;

        expect(updated).not.toBeNull();
        const rootDir = updated!.root_dir as Record<string, unknown> | null;
        expect(rootDir?.path).toBe(`/${username}/Documents`);
    });

    it('refuses to update a subdomain owned by another user with 403', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const sub = uniqueSubdomain('cross-upd');

        const created = (await withActor(a.actor, () =>
            driver.create({
                object: {
                    subdomain: sub,
                    root_dir: `/${a.actor.user!.username}/Public`,
                },
            }),
        )) as Record<string, unknown>;

        await expect(
            withActor(b.actor, () =>
                driver.update({
                    uid: created.uid,
                    object: {
                        root_dir: `/${b.actor.user!.username}/Public`,
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 404 for a missing object body', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.update({ uid: 'whatever' } as Record<string, unknown>),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── upsert ──────────────────────────────────────────────────────────

describe('SubdomainDriver.upsert', () => {
    it('creates when no row matches the args', async () => {
        const { actor } = await makeUser();
        const sub = uniqueSubdomain('ups');
        const result = (await withActor(actor, () =>
            driver.upsert({
                object: {
                    subdomain: sub,
                    root_dir: `/${actor.user!.username}/Public`,
                },
            }),
        )) as Record<string, unknown> | null;
        expect(result?.subdomain).toBe(sub);
    });

    it('updates when an existing row resolves via id.subdomain', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const sub = uniqueSubdomain('ups-existing');
        await withActor(actor, () =>
            driver.create({
                object: { subdomain: sub, root_dir: `/${username}/Public` },
            }),
        );

        const result = (await withActor(actor, () =>
            driver.upsert({
                id: { subdomain: sub },
                object: { root_dir: `/${username}/Documents` },
            }),
        )) as Record<string, unknown> | null;

        const rootDir = result!.root_dir as Record<string, unknown> | null;
        expect(rootDir?.path).toBe(`/${username}/Documents`);
    });
});

// ── delete ──────────────────────────────────────────────────────────

describe('SubdomainDriver.delete', () => {
    it('deletes an owned subdomain and reports success', async () => {
        const { actor } = await makeUser();
        const sub = uniqueSubdomain('del');
        const created = (await withActor(actor, () =>
            driver.create({
                object: {
                    subdomain: sub,
                    root_dir: `/${actor.user!.username}/Public`,
                },
            }),
        )) as Record<string, unknown>;

        const result = (await withActor(actor, () =>
            driver.delete({ uid: created.uid }),
        )) as { success: boolean; uid: string };

        expect(result.success).toBe(true);
        expect(result.uid).toBe(created.uid);
        expect(
            await server.stores.subdomain.getBySubdomain(sub),
        ).toBeNull();
    });

    it("refuses to delete another user's subdomain with 403", async () => {
        const a = await makeUser();
        const b = await makeUser();
        const sub = uniqueSubdomain('cross-del');
        const created = (await withActor(a.actor, () =>
            driver.create({
                object: {
                    subdomain: sub,
                    root_dir: `/${a.actor.user!.username}/Public`,
                },
            }),
        )) as Record<string, unknown>;

        await expect(
            withActor(b.actor, () => driver.delete({ uid: created.uid })),
        ).rejects.toMatchObject({ statusCode: 403 });

        // a's row is still there.
        expect(
            await server.stores.subdomain.getBySubdomain(sub),
        ).not.toBeNull();
    });

    it('returns 404 for a non-existent subdomain', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.delete({ uid: 'nonexistent-uuid' }),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});
