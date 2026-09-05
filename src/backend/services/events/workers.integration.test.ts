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

/**
 * The events worker as a billable artifact: the `events.worker.create` /
 * `events.worker.destroy` lifecycle a rent listener keys on, the owner-scoped
 * listing, and the destroy route's whole-app removal.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let userId: number;
let otherUserId: number;

interface ApiResponse {
    status: number;
    body: Record<string, unknown>;
}

const call = async (
    method: 'GET' | 'POST',
    path: string,
    token: string,
    body?: object,
): Promise<ApiResponse> => {
    const response = await fetch(new URL(path, env.apiOrigin), {
        method,
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
    };
};

const publish = (
    token: string,
    body: { appUid?: string; name: string; source: string },
): Promise<ApiResponse> => call('POST', '/events/handlers/publish', token, body);

const remove = (
    token: string,
    body: { appUid?: string; name: string },
): Promise<ApiResponse> => call('POST', '/events/handlers/remove', token, body);

/** An app owned by `ownerUserId`, with a token that acts as it for that owner. */
const makeApp = async (ownerUserId: number): Promise<{ uid: string; token: string }> => {
    const uid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [uid, uid, uid, `https://${uid}.example/`, ownerUserId],
    );
    const ownerToken =
        ownerUserId === userId ? env.users.user.token : env.users.other.token;
    const { actor } = await env.server.services.auth.authenticate(ownerToken);
    const token = await env.server.services.auth.getUserAppToken(actor!, uid);
    return { uid, token };
};

const SOURCE = 'async ({ event }) => { console.log(event.path); }';
const OTHER_SOURCE = 'async ({ event, ctx }) => { console.log(ctx.url); }';

let creates: Array<{ appUid: string; ownerId: number | undefined }>;
let destroys: Array<{ appUid: string; ownerId: number | undefined }>;

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true },
        unlimitedMetering: true,
    } as IConfig);

    const user = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    userId = user!.id;
    const other = await env.server.stores.user.getByUsername(
        env.users.other.username,
    );
    otherUserId = other!.id;

    creates = [];
    destroys = [];
    env.server.clients.event.on('events.worker.create', (_key, event) => {
        creates.push({ appUid: event.appUid, ownerId: event.actor.user.id });
    });
    env.server.clients.event.on('events.worker.destroy', (_key, event) => {
        destroys.push({ appUid: event.appUid, ownerId: event.actor.user.id });
    });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

beforeEach(async () => {
    await env.server.clients.db.write('DELETE FROM `event_handlers`', []);
    await env.server.clients.db.write('DELETE FROM `event_subscriptions`', []);
    await env.server.clients.db.write('DELETE FROM `apps`', []);
    creates.length = 0;
    destroys.length = 0;
});

describe('the create / destroy lifecycle', () => {
    it('fires events.worker.create once for a whole publishAll set', async () => {
        const app = await makeApp(userId);

        const published = await call(
            'POST',
            '/events/handlers/publishAll',
            app.token,
            {
                appUid: app.uid,
                handlers: [
                    { name: 'a', source: SOURCE },
                    { name: 'b', source: OTHER_SOURCE },
                ],
            },
        );
        expect(published.status).toBe(200);
        expect(creates).toEqual([{ appUid: app.uid, ownerId: userId }]);
    });

    it('fires events.worker.create for a publishAll that stopped partway', async () => {
        const app = await makeApp(userId);

        // The second item is refused, but the first one landed — the worker
        // exists, so it has to have been announced.
        const published = await call(
            'POST',
            '/events/handlers/publishAll',
            app.token,
            {
                appUid: app.uid,
                handlers: [
                    { name: 'a', source: SOURCE },
                    { name: '', source: SOURCE },
                ],
            },
        );
        expect(published.status).toBe(400);
        expect(creates).toEqual([{ appUid: app.uid, ownerId: userId }]);
    });

    it('fires events.worker.create once on first publish, not on a second', async () => {
        const app = await makeApp(userId);

        const first = await publish(app.token, {
            appUid: app.uid,
            name: 'ingestUpload',
            source: SOURCE,
        });
        expect(first.status).toBe(200);
        expect(creates).toEqual([{ appUid: app.uid, ownerId: userId }]);

        const second = await publish(app.token, {
            appUid: app.uid,
            name: 'indexDocument',
            source: OTHER_SOURCE,
        });
        expect(second.status).toBe(200);
        expect(creates).toHaveLength(1);
    });

    it('fires events.worker.destroy on the last removal, not before', async () => {
        const app = await makeApp(userId);
        await publish(app.token, { appUid: app.uid, name: 'a', source: SOURCE });
        await publish(app.token, {
            appUid: app.uid,
            name: 'b',
            source: OTHER_SOURCE,
        });

        await remove(app.token, { appUid: app.uid, name: 'a' });
        expect(destroys).toEqual([]);

        await remove(app.token, { appUid: app.uid, name: 'b' });
        expect(destroys).toEqual([{ appUid: app.uid, ownerId: userId }]);
    });

    it('fires events.worker.destroy exactly once for POST /events/workers/destroy', async () => {
        const app = await makeApp(userId);
        await publish(app.token, { appUid: app.uid, name: 'a', source: SOURCE });
        await publish(app.token, {
            appUid: app.uid,
            name: 'b',
            source: OTHER_SOURCE,
        });

        const destroyed = await call(
            'POST',
            '/events/workers/destroy',
            app.token,
            { appUid: app.uid },
        );
        expect(destroyed.status).toBe(200);
        expect(destroyed.body).toEqual({
            appUid: app.uid,
            removed: 2,
            suspended: 0,
        });
        expect(destroys).toEqual([{ appUid: app.uid, ownerId: userId }]);
    });

    it('404s destroying an app with nothing published, and fires nothing', async () => {
        const app = await makeApp(userId);
        const destroyed = await call(
            'POST',
            '/events/workers/destroy',
            app.token,
            { appUid: app.uid },
        );
        expect(destroyed.status).toBe(404);
        expect(destroyed.body.code).toBe('events_handler_not_found');
        expect(destroys).toEqual([]);
    });

    it('announces the app`s owner, not the publishing developer session', async () => {
        const app = await makeApp(userId);
        await publish(env.users.user.token, {
            appUid: app.uid,
            name: 'ingestUpload',
            source: SOURCE,
        });
        expect(creates).toEqual([{ appUid: app.uid, ownerId: userId }]);
    });
});

