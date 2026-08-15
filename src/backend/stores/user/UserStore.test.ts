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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupTestServer } from '../../testUtil.ts';
import { PuterServer } from '../../server.ts';
import { cleanEmail } from '../../util/email.ts';
import { isOwnedEmailConflict } from './UserStore.ts';

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

    it('stops resolving an email the account no longer holds', async () => {
        const username = `us-${Math.random().toString(36).slice(2, 10)}`;
        const oldEmail = `${username}-old@test.local`;
        const newEmail = `${username}-new@test.local`;
        const user = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: oldEmail,
        });

        // Warm the by-email key, then move the account to a new address.
        expect((await server.stores.user.getByEmail(oldEmail))?.id).toBe(
            user.id,
        );
        await server.stores.user.update(user.id, {
            email: newEmail,
            clean_email: newEmail,
        });

        // The old address is no longer this account's — a cached copy of the
        // pre-update row answering for it is what let a replaced email keep
        // working as a login.
        expect(await server.stores.user.getByEmail(oldEmail)).toBeNull();
        expect((await server.stores.user.getByEmail(newEmail))?.id).toBe(
            user.id,
        );
    });

    it('stops resolving a username the account no longer holds', async () => {
        const oldUsername = `us-${Math.random().toString(36).slice(2, 10)}`;
        const newUsername = `${oldUsername}-renamed`;
        const user = await server.stores.user.create({
            username: oldUsername,
            uuid: uuidv4(),
            password: null,
            email: `${oldUsername}@test.local`,
        });

        expect((await server.stores.user.getByUsername(oldUsername))?.id).toBe(
            user.id,
        );
        await server.stores.user.update(user.id, { username: newUsername });

        expect(await server.stores.user.getByUsername(oldUsername)).toBeNull();
        expect((await server.stores.user.getByUsername(newUsername))?.id).toBe(
            user.id,
        );
    });

    it('stops resolving an email revoked from a competing account', async () => {
        const shared = `shared-${Math.random().toString(36).slice(2, 10)}@test.local`;
        const makeClaimant = async () => {
            const username = `uc-${Math.random().toString(36).slice(2, 10)}`;
            return server.stores.user.create({
                username,
                uuid: uuidv4(),
                password: null,
                email: shared,
                clean_email: shared,
            });
        };

        // Both start as unconfirmed placeholders — the only shape in which two
        // rows may hold one address. The winner then confirms it.
        const loser = await makeClaimant();
        const winner = await makeClaimant();

        // Warm the loser's cache entries before its claim is revoked.
        expect((await server.stores.user.getById(loser.id))?.email).toBe(
            shared,
        );

        await server.stores.user.unconfirmOthersByEmail(
            winner.id,
            shared,
            shared,
        );
        await server.stores.user.update(winner.id, { email_confirmed: true });

        const strippedLoser = await server.stores.user.getById(loser.id);
        expect(strippedLoser?.email).toBeNull();
        expect(strippedLoser?.email_confirmed).toBe(false);
        expect((await server.stores.user.getByEmail(shared))?.id).toBe(
            winner.id,
        );
    });

    it('refuses a second account owning the same address', async () => {
        const shared = `owned-${Math.random().toString(36).slice(2, 10)}@test.local`;
        const makeOwner = (password: string | null) =>
            server.stores.user.create({
                username: `uo-${Math.random().toString(36).slice(2, 10)}`,
                uuid: uuidv4(),
                password,
                email: shared,
                clean_email: shared,
            });

        await makeOwner('hashed');

        // A placeholder may still share the address...
        await expect(makeOwner(null)).resolves.toBeTruthy();

        // ...but a second row that could drive password recovery for that
        // inbox may not, however the application-level guards behaved.
        await expect(makeOwner('hashed')).rejects.toThrow(
            /idx_user_owned_email/,
        );
    });

    it('resolves a shared address to the row that owns it', async () => {
        const shared = `pref-${Math.random().toString(36).slice(2, 10)}@test.local`;
        const placeholder = await server.stores.user.create({
            username: `up-${Math.random().toString(36).slice(2, 10)}`,
            uuid: uuidv4(),
            password: null,
            email: shared,
            clean_email: shared,
        });
        const owner = await server.stores.user.create({
            username: `uw-${Math.random().toString(36).slice(2, 10)}`,
            uuid: uuidv4(),
            password: 'hashed',
            email: shared,
            clean_email: shared,
        });

        // The placeholder has the lower id, so an unordered LIMIT 1 would be
        // free to return it — and login and password recovery both resolve
        // through here.
        expect(placeholder.id).toBeLessThan(owner.id);
        expect(
            (await server.stores.user.getByEmail(shared, { cached: false }))
                ?.id,
        ).toBe(owner.id);
        expect((await server.stores.user.findEmailOwner(shared))?.id).toBe(
            owner.id,
        );
    });

    it('keeps a placeholder from shadowing the owner in the cache', async () => {
        const shared = `cached-${Math.random().toString(36).slice(2, 10)}@test.local`;
        const owner = await server.stores.user.create({
            username: `uk-${Math.random().toString(36).slice(2, 10)}`,
            uuid: uuidv4(),
            password: 'hashed',
            email: shared,
            clean_email: shared,
        });
        // Warm the address-keyed entry, so the placeholder below has something
        // to overwrite.
        expect((await server.stores.user.getByEmail(shared))?.id).toBe(
            owner.id,
        );

        await server.stores.user.create({
            username: `ul-${Math.random().toString(36).slice(2, 10)}`,
            uuid: uuidv4(),
            password: null,
            email: shared,
            clean_email: shared,
        });

        // Cached lookups are how login and password recovery resolve an
        // address, and ordering the SQL does nothing for them — the placeholder
        // must never be written under the address in the first place.
        expect((await server.stores.user.getByEmail(shared))?.id).toBe(
            owner.id,
        );
    });

    it('lets only one of two concurrent signups claim a placeholder row', async () => {
        const email = `claim-${Math.random().toString(36).slice(2, 10)}@test.local`;
        const placeholder = await server.stores.user.create({
            username: `uq-${Math.random().toString(36).slice(2, 10)}`,
            uuid: uuidv4(),
            password: null,
            email,
            clean_email: email,
        });

        // The address never changes hands here — the row already holds it — so
        // the unique index has nothing to catch. Only the guard stops the
        // second write from overwriting the first.
        const claim = (username: string) =>
            server.stores.user.claimPlaceholder(placeholder.id, {
                username,
                password: `hash-${username}`,
                uuid: uuidv4(),
                email_confirmed: 0,
            });

        const first = await claim('winner');
        const second = await claim('loser');

        expect(first).toBe(true);
        expect(second).toBe(false);
        const fresh = await server.stores.user.getById(placeholder.id, {
            force: true,
        });
        expect(fresh?.username).toBe('winner');
        expect(fresh?.password).toBe('hash-winner');
    });

    it('retires the placeholder username once the claim converts the row', async () => {
        const email = `retire-${Math.random().toString(36).slice(2, 10)}@test.local`;
        const oldName = `uo-${Math.random().toString(36).slice(2, 10)}`;
        const newName = `un-${Math.random().toString(36).slice(2, 10)}`;
        const placeholder = await server.stores.user.create({
            username: oldName,
            uuid: uuidv4(),
            password: null,
            email,
            clean_email: email,
        });
        // Warm the username-keyed cache entry so a stale hit would surface.
        expect((await server.stores.user.getByUsername(oldName))?.id).toBe(
            placeholder.id,
        );

        expect(
            await server.stores.user.claimPlaceholder(placeholder.id, {
                username: newName,
                password: 'hashed',
                uuid: uuidv4(),
            }),
        ).toBe(true);

        expect(await server.stores.user.getByUsername(oldName)).toBeNull();
        expect((await server.stores.user.getByUsername(newName))?.id).toBe(
            placeholder.id,
        );
    });

    it('tells an address conflict apart from other unique violations', async () => {
        const username = `udup-${Math.random().toString(36).slice(2, 10)}`;
        await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: 'hashed',
            email: `${username}@test.local`,
            clean_email: `${username}@test.local`,
        });

        // A duplicate username raises the same unique-violation code. Reading
        // it as an address conflict would report the wrong error to the user.
        let usernameError: unknown;
        try {
            await server.stores.user.create({
                username,
                uuid: uuidv4(),
                password: 'hashed',
                email: `other-${username}@test.local`,
                clean_email: `other-${username}@test.local`,
            });
        } catch (e) {
            usernameError = e;
        }
        expect(usernameError).toBeTruthy();
        expect(isOwnedEmailConflict(usernameError)).toBe(false);

        let emailError: unknown;
        try {
            await server.stores.user.create({
                username: `${username}-2`,
                uuid: uuidv4(),
                password: 'hashed',
                email: `${username}@test.local`,
                clean_email: `${username}@test.local`,
            });
        } catch (e) {
            emailError = e;
        }
        expect(isOwnedEmailConflict(emailError)).toBe(true);
    });

    it('finds an address holder through its canonical form', async () => {
        const suffix = Math.random().toString(36).slice(2, 10);
        const stored = `first.last.${suffix}+tag@gmail.com`;
        const owner = await server.stores.user.create({
            username: `uc-${suffix}`,
            uuid: uuidv4(),
            password: 'hashed',
            email: stored,
            clean_email: cleanEmail(stored),
        });

        // A gmail alias of a stored address has to resolve to the same account,
        // or signup would happily mint a second one for the same inbox.
        expect(
            (
                await server.stores.user.findEmailOwner(
                    `firstlast${suffix}@gmail.com`,
                )
            )?.id,
        ).toBe(owner.id);
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

describe('UserStore batched and uncached lookups', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUser = async (overrides: Record<string, unknown> = {}) => {
        const username = `ub-${Math.random().toString(36).slice(2, 10)}`;
        return server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            ...overrides,
        } as never);
    };

    it('getByIds resolves known ids, skips unknown ones and dedupes input', async () => {
        const a = await makeUser();
        const b = await makeUser();

        const found = await server.stores.user.getByIds([
            a.id,
            b.id,
            a.id,
            99999999,
            null as never,
            undefined as never,
        ]);

        expect(found.size).toBe(2);
        expect(found.get(a.id)?.username).toBe(a.username);
        expect(found.get(b.id)?.username).toBe(b.username);
    });

    it('getByIds tolerates empty and non-array input', async () => {
        expect((await server.stores.user.getByIds([])).size).toBe(0);
        expect((await server.stores.user.getByIds(null as never)).size).toBe(0);
    });

    it('getByIds serves warm ids from cache and cold ids from the database', async () => {
        const warm = await makeUser();
        const cold = await makeUser();
        // Warm only the first id's cache entry.
        await server.stores.user.getById(warm.id);
        await server.stores.user.invalidateById(cold.id);

        await server.clients.db.write(
            'UPDATE `user` SET `username` = ? WHERE `id` = ?',
            [`${cold.username}-renamed`, cold.id],
        );

        const found = await server.stores.user.getByIds([warm.id, cold.id]);
        expect(found.get(warm.id)?.username).toBe(warm.username);
        expect(found.get(cold.id)?.username).toBe(`${cold.username}-renamed`);
    });

    it('getByIds falls back to the database when a cached entry is corrupt', async () => {
        const user = await makeUser();
        await server.stores.user.getById(user.id);
        await server.clients.redis.set(`user:id:${user.id}`, 'not-json');

        const found = await server.stores.user.getByIds([user.id]);
        expect(found.get(user.id)?.username).toBe(user.username);
    });

    it('getByCleanEmail finds the account behind an aliased address', async () => {
        const user = await makeUser();
        await server.stores.user.update(user.id, {
            clean_email: `canonical-${user.username}@test.local`,
        });

        const found = await server.stores.user.getByCleanEmail(
            `canonical-${user.username}@test.local`,
        );
        expect(found?.id).toBe(user.id);
    });

    it('getByCleanEmail returns null for empty, unknown, or non-latin1 values', async () => {
        expect(await server.stores.user.getByCleanEmail('')).toBeNull();
        expect(
            await server.stores.user.getByCleanEmail('nobody@test.local'),
        ).toBeNull();
        // Outside latin1 — no stored row could match, so it never reaches SQL.
        expect(
            await server.stores.user.getByCleanEmail('日本語@test.local'),
        ).toBeNull();
    });

    it('countOthersByPhone excludes the caller and ignores unusable input', async () => {
        const phone = `+1415555${Math.floor(1000 + Math.random() * 9000)}`;
        const a = await makeUser();
        const b = await makeUser();
        await server.stores.user.update(a.id, { phone });
        await server.stores.user.update(b.id, { phone });

        expect(await server.stores.user.countOthersByPhone(phone, a.id)).toBe(
            1,
        );
        expect(await server.stores.user.countOthersByPhone('', a.id)).toBe(0);
        expect(
            await server.stores.user.countOthersByPhone('☎️12345', a.id),
        ).toBe(0);
    });

    it('short-circuits identifying lookups whose value cannot exist in a latin1 column', async () => {
        expect(await server.stores.user.getByUsername('用户')).toBeNull();
        expect(
            await server.stores.user.getByEmail('用户@test.local'),
        ).toBeNull();
    });

    it('refuses to write a non-latin1 value into a latin1 column', async () => {
        const user = await makeUser();
        await expect(
            server.stores.user.update(user.id, { username: '用户' }),
        ).rejects.toMatchObject({ code: 'userFieldNotLatin1' });
        // Columns outside the latin1 set are unaffected.
        await expect(
            server.stores.user.update(user.id, {
                taskbar_items: '日本語',
            } as never),
        ).resolves.toBeUndefined();
    });

    it('ignores an update with no fields', async () => {
        const user = await makeUser();
        await expect(
            server.stores.user.update(user.id, {}),
        ).resolves.toBeUndefined();
    });

    it('normalizes a corrupt metadata column to an empty object', async () => {
        const user = await makeUser();
        await server.clients.db.write(
            'UPDATE `user` SET `metadata` = ? WHERE `id` = ?',
            ['{not json', user.id],
        );
        await server.stores.user.invalidateById(user.id);

        expect((await server.stores.user.getById(user.id))?.metadata).toEqual(
            {},
        );
    });
});
