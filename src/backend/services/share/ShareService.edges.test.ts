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
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';

describe('ShareService: refusals and edge cases', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUser = async () => {
        const username = `se${Math.random().toString(36).slice(2, 9)}`;
        await createTestUser(server, { username, password: 'pw-test-1234' });
        const user = await server.stores.user.getByUsername(username);
        if (!user) throw new Error('test user missing');
        const email = `${username}@test.local`;
        await server.stores.user.update(user.id, {
            email,
            clean_email: email,
            email_confirmed: true,
        });
        const fresh = await server.stores.user.getById(user.id, {
            force: true,
        });
        const actor: Actor = {
            user: fresh as Actor['user'],
            effectiveApp: null,
        };
        return { user: fresh!, actor, email };
    };

    const makeFile = async (owner: { id: number; username: string }) => {
        const home = await server.stores.fsEntry.getRootEntryForUser(owner.id);
        if (!home) throw new Error('home directory missing');
        const uuid = uuidv4();
        const name = `f-${uuid.slice(0, 8)}.txt`;
        const path = `/${owner.username}/${name}`;
        await server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`, `parent_id`, `parent_uid`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                uuid,
                name,
                path,
                owner.id,
                server.clients.db.booleanValue(false),
                Math.floor(Date.now() / 1000),
                home.id,
                home.uuid,
            ],
        );
        const entry = await server.stores.fsEntry.getEntryByPath(path);
        if (!entry) throw new Error('fsentry not created');
        return entry;
    };

    const canRead = (actor: Actor, path: string) =>
        server.services.acl.check(
            actor,
            {
                path,
                resolveAncestors: () =>
                    server.services.fs.getAncestorChain(path),
            },
            'read',
        );

    const share = (actor: Actor, input: Record<string, unknown>) =>
        runWithContext({ actor }, () =>
            server.services.share.share(actor, input as never),
        );

    it('refuses a delegate sharing an item back to its owner', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const file = await makeFile(owner.user);
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });

        await expect(
            share(delegate.actor, {
                uid: file.uuid,
                recipient: { username: owner.user.username },
                mode: 'read',
            }),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'cannot_share_with_owner',
        });
    });

    it('refuses an actor with no user behind it', async () => {
        const owner = await makeUser();
        const file = await makeFile(owner.user);
        const nobody = { effectiveApp: null } as unknown as Actor;

        await expect(
            share(nobody, {
                uid: file.uuid,
                recipient: { username: owner.user.username },
                mode: 'read',
            }),
        ).rejects.toMatchObject({ statusCode: 403, legacyCode: 'forbidden' });
    });

    it('answers not-found for a path with nothing at it, and for an unknown username', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await expect(
            share(owner.actor, {
                path: `/${owner.user.username}/missing-${uuidv4()}.txt`,
                recipient: { username: recipient.user.username },
                mode: 'read',
            }),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
        });
        await expect(
            share(owner.actor, {
                uid: file.uuid,
                recipient: { username: `nobody-${uuidv4().slice(0, 8)}` },
                mode: 'read',
            }),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'user_does_not_exist',
        });
    });

    // On an unknown domain a rewritten local part may be someone else's mailbox.
    it('invites, rather than grants, an alias of an account address', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);
        const alias = recipient.email.replace('@', '+work@');

        const shared = await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: alias },
            mode: 'read',
        });

        expect(shared).toMatchObject({ pending: true, recipientEmail: alias });
        expect(await canRead(recipient.actor, file.path)).toBe(false);
    });

    it('leaves the recipient without access when the share cannot be recorded', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);
        const failing = vi
            .spyOn(server.stores.share, 'upsertActive')
            .mockRejectedValueOnce(new Error('index write failed'));
        try {
            await expect(
                share(owner.actor, {
                    uid: file.uuid,
                    recipient: { email: recipient.email },
                    mode: 'read',
                }),
            ).rejects.toThrow('index write failed');
        } finally {
            failing.mockRestore();
        }

        expect(await canRead(recipient.actor, file.path)).toBe(false);
    });

    describe('tryListSharesOf', () => {
        it('lists for the owner, and answers null where the caller may not manage or the item is gone', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const stranger = await makeUser();
            const file = await makeFile(owner.user);
            const shared = await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });
            const list = (actor: Actor, uid: string) =>
                runWithContext({ actor }, () =>
                    server.services.share.tryListSharesOf(actor, { uid }),
                );

            expect(await list(owner.actor, file.uuid)).toEqual([
                expect.objectContaining({ uid: shared.uid }),
            ]);
            expect(await list(stranger.actor, file.uuid)).toBeNull();
            expect(await list(recipient.actor, file.uuid)).toBeNull();
            expect(await list(owner.actor, uuidv4())).toBeNull();
        });

        it('lets a failure that is not about access through', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const failing = vi
                .spyOn(server.stores.share, 'listByFsentry')
                .mockRejectedValueOnce(new Error('store down'));
            try {
                await expect(
                    runWithContext({ actor: owner.actor }, () =>
                        server.services.share.tryListSharesOf(owner.actor, {
                            uid: file.uuid,
                        }),
                    ),
                ).rejects.toThrow('store down');
            } finally {
                failing.mockRestore();
            }
        });
    });

    describe('shareFlags', () => {
        it("flags the caller's own shared items, and nothing for an actor without a user", async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const shared = await makeFile(owner.user);
            const unshared = await makeFile(owner.user);
            const theirs = await makeFile(recipient.user);
            await share(owner.actor, {
                uid: shared.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const flags = await server.services.share.shareFlags(owner.actor, [
                shared,
                unshared,
                theirs,
            ]);
            expect(flags).toEqual(
                new Map([
                    [shared.uuid, true],
                    [unshared.uuid, false],
                ]),
            );
            expect(
                await server.services.share.shareFlags(
                    { effectiveApp: null } as unknown as Actor,
                    [shared],
                ),
            ).toEqual(new Map());
            expect(
                await server.services.share.shareFlags(owner.actor, [theirs]),
            ).toEqual(new Map());
        });
    });

    describe('claimPendingShares', () => {
        const invite = async (
            issuer: Actor,
            uid: string,
            email: string,
            mode = 'read',
        ) => {
            const shared = await share(issuer, {
                uid,
                recipient: { email },
                mode,
            });
            expect(shared.pending).toBe(true);
            return shared;
        };

        /** An account whose address is `email`, as if it had just confirmed. */
        const makeUserWithEmail = async (email: string) => {
            const made = await makeUser();
            await server.stores.user.update(made.user.id, {
                email,
                clean_email: email,
                email_confirmed: true,
            });
            return made;
        };

        it('drops an invite to an address its own sender turns out to hold', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `claim-${uuidv4().slice(0, 8)}@test.local`;
            const invited = await invite(owner.actor, file.uuid, email);

            const claimed = await server.services.share.claimPendingShares(
                owner.user.id,
                email,
            );

            expect(claimed).toEqual([]);
            expect(await server.stores.share.getByUid(invited.uid)).toBeFalsy();
        });

        it('drops an invite whose address owner has since stopped accepting shares', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `claim-${uuidv4().slice(0, 8)}@test.local`;
            const invited = await invite(owner.actor, file.uuid, email);
            const holder = await makeUserWithEmail(email);
            await server.services.share.setBlockAllSenders(holder.actor, true);

            const claimed = await server.services.share.claimPendingShares(
                holder.user.id,
                email,
            );

            expect(claimed).toEqual([]);
            expect(await server.stores.share.getByUid(invited.uid)).toBeFalsy();
            expect(await canRead(holder.actor, file.path)).toBe(false);
        });

        it('claims nothing for an account that no longer exists', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `claim-${uuidv4().slice(0, 8)}@test.local`;
            const invited = await invite(owner.actor, file.uuid, email);

            expect(
                await server.services.share.claimPendingShares(
                    999_999_999,
                    email,
                ),
            ).toEqual([]);
            // Still there for whoever does confirm the address.
            expect(
                await server.stores.share.getByUid(invited.uid),
            ).toBeTruthy();
        });
    });
});