describe('GET /events/workers', () => {
    it('lists the caller`s own apps with published handlers', async () => {
        const mine = await makeApp(userId);
        await publish(mine.token, { appUid: mine.uid, name: 'a', source: SOURCE });
        await publish(mine.token, {
            appUid: mine.uid,
            name: 'b',
            source: OTHER_SOURCE,
        });

        const listed = await call('GET', '/events/workers', env.users.user.token);
        expect(listed.status).toBe(200);
        const items = listed.body.items as Array<Record<string, unknown>>;
        expect(items).toEqual([
            expect.objectContaining({
                appUid: mine.uid,
                handlerCount: 2,
                script: expect.any(String),
            }),
        ]);
        expect(typeof listed.body.deployable).toBe('boolean');
    });

    it('never lists another account`s app', async () => {
        const theirs = await makeApp(otherUserId);
        await publish(theirs.token, {
            appUid: theirs.uid,
            name: 'a',
            source: SOURCE,
        });

        const listed = await call('GET', '/events/workers', env.users.user.token);
        expect(listed.body.items).toEqual([]);
    });

    it('refuses an app token — this is the owner`s own view', async () => {
        const app = await makeApp(userId);
        await publish(app.token, { appUid: app.uid, name: 'a', source: SOURCE });

        const listed = await call('GET', '/events/workers', app.token);
        expect(listed.status).toBe(403);
        expect(listed.body.code).toBe('events_worker_owner_only');
    });
});

describe('POST /events/workers/destroy', () => {
    it('suspends dependents the same way removing each by name would', async () => {
        const app = await makeApp(userId);
        await publish(app.token, {
            appUid: app.uid,
            name: 'ingestUpload',
            source: SOURCE,
        });

        // A background-delivered subscription needs the anchor's own grant
        // plus the app's consent to run with nobody present.
        const anchor = `/${env.users.user.username}/${uuidv4()}`;
        await env.server.services.fs.mkdir(userId, {
            path: anchor,
            createMissingParents: true,
        });
        const { actor } = await env.server.services.auth.authenticate(
            env.users.user.token,
        );
        const entry = await env.server.stores.fsEntry.getEntryByPath(anchor);
        await env.server.services.permission.grantUserAppPermission(
            actor!,
            app.uid,
            `fs:${entry!.uid}:list`,
        );
        await env.server.services.permission.grantUserAppPermission(
            actor!,
            app.uid,
            EVENTS_BACKGROUND_PERMISSION,
        );

        const subscribed = await call('POST', '/events/subscribe', app.token, {
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: 'ingestUpload',
            targets: ['worker'],
        });
        expect(subscribed.status).toBe(200);

        const destroyed = await call(
            'POST',
            '/events/workers/destroy',
            app.token,
            { appUid: app.uid },
        );
        expect(destroyed.body).toMatchObject({ removed: 1, suspended: 1 });
    });

    it('refuses an app token destroying an app it is not', async () => {
        const app = await makeApp(userId);
        await publish(app.token, { appUid: app.uid, name: 'a', source: SOURCE });
        const other = await makeApp(userId);

        const refused = await call(
            'POST',
            '/events/workers/destroy',
            app.token,
            { appUid: other.uid },
        );
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_handler_forbidden');
    });

    it('refuses an account session naming another account`s app', async () => {
        const theirs = await makeApp(otherUserId);
        await publish(theirs.token, {
            appUid: theirs.uid,
            name: 'a',
            source: SOURCE,
        });

        const refused = await call(
            'POST',
            '/events/workers/destroy',
            env.users.user.token,
            { appUid: theirs.uid },
        );
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('events_handler_forbidden');
        expect(destroys).toEqual([]);
    });
});
