/*
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

import { Writable } from 'node:stream';
import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createPuterSiteMiddleware } from '../../core/http/middleware/puterSite.js';
import type { PuterServer } from '../../server.js';
import type { IConfig } from '../../types.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import {
    createTestUser,
    setupTestServer,
    TEST_ADMIN_CREDENTIALS,
} from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import {
    PROFILE_BIO_MAX_LENGTH,
    PROFILE_DISPLAY_NAME_MAX_LENGTH,
    PROFILE_PICTURE_MAX_BYTES,
    PROFILES_PATH_PREFIX,
    PROFILES_SUBDOMAIN,
    type ProfileService,
} from './ProfileService.js';

const PICTURE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';

describe('ProfileService', () => {
    let server: PuterServer;
    let service: ProfileService;

    /**
     * The plan each test user is on, by uuid. A resolver is registered once for
     * the life of the service, so a map it reads is what keeps one test's plan
     * out of the next one's.
     */
    const plans = new Map<string, string>();

    const makeUser = async (): Promise<UserRow> => {
        const username = `pr-${Math.random().toString(36).slice(2, 10)}`;
        const created = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: false,
        } as Parameters<typeof server.stores.user.create>[0]);
        await generateDefaultFsentries(
            server.clients.db,
            server.stores.user,
            created,
        );
        return (await server.stores.user.getById(created.id))!;
    };

    const onPlan = async <T>(
        user: UserRow,
        plan: string,
        fn: () => Promise<T>,
    ): Promise<T> => {
        plans.set(user.uuid, plan);
        server.services.metering.invalidateActorSubscription(user.uuid);
        try {
            return await fn();
        } finally {
            plans.delete(user.uuid);
            server.services.metering.invalidateActorSubscription(user.uuid);
        }
    };

    beforeAll(async () => {
        server = await setupTestServer();
        // `no_default_user` leaves no admin, so the bootstrap deferred; create
        // one the way the client env does and run it again.
        await createTestUser(server, {
            ...TEST_ADMIN_CREDENTIALS,
            admin: true,
        });
        service = server.services.profile;
        await service.ensureProfilesDirectory();

        server.services.metering.registerPolicy({
            id: 'business',
            monthUsageAllowance: 45 * 1_000_000 * 100,
            monthlyStorageAllowance: 1024 ** 3,
        });
        server.services.metering.registerSubscriptionResolver(
            (actor) => plans.get(actor.user?.uuid ?? '') ?? null,
        );
    }, 120_000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('bootstraps an admin-owned directory served by a protected system subdomain', async () => {
        const dir =
            await server.stores.fsEntry.getEntryByPath(PROFILES_PATH_PREFIX);
        const admin = await server.stores.user.getByUsername('admin');
        expect(dir?.isDir).toBe(true);
        expect(dir?.userId).toBe(admin!.id);

        const site =
            await server.stores.subdomain.getBySubdomain(PROFILES_SUBDOMAIN);
        expect(site?.user_id).toBe(admin!.id);
        expect(site?.root_dir_id).toBe(dir!.id);
        expect(Boolean(site?.protected)).toBe(true);

        // Running it again changes nothing.
        await service.ensureProfilesDirectory();
        expect(
            (await server.stores.subdomain.getBySubdomain(PROFILES_SUBDOMAIN))
                ?.uuid,
        ).toBe(site!.uuid);
    });

    it('reads an empty profile for a user who never set one', async () => {
        const user = await makeUser();
        expect(await service.getProfile(user)).toEqual({
            picture: null,
            displayName: null,
            bio: null,
        });
    });

    it('stores a patch as <uuid>.profile in the system directory and merges later patches', async () => {
        const user = await makeUser();
        expect(
            await service.updateProfile(user, {
                picture: PICTURE,
                displayName: '  Ada  ',
            }),
        ).toEqual({ picture: PICTURE, displayName: 'Ada', bio: null });

        const entry = await server.stores.fsEntry.getEntryByPath(
            `${PROFILES_PATH_PREFIX}/${user.uuid}.profile`,
        );
        const admin = await server.stores.user.getByUsername('admin');
        expect(entry).not.toBeNull();
        expect(entry!.userId).toBe(admin!.id);

        // A second patch leaves untouched fields alone, and `null` clears.
        expect(
            await service.updateProfile(user, { bio: 'hi', displayName: null }),
        ).toEqual({ picture: PICTURE, displayName: null, bio: 'hi' });
        expect(await service.getProfile(user)).toEqual({
            picture: PICTURE,
            displayName: null,
            bio: 'hi',
        });
    });

    it('rejects unknown fields, wrong types, bad pictures, and oversized values without writing', async () => {
        const user = await makeUser();
        const cases: Array<[unknown, string]> = [
            [{ name: 'x' }, 'profile_field_not_allowed'],
            [{ picture: 42 }, 'profile_field_invalid'],
            [
                { picture: 'https://example.com/a.png' },
                'profile_picture_invalid',
            ],
            [
                { picture: 'data:text/html;base64,SGk=' },
                'profile_picture_invalid',
            ],
            [
                {
                    picture: `data:image/png;base64,${'A'.repeat(PROFILE_PICTURE_MAX_BYTES)}`,
                },
                'profile_picture_too_large',
            ],
            [
                {
                    displayName: 'x'.repeat(
                        PROFILE_DISPLAY_NAME_MAX_LENGTH + 1,
                    ),
                },
                'profile_field_too_long',
            ],
            [
                { bio: 'x'.repeat(PROFILE_BIO_MAX_LENGTH + 1) },
                'profile_field_too_long',
            ],
            ['nope', 'profile_patch_invalid'],
            [[], 'profile_patch_invalid'],
            [null, 'profile_patch_invalid'],
        ];
        for (const [patch, code] of cases) {
            await expect(
                service.updateProfile(user, patch),
                JSON.stringify(patch).slice(0, 60),
            ).rejects.toMatchObject({ code });
        }
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `${PROFILES_PATH_PREFIX}/${user.uuid}.profile`,
            ),
        ).toBeNull();
    });

    it('keeps what validates from a legacy profile and names the rest', () => {
        expect(
            service.normalizeLegacyProfile({
                picture: PICTURE,
                name: 'Ignored',
                bio: 42,
                displayName: ' Ada ',
            }),
        ).toEqual({
            patch: { picture: PICTURE, displayName: 'Ada' },
            dropped: ['name', 'bio'],
        });
        expect(service.normalizeLegacyProfile('[]')).toEqual({
            patch: {},
            dropped: [],
        });
        // An empty picture is not a picture; it is dropped, not kept as null.
        expect(service.normalizeLegacyProfile({ picture: '' })).toEqual({
            patch: {},
            dropped: ['picture'],
        });
    });

    it('is public only while the owner is on a paid plan, and never for a suspended owner', async () => {
        const user = await makeUser();
        expect(await service.isPubliclyVisible(user)).toBe(false);
        await onPlan(user, 'business', async () => {
            expect(await service.isPubliclyVisible(user)).toBe(true);
            expect(
                await service.isPubliclyVisible({ ...user, suspended: true }),
            ).toBe(false);
        });
        expect(await service.isPubliclyVisible(user)).toBe(false);
    });

    it('withholds the hosted <uuid>.profile file for a free owner on site.access.check', async () => {
        const user = await makeUser();
        await service.updateProfile(user, { picture: PICTURE });
        const ask = async (name: string, subdomain = PROFILES_SUBDOMAIN) => {
            const data = {
                subdomain,
                host: `${subdomain}.site.puter.localhost`,
                requestPath: `/${name}`,
                entry: { name, path: `${PROFILES_PATH_PREFIX}/${name}` },
                result: { allowed: true },
            };
            await server.clients.event.emitAndWait(
                'site.access.check',
                data,
                {},
            );
            return data.result.allowed;
        };

        expect(await ask(`${user.uuid}.profile`)).toBe(false);
        await onPlan(user, 'business', async () => {
            expect(await ask(`${user.uuid}.profile`)).toBe(true);
        });
        // Not a profile file, or nobody's: withheld too.
        expect(await ask(`${uuidv4()}.profile`)).toBe(false);
        expect(await ask('index.html')).toBe(false);
        // Other sites are none of this listener's business.
        expect(await ask('index.html', 'someone-else')).toBe(true);
    });

    it('serves <uuid>.profile on the profiles subdomain only for a paid owner', async () => {
        const user = await makeUser();
        await service.updateProfile(user, { picture: PICTURE });
        const middleware = createPuterSiteMiddleware(
            {
                domain: 'puter.localhost',
                static_hosting_domain: 'site.puter.localhost',
                protocol: 'http',
            } as unknown as IConfig,
            {
                clients: server.clients,
                stores: server.stores,
                services: server.services,
            },
        );
        const request = async () => {
            const chunks: Buffer[] = [];
            let statusCode = 0;
            const res = new Writable({
                write(chunk: Buffer, _enc, cb) {
                    chunks.push(chunk);
                    cb();
                },
            }) as unknown as Response;
            const chain = () => res;
            res.status = (code: number) => {
                statusCode = code;
                return res;
            };
            res.type = chain;
            res.send = chain;
            res.set = chain;
            res.setHeader = chain;
            res.cookie = chain;
            res.redirect = chain as never;
            const req = {
                hostname: `${PROFILES_SUBDOMAIN}.site.puter.localhost`,
                path: `/${user.uuid}.profile`,
                originalUrl: `/${user.uuid}.profile`,
                protocol: 'http',
                headers: {},
                cookies: {},
                query: {},
                on: () => undefined,
            } as unknown as Request;
            await middleware(req, res, vi.fn());
            await new Promise<void>((resolve) => setImmediate(resolve));
            return { statusCode, body: Buffer.concat(chunks).toString() };
        };

        expect((await request()).statusCode).toBe(404);
        await onPlan(user, 'business', async () => {
            const served = await request();
            expect(served.statusCode).toBe(200);
            expect(JSON.parse(served.body)).toEqual({ picture: PICTURE });
        });
        expect((await request()).statusCode).toBe(404);
    });

    it('serves the hosted file to everyone when the gate is switched off', async () => {
        const gated = await setupTestServer({
            profileGate: { enabled: false },
        } as never);
        try {
            await createTestUser(gated, {
                ...TEST_ADMIN_CREDENTIALS,
                admin: true,
            });
            const created = await gated.stores.user.create({
                username: 'free-user',
                uuid: uuidv4(),
                password: null,
                email: 'free@test.local',
                requires_email_confirmation: false,
            } as Parameters<typeof gated.stores.user.create>[0]);
            const user = (await gated.stores.user.getById(created.id))!;
            expect(await gated.services.profile.isPubliclyVisible(user)).toBe(
                true,
            );
        } finally {
            await gated.shutdown();
        }
    });

    it('builds the hosted URL from the static hosting domain', async () => {
        const user = await makeUser();
        // The default test config hosts sites under `site.puter.localhost`.
        expect(service.getPublicUrl(user)).toMatch(
            new RegExp(
                `^https?://${PROFILES_SUBDOMAIN}\\.site\\.puter\\.localhost(:\\d+)?/${user.uuid}\\.profile$`,
            ),
        );
    });
});
