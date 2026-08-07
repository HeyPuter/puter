/**
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
import type { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import type { PermissionService } from '../permission/PermissionService.js';

let server: PuterServer;
let permissions: PermissionService;
let ownerUserId: number;

beforeAll(async () => {
    server = await setupTestServer();
    permissions = server.services.permission as unknown as PermissionService;
    const created = await createTestUser(server, {
        username: 'subperm',
        password: 'subperm-password',
    });
    const row = await server.stores.user.getByUsername(created.username);
    ownerUserId = row!.id;
}, 60_000);

afterAll(async () => {
    await server?.shutdown();
}, 60_000);

describe('SubdomainPermissionService — site name rewriter', () => {
    it('rewrites a site name to the stable uid form so renames keep grants', async () => {
        const name = `sp${Math.random().toString(36).slice(2, 10)}`;
        await server.stores.subdomain.create({
            userId: ownerUserId,
            subdomain: name,
        });
        const row = await server.stores.subdomain.getBySubdomain(name);

        expect(await permissions.rewritePermission(`site:${name}:read`)).toBe(
            `site:uid#${row!.uuid}:read`,
        );
    });

    it('leaves an already-uid specifier untouched', async () => {
        const already = `site:uid#${uuidv4()}:read`;
        expect(await permissions.rewritePermission(already)).toBe(already);
    });

    it('leaves an unknown site name untouched rather than inventing a uid', async () => {
        const permission = `site:no-such-site-${uuidv4()}:read`;
        expect(await permissions.rewritePermission(permission)).toBe(
            permission,
        );
    });

    it('ignores permissions outside the site namespace and the bare prefix', async () => {
        expect(await permissions.rewritePermission('fs:uid:read')).toBe(
            'fs:uid:read',
        );
        expect(await permissions.rewritePermission('site')).toBe('site');
        expect(await permissions.rewritePermission('site:')).toBe('site:');
    });
});
