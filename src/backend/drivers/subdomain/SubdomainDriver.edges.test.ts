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

/**
 * Guard rails and wire shape for the `puter-subdomains` driver.
 *
 * The sibling SubdomainDriver.test.ts covers the CRUD happy paths. This suite
 * pins the refusals a hosting API has to get right — quota, reserved and
 * malformed names, protected rows, app-actor scoping, verified-email gating —
 * and the exact hydrated row a client receives.
 */

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor } from '../../core/actor.js';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { SubdomainDriver } from './SubdomainDriver.js';

let server: PuterServer;
let driver: SubdomainDriver;

beforeAll(async () => {
    server = await setupTestServer({
        max_subdomains_per_user: 2,
        static_hosting_domain: 'puter.site',
        protocol: 'https:',
    } as never);
    driver = server.drivers.subdomains as unknown as SubdomainDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async () => {
    const username = `sde-${Math.random().toString(36).slice(2, 10)}`;
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
    const user = (await server.stores.user.getById(created.id))!;
    return {
        userId: user.id,
        username: user.username,
        actor: {
            user: {
                id: user.id,
                uuid: user.uuid,
                username: user.username,
                email: user.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        } as Actor,
    };
};

const withActor = <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

const uniqueName = (prefix: string) =>
    `${prefix}${Math.random().toString(36).slice(2, 10)}`;

const createSubdomain = (actor: Actor, subdomain: string) =>
    withActor(actor, () =>
        driver.create({ object: { subdomain, root_dir: '~/Public' } }),
    ) as Promise<Record<string, unknown>>;

// -- Name validation -------------------------------------------------

describe('SubdomainDriver name validation', () => {
    it('rejects a non-string or blank subdomain with 400', async () => {
        const { actor } = await makeUser();
        for (const subdomain of [undefined, 42, '', '   ']) {
            await expect(
                withActor(actor, () =>
                    driver.create({
                        object: { subdomain, root_dir: '~/Public' },
                    }),
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
        }
    });

    it('rejects a subdomain longer than the 64-character cap', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: { subdomain: 'a'.repeat(65), root_dir: '~/Public' },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('reports the reserved-name refusal with its own legacy code', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: { subdomain: 'api', root_dir: '~/Public' },
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'subdomain_reserved',
        });
    });

    it('normalizes surrounding whitespace and case before storing', async () => {
        const { actor } = await makeUser();
        const name = uniqueName('mixedcase');
        const created = (await withActor(actor, () =>
            driver.create({
                object: {
                    subdomain: `  ${name.toUpperCase()}  `,
                    root_dir: '~/Public',
                },
            }),
        )) as Record<string, unknown>;
        expect(created.subdomain).toBe(name);
    });
});

// -- Quota -----------------------------------------------------------

describe('SubdomainDriver quota', () => {
    it('refuses past the configured per-user limit', async () => {
        const { actor } = await makeUser();
        await createSubdomain(actor, uniqueName('quota'));
        await createSubdomain(actor, uniqueName('quota'));

        await expect(
            createSubdomain(actor, uniqueName('quota')),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'subdomain_limit_reached',
        });
    });

    it('lets a per-user max_subdomains override the config default', async () => {
        const { actor } = await makeUser();
        (actor.user as unknown as Record<string, unknown>).max_subdomains = 1;

        await createSubdomain(actor, uniqueName('override'));
        await expect(
            createSubdomain(actor, uniqueName('override')),
        ).rejects.toMatchObject({ legacyCode: 'subdomain_limit_reached' });
    });
});

// -- Resolution ------------------------------------------------------

describe('SubdomainDriver row resolution', () => {
    it('resolves by uid, by a bare id string, and by { id: { uid } }', async () => {
        const { actor } = await makeUser();
        const name = uniqueName('resolve');
        const created = await createSubdomain(actor, name);
        const uid = created.uid as string;

        const byUid = (await withActor(actor, () =>
            driver.read({ uid }),
        )) as Record<string, unknown>;
        const byBareId = (await withActor(actor, () =>
            driver.read({ id: uid }),
        )) as Record<string, unknown>;
        const byIdObject = (await withActor(actor, () =>
            driver.read({ id: { uid } }),
        )) as Record<string, unknown>;

        expect(byUid.subdomain).toBe(name);
        expect(byBareId.subdomain).toBe(name);
        expect(byIdObject.subdomain).toBe(name);
    });

    it('404s when the args carry no usable identifier at all', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.read({})),
        ).rejects.toMatchObject({ statusCode: 404 });
        await expect(
            withActor(actor, () => driver.read({ id: { nothing: true } })),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

// -- Delete ----------------------------------------------------------

describe('SubdomainDriver.delete guards', () => {
    it('refuses to delete a protected subdomain', async () => {
        const { actor, userId } = await makeUser();
        const name = uniqueName('prot');
        const created = await createSubdomain(actor, name);
        await server.clients.db.write(
            'UPDATE `subdomains` SET `protected` = 1 WHERE `uuid` = ?',
            [created.uid],
        );

        await expect(
            withActor(actor, () => driver.delete({ uid: created.uid })),
        ).rejects.toMatchObject({ statusCode: 403, legacyCode: 'forbidden' });

        // Still there.
        const rows = await server.stores.subdomain.listByUserId(userId, {});
        expect(rows.some((r) => r.subdomain === name)).toBe(true);
    });

    it('emits subdomain.delete and returns the deleted uid', async () => {
        const { actor } = await makeUser();
        const name = uniqueName('del');
        const created = await createSubdomain(actor, name);
        const emitted: Array<{ subdomain: string }> = [];
        server.clients.event.on('subdomain.delete', (_k, data) => {
            emitted.push(data as { subdomain: string });
        });

        const result = await withActor(actor, () =>
            driver.delete({ uid: created.uid }),
        );

        expect(result).toEqual({ success: true, uid: created.uid });
        expect(emitted.some((e) => e.subdomain === name)).toBe(true);
    });
});

// -- App-actor scoping -----------------------------------------------

describe('SubdomainDriver app-actor scoping', () => {
    const seedApp = async (ownerUserId: number, label: string) =>
        await server.stores.app.create(
            {
                name: `${label}-${Math.random().toString(36).slice(2, 8)}`,
                title: label,
                index_url: `https://${label}.example.com/`,
            },
            { ownerUserId },
        );

    // The FS ACL path is covered by the create tests above; here the rows are
    // seeded directly so the app-scoping rules are the only thing under test.
    const seedRow = async (
        userId: number,
        subdomain: string,
        appOwner: number | null,
    ) =>
        await server.stores.subdomain.create({
            userId,
            subdomain,
            rootDirId: null,
            associatedAppId: null,
            appOwner,
        });

    // Built through `makeActor` so `effectiveApp` is derived the way the auth
    // path derives it. An actor literal carrying only `app` leaves it
    // undefined, which the read gate reads as "no app acting" — such an actor
    // would sail past the very scoping these tests exist to pin.
    const asApp = (base: Actor, app: { uid: string; id: number }): Actor =>
        makeActor({ ...base, app: { uid: app.uid, id: app.id } });

    it('lets the owning app read and update the row', async () => {
        const { actor, userId } = await makeUser();
        const app = await seedApp(userId, 'owner-app');
        const appActor: Actor = asApp(actor, app);
        const name = uniqueName('appscope');
        const row = await seedRow(userId, name, app.id);

        const read = (await withActor(appActor, () =>
            driver.read({ uid: row.uuid }),
        )) as Record<string, unknown>;
        expect(read.subdomain).toBe(name);
        expect((read.app_owner as { uid: string }).uid).toBe(app.uid);

        const updated = (await withActor(appActor, () =>
            driver.update({
                uid: row.uuid,
                object: { domain: 'custom.test' },
            }),
        )) as Record<string, unknown>;
        expect(updated.domain).toBe('custom.test');
    });

    it('refuses a different app of the same user write access to the row', async () => {
        const { actor, userId } = await makeUser();
        const ownerApp = await seedApp(userId, 'first-app');
        const otherApp = await seedApp(userId, 'second-app');
        const row = await seedRow(userId, uniqueName('appdeny'), ownerApp.id);

        await expect(
            withActor(asApp(actor, otherApp), () =>
                driver.delete({ uid: row.uuid }),
            ),
        ).rejects.toMatchObject({ statusCode: 403, legacyCode: 'forbidden' });
    });

    it('refuses the owning app when the row belongs to a different user', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const app = await seedApp(owner.userId, 'mismatch-app');
        const row = await seedRow(owner.userId, uniqueName('appmix'), app.id);

        await expect(
            withActor(asApp(stranger.actor, app), () =>
                driver.delete({ uid: row.uuid }),
            ),
        ).rejects.toMatchObject({ statusCode: 403, legacyCode: 'forbidden' });
    });

    it('refuses an app reading a row of a different user that shares its app_owner', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const app = await seedApp(owner.userId, 'reader-app');
        const name = uniqueName('appread');
        const row = await seedRow(owner.userId, name, app.id);

        // `app_owner` is a global app id, so every user of an app shares it.
        // Granting on that alone would hand the owner's username, uuid and
        // home path to anyone else acting under the same app.
        await expect(
            withActor(asApp(stranger.actor, app), () =>
                driver.read({ uid: row.uuid }),
            ),
        ).rejects.toMatchObject({ statusCode: 403, legacyCode: 'forbidden' });

        await expect(
            withActor(asApp(stranger.actor, app), () =>
                driver.read({ id: { subdomain: name } }),
            ),
        ).rejects.toMatchObject({ statusCode: 403, legacyCode: 'forbidden' });
    });

    it('refuses an app reading its own user rows that belong to another app', async () => {
        const { actor, userId } = await makeUser();
        const ownerApp = await seedApp(userId, 'creator-app');
        const otherApp = await seedApp(userId, 'nosy-app');
        const scoped = uniqueName('appscoped');
        const loose = uniqueName('apploose');
        const scopedRow = await seedRow(userId, scoped, ownerApp.id);
        const looseRow = await seedRow(userId, loose, null);

        // Same scoping `select` applies: an app sees what it created, not
        // everything its user owns. Rows with no owning app included.
        for (const uid of [scopedRow.uuid, looseRow.uuid]) {
            await expect(
                withActor(asApp(actor, otherApp), () => driver.read({ uid })),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'forbidden',
            });
        }

        // The user acting directly still reads both.
        for (const uid of [scopedRow.uuid, looseRow.uuid]) {
            const read = (await withActor(actor, () =>
                driver.read({ uid }),
            )) as Record<string, unknown>;
            expect(read.uid).toBe(uid);
        }
    });

    it('does not answer for worker rows, which belong to the workers driver', async () => {
        const { actor, userId } = await makeUser();
        const name = uniqueName('wk');
        const row = await seedRow(userId, `workers.puter.${name}`, null);

        // Same 404 as a miss: the name resolves globally, so a distinct
        // refusal would confirm the row exists.
        for (const args of [
            { uid: row.uuid },
            { id: { subdomain: `workers.puter.${name}` } },
        ]) {
            await expect(
                withActor(actor, () => driver.read(args)),
            ).rejects.toMatchObject({
                statusCode: 404,
                legacyCode: 'not_found',
            });
        }
    });

    it('scopes select to the acting app', async () => {
        const { actor, userId } = await makeUser();
        const app = await seedApp(userId, 'listing-app');
        const appActor: Actor = asApp(actor, app);
        const appOwned = uniqueName('applist');
        const userOwned = uniqueName('userlist');
        await seedRow(userId, appOwned, app.id);
        await seedRow(userId, userOwned, null);

        const seen = (
            (await withActor(appActor, () => driver.select({}))) as Array<{
                subdomain: string;
            }>
        ).map((r) => r.subdomain);

        expect(seen).toContain(appOwned);
        expect(seen).not.toContain(userOwned);
    });
});

// -- Cross-user reads via permission ---------------------------------

describe('SubdomainDriver read-all-subdomains permission', () => {
    it("lets a permitted actor read and list another user's subdomains", async () => {
        const owner = await makeUser();
        const admin = await makeUser();
        const name = uniqueName('crossread');
        const created = await createSubdomain(owner.actor, name);

        // Only `read-all-subdomains` is granted; every other check falls
        // through to the real permission service.
        vi.spyOn(server.services.permission, 'check').mockImplementation(
            async (_actor: unknown, permission: string) =>
                permission === 'read-all-subdomains',
        );
        try {
            const read = (await withActor(admin.actor, () =>
                driver.read({ uid: created.uid }),
            )) as Record<string, unknown>;
            expect(read.subdomain).toBe(name);

            const listed = (await withActor(admin.actor, () =>
                driver.select({ includeTotal: true }),
            )) as { items: Array<{ subdomain: string }>; total: number };
            expect(listed.items.map((r) => r.subdomain)).toContain(name);
            expect(listed.total).toBeGreaterThan(0);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('treats a permission-service failure as "no permission"', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const created = await createSubdomain(
            owner.actor,
            uniqueName('permerr'),
        );

        vi.spyOn(server.services.permission, 'check').mockRejectedValue(
            new Error('permission backend down'),
        );
        try {
            await expect(
                withActor(stranger.actor, () =>
                    driver.read({ uid: created.uid }),
                ),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'forbidden',
            });
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('does not widen the listing when the predicate asks for editable rows only', async () => {
        const owner = await makeUser();
        const admin = await makeUser();
        const ownerName = uniqueName('editonly');
        await createSubdomain(owner.actor, ownerName);

        vi.spyOn(server.services.permission, 'check').mockResolvedValue(
            true as never,
        );
        try {
            const seen = (
                (await withActor(admin.actor, () =>
                    driver.select({ predicate: 'user-can-edit' }),
                )) as Array<{ subdomain: string }>
            ).map((r) => r.subdomain);
            expect(seen).not.toContain(ownerName);
        } finally {
            vi.restoreAllMocks();
        }
    });
});

// -- Update ----------------------------------------------------------

describe('SubdomainDriver.update field handling', () => {
    it('clears a custom domain when passed null and ignores associated_app_uid', async () => {
        const { actor } = await makeUser();
        const created = await createSubdomain(actor, uniqueName('domain'));

        await withActor(actor, () =>
            driver.update({
                uid: created.uid,
                object: { domain: 'first.test' },
            }),
        );
        const cleared = (await withActor(actor, () =>
            driver.update({
                uid: created.uid,
                object: {
                    domain: null,
                    associated_app_uid: 'app-does-not-exist',
                },
            }),
        )) as Record<string, unknown>;

        // A null domain round-trips as the empty string in the wire shape.
        expect(cleared.domain).toBe('');
        expect(cleared.associated_app).toBeNull();
    });

    it('rejects repointing root_dir at a path that does not exist', async () => {
        const { actor } = await makeUser();
        const created = await createSubdomain(actor, uniqueName('badroot'));

        await expect(
            withActor(actor, () =>
                driver.update({
                    uid: created.uid,
                    object: { root_dir: '~/NoSuchDirectory' },
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
        });
    });

    it("rejects repointing root_dir into another user's tree", async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const created = await createSubdomain(owner.actor, uniqueName('xroot'));

        const err = await withActor(owner.actor, () =>
            driver.update({
                uid: created.uid,
                object: { root_dir: `/${stranger.username}/Public` },
            }),
        ).then(
            () => null,
            (e: unknown) => e,
        );
        expect([403, 404]).toContain(
            (err as { statusCode?: number })?.statusCode,
        );
    });

    it('404s when updating a subdomain that does not exist', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.update({ uid: uuidv4(), object: { domain: 'x.test' } }),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

// -- Hydrated wire shape ---------------------------------------------

describe('SubdomainDriver hydrated wire shape', () => {
    it('returns owner, root_dir and metadata without exposing raw row ids', async () => {
        const { actor, username } = await makeUser();
        const name = uniqueName('shape');
        const created = await createSubdomain(actor, name);

        expect(created).toMatchObject({
            subdomain: name,
            domain: '',
            associated_app: null,
            app_owner: null,
            protected: false,
        });
        expect(created.owner).toEqual({
            username,
            uuid: actor.user!.uuid,
        });
        expect(typeof created.uid).toBe('string');

        const rootDir = created.root_dir as Record<string, unknown>;
        expect(rootDir.path).toBe(`/${username}/Public`);
        expect(rootDir.is_dir).toBe(true);
        expect(rootDir.writable).toBe(true);
        // Internal database ids must never reach the client.
        expect('user_id' in created).toBe(false);
        expect('root_dir_id' in created).toBe(false);
        expect('bucket' in rootDir).toBe(false);
    });

    it('derives associated_app from an owned app whose index_url matches the host', async () => {
        const { actor, userId } = await makeUser();
        const name = uniqueName('assoc');
        const app = await server.stores.app.create(
            {
                name: `assoc-${name}`,
                title: 'Associated',
                index_url: `https://${name}.puter.site/`,
            },
            { ownerUserId: userId },
        );

        const created = await createSubdomain(actor, name);
        const associated = created.associated_app as Record<string, unknown>;
        expect(associated).toBeTruthy();
        expect(associated.uid).toBe(app.uid);
        expect(associated.title).toBe('Associated');
        expect(associated.filetype_associations).toEqual([]);
    });
});

// -- Verified-email gate ---------------------------------------------

describe('SubdomainDriver verified-email gate', () => {
    it('blocks writes from an unconfirmed account when strict verification is on', async () => {
        const strictServer = await setupTestServer({
            strict_email_verification_required: true,
        } as never);
        try {
            const strictDriver = strictServer.drivers
                .subdomains as unknown as SubdomainDriver;
            const created = await strictServer.stores.user.create({
                username: `sdstrict${Math.random().toString(36).slice(2, 8)}`,
                uuid: uuidv4(),
                password: null,
                email: 'unconfirmed@test.local',
                requires_email_confirmation: true,
            });
            const unverified: Actor = {
                user: {
                    id: created.id,
                    uuid: created.uuid,
                    username: created.username,
                    email: created.email ?? null,
                    email_confirmed: false,
                } as Actor['user'],
            };

            await expect(
                runWithContext({ actor: unverified }, () =>
                    strictDriver.create({
                        object: {
                            subdomain: uniqueName('strict'),
                            root_dir: '~/Public',
                        },
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        } finally {
            await strictServer.shutdown();
        }
    });
});
