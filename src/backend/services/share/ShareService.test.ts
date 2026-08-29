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
        // clean_email too, as real signup writes it — canonical resolution
        // (alias and case variants) rides on that column.
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

    const makeApp = async (ownerUserId) =>
        server.stores.app.create(
            {
                name: `share-app-${uuidv4()}`,
                title: 'Share app',
                index_url: `https://share-${uuidv4()}.test/`,
            },
            { ownerUserId },
        );

    // Built the way the request path builds it, so `effectiveApp` is derived
    // rather than left unresolved.
    const asApp = (owner, app) =>
        makeActor({
            user: owner.user,
            app: { uid: app.uid, id: app.id },
        });

    /** Hand an app the reach it needs to share one of its user's files. */
    const grantAppReach = (owner, app, entry, mode = 'read') =>
        runWithContext({ actor: owner.actor }, () =>
            server.services.permission.grantUserAppPermission(
                owner.actor,
                app.uid,
                `fs:${entry.uuid}:${mode}`,
            ),
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
        expect(result.name).toBe(file.name);
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

    it('refuses an unknown mode', async () => {
        const owner = await makeUser();
        const file = await makeFile(owner.user);

        await expect(
            share(owner.actor, {
                uid: file.uuid,
                recipient: { email: 'nobody@nowhere.test' },
                mode: 'wizard',
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('grants nothing to an email its account has not confirmed', async () => {
        const owner = await makeUser();
        const squatter = await makeUser();
        await server.stores.user.update(squatter.user.id, {
            email_confirmed: false,
        });
        const file = await makeFile(owner.user);

        // The address is a claim, not an identity: the share waits as an
        // invite rather than handing access to whoever registered it first.
        const result = await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: squatter.email },
            mode: 'read',
        });
        expect(result.pending).toBe(true);
        expect(await canRead(squatter.actor, file.path)).toBe(false);

        // A username names exactly one account, confirmed or not.
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { username: squatter.user.username },
            mode: 'read',
        });
        expect(await canRead(squatter.actor, file.path)).toBe(true);
    });

    // `+` is only an alias separator where the domain says so.
    it('does not hand a plus-addressed share to the base account', async () => {
        const owner = await makeUser();
        const file = await makeFile(owner.user);
        const base = `finance-${Math.random().toString(36).slice(2, 8)}@example.test`;
        const holder = await makeUser();
        await server.stores.user.update(holder.user.id, {
            email: base,
            clean_email: base,
            email_confirmed: true,
        });
        const [local, domain] = base.split('@');
        const distinct = `${local}+board@${domain}`;

        const result = await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: distinct },
            mode: 'read',
        });

        expect(result.holder.username).not.toBe(holder.user.username);
        expect(await canRead(holder.actor, file.path)).toBe(false);
    });

    // The invite variant: no account need exist when the share is made.
    it('does not let the base address claim a plus-addressed invite', async () => {
        const owner = await makeUser();
        const file = await makeFile(owner.user);
        const stem = `payroll-${Math.random().toString(36).slice(2, 8)}`;
        const base = `${stem}@example.test`;
        const distinct = `${stem}+contractors@example.test`;

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: distinct },
            mode: 'read',
        });

        const claimer = await makeUser();
        await server.stores.user.update(claimer.user.id, {
            email: base,
            clean_email: base,
            email_confirmed: true,
        });
        const claimed = await server.services.share.claimPendingShares(
            claimer.user.id,
            base,
        );

        expect(claimed).toEqual([]);
        expect(await canRead(claimer.actor, file.path)).toBe(false);
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

    describe('the listing flag', () => {
        const flags = (actor: Actor, entries: unknown[]) =>
            server.services.share.shareFlags(actor, entries as never);

        it('goes quiet when the grant is withdrawn through the permission API', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            // What the deprecated `/auth/revoke-user-user` route does: the
            // grant goes, `unshare` never runs, and the index row is left.
            await runWithContext({ actor: owner.actor }, () =>
                server.services.permission.revokeUserUserPermission(
                    owner.actor,
                    recipient.user.username!,
                    `fs:${file.uuid}:read`,
                ),
            );
            await server.services.share.onGrantRevoked(
                owner.actor,
                recipient.user.username!,
                `fs:${file.uuid}:read`,
            );

            expect(await canRead(recipient.actor, file.path)).toBe(false);
            // The flag reads the index, so it has to agree with `listSharesOf`.
            expect(
                await server.services.share.listSharesOf(owner.actor, {
                    uid: file.uuid,
                }),
            ).toEqual([]);
            expect(await flags(owner.actor, [file])).toEqual(
                new Map([[file.uuid, false]]),
            );
        });

        it('flags a shared entry and not its neighbour, until it is revoked', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const shared = await makeFile(owner.user);
            const untouched = await makeFile(owner.user);

            await share(owner.actor, {
                uid: shared.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            expect(await flags(owner.actor, [shared, untouched])).toEqual(
                new Map([
                    [shared.uuid, true],
                    [untouched.uuid, false],
                ]),
            );

            await unshare(owner.actor, {
                uid: shared.uuid,
                recipient: { username: recipient.user.username },
            });

            expect(await flags(owner.actor, [shared, untouched])).toEqual(
                new Map([
                    [shared.uuid, false],
                    [untouched.uuid, false],
                ]),
            );
        });

        it('flags an entry whose only share is an unclaimed invite', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);

            const result = await share(owner.actor, {
                uid: file.uuid,
                recipient: {
                    email: `nobody-${uuidv4().slice(0, 8)}@test.local`,
                },
                mode: 'read',
            });
            expect(result.pending).toBe(true);

            expect(await flags(owner.actor, [file])).toEqual(
                new Map([[file.uuid, true]]),
            );
        });

        it('tells a recipient nothing about who else the owner shared with', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            expect(await flags(recipient.actor, [file])).toEqual(new Map());
        });

        it('does not flag a file reachable only through a shared folder', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            // The flag says shared, not reachable.
            expect(await canRead(recipient.actor, file.path)).toBe(true);
            expect(await flags(owner.actor, [dir, file])).toEqual(
                new Map([
                    [dir.uuid, true],
                    [file.uuid, false],
                ]),
            );
        });
    });

    describe('the outbound listing', () => {
        const listSharedByMe = (
            actor: Actor,
            opts?: { limit?: number; cursor?: string; includeTotal?: boolean },
        ) =>
            runWithContext({ actor }, () =>
                server.services.share.listSharedByMe(actor, opts),
            );

        it('gathers shares on unrelated items into one listing', async () => {
            const owner = await makeUser();
            const first = await makeUser();
            const second = await makeUser();
            const files = [
                await makeFile(owner.user),
                await makeFile(owner.user),
                await makeFile(owner.user),
            ];

            for (const [index, file] of files.entries()) {
                await share(owner.actor, {
                    uid: file.uuid,
                    recipient: {
                        email: index === 2 ? second.email : first.email,
                    },
                    mode: 'read',
                });
            }

            const listed = await listSharedByMe(owner.actor);
            expect(listed.items.map((i) => i.entryUid).sort()).toEqual(
                files.map((f) => f.uuid).sort(),
            );
            // The caller owns these, so the paths are their own.
            expect(listed.items.map((i) => i.path).sort()).toEqual(
                files.map((f) => f.path).sort(),
            );
            expect(listed.items.map((i) => i.holder.username).sort()).toEqual(
                [
                    first.user.username,
                    first.user.username,
                    second.user.username,
                ].sort(),
            );
        });

        it('shows the owner what a manage delegate shared from their item', async () => {
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

            const listed = await listSharedByMe(owner.actor);
            const byHolder = new Map(
                listed.items.map((i) => [i.holder.username, i]),
            );
            expect([...byHolder.keys()].sort()).toEqual(
                [delegate.user.username, third.user.username].sort(),
            );
            expect(byHolder.get(third.user.username)?.issuer.username).toBe(
                delegate.user.username,
            );
            expect(byHolder.get(third.user.username)?.entryUid).toBe(file.uuid);
        });

        it('masks the owner path on a share the caller issued as a delegate', async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const third = await makeUser();
            const file = await makeFile(owner.user);
            const unrelated = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: delegate.email },
                mode: 'manage',
            });
            await share(owner.actor, {
                uid: unrelated.uuid,
                recipient: { email: third.email },
                mode: 'read',
            });
            await share(delegate.actor, {
                uid: file.uuid,
                recipient: { email: third.email },
                mode: 'read',
            });

            // Only what the delegate handed out — the owner's own share of an
            // item they never touched is not theirs to see.
            const listed = await listSharedByMe(delegate.actor);
            expect(listed.items).toHaveLength(1);
            expect(listed.items[0].entryUid).toBe(file.uuid);
            expect(listed.items[0].path).toBe(
                `/${owner.user.username}/${file.uuid}/${file.name}`,
            );
            expect(listed.items[0].owner?.username).toBe(
                owner.user.username,
            );
        });

        it('drops a delegate-issued share from both listings once revoked, never from the recipient\'s', async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: delegate.email },
                mode: 'manage',
            });
            await share(delegate.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const heldByRecipient = (
                items: Array<{ holder: { username: string | null } }>,
            ) => items.some((i) => i.holder.username === recipient.user.username);

            expect(
                heldByRecipient((await listSharedByMe(owner.actor)).items),
            ).toBe(true);
            expect(
                (await listSharedByMe(delegate.actor)).items.map(
                    (i) => i.entryUid,
                ),
            ).toEqual([file.uuid]);
            // The recipient only holds the share; that is inbound for them,
            // not something they issued or own the node for.
            expect((await listSharedByMe(recipient.actor)).items).toEqual([]);

            await unshare(delegate.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
            });

            expect(
                heldByRecipient((await listSharedByMe(owner.actor)).items),
            ).toBe(false);
            expect((await listSharedByMe(delegate.actor)).items).toEqual([]);
        });

        it('never lists a share another user made', async () => {
            const owner = await makeUser();
            const other = await makeUser();
            const recipient = await makeUser();
            const ownersFile = await makeFile(owner.user);
            const othersFile = await makeFile(other.user);

            await share(owner.actor, {
                uid: ownersFile.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });
            await share(other.actor, {
                uid: othersFile.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const listed = await listSharedByMe(other.actor);
            expect(listed.items.map((i) => i.entryUid)).toEqual([
                othersFile.uuid,
            ]);
        });

        it('drops a share once it is revoked', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });
            expect(
                (await listSharedByMe(owner.actor)).items.map(
                    (i) => i.entryUid,
                ),
            ).toEqual([file.uuid]);

            await unshare(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
            });
            expect((await listSharedByMe(owner.actor)).items).toEqual([]);
        });

        it('is an empty page for someone who has shared nothing', async () => {
            const nobody = await makeUser();
            const listed = await listSharedByMe(nobody.actor, {
                includeTotal: true,
            });
            expect(listed.items).toEqual([]);
            expect(listed.cursor).toBeUndefined();
            expect(listed.total).toBe(0);
        });

        it('carries an unclaimed invite as pending', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `invitee-${Math.random()
                .toString(36)
                .slice(2, 8)}@test.local`;

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            const listed = await listSharedByMe(owner.actor);
            expect(listed.items).toHaveLength(1);
            expect(listed.items[0].pending).toBe(true);
            expect(listed.items[0].recipientEmail).toBe(email);
            expect(listed.items[0].holder.username).toBeNull();
        });

        it("drops only the withdrawn issuer's row when another grant keeps the holder reachable", async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const holder = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: delegate.email },
                mode: 'manage',
            });
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: holder.email },
                mode: 'read',
            });
            await share(delegate.actor, {
                uid: file.uuid,
                recipient: { email: holder.email },
                mode: 'read',
            });

            // The owner's grant goes through the permission API and the index
            // row is left behind (what `onGrantRevoked` cannot fix when it
            // can't name the issuer). The delegate's grant still reaches the
            // holder — that must not keep the owner's dead row listed.
            await runWithContext({ actor: owner.actor }, () =>
                server.services.permission.revokeUserUserPermission(
                    owner.actor,
                    holder.user.username!,
                    `fs:${file.uuid}:read`,
                ),
            );

            const listed = await listSharedByMe(owner.actor);
            const pairs = listed.items
                .map((i) => `${i.issuer.username}>${i.holder.username}`)
                .sort();
            expect(pairs).toEqual(
                [
                    `${owner.user.username}>${delegate.user.username}`,
                    `${delegate.user.username}>${holder.user.username}`,
                ].sort(),
            );
        });

        it("takes a revoked delegate's unclaimed invites with them", async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const file = await makeFile(owner.user);
            const email = `orphan-${Math.random()
                .toString(36)
                .slice(2, 8)}@test.local`;

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: delegate.email },
                mode: 'manage',
            });
            await share(delegate.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });
            expect(
                (await listSharedByMe(delegate.actor)).items.some(
                    (i) => i.pending,
                ),
            ).toBe(true);

            await unshare(owner.actor, {
                uid: file.uuid,
                recipient: { email: delegate.email },
            });

            // The row itself is gone, not just hidden: nothing else would
            // ever retire it.
            expect(await server.stores.share.listPendingByEmail(email)).toEqual(
                [],
            );
            expect((await listSharedByMe(delegate.actor)).items).toEqual([]);
        });

        it('hides an invite whose issuer lost their authority outside unshare', async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const file = await makeFile(owner.user);
            const email = `stale-${Math.random()
                .toString(36)
                .slice(2, 8)}@test.local`;

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: delegate.email },
                mode: 'manage',
            });
            await share(delegate.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            // Withdrawn through the permission API: no share-row cleanup runs,
            // but the listing must not keep publishing the entry to an issuer
            // whose access is gone.
            await runWithContext({ actor: owner.actor }, () =>
                server.services.permission.revokeUserUserPermission(
                    owner.actor,
                    delegate.user.username!,
                    `manage:fs:${file.uuid}`,
                ),
            );

            expect(
                await server.stores.share.listPendingByEmail(email),
            ).toHaveLength(1);
            expect((await listSharedByMe(delegate.actor)).items).toEqual([]);
            expect(
                (await listSharedByMe(owner.actor)).items.some(
                    (i) => i.pending,
                ),
            ).toBe(false);
        });

        it('reads the app off an invite recorded under the legacy key', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `legacy-${Math.random()
                .toString(36)
                .slice(2, 8)}@test.local`;

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });
            const [row] = await server.stores.share.listPendingByEmail(email);
            await server.clients.db.write(
                'UPDATE `share` SET `data` = ? WHERE `uid` = ?',
                [JSON.stringify({ issuerAppUid: 'app-legacy' }), row.uid],
            );

            const listed = await listSharedByMe(owner.actor);
            expect(listed.items).toHaveLength(1);
            expect(listed.items[0].issuedByApp).toBe('app-legacy');
        });

        it('walks every page through the cursor', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const files = [
                await makeFile(owner.user),
                await makeFile(owner.user),
                await makeFile(owner.user),
            ];
            for (const file of files) {
                await share(owner.actor, {
                    uid: file.uuid,
                    recipient: { email: recipient.email },
                    mode: 'read',
                });
            }

            const seen: string[] = [];
            let cursor: string | undefined;
            let total: number | undefined;
            for (let page = 0; page < 5; page++) {
                const listed = await listSharedByMe(owner.actor, {
                    limit: 1,
                    cursor,
                    includeTotal: cursor === undefined,
                });
                seen.push(...listed.items.map((i) => i.entryUid));
                total ??= listed.total;
                cursor = listed.cursor;
                if (!cursor) break;
            }

            expect(cursor).toBeUndefined();
            expect(seen.sort()).toEqual(files.map((f) => f.uuid).sort());
            expect(total).toBe(files.length);
        });
    });

    describe('the outbound listing scoped by app', () => {
        const listSharedByMe = (
            actor: Actor,
            opts?: {
                limit?: number;
                cursor?: string;
                includeTotal?: boolean;
                appUid?: string | null;
            },
        ) =>
            runWithContext({ actor }, () =>
                server.services.share.listSharedByMe(actor, opts),
            );

        const listApps = (
            actor: Actor,
            opts?: { limit?: number; cursor?: string; includeTotal?: boolean },
        ) =>
            runWithContext({ actor }, () =>
                server.services.share.listSharedByMeApps(actor, opts),
            );

        const revokeByUid = (actor: Actor, uid: string) =>
            runWithContext({ actor }, () =>
                server.services.share.revokeSharedByMe(actor, uid),
            );

        /** An owner, a recipient, and one file shared through each app. */
        const shareThroughApps = async (appCount: number) => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const apps = [];
            const files = [];
            for (let i = 0; i < appCount; i++) {
                const app = await makeApp(owner.user.id);
                const file = await makeFile(owner.user);
                await grantAppReach(owner, app, file);
                await share(asApp(owner, app), {
                    uid: file.uuid,
                    recipient: { username: recipient.user.username },
                    mode: 'read',
                });
                apps.push(app);
                files.push(file);
            }
            return { owner, recipient, apps, files };
        };

        it('shows an app its own grants and nothing another app issued', async () => {
            const { owner, apps, files } = await shareThroughApps(2);

            for (const [index, app] of apps.entries()) {
                const listed = await listSharedByMe(asApp(owner, app), {
                    includeTotal: true,
                });
                expect(listed.items.map((i) => i.entryUid)).toEqual([
                    files[index].uuid,
                ]);
                expect(listed.items[0].issuedByApp).toBe(app.uid);
                expect(listed.total).toBe(1);
            }
        });

        it('gives an app nothing when it asks about another app', async () => {
            const { owner, apps } = await shareThroughApps(2);

            const listed = await listSharedByMe(asApp(owner, apps[0]), {
                appUid: apps[1].uid,
                includeTotal: true,
            });
            expect(listed.items).toEqual([]);
            expect(listed.total).toBe(0);
        });

        it('lets a session filter to one app, or to what it shared itself', async () => {
            const { owner, recipient, apps, files } =
                await shareThroughApps(2);
            const byHand = await makeFile(owner.user);
            await share(owner.actor, {
                uid: byHand.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            const across = await listSharedByMe(owner.actor);
            expect(across.items.map((i) => i.entryUid).sort()).toEqual(
                [...files.map((f) => f.uuid), byHand.uuid].sort(),
            );

            const scoped = await listSharedByMe(owner.actor, {
                appUid: apps[0].uid,
                includeTotal: true,
            });
            expect(scoped.items.map((i) => i.entryUid)).toEqual([
                files[0].uuid,
            ]);
            expect(scoped.total).toBe(1);

            const manual = await listSharedByMe(owner.actor, { appUid: null });
            expect(manual.items.map((i) => i.entryUid)).toEqual([byHand.uuid]);
        });

        it('groups the listing by app, naming each one', async () => {
            const { owner, recipient, apps } = await shareThroughApps(1);
            const byHand = await makeFile(owner.user);
            await share(owner.actor, {
                uid: byHand.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            const grouped = await listApps(owner.actor, { includeTotal: true });
            expect(grouped.total).toBe(2);
            const byApp = new Map(grouped.items.map((i) => [i.appUid, i]));
            expect(byApp.get(null)?.count).toBe(1);
            expect(byApp.get(apps[0].uid)).toMatchObject({
                name: apps[0].name,
                title: apps[0].title,
                count: 1,
            });
        });

        it('keeps the grouped view to user sessions', async () => {
            const { owner, apps } = await shareThroughApps(1);
            await expect(
                listApps(asApp(owner, apps[0])),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('still shows and revokes what a removed app left behind', async () => {
            const { owner, recipient, apps, files } =
                await shareThroughApps(1);
            await server.stores.app.delete(apps[0].id);

            const grouped = await listApps(owner.actor);
            expect(
                grouped.items.find((i) => i.appUid === apps[0].uid),
            ).toMatchObject({ name: null, title: null, count: 1 });

            const listed = await listSharedByMe(owner.actor, {
                appUid: apps[0].uid,
            });
            expect(listed.items.map((i) => i.entryUid)).toEqual([
                files[0].uuid,
            ]);

            expect(await canRead(recipient.actor, files[0].path)).toBe(true);
            await revokeByUid(owner.actor, listed.items[0].uid);
            expect(await canRead(recipient.actor, files[0].path)).toBe(false);
            expect((await listSharedByMe(owner.actor)).items).toEqual([]);
        });

        it('settles the grant when a listed share is revoked', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            const listed = await listSharedByMe(owner.actor);
            expect(await canRead(recipient.actor, file.path)).toBe(true);

            expect(await revokeByUid(owner.actor, listed.items[0].uid)).toEqual(
                { revoked: 1 },
            );
            expect(await canRead(recipient.actor, file.path)).toBe(false);
            expect((await listSharedByMe(owner.actor)).items).toEqual([]);
        });

        it('takes back an unclaimed invite by its uid', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `invitee-${uuidv4().slice(0, 8)}@test.local`;
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            const listed = await listSharedByMe(owner.actor);
            expect(listed.items[0].pending).toBe(true);
            await revokeByUid(owner.actor, listed.items[0].uid);
            expect((await listSharedByMe(owner.actor)).items).toEqual([]);
        });

        it('revokes only the named row when two issuers reach the same pair', async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const recipient = await makeUser();
            const app = await makeApp(owner.user.id);
            const file = await makeFile(owner.user);
            await grantAppReach(owner, app, file);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: delegate.email },
                mode: 'manage',
            });
            await share(asApp(owner, app), {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            await share(delegate.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            // The app addresses its own row; the delegate's grant on the same
            // (file, recipient) pair is not its to take.
            const listed = await listSharedByMe(asApp(owner, app));
            expect(listed.items).toHaveLength(1);
            await revokeByUid(asApp(owner, app), listed.items[0].uid);

            expect(await canRead(recipient.actor, file.path)).toBe(true);
            const remaining = await server.services.share.listSharesOf(
                owner.actor,
                { uid: file.uuid },
            );
            expect(
                remaining.some(
                    (row) =>
                        row.holder.username === recipient.user.username &&
                        row.issuer.username === delegate.user.username,
                ),
            ).toBe(true);
        });

        it('takes back an invite whose address registered but never claimed', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `late-${uuidv4().slice(0, 8)}@test.local`;
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            // The address's owner signs up and confirms, but the claim never
            // runs — the row still has no holder, so recipient-addressed
            // revocation can't find it. The uid-addressed one must.
            const late = await makeUser();
            await server.stores.user.update(late.user.id, {
                email,
                clean_email: email,
            });

            const listed = await listSharedByMe(owner.actor);
            expect(listed.items[0].pending).toBe(true);
            expect(
                await revokeByUid(owner.actor, listed.items[0].uid),
            ).toEqual({ revoked: 1 });
            expect(await server.stores.share.listPendingByEmail(email)).toEqual(
                [],
            );
            expect((await listSharedByMe(owner.actor)).items).toEqual([]);
        });

        // One row records one issuance, so attribution follows the most
        // recent one — in both directions.
        it('re-attributes a grant to whoever issued it last', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const app = await makeApp(owner.user.id);
            const file = await makeFile(owner.user);
            await grantAppReach(owner, app, file);

            await share(asApp(owner, app), {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            const viaApp = await listSharedByMe(asApp(owner, app));
            expect(viaApp.items).toHaveLength(1);
            const uid = viaApp.items[0].uid;

            // Re-shared by hand: the grant is now the user's own. The app's
            // scoped view drops it, and its uid-addressed delete no longer
            // names a row it issued.
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'write',
            });
            expect((await listSharedByMe(asApp(owner, app))).items).toEqual(
                [],
            );
            const manual = await listSharedByMe(owner.actor, { appUid: null });
            expect(manual.items.map((i) => i.uid)).toEqual([uid]);
            await expect(revokeByUid(asApp(owner, app), uid)).rejects.toMatchObject(
                { statusCode: 404 },
            );

            // And back: re-shared through the app, the same row is the app's
            // again.
            await share(asApp(owner, app), {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            expect(
                (await listSharedByMe(asApp(owner, app))).items.map(
                    (i) => i.uid,
                ),
            ).toEqual([uid]);
        });

        // Every uid the caller may not act on answers alike, or the endpoint
        // becomes a way to ask whether one exists.
        it('answers 404 for an unknown uid and for another account\'s', async () => {
            const owner = await makeUser();
            const stranger = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            const listed = await listSharedByMe(owner.actor);

            await expect(
                revokeByUid(owner.actor, uuidv4()),
            ).rejects.toMatchObject({ statusCode: 404 });
            await expect(
                revokeByUid(stranger.actor, listed.items[0].uid),
            ).rejects.toMatchObject({ statusCode: 404 });
            expect(await canRead(recipient.actor, file.path)).toBe(true);
        });

        it('answers 404 when an app names another app\'s share', async () => {
            const { owner, recipient, apps, files } =
                await shareThroughApps(2);
            const listed = await listSharedByMe(asApp(owner, apps[1]));

            await expect(
                revokeByUid(asApp(owner, apps[0]), listed.items[0].uid),
            ).rejects.toMatchObject({ statusCode: 404 });
            expect(await canRead(recipient.actor, files[1].path)).toBe(true);

            // Its own, on the other hand, it may take back.
            await revokeByUid(asApp(owner, apps[1]), listed.items[0].uid);
            expect(await canRead(recipient.actor, files[1].path)).toBe(false);
        });

        it('lets the owner revoke a delegate-issued share, leaving the delegate itself alone', async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const third = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: delegate.user.username },
                mode: 'manage',
            });
            await share(delegate.actor, {
                uid: file.uuid,
                recipient: { username: third.user.username },
                mode: 'read',
            });
            expect(await canRead(third.actor, file.path)).toBe(true);

            // The owner's own listing includes what the delegate issued.
            const listed = await listSharedByMe(owner.actor);
            const delegateRow = listed.items.find(
                (i) => i.holder.username === third.user.username,
            );
            expect(delegateRow).toBeDefined();

            await revokeByUid(owner.actor, delegateRow!.uid);

            // The third party's access is gone; the delegate's own manage
            // grant — issued by the owner, not by the delegate — is untouched.
            expect(await canRead(third.actor, file.path)).toBe(false);
            expect(await canRead(delegate.actor, file.path)).toBe(true);
        });
    });

    describe('the grant audit trail', () => {
        const audit = (
            actor: Actor,
            target?: Record<string, unknown>,
            opts?: { limit?: number; cursor?: string; includeTotal?: boolean },
        ) =>
            runWithContext({ actor }, () =>
                server.services.share.listGrantAudit(
                    actor,
                    target as never,
                    opts,
                ),
            );

        it('names when a grant was made, by whom, and under which app', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const app = await makeApp(owner.user.id);
            const file = await makeFile(owner.user);
            await grantAppReach(owner, app, file);

            await share(asApp(owner, app), {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            const trail = await audit(
                owner.actor,
                { uid: file.uuid },
                { includeTotal: true },
            );
            expect(trail.total).toBe(trail.items.length);
            const granted = trail.items.filter((i) => i.action === 'grant');
            expect(granted.length).toBeGreaterThan(0);
            for (const row of granted) {
                expect(row.entryUid).toBe(file.uuid);
                expect(row.issuer.username).toBe(owner.user.username);
                expect(row.holder.username).toBe(recipient.user.username);
                expect(row.appUid).toBe(app.uid);
                expect(row.createdAt).toBeDefined();
            }
            expect(granted.map((i) => i.mode)).toContain('read');
        });

        it('carries no app for a grant the user made themselves', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            const trail = await audit(owner.actor, { uid: file.uuid });
            expect(trail.items.every((i) => i.appUid === null)).toBe(true);
        });

        // The grant is gone by then; the row is the only record left of it.
        it('still reads after the grant is revoked, and says so', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            await unshare(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
            });
            expect(await canRead(recipient.actor, file.path)).toBe(false);

            const trail = await audit(owner.actor, { uid: file.uuid });
            const actions = new Set(trail.items.map((i) => i.action));
            expect(actions.has('grant')).toBe(true);
            expect(actions.has('revoke')).toBe(true);
            expect(
                trail.items.every(
                    (i) => i.holder.username === recipient.user.username,
                ),
            ).toBe(true);
        });

        it('shows the owner what a delegate granted on their item', async () => {
            const owner = await makeUser();
            const delegate = await makeUser();
            const third = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: delegate.user.username },
                mode: 'manage',
            });
            await share(delegate.actor, {
                uid: file.uuid,
                recipient: { username: third.user.username },
                mode: 'read',
            });

            const trail = await audit(owner.actor, { uid: file.uuid });
            const issuers = new Set(trail.items.map((i) => i.issuer.username));
            expect(issuers).toEqual(
                new Set([owner.user.username, delegate.user.username]),
            );
        });

        it('lists what the caller granted when no item is named', async () => {
            const owner = await makeUser();
            const other = await makeUser();
            const recipient = await makeUser();
            const mine = await makeFile(owner.user);
            const theirs = await makeFile(other.user);

            await share(owner.actor, {
                uid: mine.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            await share(other.actor, {
                uid: theirs.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            const trail = await audit(owner.actor);
            expect(trail.items.length).toBeGreaterThan(0);
            expect(
                trail.items.every(
                    (i) => i.issuer.username === owner.user.username,
                ),
            ).toBe(true);
            expect(
                trail.items.some((i) => i.entryUid === theirs.uuid),
            ).toBe(false);
        });

        it('refuses the trail of an item the caller cannot manage', async () => {
            const owner = await makeUser();
            const stranger = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            await expect(
                audit(stranger.actor, { uid: file.uuid }),
            ).rejects.toMatchObject({ statusCode: 404 });
            // Holding the share is not authority over what else was granted.
            await expect(
                audit(recipient.actor, { uid: file.uuid }),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('walks every page through the cursor', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            await unshare(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
            });

            const all = await audit(
                owner.actor,
                { uid: file.uuid },
                { includeTotal: true },
            );
            expect(all.total).toBe(all.items.length);

            const seen: string[] = [];
            let cursor: string | undefined;
            for (let page = 0; page < all.items.length + 2; page++) {
                const listed = await audit(
                    owner.actor,
                    { uid: file.uuid },
                    { limit: 1, cursor },
                );
                seen.push(
                    ...listed.items.map((i) => `${i.action}:${i.permission}`),
                );
                cursor = listed.cursor;
                if (!cursor) break;
            }

            expect(cursor).toBeUndefined();
            expect(seen).toEqual(
                all.items.map((i) => `${i.action}:${i.permission}`),
            );
        });
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

        // Group permissions are migration-seeded rather than written at
        // runtime, so the rows go in directly.
        const groupUid = uuidv4();
        await server.clients.db.write(
            'INSERT INTO `group` (`uid`, `owner_user_id`, `extra`, `metadata`) ' +
                'VALUES (?, ?, ?, ?)',
            [groupUid, owner.user.id, '{}', '{}'],
        );
        const [group] = await server.clients.db.read(
            'SELECT `id` FROM `group` WHERE `uid` = ?',
            [groupUid],
        );
        await server.stores.group.addUsers(groupUid, [member.user.username!]);
        await server.clients.db.write(
            'INSERT INTO `user_to_group_permissions` ' +
                '(`user_id`, `group_id`, `permission`, `extra`) VALUES (?, ?, ?, ?)',
            [owner.user.id, Number(group.id), `manage:fs:${dir.uuid}`, '{}'],
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
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'cannot_delegate_manage',
        });

        // What they can do is unchanged.
        await expect(
            share(delegate.actor, {
                uid: file.uuid,
                recipient: { email: third.email },
                mode: 'write',
            }),
        ).resolves.toMatchObject({ mode: 'write' });
    });

    it('tells a stranger nothing when they ask to grant `manage`', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const third = await makeUser();
        const file = await makeFile(owner.user);

        // No access at all, so the refusal must not confirm the file exists.
        await expect(
            share(stranger.actor, {
                uid: file.uuid,
                recipient: { email: third.email },
                mode: 'manage',
            }),
        ).rejects.not.toMatchObject({ legacyCode: 'cannot_delegate_manage' });
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

    it('interrupts a recipient once per window, not once per re-share', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const first = await makeFile(owner.user);
        const second = await makeFile(owner.user);

        const notified: Array<{ ids: number[]; silent: boolean }> = [];
        const notify = server.services.notification.notify.bind(
            server.services.notification,
        );
        server.services.notification.notify = (async (
            ids: number[],
            _payload: unknown,
            opts: { silent?: boolean } = {},
        ) => {
            notified.push({ ids, silent: Boolean(opts.silent) });
        }) as never;
        try {
            const shared = await share(owner.actor, {
                uid: first.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            await server.services.shareNotification.notifyShared(owner.actor, [
                shared,
            ]);

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
            await server.services.shareNotification.notifyShared(owner.actor, [
                again,
                other,
            ]);
        } finally {
            server.services.notification.notify = notify;
        }

        // The second batch is still recorded — the recipient must not open
        // Puter to a notification that undercounts what is waiting — but it
        // arrives silently, without a second interruption.
        expect(notified.map((call) => call.ids)).toEqual([
            [recipient.user.id],
            [recipient.user.id],
        ]);
        expect(notified.map((call) => call.silent)).toEqual([false, true]);
    });

    describe('an app is bounded by what it was given', () => {
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

    // The other derived actor: same reach bound, a different arm of the check.
    describe('a token is bounded by what it was minted for', () => {
        /** Mint a token and resolve it the way an authenticated request does. */
        const asToken = async (
            owner: { actor: Actor },
            permissions: Array<[string]>,
        ) => {
            const token = await runWithContext({ actor: owner.actor }, () =>
                server.services.auth.createAccessToken(
                    owner.actor,
                    permissions,
                    { label: 'share-test' },
                ),
            );
            const actor =
                await server.services.auth.authenticateFromToken(token);
            if (!actor) throw new Error('token did not resolve to an actor');
            return actor;
        };

        it('shares a file the token carries', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            const actor = await asToken(owner, [[`fs:${file.uuid}:read`]]);

            const result = await share(actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            expect(result.mode).toBe('read');
            expect(await canRead(recipient.actor, file.path)).toBe(true);
        });

        it('refuses a file of its issuer’s that the token does not carry', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const carried = await makeFile(owner.user);
            const other = await makeFile(owner.user);
            const actor = await asToken(owner, [[`fs:${carried.uuid}:read`]]);

            await expect(
                share(actor, {
                    uid: other.uuid,
                    recipient: { username: recipient.user.username },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({ statusCode: 404 });
            expect(await canRead(recipient.actor, other.path)).toBe(false);
        });

        it('cannot hand out more than it holds', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            const actor = await asToken(owner, [[`fs:${file.uuid}:read`]]);

            await expect(
                share(actor, {
                    uid: file.uuid,
                    recipient: { username: recipient.user.username },
                    mode: 'write',
                }),
            ).rejects.toMatchObject({ statusCode: 403 });
            expect(await canRead(recipient.actor, file.path)).toBe(false);
        });

        it('cannot withdraw a share on a file it does not carry', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const carried = await makeFile(owner.user);
            const other = await makeFile(owner.user);
            await share(owner.actor, {
                uid: other.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });

            const actor = await asToken(owner, [[`fs:${carried.uuid}:read`]]);
            await expect(
                unshare(actor, {
                    uid: other.uuid,
                    recipient: { username: recipient.user.username },
                }),
            ).rejects.toMatchObject({ statusCode: 404 });
            // The share it could not reach is still standing.
            expect(await canRead(recipient.actor, other.path)).toBe(true);
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
                | 'outer.gui.item.added'
                | 'outer.gui.item.removed'
                | 'outer.gui.item.moved'
                | 'outer.gui.item.renamed'
                | 'outer.gui.item.updated',
            /** Null accepts any entry — for events whose uuid isn't known yet. */
            uuid: string | null,
            fn: () => Promise<void>,
        ) => {
            const seen: number[][] = [];
            const listener = (_key: string, data: unknown) => {
                const payload = data as {
                    user_id_list?: number[];
                    response?: { uuid?: string };
                };
                if (uuid !== null && payload.response?.uuid !== uuid) return;
                seen.push(payload.user_id_list ?? []);
            };
            server.clients.event.on(event, listener);
            try {
                await fn();
                for (let i = 0; i < 50 && seen.length === 0; i++) {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
                return seen;
            } finally {
                // An `uuid: null` capture would match later tests' events.
                server.clients.event.off(event, listener);
            }
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

        it('tells a folder recipient when a file inside it is deleted', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            // No share on the file, so the audience is only found upward.
            const payload = await capturePayload(
                'outer.gui.item.removed',
                recipient.user.id,
                async () => {
                    await server.services.fs.remove(owner.user.id, {
                        entry: file,
                    });
                },
            );

            // Named by the path they knew, masked through the folder they hold.
            expect(payload?.path).toBe(
                `/${owner.user.username}/${dir.uuid}/${dir.name}/${file.name}`,
            );
        });

        it('tells a recipient once when they hold both the file and its folder', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);

            for (const uid of [dir.uuid, file.uuid]) {
                await share(owner.actor, {
                    uid,
                    recipient: { email: recipient.email },
                    mode: 'read',
                });
            }

            // Both passes reach them; one delete must not arrive as two.
            const audiences = await captureAudiences(
                'outer.gui.item.removed',
                file.uuid,
                async () => {
                    await server.services.fs.remove(owner.user.id, {
                        entry: file,
                    });
                },
            );

            const told = audiences
                .flat()
                .filter((id) => id === recipient.user.id);
            expect(told).toHaveLength(1);
        });

        it('tells a folder recipient when a file is moved out of it', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);
            const before = file.path;
            const after = `/${owner.user.username}/Trash/${file.name}`;

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            // What Delete does; `item.moved` would name a path they can't see.
            const audiences = await captureAudiences(
                'outer.gui.item.removed',
                file.uuid,
                async () => {
                    await server.clients.event.emitAndWait(
                        'fs.move.node',
                        {
                            node: { ...file, path: after },
                            fromPath: before,
                            toPath: after,
                        },
                        {},
                    );
                },
            );

            expect(audiences.flat()).toContain(recipient.user.id);
        });

        it('names a moved-out file by where the recipient last saw it', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);
            const before = file.path;
            const after = `/${owner.user.username}/Trash/${file.name}`;

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const payload = await capturePayload(
                'outer.gui.item.removed',
                recipient.user.id,
                async () => {
                    await server.clients.event.emitAndWait(
                        'fs.move.node',
                        {
                            node: { ...file, path: after },
                            fromPath: before,
                            toPath: after,
                        },
                        {},
                    );
                },
            );

            // Masked through the folder they hold, not the owner's Trash.
            expect(payload?.path).toBe(
                `/${owner.user.username}/${dir.uuid}/${dir.name}/${file.name}`,
            );
        });

        it('tells a folder recipient when a file is moved into it', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir } = await makeDirWithFile(owner.user);
            const loose = await makeFile(owner.user);
            const after = `${dir.path}/${loose.name}`;

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            // They never had it, so there is nothing for `item.moved` to move.
            const audiences = await captureAudiences(
                'outer.gui.item.added',
                loose.uuid,
                async () => {
                    await server.clients.event.emitAndWait(
                        'fs.move.node',
                        {
                            node: { ...loose, path: after },
                            fromPath: loose.path,
                            toPath: after,
                        },
                        {},
                    );
                },
            );

            expect(audiences.flat()).toContain(recipient.user.id);
        });

        it('still reports a move within the shared folder as a move', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);
            const before = file.path;
            const after = `${dir.path}/renamed-${file.name}`;

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const payload = await capturePayload(
                'outer.gui.item.moved',
                recipient.user.id,
                async () => {
                    await server.clients.event.emitAndWait(
                        'fs.move.node',
                        {
                            node: { ...file, path: after },
                            fromPath: before,
                            toPath: after,
                        },
                        {},
                    );
                },
            );

            const masked = `/${owner.user.username}/${dir.uuid}/${dir.name}`;
            expect(payload?.from_path).toBe(`${masked}/${file.name}`);
            expect(payload?.path).toBe(`${masked}/renamed-${file.name}`);
        });

        it('tells a recipient when the shared item itself is trashed', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            const before = file.path;
            const trashName = uuidv4();
            const trashed = `/${owner.user.username}/Trash/${trashName}`;

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            // The grant follows it into Trash, so both ends would resolve.
            const payload = await capturePayload(
                'outer.gui.item.removed',
                recipient.user.id,
                async () => {
                    await server.clients.event.emitAndWait(
                        'fs.move.node',
                        {
                            node: {
                                ...file,
                                path: trashed,
                                name: trashName,
                            },
                            fromPath: before,
                            toPath: trashed,
                        },
                        {},
                    );
                },
            );

            // Named as they knew it, never the GUID that Trash gave it.
            expect(payload?.path).toBe(
                `/${owner.user.username}/${file.uuid}/${file.name}`,
            );
        });

        it('stays quiet when a move leaves the recipient address alone', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            const elsewhere = `/${owner.user.username}/Documents/${file.name}`;

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const seen: unknown[] = [];
            const listener = (_key: string, data: unknown) => {
                const payload = data as { user_id_list?: number[] };
                if (!payload.user_id_list?.includes(recipient.user.id)) return;
                seen.push(payload);
            };
            server.clients.event.on('outer.gui.item.moved', listener);

            try {
                // Masked at its own root, so their path holds wherever it goes.
                await server.clients.event.emitAndWait(
                    'fs.move.node',
                    {
                        node: { ...file, path: elsewhere },
                        fromPath: file.path,
                        toPath: elsewhere,
                    },
                    {},
                );
                await new Promise((resolve) => setTimeout(resolve, 100));
            } finally {
                server.clients.event.off('outer.gui.item.moved', listener);
            }

            expect(seen).toEqual([]);
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

        it('tells a folder recipient when a file appears inside it', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            // The real create path, not the event the fan-out listens for.
            let created: { uuid: string } | undefined;
            const audiences = await captureAudiences(
                'outer.gui.item.added',
                null,
                async () => {
                    created = await server.services.fs.touch(owner.user.id, {
                        path: `${dir.path}/appeared.txt`,
                    });
                },
            );
            expect(created?.uuid).toEqual(expect.any(String));

            expect(audiences.flat()).toContain(recipient.user.id);
        });

        it('addresses a new file by the path the recipient listed', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const paths: string[] = [];
            server.clients.event.on('outer.gui.item.added', (_key, data) => {
                const payload = data as {
                    user_id_list?: number[];
                    response?: { path?: string };
                };
                if (!payload.user_id_list?.includes(recipient.user.id)) return;
                paths.push(String(payload.response?.path));
            });

            await server.services.fs.touch(owner.user.id, {
                path: `${dir.path}/inside.txt`,
            });
            for (let i = 0; i < 50 && paths.length === 0; i++) {
                await new Promise((resolve) => setTimeout(resolve, 20));
            }

            // The parent has to be the folder as the recipient addresses it.
            expect(paths).toEqual([
                `/${owner.user.username}/${dir.uuid}/${dir.name}/inside.txt`,
            ]);
            // And never the owner's real path.
            expect(paths[0]).not.toContain(dir.path);
        });

        it('tells a recipient when a shared file is renamed', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const audiences = await captureAudiences(
                'outer.gui.item.renamed',
                file.uuid,
                async () => {
                    await server.services.fs.rename(
                        owner.user.id,
                        file,
                        'renamed.txt',
                    );
                },
            );

            expect(audiences.flat()).toContain(recipient.user.id);
        });

        /** The one payload sent to `holder` for `event`, or undefined. */
        const capturePayload = async (
            event:
                | 'outer.gui.item.moved'
                | 'outer.gui.item.removed'
                | 'outer.gui.item.renamed',
            holderId: number,
            fn: () => Promise<void>,
        ) => {
            const seen: Record<string, unknown>[] = [];
            server.clients.event.on(event, (_key, data) => {
                const payload = data as {
                    user_id_list?: number[];
                    response?: Record<string, unknown>;
                };
                if (!payload.user_id_list?.includes(holderId)) return;
                seen.push(payload.response ?? {});
            });
            await fn();
            for (let i = 0; i < 50 && seen.length === 0; i++) {
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            return seen[0];
        };

        it('asks who the audience is once per folder, not once per file', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const seen: number[][] = [];
            const listener = (_key: string, data: unknown) => {
                const payload = data as { user_id_list?: number[] };
                if (!payload.user_id_list?.includes(recipient.user.id)) return;
                seen.push(payload.user_id_list);
            };
            server.clients.event.on('outer.gui.item.added', listener);
            const reaching = vi.spyOn(server.stores.share, 'listReaching');
            let lookups = -1;

            try {
                // What an upload looks like: siblings landing together.
                await Promise.all(
                    Array.from({ length: 8 }, (_, i) =>
                        server.services.fs.touch(owner.user.id, {
                            path: `${dir.path}/bulk-${i}.txt`,
                        }),
                    ),
                );
                for (let i = 0; i < 50 && seen.length < 8; i++) {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
                // Read before restoring: `mockRestore` clears the history.
                lookups = reaching.mock.calls.length;
            } finally {
                server.clients.event.off('outer.gui.item.added', listener);
                reaching.mockRestore();
            }

            // Every file is announced, but they share one lookup.
            expect(seen).toHaveLength(8);
            expect(lookups).toBe(1);
        });

        it('asks once per folder when a whole subtree is deleted', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            await Promise.all(
                Array.from({ length: 8 }, (_, i) =>
                    server.services.fs.touch(owner.user.id, {
                        path: `${dir.path}/doomed-${i}.txt`,
                    }),
                ),
            );
            const files = await Promise.all(
                Array.from({ length: 8 }, (_, i) =>
                    server.stores.fsEntry.getEntryByPath(
                        `${dir.path}/doomed-${i}.txt`,
                    ),
                ),
            );

            const seen: number[][] = [];
            const listener = (_key: string, data: unknown) => {
                const payload = data as { user_id_list?: number[] };
                if (!payload.user_id_list?.includes(recipient.user.id)) return;
                seen.push(payload.user_id_list);
            };
            server.clients.event.on('outer.gui.item.removed', listener);
            const reaching = vi.spyOn(server.stores.share, 'listReaching');
            let lookups = -1;

            try {
                await Promise.all(
                    files.map((entry) =>
                        server.services.fs.remove(owner.user.id, { entry }),
                    ),
                );
                for (let i = 0; i < 50 && seen.length < 8; i++) {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
                lookups = reaching.mock.calls.length;
            } finally {
                server.clients.event.off('outer.gui.item.removed', listener);
                reaching.mockRestore();
            }

            // Siblings share a parent, so a burst settles in a flush or two.
            expect(seen).toHaveLength(8);
            expect(lookups).toBeLessThanOrEqual(2);
        });

        it('stays quiet for a recipient whose grant was revoked', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            // As `/auth/revoke-user-user` does; the share row survives.
            await server.services.permission.revokeUserUserPermission(
                owner.actor,
                recipient.user.username!,
                `fs:${dir.uuid}:read`,
            );

            const seen: unknown[] = [];
            const listener = (_key: string, data: unknown) => {
                const payload = data as { user_id_list?: number[] };
                if (!payload.user_id_list?.includes(recipient.user.id)) return;
                seen.push(payload);
            };
            server.clients.event.on('outer.gui.item.added', listener);
            server.clients.event.on('outer.gui.item.updated', listener);

            try {
                await server.services.fs.touch(owner.user.id, {
                    path: `${dir.path}/after-revoke.txt`,
                });
                await new Promise((resolve) => setTimeout(resolve, 150));
            } finally {
                server.clients.event.off('outer.gui.item.added', listener);
                server.clients.event.off('outer.gui.item.updated', listener);
            }

            expect(seen).toEqual([]);
        });

        it('checks no grants when nothing is shared', async () => {
            const owner = await makeUser();
            const { dir } = await makeDirWithFile(owner.user);

            // This guards every write on the server, shared or not.
            const linked = vi.spyOn(
                server.stores.permission,
                'readLinkedUserUserPerms',
            );
            let reads = -1;
            try {
                await server.services.fs.touch(owner.user.id, {
                    path: `${dir.path}/unshared.txt`,
                });
                await new Promise((resolve) => setTimeout(resolve, 150));
                reads = linked.mock.calls.length;
            } finally {
                linked.mockRestore();
            }

            expect(reads).toBe(0);
        });

        it('stays quiet for an event another node already handled', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir, file } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const seen: unknown[] = [];
            const listener = (_key: string, data: unknown) => seen.push(data);
            server.clients.event.on('outer.gui.item.added', listener);
            server.clients.event.on('outer.gui.item.updated', listener);
            try {
                // What replication looks like: the writing node already told
                // this audience, so a second fan-out would only duplicate it.
                await server.clients.event.emitAndWait(
                    'fs.create.file',
                    { node: file, entry: file, uid: file.uuid },
                    { from_outside: true },
                );
                await server.clients.event.emitAndWait(
                    'fs.write.file',
                    { node: file, entry: file, target: file },
                    { from_outside: true },
                );
                await new Promise((resolve) => setTimeout(resolve, 100));
            } finally {
                server.clients.event.off('outer.gui.item.added', listener);
                server.clients.event.off('outer.gui.item.updated', listener);
            }

            expect(seen).toEqual([]);
        });

        it('says where a directly shared file moved from', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            const before = file.path;

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const payload = await capturePayload(
                'outer.gui.item.moved',
                recipient.user.id,
                async () => {
                    await server.clients.event.emitAndWait(
                        'fs.move.node',
                        {
                            node: {
                                ...file,
                                path: `${before}-moved`,
                                name: `${file.name}-moved`,
                            },
                            fromPath: before,
                            toPath: `${before}-moved`,
                        },
                        {},
                    );
                },
            );

            // Shared at the file itself, so the old path resolves by uuid.
            expect(payload?.from_path).toBe(
                `/${owner.user.username}/${file.uuid}/${file.name}`,
            );
        });

        it('says what a renamed file was called', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            const before = file.path;

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const payload = await capturePayload(
                'outer.gui.item.renamed',
                recipient.user.id,
                async () => {
                    await server.services.fs.rename(
                        owner.user.id,
                        file,
                        'after.txt',
                    );
                },
            );

            expect(payload?.old_path).toBe(
                `/${owner.user.username}/${file.uuid}/${file.name}`,
            );
            expect(String(payload?.old_path)).not.toContain(before);
        });

        it('carries the container the desktop renders into', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const { dir } = await makeDirWithFile(owner.user);

            await share(owner.actor, {
                uid: dir.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });

            const seen: Record<string, unknown>[] = [];
            server.clients.event.on('outer.gui.item.added', (_key, data) => {
                const payload = data as {
                    user_id_list?: number[];
                    response?: Record<string, unknown>;
                };
                if (!payload.user_id_list?.includes(recipient.user.id)) return;
                seen.push(payload.response ?? {});
            });

            await server.services.fs.touch(owner.user.id, {
                path: `${dir.path}/rendered.txt`,
            });
            for (let i = 0; i < 50 && seen.length === 0; i++) {
                await new Promise((resolve) => setTimeout(resolve, 20));
            }

            // The desktop finds the open window by `dirpath`.
            expect(seen[0]?.dirpath).toBe(
                `/${owner.user.username}/${dir.uuid}/${dir.name}`,
            );
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
                            node: {
                                ...file,
                                path: `${file.path}-moved`,
                                name: `${file.name}-moved`,
                            },
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

        // Straight at the permission layer, bypassing the share row — it
        // survives, so the index alone would keep publishing the entry's name,
        // size and a signed thumbnail URL.
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

    // One entry's answer must not vouch for another's in the batched read.
    it('drops a withdrawn listing even when another share survives', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const withdrawn = await makeFile(owner.user);
        const kept = await makeFile(owner.user);

        for (const file of [withdrawn, kept]) {
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });
        }

        await server.services.permission.revokeUserUserPermission(
            owner.actor,
            recipient.user.username!,
            `fs:${withdrawn.uuid}:read`,
        );
        expect(await canRead(recipient.actor, withdrawn.path)).toBe(false);
        expect(await canRead(recipient.actor, kept.path)).toBe(true);

        const after = await server.services.share.listSharedWithMe(
            recipient.actor,
        );
        const listed = after.items.map((i) => i.entryUid);
        expect(listed).toContain(kept.uuid);
        expect(listed).not.toContain(withdrawn.uuid);
    });

    // `total` counts rows; items are filtered after the page is read.
    it('reports a total that can exceed what paging yields', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const withdrawn = await makeFile(owner.user);
        const kept = await makeFile(owner.user);

        for (const file of [withdrawn, kept]) {
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: recipient.email },
                mode: 'read',
            });
        }
        await server.services.permission.revokeUserUserPermission(
            owner.actor,
            recipient.user.username!,
            `fs:${withdrawn.uuid}:read`,
        );

        const page = await server.services.share.listSharedWithMe(
            recipient.actor,
            { includeTotal: true },
        );
        expect(page.items.map((i) => i.entryUid)).toEqual([kept.uuid]);
        expect(page.total).toBe(2);
    });

    // The owner's view of the same withdrawal.
    it('stops naming a holder whose grant was withdrawn outside the index', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const file = await makeFile(owner.user);

        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email: recipient.email },
            mode: 'read',
        });
        await server.services.permission.revokeUserUserPermission(
            owner.actor,
            recipient.user.username!,
            `fs:${file.uuid}:read`,
        );
        expect(await canRead(recipient.actor, file.path)).toBe(false);

        const shares = await runWithContext({ actor: owner.actor }, () =>
            server.services.share.listSharesOf(owner.actor, {
                uid: file.uuid,
            }),
        );
        expect(shares.map((s) => s.holder.username)).not.toContain(
            recipient.user.username,
        );
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

    describe('an address with no account yet', () => {
        const pendingEmail = () =>
            `pending-${Math.random().toString(36).slice(2, 9)}@test.local`;

        it('records an invite instead of refusing the share', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = pendingEmail();

            const result = await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            expect(result.pending).toBe(true);
            expect(result.recipientEmail).toBe(email);
            expect(result.holder.username).toBeNull();

            const rows = await server.stores.share.listPendingByEmail(email);
            expect(rows).toHaveLength(1);
            expect(Number(rows[0].fsentry_id)).toBe(file.id);
            expect(rows[0].holder_user_id).toBeNull();
        });

        it('still refuses a username that does not exist', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);

            await expect(
                share(owner.actor, {
                    uid: file.uuid,
                    recipient: { username: 'nobody-by-that-name' },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('does not pile up a row per re-invite', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = pendingEmail();

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });
            const again = await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'write',
            });

            const rows = await server.stores.share.listPendingByEmail(email);
            expect(rows).toHaveLength(1);
            expect(rows[0].mode).toBe('write');
            expect(again.isNew).toBe(false);
        });

        it('grants nothing until the address is confirmed', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = pendingEmail();
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            const claimer = await makeUser();
            expect(await canRead(claimer.actor, file.path)).toBe(false);
        });

        it('becomes a real grant when the address is confirmed', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = pendingEmail();
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            const claimer = await makeUser();
            await server.stores.user.update(claimer.user.id, { email });
            const claimed = await server.services.share.claimPendingShares(
                claimer.user.id,
                email,
            );

            expect(claimed).toHaveLength(1);
            expect(await canRead(claimer.actor, file.path)).toBe(true);

            expect(await server.stores.share.listPendingByEmail(email)).toEqual(
                [],
            );
            const listed = await server.services.share.listSharedWithMe(
                claimer.actor,
            );
            expect(listed.items).toHaveLength(1);
        });

        it('drops an invite whose issuer can no longer share it', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = pendingEmail();
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            await server.clients.db.write(
                'DELETE FROM `fsentries` WHERE `id` = ?',
                [file.id],
            );

            const claimer = await makeUser();
            const claimed = await server.services.share.claimPendingShares(
                claimer.user.id,
                email,
            );

            expect(claimed).toEqual([]);
            expect(await server.stores.share.listPendingByEmail(email)).toEqual(
                [],
            );
        });

        it('withdraws an invite before it is claimed', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = pendingEmail();
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            const result = await unshare(owner.actor, {
                uid: file.uuid,
                recipient: { email },
            });

            expect(result.revoked).toBe(1);
            expect(await server.stores.share.listPendingByEmail(email)).toEqual(
                [],
            );

            const claimer = await makeUser();
            expect(
                await server.services.share.claimPendingShares(
                    claimer.user.id,
                    email,
                ),
            ).toEqual([]);
        });

        it('never grants an invite back to the node owner', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = pendingEmail();
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            const claimed = await server.services.share.claimPendingShares(
                owner.user.id,
                email,
            );

            expect(claimed).toEqual([]);
            expect(await server.stores.share.listPendingByEmail(email)).toEqual(
                [],
            );
        });
    });

    describe('blocking a sender', () => {
        const blockEmail = () =>
            `blocked-${Math.random().toString(36).slice(2, 9)}@test.local`;

        it('refuses the share, and grants nothing', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await server.services.share.blockSender(
                recipient.actor,
                owner.user.username,
            );

            await expect(
                share(owner.actor, {
                    uid: file.uuid,
                    recipient: { username: recipient.user.username },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'recipient_not_accepting_shares',
            });

            expect(await canRead(recipient.actor, file.path)).toBe(false);
            expect(await server.stores.share.listByFsentry(file.id)).toEqual(
                [],
            );
        });

        it('costs the blocked sender none of their daily quota', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            await server.services.share.blockSender(
                recipient.actor,
                owner.user.username,
            );

            // Reading the counter by incrementing it with nothing.
            const before = await server.stores.share.incrementDailyShareCount(
                owner.user.id,
                0,
            );
            await expect(
                share(owner.actor, {
                    uid: file.uuid,
                    recipient: { username: recipient.user.username },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({ statusCode: 403 });

            // A refused share is not reach handed out, so it buys nothing and
            // costs nothing — otherwise blocking one recipient would eat the
            // sender's budget for everyone else.
            expect(
                await server.stores.share.incrementDailyShareCount(
                    owner.user.id,
                    0,
                ),
            ).toBe(before);
        });

        it('accepts shares again once the block is lifted', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await server.services.share.blockSender(
                recipient.actor,
                owner.user.username,
            );
            expect(
                await server.services.share.unblockSender(
                    recipient.actor,
                    owner.user.username,
                ),
            ).toMatchObject({ unblocked: true });

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            expect(await canRead(recipient.actor, file.path)).toBe(true);
        });

        it('leaves access the sender already granted alone', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            await server.services.share.blockSender(
                recipient.actor,
                owner.user.username,
            );

            // Blocking stops what comes next. What they already have is theirs
            // until it is revoked — a control labelled "block" silently
            // withdrawing it would be a surprise.
            expect(await canRead(recipient.actor, file.path)).toBe(true);
        });

        it('is idempotent, and refuses to block yourself', async () => {
            const recipient = await makeUser();
            const sender = await makeUser();

            expect(
                await server.services.share.blockSender(
                    recipient.actor,
                    sender.user.username,
                ),
            ).toMatchObject({ created: true });
            expect(
                await server.services.share.blockSender(
                    recipient.actor,
                    sender.user.username,
                ),
            ).toMatchObject({ created: false });

            await expect(
                server.services.share.blockSender(
                    recipient.actor,
                    recipient.user.username,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'cannot_block_self',
            });
        });

        it('lists who the caller blocked, and nothing internal', async () => {
            const recipient = await makeUser();
            const first = await makeUser();
            const second = await makeUser();

            await server.services.share.blockSender(
                recipient.actor,
                first.user.username,
            );
            await server.services.share.blockSender(
                recipient.actor,
                second.user.username,
            );

            const listed = await server.services.share.listBlockedSenders(
                recipient.actor,
            );
            // Most recent first, and named by username only.
            expect(listed.items.map((row) => row.username)).toEqual([
                second.user.username,
                first.user.username,
            ]);
            for (const row of listed.items) {
                expect(Object.keys(row).sort()).toEqual([
                    'createdAt',
                    'username',
                ]);
            }
            expect(listed.all).toBe(false);
            // Someone else's blocklist is not the caller's.
            expect(
                await server.services.share.listBlockedSenders(first.actor),
            ).toEqual({ all: false, items: [] });
        });

        it('refuses to block an account that does not exist', async () => {
            const recipient = await makeUser();
            await expect(
                server.services.share.blockSender(recipient.actor, 'nobody-x'),
            ).rejects.toMatchObject({
                statusCode: 404,
                legacyCode: 'user_does_not_exist',
            });
        });

        it('refuses every sender once the blanket switch is on', async () => {
            const recipient = await makeUser();
            const first = await makeUser();
            const second = await makeUser();
            const fileOne = await makeFile(first.user);
            const fileTwo = await makeFile(second.user);

            await server.services.share.setBlockAllSenders(
                recipient.actor,
                true,
            );

            // Nobody is on the per-sender list, so this can only be the
            // blanket switch answering.
            for (const [sender, file] of [
                [first, fileOne],
                [second, fileTwo],
            ] as const) {
                await expect(
                    share(sender.actor, {
                        uid: file.uuid,
                        recipient: { username: recipient.user.username },
                        mode: 'read',
                    }),
                ).rejects.toMatchObject({
                    statusCode: 403,
                    legacyCode: 'recipient_not_accepting_shares',
                });
            }
            expect(await canRead(recipient.actor, fileOne.path)).toBe(false);
        });

        it('reports the same code whether it is everyone or one person', async () => {
            const recipient = await makeUser();
            const sender = await makeUser();
            const file = await makeFile(sender.user);

            // Which of the two it is is the recipient's business — a sender
            // who could tell them apart would learn they were singled out.
            await server.services.share.setBlockAllSenders(
                recipient.actor,
                true,
            );
            const blanket = await share(sender.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            }).catch((err) => err);

            await server.services.share.setBlockAllSenders(
                recipient.actor,
                false,
            );
            await server.services.share.blockSender(
                recipient.actor,
                sender.user.username,
            );
            const personal = await share(sender.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            }).catch((err) => err);

            expect(personal.statusCode).toBe(blanket.statusCode);
            expect(personal.legacyCode).toBe(blanket.legacyCode);
            expect(personal.message).toBe(blanket.message);
        });

        it('keeps the per-sender list intact while it is on', async () => {
            const recipient = await makeUser();
            const sender = await makeUser();
            const other = await makeUser();
            const file = await makeFile(other.user);

            await server.services.share.blockSender(
                recipient.actor,
                sender.user.username,
            );
            await server.services.share.setBlockAllSenders(
                recipient.actor,
                true,
            );
            expect(
                await server.services.share.listBlockedSenders(
                    recipient.actor,
                ),
            ).toMatchObject({
                all: true,
                items: [{ username: sender.user.username }],
            });

            // Turning it back off restores exactly what it hid: `other` gets
            // through again, `sender` still does not.
            await server.services.share.setBlockAllSenders(
                recipient.actor,
                false,
            );
            await share(other.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            expect(await canRead(recipient.actor, file.path)).toBe(true);
            await expect(
                share(sender.actor, {
                    uid: (await makeFile(sender.user)).uuid,
                    recipient: { username: recipient.user.username },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({
                legacyCode: 'recipient_not_accepting_shares',
            });
        });

        it('leaves access already granted alone when switched on', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            await share(owner.actor, {
                uid: file.uuid,
                recipient: { username: recipient.user.username },
                mode: 'read',
            });
            await server.services.share.setBlockAllSenders(
                recipient.actor,
                true,
            );
            expect(await canRead(recipient.actor, file.path)).toBe(true);
        });

        it('drops an invite from a sender blocked before it was claimed', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = blockEmail();
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            // The address's owner turns up, having blocked the sender in the
            // meantime — claiming it now would hand them the one thing they
            // said no to.
            const claimer = await makeUser();
            await server.stores.user.update(claimer.user.id, { email });
            await server.services.share.blockSender(
                claimer.actor,
                owner.user.username,
            );

            const claimed = await server.services.share.claimPendingShares(
                claimer.user.id,
                email,
            );

            expect(claimed).toEqual([]);
            expect(await canRead(claimer.actor, file.path)).toBe(false);
            expect(await server.stores.share.listPendingByEmail(email)).toEqual(
                [],
            );
        });

        it('drops an invite when the claimer refuses everyone', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = blockEmail();
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            // Same reasoning as the per-sender case: an invite can sit for
            // weeks, and the address's owner may have said no to all of this
            // since it was sent.
            const claimer = await makeUser();
            await server.stores.user.update(claimer.user.id, { email });
            await server.services.share.setBlockAllSenders(
                claimer.actor,
                true,
            );

            expect(
                await server.services.share.claimPendingShares(
                    claimer.user.id,
                    email,
                ),
            ).toEqual([]);
            expect(await canRead(claimer.actor, file.path)).toBe(false);
            expect(await server.stores.share.listPendingByEmail(email)).toEqual(
                [],
            );
        });
    });

    describe('email variants resolve to the inbox, not the string', () => {
        it('shares to the account behind a case variant', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);

            // Treating `Bob@…` as a stranger minted an unclaimable invite.
            const variant = recipient.email.toUpperCase();
            const result = await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: variant },
                mode: 'read',
            });

            expect(result.pending).toBeUndefined();
            expect(result.holder.username).toBe(recipient.user.username);
            expect(await canRead(recipient.actor, file.path)).toBe(true);
        });

        it('a blocked sender cannot reach their blocker through a variant', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const file = await makeFile(owner.user);
            await server.services.share.blockSender(
                recipient.actor,
                owner.user.username,
            );

            // The variant resolves to the account, so the block applies —
            // an exact-string lookup turned this into an invite that emailed
            // the blocker on the sender's behalf.
            const variant = `${recipient.email.split('@')[0]}+x@test.local`;
            await expect(
                share(owner.actor, {
                    uid: file.uuid,
                    recipient: { email: variant },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'recipient_not_accepting_shares',
            });
            expect(
                await server.stores.share.listPendingByEmail(recipient.email),
            ).toEqual([]);
        });

        it('claims an invite whatever case the sharer typed it in', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const local = `cased-${Math.random().toString(36).slice(2, 8)}`;
            const typed = `${local.toUpperCase()}@Test.Local`;
            const confirmed = `${local}@test.local`;

            const invited = await share(owner.actor, {
                uid: file.uuid,
                recipient: { email: typed },
                mode: 'read',
            });
            expect(invited.pending).toBe(true);
            // The sharer sees what they typed, not the canonical form.
            expect(invited.recipientEmail).toBe(typed);
            const [listed] = await server.services.share.listSharesOf(
                owner.actor,
                { uid: file.uuid },
            );
            expect(listed.recipientEmail).toBe(typed);

            const claimer = await makeUser();
            await server.stores.user.update(claimer.user.id, {
                email: confirmed,
                clean_email: confirmed,
            });
            const claimed = await server.services.share.claimPendingShares(
                claimer.user.id,
                confirmed,
            );

            expect(claimed).toHaveLength(1);
            expect(await canRead(claimer.actor, file.path)).toBe(true);
        });

        it('claims invites when the address arrives by other confirmed routes', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `changed-${Math.random().toString(36).slice(2, 8)}@test.local`;
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            // The change-email flow confirms the new address without ever
            // emitting `user.email-confirmed` — the invite has no other
            // moment to become a grant.
            const claimer = await makeUser();
            await server.stores.user.update(claimer.user.id, {
                email,
                clean_email: email,
            });
            server.clients.event.emit(
                'user.email-changed' as never,
                { user_id: claimer.user.id, new_email: email } as never,
                {},
            );

            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                if (await canRead(claimer.actor, file.path)) break;
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            expect(await canRead(claimer.actor, file.path)).toBe(true);
        });


        it('claims invites when the address arrives via OIDC signup', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `oidc-${Math.random().toString(36).slice(2, 8)}@test.local`;
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            // The provider's attestation is the confirmation; there is no
            // code-entry step for this event to fire from later.
            const fakeReq = {
                ip: '127.0.0.1',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };
            const outcome = await runWithContext({ req: fakeReq }, () =>
                server.services.oidc.createUserFromOIDC('test-provider', {
                    sub: `sub-${Math.random().toString(36).slice(2, 10)}`,
                    email,
                    email_verified: true,
                }),
            );
            expect(outcome.success, outcome.error).toBe(true);

            const created = outcome.user!;
            const actor: Actor = {
                user: created as Actor['user'],
                effectiveApp: null,
            };
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                if (await canRead(actor, file.path)) break;
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            expect(await canRead(actor, file.path)).toBe(true);
        });

        it('refuses an address that cannot receive the invite', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const before = await server.stores.share.incrementDailyShareCount(
                owner.user.id,
                0,
            );

            // `a@b` must not become a permanent pending row that spent quota.
            await expect(
                share(owner.actor, {
                    uid: file.uuid,
                    recipient: { email: 'a@b' },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'email_not_allowed',
            });

            expect(await server.stores.share.listPendingByEmail('a@b')).toEqual(
                [],
            );
            expect(
                await server.stores.share.incrementDailyShareCount(
                    owner.user.id,
                    0,
                ),
            ).toBe(before);
        });
    });

    describe('claiming is safe against races and duplicates', () => {
        it('claims once when two confirmations race', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `race-${Math.random().toString(36).slice(2, 8)}@test.local`;
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            const claimer = await makeUser();
            await server.stores.user.update(claimer.user.id, {
                email,
                clean_email: email,
            });

            // The row is claimed before any grant is written, so whichever
            // call loses the row has granted nothing it must take back.
            const [a, b] = await Promise.all([
                server.services.share.claimPendingShares(claimer.user.id, email),
                server.services.share.claimPendingShares(claimer.user.id, email),
            ]);

            expect(a.length + b.length).toBe(1);
            expect(await canRead(claimer.actor, file.path)).toBe(true);
            expect(await server.stores.share.listPendingByEmail(email)).toEqual(
                [],
            );
        });

        it('clears a duplicate pending row instead of keeping a phantom invite', async () => {
            const owner = await makeUser();
            const file = await makeFile(owner.user);
            const email = `dup-${Math.random().toString(36).slice(2, 8)}@test.local`;
            await share(owner.actor, {
                uid: file.uuid,
                recipient: { email },
                mode: 'read',
            });

            // A duplicate that slipped past the in-code dedup (its unique
            // index cannot cover NULL holders). Claiming makes it collide;
            // it must be cleared, not retried forever.
            const { v4: uuidv4 } = await import('uuid');
            await server.clients.db.write(
                'INSERT INTO `share` (`uid`, `issuer_user_id`, `recipient_email`, `fsentry_id`, `mode`, `data`) VALUES (?, ?, ?, ?, ?, ?)',
                [uuidv4(), owner.user.id, email, file.id, 'read', '{}'],
            );

            const claimer = await makeUser();
            await server.stores.user.update(claimer.user.id, {
                email,
                clean_email: email,
            });
            const claimed = await server.services.share.claimPendingShares(
                claimer.user.id,
                email,
            );

            expect(claimed).toHaveLength(1);
            expect(await canRead(claimer.actor, file.path)).toBe(true);
            expect(await server.stores.share.listPendingByEmail(email)).toEqual(
                [],
            );
        });
    });
});
