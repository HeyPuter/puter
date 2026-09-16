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
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
    type TestUserCredentials,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { resetCardVerificationStatusCache } from '../../util/cardFallback.js';

/**
 * Handing out a share asks for a verified phone or card. Its own env, with an
 * SMS provider configured: the sibling share tests run without one, where the
 * gate is inert by design.
 */
describe('share verification gate over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            prelude: { apiKey: 'test-key' },
        } as IConfig);
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const post = (path: string, token: string, body: unknown) =>
        fetch(new URL(path, env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    const get = (path: string, token: string) =>
        fetch(new URL(path, env.apiOrigin), {
            headers: { authorization: `Bearer ${token}` },
        });

    /** A fresh account, optionally with a verification artifact on its row. */
    const makeUser = async (patch: Record<string, unknown> = {}) => {
        const username = `svg${Math.random().toString(36).slice(2, 9)}`;
        const creds = await createTestUser(env.server, {
            username,
            password: 'puter-test-user-password',
        });
        if (Object.keys(patch).length > 0) {
            const row = await env.server.stores.user.getByUsername(username);
            await env.server.stores.user.update(row!.id, patch);
        }
        return creds;
    };

    const makeFile = async (owner: { username: string }) => {
        const uid = crypto.randomUUID();
        const name = `share-gate-${uid.slice(0, 8)}.txt`;
        const path = `/${owner.username}/${name}`;
        const user = await env.server.stores.user.getByUsername(owner.username);
        await env.server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, 0, ?)',
            [uid, name, path, user!.id, Math.floor(Date.now() / 1000)],
        );
        return { uid, path, name };
    };

    const share = (owner: TestUserCredentials, uid: string) =>
        post('/share', owner.token, {
            recipients: [env.users.other.username],
            items: [{ uid }],
            mode: 'read',
        });

    it('turns an unverified owner away, leading with the phone flow', async () => {
        const owner = await makeUser();
        const file = await makeFile(owner);
        const res = await share(owner, file.uid);
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({
            code: 'phone_verification_required',
            factors: ['phone'],
        });
    });

    it('lets an owner with a verified number share', async () => {
        const owner = await makeUser({ phone: '+14155550123' });
        const file = await makeFile(owner);
        const res = await share(owner, file.uid);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ status: 'success' });
    });

    it('lets a paying owner share without either factor', async () => {
        const owner = await makeUser();
        const row = await env.server.stores.user.getByUsername(owner.username);
        const metering = env.server.services.metering;
        const real = metering.getActorSubscription.bind(metering);
        const spy = vi
            .spyOn(metering, 'getActorSubscription')
            .mockImplementation(async (actor) =>
                actor.user?.uuid === row!.uuid
                    ? ({ id: 'business' } as never)
                    : real(actor),
            );
        try {
            const file = await makeFile(owner);
            expect((await share(owner, file.uid)).status).toBe(200);
        } finally {
            spy.mockRestore();
            metering.invalidateActorSubscription(row!.uuid);
        }
    });

    it('accepts a verified card once an extension reports the card gate on', async () => {
        const cardGateOn = (
            _key: string,
            data: { enabled: boolean | null },
        ) => {
            data.enabled = true;
        };
        resetCardVerificationStatusCache();
        env.server.clients.event.on(
            'puter.card-verification.status',
            cardGateOn,
        );
        try {
            const carded = await makeUser({ card_fingerprint: 'fp_test' });
            const file = await makeFile(carded);
            expect((await share(carded, file.uid)).status).toBe(200);

            // ...and an owner with neither is now offered both.
            const bare = await makeUser();
            const bareFile = await makeFile(bare);
            const res = await share(bare, bareFile.uid);
            expect(res.status).toBe(403);
            expect(await res.json()).toMatchObject({
                code: 'phone_verification_required',
                factors: ['phone', 'card'],
            });
        } finally {
            env.server.clients.event.off(
                'puter.card-verification.status',
                cardGateOn,
            );
            resetCardVerificationStatusCache();
        }
    });

    it('never gates withdrawing or listing shares', async () => {
        const owner = await makeUser();
        const file = await makeFile(owner);
        const revoke = await post('/share/revoke', owner.token, {
            recipients: [env.users.other.username],
            items: [{ uid: file.uid }],
        });
        expect(revoke.status).toBe(200);
        const list = await get('/share/shared-by-me', owner.token);
        expect(list.status).toBe(200);
    });
});
