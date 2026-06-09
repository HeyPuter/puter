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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PuterServer } from '../../server';
import type { IConfig } from '../../types';
import {
    POSTGRES_TEST_MIGRATIONS_PATH,
    setupTestServer,
} from '../../testUtil.js';

const APP_ICONS_SUBDOMAIN = 'puter-app-icons';

describe('AppIconService.ensureIconsDirectory', () => {
    let server: PuterServer;

    beforeAll(async () => {
        // Boot on (pgmock) Postgres specifically: the `subdomains.subdomain`
        // UNIQUE constraint this fix relies on exists on Postgres but not on
        // the sqlite test schema, so only Postgres faithfully reproduces the
        // duplicate-insert the race triggers.
        //
        // `no_default_user: false` provisions the admin user and the app-icons
        // subdomain at boot — the realistic setup for the first-boot race.
        server = await setupTestServer({
            no_default_user: false,
            database: {
                engine: 'postgres',
                inMemory: true,
                migrationPaths: [POSTGRES_TEST_MIGRATIONS_PATH],
            },
        } as unknown as IConfig);
    }, 180_000); // pgmock boot + migrations is slow

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    // Regression: `ensureIconsDirectory` runs twice on first boot (once
    // un-awaited from its own onServerStart, then from DefaultUserService),
    // and the existence check reads a cache that can hold a stale negative
    // entry. The losing create then violated the unique constraint and — on
    // the un-awaited path — surfaced as an unhandled rejection. The "ensure"
    // must be idempotent even when the guard wrongly reports "absent".
    it('is idempotent when the existence cache reports the subdomain absent but the row exists', async () => {
        const subdomains = server.stores.subdomain;
        expect(await subdomains.existsBySubdomain(APP_ICONS_SUBDOMAIN)).toBe(
            true,
        );

        // Reproduce the stale-negative-cache: write the negative marker for a
        // subdomain that genuinely exists, so the guard in
        // `ensureIconsDirectory` passes and it attempts a duplicate insert.
        await server.clients.redis.set(
            `subdomains:name:${APP_ICONS_SUBDOMAIN}`,
            '__none__',
        );
        // Self-check: confirm the poison took effect (guards against the
        // cache key/marker drifting out from under this test).
        expect(await subdomains.existsBySubdomain(APP_ICONS_SUBDOMAIN)).toBe(
            false,
        );

        // Before the fix this rejected with a unique-constraint violation.
        await expect(
            server.services.appIcon.ensureIconsDirectory(),
        ).resolves.toBeUndefined();

        // And no duplicate row was created.
        const rows = await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `subdomains` WHERE `subdomain` = ?',
            [APP_ICONS_SUBDOMAIN],
        );
        expect(Number(rows[0]?.n)).toBe(1);
    }, 60_000);
});
