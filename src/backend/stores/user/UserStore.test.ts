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
import { v4 as uuidv4 } from 'uuid';
import { setupTestServer } from '../../testUtil.ts';
import { PuterServer } from '../../server.ts';

describe('UserStore', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('keeps cached booleans normalized after update', async () => {
        const username = `us-${Math.random().toString(36).slice(2, 10)}`;
        const user = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        });

        await server.stores.user.update(user.id, {
            email_confirmed: false,
            requires_email_confirmation: true,
        });

        const cachedUser = await server.stores.user.getById(user.id);

        expect(cachedUser?.email_confirmed).toBe(false);
        expect(cachedUser?.requires_email_confirmation).toBe(true);
        expect(typeof cachedUser?.email_confirmed).toBe('boolean');
        expect(typeof cachedUser?.requires_email_confirmation).toBe('boolean');
    });

    it('counts other accounts holding the same phone number', async () => {
        const phone = `+1415555${Math.floor(1000 + Math.random() * 9000)}`;
        const makeUser = async () => {
            const username = `up-${Math.random().toString(36).slice(2, 10)}`;
            const user = await server.stores.user.create({
                username,
                uuid: uuidv4(),
                password: null,
                email: `${username}@test.local`,
            });
            await server.stores.user.update(user.id, { phone });
            return user;
        };

        const first = await makeUser();
        expect(
            await server.stores.user.countOthersByPhone(phone, first.id),
        ).toBe(0);

        const second = await makeUser();
        expect(
            await server.stores.user.countOthersByPhone(phone, first.id),
        ).toBe(1);
        expect(
            await server.stores.user.countOthersByPhone(phone, second.id),
        ).toBe(1);
        // A caller that isn't among the holders sees both.
        expect(await server.stores.user.countOthersByPhone(phone, -1)).toBe(2);
        // Unknown number counts zero.
        expect(
            await server.stores.user.countOthersByPhone('+19995550000', -1),
        ).toBe(0);
    });
});
