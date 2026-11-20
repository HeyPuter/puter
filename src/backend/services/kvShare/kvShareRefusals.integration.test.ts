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
import { makeActor, type Actor } from '../../core/actor.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';

/** A server that shares key-value data but runs no events. */
describe('key-value shares on a server without events', () => {
    let env: PuterTestEnv;
    let owner: Actor;
    let guestUsername: string;
    let appUid: string;

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            events: { enabled: false },
            kv: { shareHandles: true },
            unlimitedMetering: true,
        } as IConfig);
        const ownerRow = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        owner = makeActor({ user: ownerRow as never });
        guestUsername = env.users.other.username;
        const name = `kv-refusal-${uuidv4().slice(0, 8)}`;
        const app = await env.server.stores.app.create(
            {
                name,
                title: 'Refusal App',
                index_url: `https://${name}.example.test/index.html`,
            },
            { ownerUserId: ownerRow!.id },
        );
        appUid = (app as { uid: string }).uid;
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const mint = (fields: Record<string, unknown>) =>
        env.server.services.kvShare.mintKvHandle(
            owner,
            {
                prefix: `notes:${uuidv4()}:`,
                recipient: { username: guestUsername },
                appUid,
                ...fields,
            } as never,
            { defaultAccess: 'read' },
        );

    it('refuses a watch share, which needs events, and still mints a read share', async () => {
        await expect(mint({ access: 'watch' })).rejects.toMatchObject({
            statusCode: 503,
            legacyCode: 'events_disabled',
        });

        const minted = await mint({ access: 'read' });
        expect(minted.handle).toEqual(expect.any(String));
    });

    it('refuses an app uid that is not a string', async () => {
        await expect(
            mint({ access: 'read', appUid: 42 }),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            message: 'appUid must be a string',
        });
    });
});
