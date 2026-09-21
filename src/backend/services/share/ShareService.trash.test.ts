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
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';

describe('ShareService: deleting a shared item', () => {
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
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, ?, ?)',
            [
                uuid,
                name,
                path,
                owner.id,
                server.clients.db.booleanValue(false),
                Math.floor(Date.now() / 1000),
            ],
        );
        const entry = await server.stores.fsEntry.getEntryByPath(path);
        if (!entry) throw new Error('fsentry not created');
        return entry;
    };

    /**
     * A directory and a file inside it, so the file inherits the folder's
     * shares.
     */
    const makeDirWithFile = async (owner: { id: number; username: string }) => {
        const dirUuid = uuidv4();
        const dirName = `d-${dirUuid.slice(0, 8)}`;
        const dirPath = `/${owner.username}/${dirName}`;
        const fileUuid = uuidv4();
        const fileName = `f-${fileUuid.slice(0, 8)}.txt`;
        const now = Math.floor(Date.now() / 1000);

        await server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, ?, ?)',
            [
                dirUuid,
                dirName,
                dirPath,
                owner.id,
                server.clients.db.booleanValue(true),
                now,
            ],
        );
        const dirRow = await server.stores.fsEntry.getEntryByPath(dirPath);
        await server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`, `parent_id`, `parent_uid`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                fileUuid,
                fileName,
                `${dirPath}/${fileName}`,
                owner.id,
                server.clients.db.booleanValue(false),
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

    const check = (actor: Actor, path: string, mode: 'read' | 'write') =>
        server.services.acl.check(
            actor,
            {
                path,
                resolveAncestors: () =>
                    server.services.fs.getAncestorChain(path),
            },
            mode,
        );
    const canRead = (actor: Actor, path: string) => check(actor, path, 'read');
    const canWrite = (actor: Actor, path: string) =>
        check(actor, path, 'write');

    const share = (actor: Actor, input: Record<string, unknown>) =>
        runWithContext({ actor }, () =>
            server.services.share.share(actor, input as never),
        );

    const dirAt = async (path: string) => {
        const entry = await server.stores.fsEntry.getEntryByPath(path, {
            skipCache: true,
        });
        if (!entry) throw new Error(`missing directory: ${path}`);
        return entry;
    };

    /** The move a GUI delete performs: into the owner's own Trash. */
    const move = (
        owner: { user: { id: number }; actor: Actor },
        source: FSEntry,
        destinationParent: FSEntry,
    ) =>
        runWithContext({ actor: owner.actor }, () =>
            server.services.fs.move(owner.user.id, {
                source,
                destinationParent,
            }),
        );

    it('withdraws every share on a folder the owner deletes', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const second = await makeUser();
        const { dir, file } = await makeDirWithFile(owner.user);

        await share(owner.actor, {
            uid: dir.uuid,
            recipient: { username: recipient.user.username },
            mode: 'write',
        });
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { username: second.user.username },
            mode: 'read',
        });
        expect(await canWrite(recipient.actor, file.path)).toBe(true);
        expect(await canRead(second.actor, file.path)).toBe(true);

        const trash = await dirAt(`/${owner.user.username}/Trash`);
        const moved = await move(owner, dir, trash);

        expect(await canRead(recipient.actor, moved.path)).toBe(false);
        expect(
            await canWrite(recipient.actor, `${moved.path}/${file.name}`),
        ).toBe(false);
        expect(await canRead(second.actor, `${moved.path}/${file.name}`)).toBe(
            false,
        );
        expect(
            await server.services.share.listSharesOf(owner.actor, {
                uid: dir.uuid,
            }),
        ).toEqual([]);
        expect(await server.stores.share.listByFsentry(dir.id)).toEqual([]);
        expect(await server.stores.share.listByFsentry(file.id)).toEqual([]);
    });

    it('drops a link share and an unclaimed invite inside it', async () => {
        const owner = await makeUser();
        const { dir, file } = await makeDirWithFile(owner.user);
        const email = `pending-${Math.random().toString(36).slice(2, 9)}@test.local`;

        await server.stores.share.upsertAnyone({
            issuerUserId: owner.user.id,
            fsentryId: dir.id,
            mode: 'read',
        });
        await share(owner.actor, {
            uid: file.uuid,
            recipient: { email },
            mode: 'read',
        });
        expect(await server.stores.share.getAnyone(dir.id)).not.toBeNull();
        expect(
            await server.stores.share.listPendingOnFsentry(file.id),
        ).toHaveLength(1);

        const trash = await dirAt(`/${owner.user.username}/Trash`);
        await move(owner, dir, trash);

        expect(await server.stores.share.getAnyone(dir.id)).toBeNull();
        expect(await server.stores.share.listPendingOnFsentry(file.id)).toEqual(
            [],
        );
    });

    it('does not hand access back when the item leaves Trash', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const { dir, file } = await makeDirWithFile(owner.user);

        await share(owner.actor, {
            uid: dir.uuid,
            recipient: { username: recipient.user.username },
            mode: 'write',
        });

        const trash = await dirAt(`/${owner.user.username}/Trash`);
        const trashed = await move(owner, dir, trash);
        const home = await dirAt(`/${owner.user.username}`);
        const restored = await move(owner, trashed, home);

        expect(await canRead(recipient.actor, restored.path)).toBe(false);
        expect(
            await canWrite(recipient.actor, `${restored.path}/${file.name}`),
        ).toBe(false);
        expect(
            await server.services.share.listSharesOf(owner.actor, {
                uid: dir.uuid,
            }),
        ).toEqual([]);
    });

    it('leaves the shares alone on an ordinary move', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const { dir, file } = await makeDirWithFile(owner.user);

        await share(owner.actor, {
            uid: dir.uuid,
            recipient: { username: recipient.user.username },
            mode: 'write',
        });

        const documents = await dirAt(`/${owner.user.username}/Documents`);
        const moved = await move(owner, dir, documents);

        expect(await canWrite(recipient.actor, moved.path)).toBe(true);
        expect(
            await canWrite(recipient.actor, `${moved.path}/${file.name}`),
        ).toBe(true);
        expect(await server.stores.share.listByFsentry(dir.id)).toHaveLength(1);
    });
});
