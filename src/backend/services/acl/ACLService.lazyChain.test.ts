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

// `check` reads a resource's ancestor chain only once a decision needs it.
// These tests hold it to a check that read the chain first, for every kind of
// actor and path, and pin which checks read it at all.

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    isSystemActor,
    makeActor,
    SYSTEM_ACTOR,
    type Actor,
} from '../../core/actor.js';
import type { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import { MANAGE_PERM_PREFIX } from '../permission/consts.js';
import type { ACLService, AclMode } from './ACLService.js';

const MODES: AclMode[] = ['see', 'list', 'read', 'write', MANAGE_PERM_PREFIX];

describe('ACL checks read the ancestor chain lazily', () => {
    let server: PuterServer;
    let acl: ACLService;
    let actors: Record<string, Actor>;
    let paths: string[];
    let owner: Actor;

    const makeUser = async (): Promise<Actor> => {
        const username = `acz${Math.random().toString(36).slice(2, 10)}`;
        await createTestUser(server, { username, password: 'acz-password' });
        const row = (await server.stores.user.getByUsername(username))!;
        return makeActor({ user: row });
    };

    const mkdir = (actor: Actor, path: string) =>
        server.services.fs.mkdir(actor.user.id!, {
            path,
            createMissingParents: true,
        } as never);

    /** A check that read the chain before anything else, as `check` once did. */
    const chainFirstCheck = async (
        actor: Actor,
        path: string,
        mode: AclMode,
    ) => {
        if (isSystemActor(actor)) return true;
        if (path === '/') return ['read', 'list', 'see'].includes(mode);
        const chain = await server.stores.fsEntry.getAncestorChain(path);
        return acl.check(
            actor,
            { path, resolveAncestors: async () => chain },
            mode,
        );
    };

    const outcome = async (run: () => Promise<boolean>) => {
        try {
            return { granted: await run() };
        } catch (error) {
            const e = error as { statusCode?: number; message: string };
            return { status: e.statusCode, message: e.message };
        }
    };

    beforeAll(async () => {
        server = await setupTestServer();
        acl = server.services.acl as unknown as ACLService;

        owner = await makeUser();
        const other = await makeUser();
        const recipient = await makeUser();
        const a = owner.user.username;
        const b = other.user.username;

        const shared = `/${a}/Documents/shared-${uuidv4()}`;
        await mkdir(owner, `${shared}/deep`);
        await acl.setUserUser(
            owner,
            recipient,
            acl.fsDescriptor(shared),
            'read',
        );
        const app = await (
            server.stores.app.create as unknown as (
                f: Record<string, unknown>,
                o: { ownerUserId: number },
            ) => Promise<{ uid: string; id: number }>
        )(
            {
                name: `acz-${uuidv4()}`,
                title: 'Lazy chain app',
                index_url: `https://acz-${uuidv4()}.test/`,
            },
            { ownerUserId: owner.user.id! },
        );
        await mkdir(owner, `/${a}/AppData/${app.uid}/data`);
        await mkdir(owner, `/${a}/Public/page`);

        const token = (issuer: Actor, fullAccess: boolean) =>
            makeActor({
                user: issuer.user,
                accessToken: {
                    uid: `tok-${uuidv4()}`,
                    issuer,
                    authorized: null,
                    fullAccess,
                },
            });
        const appActor = (user: Actor) =>
            makeActor({ user: user.user, app: { uid: app.uid, id: app.id } });

        actors = {
            owner,
            other,
            recipient,
            ownerApp: appActor(owner),
            recipientApp: appActor(recipient),
            ownerFullToken: token(owner, true),
            ownerScopedToken: token(owner, false),
            recipientFullToken: token(recipient, true),
            system: SYSTEM_ACTOR,
        };
        paths = [
            `/${a}`,
            `/${a}/Documents`,
            shared,
            `${shared}/deep`,
            `${shared}/deep/missing`,
            `/${a}/AppData/${app.uid}/data`,
            `/${a}/AppData`,
            `/${a}/Public/page`,
            `/${a}/missing/thing`,
            `/${b}/Documents`,
            '/',
            // Paths the chain read refuses.
            `/${a}/../${b}/Documents`,
            `/${a}//Documents`,
            `/${a}/Documents/./x`,
            '',
            '   ',
            // A legacy row whose path never healed.
            null as unknown as string,
            undefined as unknown as string,
        ];
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    it('decides as a chain-first check does, for every actor, path and mode', async () => {
        const seen = new Set<string>();
        for (const [name, actor] of Object.entries(actors)) {
            for (const path of paths) {
                for (const mode of MODES) {
                    const expected = await outcome(() =>
                        chainFirstCheck(actor, path, mode),
                    );
                    const actual = await outcome(() =>
                        acl.check(actor, acl.fsDescriptor(path), mode),
                    );
                    expect(
                        actual,
                        `${name} ${JSON.stringify(path)} ${mode}`,
                    ).toEqual(expected);
                    seen.add(
                        'granted' in expected
                            ? String(expected.granted)
                            : String(expected.status),
                    );
                }
            }
        }
        // Grants, refusals, the 400 for a refused path and the failure for a
        // missing one all came up.
        expect([...seen].sort()).toEqual(['400', 'false', 'true', 'undefined']);
    });

    it("answers an owner's own path without reading the chain", async () => {
        /** `fsDescriptor`, counting the chain reads `check` asks for. */
        const counted = (path: string) => {
            const descriptor = acl.fsDescriptor(path);
            const read = descriptor.resolveAncestors;
            const reads = { count: 0 };
            descriptor.resolveAncestors = () => {
                reads.count++;
                return read();
            };
            return { descriptor, reads };
        };

        const ownPaths: Array<[Actor, string]> = [
            [actors.owner, `/${owner.user.username}/Documents`],
            [actors.ownerFullToken, `/${owner.user.username}/Documents`],
            [actors.ownerApp, paths[5]],
        ];
        for (const [actor, path] of ownPaths) {
            const { descriptor, reads } = counted(path);
            expect(await acl.check(actor, descriptor, 'write')).toBe(true);
            expect(reads.count).toBe(0);
        }

        // Anyone else needs it.
        const { descriptor, reads } = counted(`${paths[2]}/deep`);
        expect(await acl.check(actors.recipient, descriptor, 'read')).toBe(
            true,
        );
        expect(reads.count).toBe(1);
    });

    it('still refuses a path the chain read would refuse, before the owner shortcut', async () => {
        const a = owner.user.username;
        for (const path of [`/${a}/x/../../other`, `/${a}//x`]) {
            await expect(
                acl.check(actors.owner, acl.fsDescriptor(path), 'read'),
            ).rejects.toMatchObject({ statusCode: 400 });
        }
        // The system actor never needed the chain, before or now.
        expect(
            await acl.check(SYSTEM_ACTOR, acl.fsDescriptor(`/${a}//x`), 'read'),
        ).toBe(true);
    });
});
