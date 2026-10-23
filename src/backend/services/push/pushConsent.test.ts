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

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { EVENTS_BACKGROUND_PERMISSION } from '../events/authorization.js';
import type { PermissionService } from '../permission/PermissionService.js';
import {
    hasPushConsent,
    NOTIFICATIONS_PUSH_PERMISSION,
    type PushConsentDeps,
} from './pushConsent.js';

interface TestUser {
    id: number;
    uuid: string;
    username: string;
}

describe('hasPushConsent', () => {
    let server: PuterServer;
    let permission: PermissionService;
    let deps: PushConsentDeps;

    const makeUser = async (): Promise<TestUser> =>
        (await server.stores.user.create({
            username: `push${Math.random().toString(36).slice(2, 10)}`,
            uuid: uuidv4(),
            password: null,
            email: null,
            requires_email_confirmation: false,
        })) as TestUser;

    const makeApp = async (owner: TestUser): Promise<string> => {
        const create = server.stores.app.create.bind(
            server.stores.app,
        ) as unknown as (
            fields: Record<string, unknown>,
            opts: { ownerUserId: number },
        ) => Promise<{ uid: string }>;
        const app = await create(
            {
                name: `push-${uuidv4()}`,
                title: 'Push app',
                index_url: `https://push-${uuidv4()}.test/`,
            },
            { ownerUserId: owner.id },
        );
        return app.uid;
    };

    const userActor = (user: TestUser): Actor => makeActor({ user });

    const grant = (user: TestUser, appUid: string, perm: string) =>
        permission.grantUserAppPermission(userActor(user), appUid, perm);

    beforeAll(async () => {
        server = await setupTestServer();
        permission = server.services.permission as unknown as PermissionService;
        deps = {
            stores: server.stores,
            services: { permission },
        } as unknown as PushConsentDeps;
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    it('is false for an app the user never granted, though the user holds the root', async () => {
        const user = await makeUser();
        const appUid = await makeApp(user);

        expect(
            await permission.check(
                userActor(user),
                NOTIFICATIONS_PUSH_PERMISSION,
            ),
        ).toBe(true);
        expect(await hasPushConsent(deps, user.id, appUid)).toBe(false);
    });

    it('is true only for the app and the user the grant names', async () => {
        const user = await makeUser();
        const other = await makeUser();
        const appUid = await makeApp(user);
        const otherAppUid = await makeApp(user);

        await grant(user, appUid, NOTIFICATIONS_PUSH_PERMISSION);

        expect(await hasPushConsent(deps, user.id, appUid)).toBe(true);
        expect(await hasPushConsent(deps, user.id, otherAppUid)).toBe(false);
        expect(await hasPushConsent(deps, other.id, appUid)).toBe(false);
    });

    it('turns false on the next check after the permission is revoked', async () => {
        const user = await makeUser();
        const appUid = await makeApp(user);
        await grant(user, appUid, NOTIFICATIONS_PUSH_PERMISSION);
        expect(await hasPushConsent(deps, user.id, appUid)).toBe(true);

        await permission.revokeUserAppPermission(
            userActor(user),
            appUid,
            NOTIFICATIONS_PUSH_PERMISSION,
        );

        expect(await hasPushConsent(deps, user.id, appUid)).toBe(false);
    });

    it('turns false on the next check after all of the app’s access is revoked', async () => {
        const user = await makeUser();
        const appUid = await makeApp(user);
        await grant(user, appUid, NOTIFICATIONS_PUSH_PERMISSION);
        expect(await hasPushConsent(deps, user.id, appUid)).toBe(true);

        await permission.revokeUserAppAll(userActor(user), appUid);

        expect(await hasPushConsent(deps, user.id, appUid)).toBe(false);
    });

    it('is not granted by events:background, nor grants it', async () => {
        const user = await makeUser();
        const backgroundApp = await makeApp(user);
        const pushApp = await makeApp(user);
        await grant(user, backgroundApp, EVENTS_BACKGROUND_PERMISSION);
        await grant(user, pushApp, NOTIFICATIONS_PUSH_PERMISSION);

        expect(await hasPushConsent(deps, user.id, backgroundApp)).toBe(false);
        const pushAppRow = await server.stores.app.getByUid(pushApp);
        expect(
            await permission.check(
                makeActor({ user, app: { uid: pushApp, id: pushAppRow.id } }),
                EVENTS_BACKGROUND_PERMISSION,
            ),
        ).toBe(false);
    });

    it('builds the actor from the stored app uid', async () => {
        const check = vi.fn(async () => true);
        const stub = {
            stores: {
                user: {
                    getById: async () => ({ id: 1, uuid: 'u', username: 'u' }),
                },
                app: {
                    getByUid: async () => ({ id: 7, uid: 'app-canonical' }),
                },
            },
            services: { permission: { check } },
        } as unknown as PushConsentDeps;

        expect(await hasPushConsent(stub, 1, 'APP-CANONICAL')).toBe(true);
        expect(check).toHaveBeenCalledWith(
            expect.objectContaining({ app: { uid: 'app-canonical', id: 7 } }),
            NOTIFICATIONS_PUSH_PERMISSION,
        );
    });

    it('is false for a user or an app that does not exist', async () => {
        const user = await makeUser();
        const appUid = await makeApp(user);
        await grant(user, appUid, NOTIFICATIONS_PUSH_PERMISSION);

        expect(await hasPushConsent(deps, user.id, `app-${uuidv4()}`)).toBe(
            false,
        );
        expect(await hasPushConsent(deps, 2_000_000_000, appUid)).toBe(false);
    });

    it('is false when the check itself fails', async () => {
        const user = await makeUser();
        const appUid = await makeApp(user);
        const failing = {
            ...deps,
            services: {
                permission: {
                    check: async () => {
                        throw new Error('unavailable');
                    },
                },
            },
        } as PushConsentDeps;

        expect(await hasPushConsent(failing, user.id, appUid)).toBe(false);
    });
});
