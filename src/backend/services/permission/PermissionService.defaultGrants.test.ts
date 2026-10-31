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

// `check` answers what fixed config grants without a scan. These tests hold
// it to the scan's own answer across actor kinds and permissions, granted by
// default or not.

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor, SYSTEM_ACTOR, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import type { AuthService } from '../auth/AuthService.js';
import { FULL_API_ACCESS } from './consts.js';
import { PermissionService } from './PermissionService.js';
import { PermissionUtil } from './permissionUtil.js';

describe('check on default grants', () => {
    let server: PuterServer;
    let permService: PermissionService;
    let actors: Record<string, Actor>;
    let fileUid: string;
    let userUuid: string;

    /** `check` as it read before it could answer without a scan. */
    const scanCheck = async (
        actor: Actor,
        options: string | string[],
        noCache: boolean,
    ) =>
        PermissionUtil.readingToOptions(
            await permService.scan(actor, options, undefined, { noCache }),
        ).length > 0;

    beforeAll(async () => {
        server = await setupTestServer();
        permService = server.services
            .permission as unknown as PermissionService;
        const auth = server.services.auth as unknown as AuthService;

        const username = `pdg${Math.random().toString(36).slice(2, 10)}`;
        await createTestUser(server, { username, password: 'pdg-password' });
        const grouped = (await server.stores.user.getByUsername(username))!;
        const loose = await server.stores.user.create({
            username: `pdl${Math.random().toString(36).slice(2, 10)}`,
            uuid: uuidv4(),
            password: null,
            email: null,
            requires_email_confirmation: false,
        });
        userUuid = grouped.uuid;
        const userActor = makeActor({ user: grouped });
        const app = await (
            server.stores.app.create as unknown as (
                f: Record<string, unknown>,
                o: { ownerUserId: number },
            ) => Promise<{ uid: string; id: number }>
        )(
            {
                name: `pdg-${uuidv4()}`,
                title: 'Default grants app',
                index_url: `https://pdg-${uuidv4()}.test/`,
            },
            { ownerUserId: grouped.id },
        );
        const appActor = makeActor({
            user: grouped,
            app: { uid: app.uid, id: app.id },
        });
        // A file the user owns, for a permission a rule answers.
        const entry = (await server.services.fs.mkdir(grouped.id, {
            path: `/${grouped.username}/pdg-${uuidv4()}`,
            createMissingParents: true,
        } as never)) as { uuid: string };
        fileUid = entry.uuid;

        const authenticate = async (token: string) =>
            (await auth.authenticate(token, { touch: false })).actor!;
        const mint = (issuer: Actor, perms: string[]) =>
            runWithContext({ actor: issuer }, () =>
                auth.createAccessToken(
                    issuer,
                    perms.map((p) => [p] as [string]),
                ),
            );

        actors = {
            user: userActor,
            looseUser: makeActor({ user: loose }),
            // Its own uuid: a scan reading is cached by uuid, and real actors
            // sharing one also share an id.
            userWithoutId: makeActor({
                user: { uuid: uuidv4(), username: grouped.username },
            }),
            app: appActor,
            builtinApp: makeActor({
                user: grouped,
                app: { uid: 'app-0bef044f-918f-4cbf-a0c0-b4a17ee81085', id: 1 },
            }),
            appWithoutUserId: makeActor({
                user: { uuid: uuidv4(), username: grouped.username },
                app: { uid: app.uid, id: app.id },
            }),
            scopedToken: await authenticate(
                await mint(userActor, [
                    'service:puter-kvstore:ii:puter-kvstore',
                ]),
            ),
            fullToken: await authenticate(
                await mint(userActor, [FULL_API_ACCESS]),
            ),
            appToken: await authenticate(
                await mint(appActor, ['driver:puter-kvstore:get']),
            ),
            system: SYSTEM_ACTOR,
        };
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    const permissions = (): Array<string | string[]> => [
        'driver',
        'service',
        'events:background',
        'events:background:extra',
        'events',
        'notifications:push',
        'notifications:push:extra',
        'notifications',
        'driver:puter-kvstore',
        'driver:puter-kvstore:get',
        'driver:puter-chat-completion:complete',
        'service:puter-kvstore:ii:puter-kvstore',
        'service:puter-chat-completion:ii:puter-chat-completion',
        'feature',
        'feature:something',
        'driver:helloworld:greet',
        'zztest:not-granted:ii:read',
        'constructor',
        'toString',
        '__proto__',
        'hasOwnProperty',
        `user:${userUuid}:email:read`,
        `fs:${fileUid}:read`,
        `fs:${fileUid}`,
        'app:uid#app-nope:read',
        `apps-of-user:${userUuid}:read`,
        'site:somewhere:read',
        'kv-share:abc',
        '',
        [],
        ['zztest:not-granted:ii:read', 'service:x:ii:y'],
        ['feature', 'zztest:nope'],
        ['feature', 'driver'],
        [`fs:${fileUid}:read`, 'service:puter-kvstore:ii:puter-kvstore'],
    ];

    it('gives the answer a scan gives, for every actor and permission', async () => {
        const answered = { granted: 0, refused: 0 };
        for (const [name, actor] of Object.entries(actors)) {
            for (const options of permissions()) {
                for (const noCache of [false, true]) {
                    const expected = await scanCheck(actor, options, noCache);
                    const actual = await permService.check(actor, options, {
                        noCache,
                    });
                    expect(
                        actual,
                        `${name} ${JSON.stringify(options)} noCache=${noCache}`,
                    ).toBe(expected);
                    answered[expected ? 'granted' : 'refused']++;
                }
            }
        }
        expect(answered.granted).toBeGreaterThan(0);
        expect(answered.refused).toBeGreaterThan(0);
    });

    it('answers a default grant without reading the scan cache', async () => {
        const getScanCache = vi.spyOn(server.stores.permission, 'getScanCache');
        try {
            // A full-access token holds its issuer's defaults.
            for (const actor of [
                actors.user,
                actors.looseUser,
                actors.app,
                actors.fullToken,
            ]) {
                expect(
                    await permService.check(
                        actor,
                        'service:puter-chat-completion:ii:puter-chat-completion',
                    ),
                ).toBe(true);
            }
            expect(getScanCache).not.toHaveBeenCalled();

            // Anything else still scans.
            for (const [actor, permission] of [
                [
                    actors.scopedToken,
                    'service:puter-chat-completion:ii:puter-chat-completion',
                ],
                [actors.fullToken, `fs:${fileUid}:read`],
                [actors.app, 'feature:something'],
                [actors.user, `fs:${fileUid}:read`],
            ] as const) {
                getScanCache.mockClear();
                await permService.check(actor, permission);
                expect(getScanCache).toHaveBeenCalled();
            }
        } finally {
            getScanCache.mockRestore();
        }
    });

    it('defers to a rule that matches a default-granted permission', async () => {
        const target = `driver:pdg-rewritten-${uuidv4()}`;
        const implied = `service:pdg-implied-${uuidv4()}`;
        permService.registerRewriter({
            id: 'pdg-test-rewriter',
            matches: (p) => p === target,
            rewrite: () => 'zztest:pdg-rewritten:ii:read',
        });
        permService.registerImplicator({
            id: 'pdg-test-implicator',
            matches: (p) => p === implied,
            check: () => {
                throw new Error('implicator failed');
            },
        });
        const outcome = async (run: () => Promise<boolean>) => {
            try {
                return { granted: await run() };
            } catch (error) {
                return { error: (error as Error).message };
            }
        };
        const failures = new Set<string>();
        for (const actor of [actors.user, actors.app]) {
            for (const permission of [target, implied]) {
                const expected = await outcome(() =>
                    scanCheck(actor, permission, true),
                );
                expect(
                    await outcome(() =>
                        permService.check(actor, permission, {
                            noCache: true,
                        }),
                    ),
                ).toEqual(expected);
                if ('error' in expected) failures.add(expected.error);
            }
        }
        // The app's scan reaches the failing rule; a default answer would not.
        expect([...failures]).toEqual(['implicator failed']);
    });
});
