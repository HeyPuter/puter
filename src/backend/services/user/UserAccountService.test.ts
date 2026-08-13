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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupTestServer } from '../../testUtil.ts';
import { PuterServer } from '../../server.ts';
import { generateDefaultFsentries } from '../../util/userProvisioning.ts';

describe('UserAccountService', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const seedUser = async (overrides: Record<string, unknown> = {}) => {
        const slug = Math.random().toString(36).slice(2, 10);
        return server.stores.user.create({
            username: `ua_${slug}`,
            uuid: uuidv4(),
            password: 'hashed',
            email: `ua-${slug}@test.local`,
            clean_email: `ua-${slug}@test.local`,
            ...overrides,
        });
    };

    describe('getUsageSignals', () => {
        it('reports a freshly created account as unused', async () => {
            const user = await seedUser();
            const usage = await server.services.userAccount.getUsageSignals(
                user.id,
            );
            expect(usage.inUse).toBe(false);
            expect(usage.signals).toEqual([]);
        });

        it('still reads as unused with only the folders signup provisions', async () => {
            // The whole delete decision hinges on this: a provisioned account
            // nobody ever opened must not look like somebody's files.
            const user = await seedUser();
            await generateDefaultFsentries(
                server.clients.db,
                server.stores.user,
                user,
            );
            const usage = await server.services.userAccount.getUsageSignals(
                user.id,
            );
            expect(usage.signals).not.toContain('files');
            expect(usage.inUse).toBe(false);
        });

        it('reports files once anything beyond the provisioned set exists', async () => {
            const user = await seedUser();
            await generateDefaultFsentries(
                server.clients.db,
                server.stores.user,
                user,
            );
            const fresh = (await server.stores.user.getById(user.id, {
                force: true,
            }))!;
            const now = Math.floor(Date.now() / 1000);
            await server.clients.db.write(
                'INSERT INTO `fsentries` (`uuid`, `parent_uid`, `user_id`, `name`, `is_dir`, `created`, `modified`) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    uuidv4(),
                    fresh.desktop_uuid,
                    user.id,
                    'notes.txt',
                    0,
                    now,
                    now,
                ],
            );

            const usage = await server.services.userAccount.getUsageSignals(
                user.id,
            );
            expect(usage.signals).toContain('files');
            expect(usage.inUse).toBe(true);
        });

        // `stripe_customer_id` is deliberately absent: it is a prod-only column
        // the self-hosted schema does not carry, which is exactly why the
        // service reads the row through the store instead of naming columns.
        it.each([
            ['card_fingerprint', 'fp_123', 'card-verified'],
            ['phone', '+14155550100', 'phone-verified'],
        ])('reports %s as %s', async (column, value, signal) => {
            const user = await seedUser();
            await server.stores.user.update(user.id, { [column]: value });
            const usage = await server.services.userAccount.getUsageSignals(
                user.id,
            );
            expect(usage.signals).toContain(signal);
            expect(usage.inUse).toBe(true);
        });

        it('reports an external identity link', async () => {
            const user = await seedUser();
            await server.stores.oidc.link(
                user.id,
                'custom-idp',
                `sub-${uuidv4()}`,
                null,
            );
            const usage = await server.services.userAccount.getUsageSignals(
                user.id,
            );
            expect(usage.signals).toContain('oidc-link');
        });

        it('errs toward in-use when a signal query fails', async () => {
            // A signal we cannot read is not a signal that is absent. Failing
            // open here would mean an unreadable table makes accounts look
            // deletable, and the collapse job deletes what looks unused.
            const user = await seedUser();
            const original = server.clients.db.read.bind(server.clients.db);
            const read = vi
                .spyOn(server.clients.db, 'read')
                .mockImplementation(async (sql: string, params?: unknown[]) => {
                    // Only the capped-count probes fail; the row read still
                    // works, which is the realistic "one table is unhappy" case.
                    if (sql.includes('FROM (SELECT 1 FROM')) {
                        throw new Error('table gone');
                    }
                    return original(sql, params);
                });
            try {
                const usage = await server.services.userAccount.getUsageSignals(
                    user.id,
                );
                expect(usage.inUse).toBe(true);
                expect(usage.signals).toContain('sessions');
            } finally {
                read.mockRestore();
            }
        });
    });

    describe('cascadeDelete', () => {
        it('removes the row, its sessions and its cache entries', async () => {
            const user = await seedUser();
            await server.clients.db.write(
                'INSERT INTO `sessions` (`uuid`, `user_id`, `created_at`, `last_activity`) VALUES (?, ?, ?, ?)',
                [uuidv4(), user.id, Date.now(), Date.now()],
            );
            // Warm the address-keyed cache entry so a stale hit would show up.
            expect(
                (await server.stores.user.getByEmail(user.email as string))?.id,
            ).toBe(user.id);

            await server.services.userAccount.cascadeDelete(user.id);

            expect(await server.stores.user.getById(user.id)).toBeNull();
            expect(
                await server.stores.user.getByEmail(user.email as string),
            ).toBeNull();
            const sessions = (await server.clients.db.read(
                'SELECT COUNT(*) AS n FROM `sessions` WHERE `user_id` = ?',
                [user.id],
            )) as Array<{ n: number }>;
            expect(Number(sessions[0].n)).toBe(0);
        });

        it('frees the address for a new account', async () => {
            const user = await seedUser();
            const email = user.email as string;
            await server.services.userAccount.cascadeDelete(user.id);

            // The unique index would reject this if the row survived.
            await expect(
                server.stores.user.create({
                    username: `ua_reuse_${Math.random().toString(36).slice(2, 8)}`,
                    uuid: uuidv4(),
                    password: 'hashed',
                    email,
                    clean_email: email,
                }),
            ).resolves.toBeTruthy();
        });
    });
});
