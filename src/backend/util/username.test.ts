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
import { PuterServer } from '../server.js';
import { setupTestServer } from '../testUtil.js';
import * as identifier from './identifier.js';
import {
    assertValidUsername,
    generateUsername,
    isUsernameTaken,
    USERNAME_MAX_LENGTH,
    usernameConflict,
    usernameRejection,
} from './username.js';
import { generateDefaultFsentries } from './userProvisioning.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const freeName = () => `un_${Math.random().toString(36).slice(2, 10)}`;

const makeUser = async (username = freeName()) => {
    const user = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
    });
    await generateDefaultFsentries(server.clients.db, server.stores.user, user);
    return user;
};

/**
 * Moves `owner`'s Documents folder under `/<name>`, so only the home path is
 * taken.
 */
const parkUnder = async (name: string) => {
    const owner = await makeUser();
    const docs = await server.stores.fsEntry.getEntryByPath(
        `/${owner.username}/Documents`,
    );
    await server.clients.db.write(
        'UPDATE fsentries SET path = ? WHERE id = ?',
        [`/${name}/Documents`, docs!.id],
    );
};

describe('usernameRejection', () => {
    it('names the first rule a name breaks', () => {
        expect(usernameRejection('ok_name1')).toBeNull();
        expect(usernameRejection('bad-name')).toBe('format');
        expect(usernameRejection('')).toBe('format');
        expect(usernameRejection('a'.repeat(USERNAME_MAX_LENGTH + 1))).toBe(
            'length',
        );
        expect(usernameRejection('admin')).toBe('reserved');
    });
});

describe('assertValidUsername', () => {
    it('throws the signup answer for each rule', () => {
        expect(() => assertValidUsername('fine_name')).not.toThrow();
        expect(() => assertValidUsername('no spaces')).toThrow(
            expect.objectContaining({
                statusCode: 400,
                legacyCode: 'bad_request',
                message:
                    'Username can only contain letters, numbers and underscore (_).',
            }),
        );
        expect(() => assertValidUsername('a'.repeat(46))).toThrow(
            expect.objectContaining({
                statusCode: 400,
                message: 'Username cannot be longer than 45 characters.',
            }),
        );
        expect(() => assertValidUsername('admin')).toThrow(
            expect.objectContaining({
                statusCode: 400,
                legacyCode: 'username_already_in_use',
            }),
        );
    });
});

describe('usernameConflict', () => {
    it('is null for a free name', async () => {
        expect(await usernameConflict(server.stores, freeName())).toBeNull();
    });

    it('reports an account holding the name, unless it is the caller', async () => {
        const user = await makeUser();
        expect(await usernameConflict(server.stores, user.username)).toBe(
            'account',
        );
        expect(
            await usernameConflict(server.stores, user.username, user.id),
        ).toBeNull();
    });

    it('reports a name that is free but whose home path holds rows', async () => {
        const name = freeName();
        await parkUnder(name);
        expect(await usernameConflict(server.stores, name)).toBe('home');
    });
});

describe('generateUsername', () => {
    it('skips a candidate whose home path is occupied', async () => {
        const parked = freeName();
        const free = freeName();
        await parkUnder(parked);
        const spy = vi
            .spyOn(identifier, 'generate_identifier')
            .mockReturnValueOnce(parked)
            .mockReturnValueOnce(free);
        try {
            expect(await generateUsername(server.stores)).toBe(free);
        } finally {
            spy.mockRestore();
        }
    });

    it('gives up after a bounded number of taken candidates', async () => {
        const taken = await makeUser();
        const spy = vi
            .spyOn(identifier, 'generate_identifier')
            .mockReturnValue(taken.username);
        try {
            expect(await generateUsername(server.stores)).toBeNull();
            expect(spy).toHaveBeenCalledTimes(20);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('isUsernameTaken', () => {
    const duplicate = Object.assign(new Error('dup'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE',
    });

    it('is true only for a unique violation on a name another account holds', async () => {
        const holder = await makeUser();
        expect(
            await isUsernameTaken(
                server.stores.user,
                duplicate,
                holder.username,
            ),
        ).toBe(true);
        expect(
            await isUsernameTaken(
                server.stores.user,
                duplicate,
                holder.username,
                holder.id,
            ),
        ).toBe(false);
        expect(
            await isUsernameTaken(
                server.stores.user,
                new Error('other'),
                holder.username,
            ),
        ).toBe(false);
    });
});
