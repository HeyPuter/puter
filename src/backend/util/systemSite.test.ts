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
import { SYSTEM_ACTOR_UUID } from '../core/actor.js';
import type { PuterServer } from '../server.js';
import { setupTestServer } from '../testUtil.js';
import { ensureSystemSite } from './systemSite.js';

describe('ensureSystemSite', () => {
    let server: PuterServer;
    let systemUserId: number;
    let otherUserId: number;

    const uniqueName = () => `ss-${uuidv4().slice(0, 8)}`;
    const ownerOf = async (path: string) =>
        (await server.stores.fsEntry.getEntryByPath(path))?.userId;

    beforeAll(async () => {
        server = await setupTestServer();
        systemUserId = (await server.stores.user.getByUuid(SYSTEM_ACTOR_UUID))!
            .id;
        const username = uniqueName();
        otherUserId = (
            await server.stores.user.create({
                username,
                uuid: uuidv4(),
                password: null,
                email: `${username}@test.local`,
                requires_email_confirmation: false,
            } as Parameters<typeof server.stores.user.create>[0])
        ).id;
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    it('creates the directories and site as the system user', async () => {
        const root = `/${uniqueName()}`;
        const subdomain = uniqueName();
        expect(
            await ensureSystemSite(server.stores, {
                subdomain,
                dirPath: `${root}/files`,
            }),
        ).toBe(systemUserId);

        expect(await ownerOf(root)).toBe(systemUserId);
        const dir = await server.stores.fsEntry.getEntryByPath(`${root}/files`);
        expect(dir?.userId).toBe(systemUserId);
        const site = await server.stores.subdomain.getBySubdomain(subdomain);
        expect(site?.user_id).toBe(systemUserId);
        expect(site?.root_dir_id).toBe(dir!.id);
        expect(Boolean(site?.protected)).toBe(false);
    });

    it('re-owns directories and reclaims a site another account holds, then leaves them alone', async () => {
        const root = `/${uniqueName()}`;
        const dirPath = `${root}/files`;
        const dir = await server.stores.fsEntry.resolveParentDirectory(
            otherUserId,
            dirPath,
            true,
        );
        const subdomain = uniqueName();
        const stale = await server.stores.subdomain.create({
            userId: otherUserId,
            subdomain,
            rootDirId: dir.id,
            isProtected: true,
        });

        const opts = { subdomain, dirPath, isProtected: true };
        await ensureSystemSite(server.stores, opts);
        expect(await ownerOf(root)).toBe(systemUserId);
        expect(await ownerOf(dirPath)).toBe(systemUserId);
        const healed = await server.stores.subdomain.getBySubdomain(subdomain);
        // Updated in place, not replaced: same row, same uuid.
        expect(healed?.uuid).toBe(stale.uuid);
        expect(healed?.user_id).toBe(systemUserId);
        expect(healed?.root_dir_id).toBe(dir.id);
        expect(Boolean(healed?.protected)).toBe(true);

        const rows = await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `subdomains` WHERE `subdomain` = ?',
            [subdomain],
        );
        expect(Number(rows[0]?.n)).toBe(1);

        await ensureSystemSite(server.stores, opts);
        expect(
            (await server.stores.subdomain.getBySubdomain(subdomain))?.uuid,
        ).toBe(healed!.uuid);
    });

    it('never clears protected, and drops the previous holder’s bindings', async () => {
        const root = `/${uniqueName()}`;
        const dirPath = `${root}/files`;
        const dir = await server.stores.fsEntry.resolveParentDirectory(
            otherUserId,
            dirPath,
            true,
        );
        const subdomain = uniqueName();
        const stale = await server.stores.subdomain.create({
            userId: otherUserId,
            subdomain,
            rootDirId: dir.id,
            isProtected: true,
        });
        await server.clients.db.write(
            'UPDATE `subdomains` SET `domain` = ?, `preamble_version` = ? WHERE `uuid` = ?',
            ['example.test', 'v1', stale.uuid],
        );

        // Not asked for protection; the existing flag stays anyway.
        await ensureSystemSite(server.stores, { subdomain, dirPath });

        const healed = await server.stores.subdomain.getBySubdomain(subdomain);
        expect(healed?.uuid).toBe(stale.uuid);
        expect(healed?.user_id).toBe(systemUserId);
        expect(healed?.root_dir_id).toBe(dir.id);
        expect(Boolean(healed?.protected)).toBe(true);
        expect(healed?.domain ?? null).toBeNull();
        expect(healed?.preamble_version).toBe('v1');
    });
});
