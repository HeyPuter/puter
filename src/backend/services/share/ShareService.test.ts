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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';

describe('ShareService', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUser = async () => {
        const username = `sh${Math.random().toString(36).slice(2, 9)}`;
        await createTestUser(server, { username, password: 'pw-test-1234' });
        const user = await server.stores.user.getByUsername(username);
        if (!user) throw new Error('test user missing');
        const email = `${username}@test.local`;
        await server.stores.user.update(user.id, {
            email,
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

    /** A real fsentry under the user's home, so ancestor chains resolve. */
    const makeFile = async (owner: { id: number; username: string }) => {
        const uuid = uuidv4();
        const name = `f-${uuid.slice(0, 8)}.txt`;
        const path = `/${owner.username}/${name}`;
        await server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, 0, ?)',
            [uuid, name, path, owner.id, Math.floor(Date.now() / 1000)],
        );
        const entry = await server.stores.fsEntry.getEntryByPath(path);
        if (!entry) throw new Error('fsentry not created');
        return entry;
    };

    /** A directory and a file inside it, so the file inherits the folder's shares. */
    const makeDirWithFile = async (owner: { id: number; username: string }) => {
        const dirUuid = uuidv4();
        const dirName = `d-${dirUuid.slice(0, 8)}`;
        const dirPath = `/${owner.username}/${dirName}`;
        const fileUuid = uuidv4();
        const fileName = `f-${fileUuid.slice(0, 8)}.txt`;
        const now = Math.floor(Date.now() / 1000);

        await server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, 1, ?)',
            [dirUuid, dirName, dirPath, owner.id, now],
        );
        const dirRow = await server.stores.fsEntry.getEntryByPath(dirPath);
        await server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`, `parent_id`, `parent_uid`) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
            [
                fileUuid,
                fileName,
                `${dirPath}/${fileName}`,
                owner.id,
                now,
                dirRow!.id,
                dirUuid,
            ],
        );

        const dir = await server.stores.fsEntry.getEntryByPath(dirPath);
        const file = await server.stores.fsEntry.getEntryByPath(
            `${dirPath}/${fileName}`,
        );
        if (!dir || !file) throw new Error('fsentries not created');
        return { dir, file };
    };

    const canRead = async (actor: Actor, path: string) =>
        server.services.acl.check(
            actor,
            {
                path,
                resolveAncestors: () => server.services.fs.getAncestorChain(path),
            },
            'read',
        );

    const share = (actor: Actor, input: Record<string, unknown>) =>
        runWithContext({ actor }, () =>
            server.services.share.share(actor, input as never),
        );

    const unshare = (actor: Actor, input: Record<string, unknown>) =>
        runWithContext({ actor }, () =>
            server.services.share.unshare(actor, input as never),
        );

    it('grants access and indexes the share', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        expect(await canRead(recipient.actor, file.path)).toBe(false);

        const result = await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });

        expect(result.mode).toBe('read');
        expect(result.path).toBe(file.path);
        expect(await canRead(recipient.actor, file.path)).toBe(true);

        const listed = await server.services.share.listSharedWithMe(
            recipient.actor,
        );
        expect(listed.items.map((i) => i.entryUid)).toContain(file.uuid);
    });

    it('carries the entry metadata the file browser renders', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });

        const [listed] = (
            await server.services.share.listSharedWithMe(recipient.actor)
        ).items;
        expect(listed.modified).toBe(file.modified);
        expect(Number.isFinite(listed.modified)).toBe(true);
        expect(listed.size).toBe(file.size);
    });

    it('resolves a recipient by username as well as email', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { username: recipient.user.username },
            mode: 'read',
        });

        expect(await canRead(recipient.actor, file.path)).toBe(true);
    });

    it('refuses to share with yourself or with the owner', async () => {
        const owner = await makeUser();
        const file = await makeFile(owner.user);

        await expect(
            share(owner.actor, {
                uid: file.uuid,
                recipient: { email: owner.email },
                mode: 'read',
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses an unknown mode and an unknown recipient', async () => {
        const owner = await makeUser();
        const file = await makeFile(owner.user);

        await expect(
            share(owner.actor, {
                uid: file.uuid,
                recipient: { email: 'nobody@nowhere.test' },
                mode: 'read',
            }),
        ).rejects.toMatchObject({ statusCode: 404 });

        await expect(
            share(owner.actor, {
                uid: file.uuid,
                recipient: { email: 'nobody@nowhere.test' },
                mode: 'wizard',
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('does not resolve an email its account has not confirmed', async () => {
        const owner = await makeUser();
        const squatter = await makeUser();
        await server.stores.user.update(squatter.user.id, {
            email_confirmed: false,
        });
        const file = await makeFile(owner.user);

        await expect(
            share(owner.actor, {
                uid: file.uuid,
                recipient: { email: squatter.email },
                mode: 'read',
            }),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'user_does_not_exist',
        });

        // A username names exactly one account, confirmed or not.
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { username: squatter.user.username },
            mode: 'read',
        });
    });

    it('hides a file from a stranger trying to share it', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        // 404 rather than 403 — a failed share must not confirm the file
        // exists to someone who cannot even see it.
        await expect(
            share(stranger.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('tells a stranger nothing about whether a recipient account exists', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        // The recipient must resolve only after authorization: a caller who
        // cannot manage the entry gets the same "no such subject" error for a
        // real recipient and a made-up one, so /share cannot be used to probe
        // which emails have accounts.
        const probe = (email: string) =>
            share(stranger.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

        await expect(probe(recipient.email)).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
        });
        await expect(probe('nobody@nowhere.test')).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
        });
    });

    it('revokes access and drops the index row', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });
        expect(await canRead(recipient.actor, file.path)).toBe(true);

        const result = await unshare(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
        });

        expect(result.revoked).toBe(1);
        expect(await canRead(recipient.actor, file.path)).toBe(false);
        const listed = await server.services.share.listSharedWithMe(
            recipient.actor,
        );
        expect(listed.items.map((i) => i.entryUid)).not.toContain(file.uuid);
    });

    it('refuses to revoke the owner', async () => {
        const owner = await makeUser();
        const file = await makeFile(owner.user);

        await expect(
            unshare(owner.actor, {
                uid: file.uuid,
                recipient: { email: owner.email },
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('shows the owner a share a manage delegate issued', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const third = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });
        await share(delegate.actor, {
            uid: file.uuid,
            recipient: { email: third.email },
            mode: 'read',
        });

        // The owner cannot see this through the permission tables, which are
        // keyed issuer→holder; the index is what answers it.
        const rows = await server.services.share.listSharesOf(owner.actor, {
            uid: file.uuid,
        });
        const holders = rows.map((r) => r.holder.username);
        expect(holders).toContain(delegate.user.username);
        expect(holders).toContain(third.user.username);
        expect(
            rows.find((r) => r.holder.username === third.user.username)?.issuer
                .username,
        ).toBe(delegate.user.username);
    });

    it('reports a share on a file as inherited from the folder', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const { dir, file } = await makeDirWithFile(owner.user);

        await share(owner.actor, {
            uid: dir.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });

        // Nobody was granted the file itself, so its own rows are empty — but
        // the recipient can reach it, and the owner has to be told so.
        const rows = await server.services.share.listSharesOf(owner.actor, {
            uid: file.uuid,
        });
        const row = rows.find(
            (r) => r.holder.username === recipient.user.username,
        );
        expect(row).toBeDefined();
        expect(row?.inheritedFrom).toBe(dir.path);
        expect(row?.mode).toBe('read');
        expect(await canRead(recipient.actor, file.path)).toBe(true);
    });

    it('marks a share on the item itself as not inherited', async () => {
        const owner = await makeUser();
        const viaFolder = await makeUser();
        const direct = await makeUser();
        const { dir, file } = await makeDirWithFile(owner.user);

        await share(owner.actor, {
            uid: dir.uuid,
            recipient: { email: viaFolder.email },
            mode: 'read',
        });
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: direct.email },
            mode: 'write',
        });

        const rows = await server.services.share.listSharesOf(owner.actor, {
            uid: file.uuid,
        });
        expect(
            rows.find((r) => r.holder.username === direct.user.username)
                ?.inheritedFrom,
        ).toBeNull();
        expect(
            rows.find((r) => r.holder.username === viaFolder.user.username)
                ?.inheritedFrom,
        ).toBe(dir.path);
    });

    it('takes downstream access with a delegate who leaves', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const third = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });
        await share(delegate.actor, {
            uid: file.uuid,
            recipient: { email: third.email },
            mode: 'read',
        });
        expect(await canRead(third.actor, file.path)).toBe(true);

        // What "Remove from Shared" calls. The delegate's grant goes, and with
        // it the authority behind everything they issued.
        await unshare(delegate.actor, {
            uid: file.uuid,
            recipient: { username: delegate.user.username },
        });

        expect(await canRead(delegate.actor, file.path)).toBe(false);
        expect(await canRead(third.actor, file.path)).toBe(false);
    });

    it('keeps the index row when the actor could not revoke anything', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const third = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });
        await share(delegate.actor, {
            uid: file.uuid,
            recipient: { email: third.email },
            mode: 'read',
        });
        await unshare(delegate.actor, {
            uid: file.uuid,
            recipient: { username: delegate.user.username },
        });

        // A grant the owner cannot see is a grant nobody can withdraw, so the
        // owner's view must not go quiet while access is still live.
        const rows = await server.services.share.listSharesOf(owner.actor, {
            uid: file.uuid,
        });
        const stillListed = rows.map((r) => r.holder.username);
        expect(stillListed).not.toContain(third.user.username);
        expect(await canRead(third.actor, file.path)).toBe(false);
    });

    describe('manage inherits down the tree', () => {
        it('lets a folder delegate re-share and inspect a file inside it', async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const third = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: delegate.email },
                mode: 'manage',
            });

            // Authority now reaches the child the way access already did.
            const rows = await server.services.share.listSharesOf(
                delegate.actor,
                { uid: file.uuid },
            );
            expect(rows.map((r) => r.holder.username)).toContain(
                delegate.user.username,
            );

            await share(delegate.actor, {
                uid: file.uuid,
                recipient: { email: third.email },
                mode: 'read',
            });
            expect(await canRead(third.actor, file.path)).toBe(true);
        });

        it('revokes what a folder delegate re-shared from inside it', async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const third = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: delegate.email },
                mode: 'manage',
            });
            await share(delegate.actor, {
                uid: file.uuid,
                recipient: { email: third.email },
                mode: 'read',
            });
            expect(await canRead(third.actor, file.path)).toBe(true);

            // The grant on the child came from authority held on the folder,
            // so withdrawing that authority has to reach down to it.
            await unshare(owner.actor, {
                uid: dir.uuid,
                recipient: { username: delegate.user.username },
            });

            expect(await canRead(delegate.actor, file.path)).toBe(false);
            expect(await canRead(third.actor, file.path)).toBe(false);
        });

        it('does not let plain access on a folder manage what is inside', async () => {
            const owner = await makeUser();
            const reader = await makeUser();
            const third = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: reader.email },
                mode: 'write',
            });

            // `write` reaches the child, but managing is a separate namespace.
            // 403 rather than 404 here: they can already see the file, so
            // hiding it would protect nothing.
            expect(await canRead(reader.actor, file.path)).toBe(true);
            await expect(
                share(reader.actor, {
                    uid: file.uuid,
                    recipient: { email: third.email },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('does not let manage on a file leak up to its folder', async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const third = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: delegate.email },
                mode: 'manage',
            });

            // Inheritance runs one way; the parent is not implied by the child.
            await expect(
                share(delegate.actor, {
                    uid: dir.uuid,
                    recipient: { email: third.email },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({ statusCode: 404 });
        });
    });

    it('inherits a group-issued manage grant down the tree', async () => {
        const owner = await makeUser();
        const member = await makeUser();
        const { dir, file } = await makeDirWithFile(owner.user);

        const groupUid = await server.stores.group.create({
            ownerUserId: owner.user.id,
        });
        const group = (await server.stores.group.getByUid(groupUid))!;
        await server.stores.group.addUsers(groupUid, [member.user.username!]);
        await runWithContext({ actor: owner.actor }, () =>
            server.services.permission.grantUserGroupPermission(
                owner.actor,
                { id: Number(group.id), uid: groupUid },
                `manage:fs:${dir.uuid}`,
            ),
        );

        // The grant sits on the folder and reached the member through the
        // group; inheritance must carry it to the file the same as a direct
        // grant would.
        const held = await server.services.permission.canManagePermission(
            member.actor,
            `fs:${file.uuid}:read`,
        );
        expect(held).toBe(true);
    });

    it('does not let a delegate pass on `manage` itself', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const third = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });

        // Granting `manage` needs `manage:manage:fs:<uid>`, which only the
        // owner holds — so delegation is one level deep by construction.
        await expect(
            share(delegate.actor, {
                uid: file.uuid,
                recipient: { email: third.email },
                mode: 'manage',
            }),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('leaves a delegate alone when their authority survives another issuer', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const middle = await makeUser();
        const leaf = await makeUser();
        const file = await makeFile(owner.user);

        // `middle` manages by the owner's grant, and separately holds a plain
        // read the delegate handed out.
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: middle.email },
            mode: 'manage',
        });
        await share(delegate.actor, {
            uid: file.uuid,
            recipient: { email: middle.email },
            mode: 'read',
        });
        await share(middle.actor, {
            uid: file.uuid,
            recipient: { email: leaf.email },
            mode: 'read',
        });

        await unshare(owner.actor, {
            uid: file.uuid,
            recipient: { username: delegate.user.username },
        });

        // Withdrawing the delegate costs `middle` nothing it was relying on,
        // so what `middle` granted must stand.
        expect(await canRead(delegate.actor, file.path)).toBe(false);
        expect(await canRead(middle.actor, file.path)).toBe(true);
        expect(await canRead(leaf.actor, file.path)).toBe(true);
    });

    it('lets a delegate clear only what it issued', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const third = await makeUser();
        const fourth = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });
        await share(delegate.actor, {
            uid: file.uuid,
            recipient: { email: third.email },
            mode: 'read',
        });
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: fourth.email },
            mode: 'read',
        });

        // Its own grant: cleared.
        expect(
            (
                await unshare(delegate.actor, {
                    uid: file.uuid,
                    recipient: { email: third.email },
                })
            ).revoked,
        ).toBe(1);
        expect(await canRead(third.actor, file.path)).toBe(false);

        // The owner's grant to someone else: untouched.
        expect(
            (
                await unshare(delegate.actor, {
                    uid: file.uuid,
                    recipient: { email: fourth.email },
                })
            ).revoked,
        ).toBe(0);
        expect(await canRead(fourth.actor, file.path)).toBe(true);
    });

    it('revoking a delegate also revokes what they re-shared', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const third = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });
        await share(delegate.actor, {
            uid: file.uuid,
            recipient: { email: third.email },
            mode: 'read',
        });
        expect(await canRead(third.actor, file.path)).toBe(true);

        await unshare(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
        });

        // The delegate's authority to grant came from access the owner has
        // now withdrawn, so what they granted cannot outlive it.
        expect(await canRead(delegate.actor, file.path)).toBe(false);
        expect(await canRead(third.actor, file.path)).toBe(false);
        expect(
            await server.services.share.listSharesOf(owner.actor, {
                uid: file.uuid,
            }),
        ).toEqual([]);
    });

    it('lets the owner clear a grant a delegate issued', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const third = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });
        await share(delegate.actor, {
            uid: file.uuid,
            recipient: { email: third.email },
            mode: 'read',
        });

        const byOwner = await unshare(owner.actor, {
            uid: file.uuid,
            recipient: { email: third.email },
        });
        expect(byOwner.revoked).toBe(1);
        expect(await canRead(third.actor, file.path)).toBe(false);
    });

    it('lets a recipient leave a share they did not issue', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });

        // Dropping your own access is always allowed, whoever granted it.
        const left = await unshare(recipient.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
        });
        expect(left.revoked).toBe(1);
        expect(await canRead(recipient.actor, file.path)).toBe(false);
    });

    it('will not let leaving a share reveal a file you cannot see', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const file = await makeFile(owner.user);

        // Self-revoke skips the manage gate, so it still has to 404 here or it
        // becomes an existence oracle for any uid a stranger cares to guess.
        await expect(
            unshare(stranger.actor, {
                uid: file.uuid,
                recipient: { email: stranger.email },
            }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    describe('daily quota', () => {
        const withLimit = async (limit: number, fn: () => Promise<void>) => {
            const cfg = (
                server.services.share as unknown as {
                    config: { share_daily_limit?: number };
                }
            ).config;
            const previous = cfg.share_daily_limit;
            cfg.share_daily_limit = limit;
            try {
                await fn();
            } finally {
                cfg.share_daily_limit = previous;
            }
        };

        it('refuses a new share once the day budget is spent', async () => {
            const owner = await makeUser();
            const first = await makeUser();
            const second = await makeUser();
            const file = await makeFile(owner.user);

            await withLimit(1, async () => {
                await share(owner.actor, {
                    uid: file.uuid,
                    recipient: { email: first.email },
                    mode: 'read',
                });

                await expect(
                    share(owner.actor, {
                        uid: file.uuid,
                        recipient: { email: second.email },
                        mode: 'read',
                    }),
                ).rejects.toMatchObject({ statusCode: 429 });
            });
        });

        it('does not spend budget on changing an existing share mode', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await withLimit(1, async () => {
                await share(owner.actor, {
                    uid: file.uuid,
                    recipient: { email: recipient.email },
                    mode: 'read',
                });
                // Same pair, new mode — reach is unchanged, so it must not
                // count against the budget the first share already spent.
                const upgraded = await share(owner.actor, {
                    uid: file.uuid,
                    recipient: { email: recipient.email },
                    mode: 'write',
                });
                expect(upgraded.mode).toBe('write');
            });
        });

        it('counts creations, so revoking does not refund the slot', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const other = await makeUser();
            const file = await makeFile(owner.user);

            await withLimit(1, async () => {
                await share(owner.actor, {
                    uid: file.uuid,
                    recipient: { email: recipient.email },
                    mode: 'read',
                });
                await unshare(owner.actor, {
                    uid: file.uuid,
                    recipient: { email: recipient.email },
                });

                await expect(
                    share(owner.actor, {
                        uid: file.uuid,
                        recipient: { email: other.email },
                        mode: 'read',
                    }),
                ).rejects.toMatchObject({ statusCode: 429 });
            });
        });

        it('treats a non-positive limit as unlimited', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await withLimit(0, async () => {
                const result = await share(owner.actor, {
                    uid: file.uuid,
                    recipient: { email: recipient.email },
                    mode: 'read',
                });
                expect(result.mode).toBe('read');
            });
        });
    });

    it('moves an existing share to a new mode rather than stacking one', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'write',
        });

        const rows = await server.services.share.listSharesOf(owner.actor, {
            uid: file.uuid,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].mode).toBe('write');
    });

    it('keeps a mode change from tearing down the share it failed on', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { username: recipient.user.username },
            mode: 'read',
        });
        expect(await canRead(recipient.actor, file.path)).toBe(true);

        // Fail the index write the way a lost connection would.
        const upsert = server.stores.share.upsertActive.bind(
            server.stores.share,
        );
        server.stores.share.upsertActive = async () => {
            throw new Error('index write failed');
        };
        try {
            await expect(
                share(owner.actor, {
                    uid: file.uuid,
                    recipient: { username: recipient.user.username },
                    mode: 'write',
                }),
            ).rejects.toThrow('index write failed');
        } finally {
            server.stores.share.upsertActive = upsert;
        }

        // The rollback may only undo reach this call created; the read the
        // recipient already had is not this call's to take away.
        expect(await canRead(recipient.actor, file.path)).toBe(true);
    });

    it('settles concurrent shares of the same pair on one row', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        const results = await Promise.allSettled(
            Array.from({ length: 4 }, () =>
                share(owner.actor, {
                    uid: file.uuid,
                    recipient: { username: recipient.user.username },
                    mode: 'read',
                }),
            ),
        );
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        expect(await server.stores.share.listByFsentry(file.id)).toHaveLength(
            1,
        );
        expect(await canRead(recipient.actor, file.path)).toBe(true);
    });

    it('retires a manage delegate’s grant when the entry is deleted', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { username: delegate.user.username },
            mode: 'manage',
        });
        expect(await canRead(delegate.actor, file.path)).toBe(true);

        await server.services.share.onEntryDeleted(file.uuid);

        // `manage:fs:<uuid>` does not sit under the `fs:<uuid>` prefix, and it
        // answers every mode — leaving it behind outlives the file.
        expect(
            await server.stores.permission.readLinkedUserUserPerms(
                delegate.user.id,
                [`manage:fs:${file.uuid}`],
            ),
        ).toEqual([]);
    });

    it('notifies a recipient once per window, not once per re-share', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const first = await makeFile(owner.user);
        const second = await makeFile(owner.user);

        const notified: number[][] = [];
        const notify = server.services.notification.notify.bind(
            server.services.notification,
        );
        server.services.notification.notify = (async (ids: number[]) => {
            notified.push(ids);
        }) as never;
        try {
            const shared = await share(owner.actor, {
                uid: first.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            await server.services.share.notifyRecipients(owner.actor, [shared]);

            // Re-sharing what they already have is not new reach, and a second
            // item inside the window still doesn't earn a second interruption.
            const again = await share(owner.actor, {
                uid: first.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            const other = await share(owner.actor, {
                uid: second.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            await server.services.share.notifyRecipients(owner.actor, [
                again,
                other,
            ]);
        } finally {
            server.services.notification.notify = notify;
        }

        expect(notified).toEqual([[recipient.user.id]]);
    });

    describe('an app is bounded by what it was given', () => {
        const makeApp = async (ownerUserId) =>
            server.stores.app.create(
                {
                    name: `share-app-${uuidv4()}`,
                    title: 'Share app',
                    index_url: `https://share-${uuidv4()}.test/`,
                },
                { ownerUserId },
            );

        const asApp = (owner, app) => ({
            user: owner.user,
            app: { uid: app.uid, id: app.id },
        });

        /** A real entry under the app's own AppData for `owner`. */
        const makeAppDataFile = async (owner, app) => {
            const now = Math.floor(Date.now() / 1000);
            let parentId = null;
            let parentUid = null;
            let dirPath = `/${owner.user.username}`;
            for (const segment of ['AppData', app.uid]) {
                dirPath = `${dirPath}/${segment}`;
                const uuid = uuidv4();
                await server.clients.db.write(
                    'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`, `parent_id`, `parent_uid`) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
                    [uuid, segment, dirPath, owner.user.id, now, parentId, parentUid],
                );
                const row = await server.stores.fsEntry.getEntryByPath(dirPath);
                parentId = row.id;
                parentUid = row.uuid;
            }
            const uuid = uuidv4();
            const filePath = `${dirPath}/state.json`;
            await server.clients.db.write(
                'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`, `parent_id`, `parent_uid`) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
                [uuid, 'state.json', filePath, owner.user.id, now, parentId, parentUid],
            );
            return server.stores.fsEntry.getEntryByPath(filePath);
        };

        it('shares a file in its own AppData without any extra grant', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const app = await makeApp(owner.user.id);
            const file = await makeAppDataFile(owner, app);

            const result = await share(asApp(owner, app), {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            expect(result.mode).toBe('read');
            expect(await canRead(recipient.actor, file.path)).toBe(true);
        });

        it('refuses a file of its user’s that it was never given', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const app = await makeApp(owner.user.id);
            const file = await makeFile(owner.user);

            // The user owns it and could share it themselves; the app cannot,
            // because the file was never handed to the app.
            await expect(
                share(asApp(owner, app), {
                    uid: file.uuid,
                    recipient: { username: recipient.user.username },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({ statusCode: 404 });
            expect(await canRead(recipient.actor, file.path)).toBe(false);
        });

        it('shares a file it was specifically granted', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const app = await makeApp(owner.user.id);
            const file = await makeFile(owner.user);

            await runWithContext({ actor: owner.actor }, () =>
                server.services.permission.grantUserAppPermission(
                    owner.actor,
                    app.uid,
                    `fs:${file.uuid}:read`,
                ),
            );

            const result = await share(asApp(owner, app), {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            expect(result.mode).toBe('read');
            expect(await canRead(recipient.actor, file.path)).toBe(true);
        });

        // 403 rather than 404: the app can see the file, so there is no
        // existence to protect — only the wider mode is refused.
        it('cannot hand out more than it holds', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const app = await makeApp(owner.user.id);
            const file = await makeFile(owner.user);

            await runWithContext({ actor: owner.actor }, () =>
                server.services.permission.grantUserAppPermission(
                    owner.actor,
                    app.uid,
                    `fs:${file.uuid}:read`,
                ),
            );

            await expect(
                share(asApp(owner, app), {
                    uid: file.uuid,
                    recipient: { username: recipient.user.username },
                    mode: 'write',
                }),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('records which app asked, so the owner can tell', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const app = await makeApp(owner.user.id);
            const file = await makeAppDataFile(owner, app);

            await share(asApp(owner, app), {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            const shares = await runWithContext({ actor: owner.actor }, () =>
                server.services.share.listSharesOf(owner.actor, {
                    uid: file.uuid,
                }),
            );
            expect(shares[0].issuedByApp).toBe(app.uid);
        });

        it('lists only the shares it can reach in shared-with-me', async () => {
            const owner = await makeUser();
            const holder = await makeUser();
            const app = await makeApp(holder.user.id);
            const reachable = await makeFile(owner.user);
            const hidden = await makeFile(owner.user);

            for (const file of [reachable, hidden]) {
                await share(owner.actor, {
                    uid: file.uuid,
                    recipient: { username: holder.user.username },
                    mode: 'read',
                });
            }
            await runWithContext({ actor: holder.actor }, () =>
                server.services.permission.grantUserAppPermission(
                    holder.actor,
                    app.uid,
                    `fs:${reachable.uuid}:read`,
                ),
            );

            const asHolder = await server.services.share.listSharedWithMe(
                holder.actor,
            );
            expect(asHolder.items.map((i) => i.entryUid)).toEqual(
                expect.arrayContaining([reachable.uuid, hidden.uuid]),
            );

            // The app sees only the one its user handed it.
            const asAppActor = await server.services.share.listSharedWithMe(
                asApp(holder, app),
            );
            const listed = asAppActor.items.map((i) => i.entryUid);
            expect(listed).toContain(reachable.uuid);
            expect(listed).not.toContain(hidden.uuid);
        });
    });

    it('retires grants when the entry is deleted', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });

        await server.services.share.onEntryDeleted(file.uuid);
        await server.clients.db.write(
            'DELETE FROM `fsentries` WHERE `uuid` = ?',
            [file.uuid],
        );

        const listed = await server.services.share.listSharedWithMe(
            recipient.actor,
        );
        expect(listed.items.map((i) => i.entryUid)).not.toContain(file.uuid);
        const rows = await server.stores.permission.readLinkedUserUserPerms(
            recipient.user.id,
            [`fs:${file.uuid}:read`],
        );
        expect(rows).toEqual([]);
    });

    it('retires grants when the file is removed through the FS', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });
        expect(await canRead(recipient.actor, file.path)).toBe(true);

        // The real delete path, not the hook. FSService emits without
        // awaiting, so the cleanup lands shortly after `remove` resolves.
        await server.services.fs.remove(owner.user.id, { entry: file });

        let rows = [] as unknown[];
        for (let attempt = 0; attempt < 50; attempt++) {
            rows = await server.stores.permission.readLinkedUserUserPerms(
                recipient.user.id,
                [`fs:${file.uuid}:read`],
            );
            if (rows.length === 0) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(rows).toEqual([]);
        expect(await canRead(recipient.actor, file.path)).toBe(false);
    });

    describe('keeping recipients in sync', () => {
        /** Collect one GUI event's audiences for the life of the callback. */
        const captureAudiences = async (
            event:
                | 'outer.gui.item.removed'
                | 'outer.gui.item.moved'
                | 'outer.gui.item.updated',
            uuid: string,
            fn: () => Promise<void>,
        ) => {
            const seen: number[][] = [];
            server.clients.event.on(event, (_key, data) => {
                const payload = data as {
                    user_id_list?: number[];
                    response?: { uuid?: string };
                };
                if (payload.response?.uuid !== uuid) return;
                seen.push(payload.user_id_list ?? []);
            });
            await fn();
            for (let i = 0; i < 50 && seen.length === 0; i++) {
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            return seen;
        };

        it('tells a recipient when a shared file is deleted', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            // Without this the recipient's open window shows a file that is
            // gone until their next request happens to fail.
            const audiences = await captureAudiences(
                'outer.gui.item.removed',
                file.uuid,
                async () => {
                    await server.services.fs.remove(owner.user.id, {
                        entry: file,
                    });
                },
            );

            expect(audiences.flat()).toContain(recipient.user.id);
        });

        it('tells a folder recipient when a file inside it changes', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);

            // The share is on the folder; the changed file has no row of its
            // own, so the fan-out has to look upward to find the audience.
            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const audiences = await captureAudiences(
                'outer.gui.item.updated',
                file.uuid,
                async () => {
                    await server.clients.event.emitAndWait(
                        'fs.write.file',
                        { node: file },
                        {},
                    );
                },
            );

            expect(audiences.flat()).toContain(recipient.user.id);
        });

        it('tells a recipient when a shared file moves', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const audiences = await captureAudiences(
                'outer.gui.item.moved',
                file.uuid,
                async () => {
                    await server.clients.event.emitAndWait(
                        'fs.move.node',
                        {
                            node: file,
                            fromPath: file.path,
                            toPath: `${file.path}-moved`,
                        },
                        {},
                    );
                },
            );

            expect(audiences.flat()).toContain(recipient.user.id);
            // The owner already gets their own event from the FS layer;
            // announcing again here would double it up.
            expect(audiences.flat()).not.toContain(owner.user.id);
        });
    });

    it('paginates what has been shared with me', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const uids: string[] = [];
        for (let i = 0; i < 3; i++) {
            const file = await makeFile(owner.user);
            uids.push(file.uuid);
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });
        }

        const seen: string[] = [];
        let cursor: string | undefined;
        for (let guard = 0; guard < 6; guard++) {
            const page = await server.services.share.listSharedWithMe(
                recipient.actor,
                { limit: 2, cursor },
            );
            seen.push(...page.items.map((i) => i.entryUid));
            cursor = page.cursor;
            if (!cursor) break;
        }
        expect(seen).toEqual(uids);

        const withTotal = await server.services.share.listSharedWithMe(
            recipient.actor,
            { includeTotal: true },
        );
        expect(withTotal.total).toBe(3);
    });

    // ── review fixes ────────────────────────────────────────────────

    it('drops a listing whose grant was withdrawn outside the index', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });
        const before = await server.services.share.listSharedWithMe(
            recipient.actor,
        );
        expect(before.items.map((i) => i.entryUid)).toContain(file.uuid);

        // Straight at the permission layer, the way `/auth/revoke-user-user`
        // does — the share row survives, so the index alone would keep
        // publishing the entry's name, size and a signed thumbnail URL.
        await server.services.permission.revokeUserUserPermission(
            owner.actor,
            recipient.user.username!,
            `fs:${file.uuid}:read`,
        );
        expect(await canRead(recipient.actor, file.path)).toBe(false);

        const after = await server.services.share.listSharedWithMe(
            recipient.actor,
        );
        expect(after.items.map((i) => i.entryUid)).not.toContain(file.uuid);
    });

    it('lets a recipient leave a share that was never indexed', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        // A grant with no share row behind it — how anything predating the
        // index looks.
        await server.services.acl.setUserUser(
            owner.actor,
            recipient.actor,
            {
                path: file.path,
                resolveAncestors: () =>
                    server.services.fs.getAncestorChain(file.path),
            },
            'read',
        );
        expect(await canRead(recipient.actor, file.path)).toBe(true);

        const result = await unshare(recipient.actor, {
            uid: file.uuid,
            recipient: { username: recipient.user.username },
        });

        expect(result.revoked).toBeGreaterThan(0);
        expect(await canRead(recipient.actor, file.path)).toBe(false);
    });

    it('refuses to let a manage delegate hand out manage', async () => {
        const owner = await makeUser();
        const delegate = await makeUser();
        const third = await makeUser();
        const { dir } = await makeDirWithFile(owner.user);

        await share(owner.actor, {
            uid: dir.uuid,
            recipient: { email: delegate.email },
            mode: 'manage',
        });

        // Write is theirs to pass on; manage is not.
        await expect(
            share(delegate.actor, {
                uid: dir.uuid,
                recipient: { email: third.email },
                mode: 'write',
            }),
        ).resolves.toMatchObject({ mode: 'write' });

        await expect(
            share(delegate.actor, {
                uid: dir.uuid,
                recipient: { email: third.email },
                mode: 'manage',
            }),
        ).rejects.toMatchObject({ statusCode: expect.any(Number) });
    });

    it('retires a share when the item changes owner', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);
        const newOwner = await makeUser();

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });
        expect(await canRead(recipient.actor, file.path)).toBe(true);

        // What a move into someone else's tree does to the row.
        await server.stores.fsEntry.updateEntry(file.uuid, {
            userId: newOwner.user.id,
        });
        const moved = await server.stores.fsEntry.getEntryByUuid(file.uuid);
        await server.services.share.onEntryOwnerChanged(moved!);

        expect(await canRead(recipient.actor, file.path)).toBe(false);
        expect((await server.stores.share.listByFsentry(file.id)).length).toBe(
            0,
        );
    });

    it('retires a whole burst of deletions in one flush', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const files = [];
        for (let i = 0; i < 5; i++) {
            const file = await makeFile(owner.user);
            files.push(file);
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });
        }

        const removed = await server.services.share.onEntryDeleted(
            files.map((f) => f.uuid),
        );
        expect(
            new Set(
                removed.map(
                    (row) =>
                        row.permission.replace(/^manage:/u, '').split(':')[1],
                ),
            ),
        ).toEqual(new Set(files.map((f) => f.uuid)));

        for (const file of files) {
            expect(await canRead(recipient.actor, file.path)).toBe(false);
        }
    });
});
