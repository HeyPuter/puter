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
import type { PuterServer } from '../server.js';
import { setupTestServer } from '../testUtil.js';
import { ensureSystemSite } from './systemSite.js';

describe('ensureSystemSite', () => {
    let server: PuterServer;
    let creatorId: number;
    let otherId: number;

    const makeUserId = async () => {
        const username = `ss-${uuidv4().slice(0, 8)}`;
        const created = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            requires_email_confirmation: false,
        } as Parameters<typeof server.stores.user.create>[0]);
        return created.id;
    };
    const uniqueName = () => `ss-${uuidv4().slice(0, 8)}`;

    beforeAll(async () => {
        server = await setupTestServer();
        creatorId = await makeUserId();
        otherId = await makeUserId();
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    it('creates the directory and registers the site to its creator', async () => {
        const subdomain = uniqueName();
        const dir = await ensureSystemSite(server.stores, {
            subdomain,
            dirPath: `/${uniqueName()}/files`,
            creatorUserId: creatorId,
        });
        expect(dir?.userId).toBe(creatorId);

        const site = await server.stores.subdomain.getBySubdomain(subdomain);
        expect(site?.user_id).toBe(creatorId);
        expect(site?.root_dir_id).toBe(dir!.id);
        expect(Boolean(site?.protected)).toBe(false);
    });

    it('registers the site to the directory owner when the parent belongs to someone else', async () => {
        const root = `/${uniqueName()}`;
        await server.stores.fsEntry.resolveParentDirectory(otherId, root, true);

        const subdomain = uniqueName();
        const dir = await ensureSystemSite(server.stores, {
            subdomain,
            dirPath: `${root}/files`,
            creatorUserId: creatorId,
        });
        expect(dir?.userId).toBe(otherId);
        expect(
            (await server.stores.subdomain.getBySubdomain(subdomain))?.user_id,
        ).toBe(otherId);
    });

    it("replaces a site registered to a user who doesn't own its directory, then leaves it alone", async () => {
        const dirPath = `/${uniqueName()}`;
        const dir = await server.stores.fsEntry.resolveParentDirectory(
            otherId,
            dirPath,
            true,
        );
        const subdomain = uniqueName();
        const stale = await server.stores.subdomain.create({
            userId: creatorId,
            subdomain,
            rootDirId: dir.id,
            isProtected: true,
        });

        const opts = {
            subdomain,
            dirPath,
            creatorUserId: creatorId,
            isProtected: true,
        };
        await ensureSystemSite(server.stores, opts);
        const healed = await server.stores.subdomain.getBySubdomain(subdomain);
        expect(healed?.uuid).not.toBe(stale.uuid);
        expect(healed?.user_id).toBe(otherId);
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
});
