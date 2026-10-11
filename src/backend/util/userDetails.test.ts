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
import { configContainer } from '../exports.js';
import { PuterServer } from '../server.js';
import { setupTestServer } from '../testUtil.js';
import type { IConfig } from '../types.js';
import { buildUserDetails, scrubSensitive } from './userDetails.js';
import { generateDefaultFsentries } from './userProvisioning.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer({
        feature_flags: { create_shortcut: 'yes', payment_bypass: true },
    } as never);
});

afterAll(async () => {
    await server?.shutdown();
});

const deps = () => ({
    config: configContainer as IConfig,
    clients: server.clients,
    stores: server.stores,
    services: server.services,
});

const makeUser = async () => {
    const username = `ud_${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: 'hashed',
        email: `${username}@test.local`,
        phone: '+15550100',
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    return (await server.stores.user.getById(created.id, { force: true }))!;
};

describe('buildUserDetails', () => {
    it('builds the desktop payload for a user actor', async () => {
        const user = await makeUser();
        const details = await buildUserDetails(user, deps(), {
            isUser: true,
        });

        expect(details).toMatchObject({
            username: user.username,
            uuid: user.uuid,
            email: user.email,
            unconfirmed_email: user.email,
            is_temp: false,
            oidc_only: false,
            feature_flags: { create_shortcut: true },
        });
        expect(details).not.toHaveProperty('phone');
        expect(details.feature_flags).not.toHaveProperty('payment_bypass');
        expect(details.directories).toMatchObject({
            [`/${user.username}/Desktop`]: user.desktop_uuid,
            [`/${user.username}/Trash`]: user.trash_uuid,
        });
        expect(Array.isArray(details.taskbar_items)).toBe(true);
    });

    it('leaves the desktop-only parts out for an app actor', async () => {
        const user = await makeUser();
        const details = await buildUserDetails(user, deps(), {
            isUser: false,
        });
        expect(details).not.toHaveProperty('taskbar_items');
        expect(details).not.toHaveProperty('directories');
        expect(details.card_fallback_available).toBe(false);
    });
});

describe('scrubSensitive', () => {
    it('removes credentials and identifiers at any depth', () => {
        const payload = {
            username: 'u',
            phone: '+1',
            metadata: { tmp_password: 'x', nested: [{ otp_secret: 'y' }] },
        };
        scrubSensitive(payload);
        expect(payload).toEqual({
            username: 'u',
            metadata: { nested: [{}] },
        });
    });
});
