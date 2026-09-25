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
 * What deleting an app leaves behind on the events side: its durable rows,
 * their backlog and its published handlers can never deliver again — the
 * grant identity they are re-checked under no longer resolves — so
 * `settleDeletedApp` tears them down on the `app.changed` bus key rather than
 * leaving them to cost their holder an anchor slot forever. Also the hourly
 * sweep that catches whatever neither this nor `workers.destroy` reached.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import { EVENTS_WORKER_SESSION_NAME } from './workerRuntime.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let userId: number;
let otherUserId: number;

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
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

beforeEach(async () => {
    await env.server.clients.db.write('DELETE FROM `event_handlers`', []);
    await env.server.clients.db.write('DELETE FROM `event_subscriptions`', []);
    await env.server.clients.db.write('DELETE FROM `apps`', []);
});

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

/** An app owned by `ownerUserId`, with a token that acts as it for that owner. */
const makeApp = async (
    ownerUserId: number,
): Promise<{ uid: string; token: string }> => {
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

/**
 * Emit the same event `AppDriver` emits on delete — `old_app` carries the row
 * as it was, which is where `owner_user_id` comes from once the row itself is
 * gone.
 */
const emitDeleted = async (appUid: string): Promise<void> => {
    const app = await env.server.stores.app.getByUid(appUid);
    await env.server.clients.event.emitAndWait(
        'app.changed',
        { app_uid: appUid, app: null, old_app: app, action: 'deleted' },
        {},
    );
};

const publish = (
    token: string,
    body: { appUid: string; name: string; source: string },
): Promise<ApiResponse> => call('POST', '/events/handlers/publish', token, body);

/** A durable `single` subscription bound to a published handler, with the
 * grants a background delivery needs. Returns the subscribed subId. */
const subscribeBackgroundHandler = async (
    app: { uid: string; token: string },
    handlerName: string,
): Promise<string> => {
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
        handlerName,
        targets: ['worker'],
    });
    expect(subscribed.status).toBe(200);
    return subscribed.body.subId as string;
};

describe('an app deleted while it has events state', () => {
    it('clears the rows, the backlog and the handlers when the app is deleted', async () => {
        const app = await makeApp(userId);
        await publish(app.token, {
            appUid: app.uid,
            name: 'ingestUpload',
            source: SOURCE,
        });
        const subId = await subscribeBackgroundHandler(app, 'ingestUpload');

        await env.server.stores.pendingDelivery.enqueue(subId, {
            id: 'ev-1',
            subject: `fs:${app.uid}`,
            op: 'write',
            uid: 'node-1',
            path: '/somewhere',
            self: true,
            seq: 0,
            ts: Date.now(),
        });
        expect(await env.server.stores.pendingDelivery.depth(subId)).toBe(1);

        await emitDeleted(app.uid);

        const listed = await env.server.stores.durableSubscription.listForHolder(
            userId,
            { appUid: app.uid },
        );
        expect(listed.items).toEqual([]);
        expect(await env.server.stores.pendingDelivery.depth(subId)).toBe(0);
        expect(await env.server.stores.eventHandler.listForApp(app.uid)).toEqual(
            [],
        );
    });

    it('retires every holder session for a deleted app', async () => {
        const app = await makeApp(userId);
        await publish(app.token, {
            appUid: app.uid,
            name: 'ingestUpload',
            source: SOURCE,
        });

        // The account's own row, from the real subscribe path.
        await subscribeBackgroundHandler(app, 'ingestUpload');
        // A second holder bound to the same app — the shared-anchor case, not
        // worth a second app-token dance to reach through the API.
        await env.server.stores.durableSubscription.create({
            holderUserId: otherUserId,
            ownerUserId: userId,
            appUid: app.uid,
            subject: `fs:${app.uid}`,
            token: `fs:${app.uid}`,
            anchorUid: app.uid,
            anchorPath: '/shared',
            match: null,
            op: null,
            delivery: 'single',
            targets: ['worker'],
            handlerName: 'ingestUpload',
            context: null,
            permission: 'list',
            expiresAt: null,
        });

        const { actor: ownerActor } = await env.server.services.auth.authenticate(
            env.users.user.token,
        );
        const { actor: otherActor } = await env.server.services.auth.authenticate(
            env.users.other.token,
        );
        const ownerToken = await env.server.services.auth.createWorkerAppToken(
            ownerActor!,
            app.uid,
            EVENTS_WORKER_SESSION_NAME,
        );
        const otherToken = await env.server.services.auth.createWorkerAppToken(
            otherActor!,
            app.uid,
            EVENTS_WORKER_SESSION_NAME,
        );

        await emitDeleted(app.uid);

        for (const token of [ownerToken, otherToken]) {
            const reauth = await env.server.services.auth.authenticate(token);
            expect(reauth).toMatchObject({
                reauth: { reason: 'session_revoked' },
            });
        }
    });

    it('still deletes the app when the settle throws', async () => {
        const app = await makeApp(userId);
        await publish(app.token, {
            appUid: app.uid,
            name: 'ingestUpload',
            source: SOURCE,
        });
        const spy = vi
            .spyOn(env.server.stores.eventHandler, 'deleteForApp')
            .mockRejectedValue(new Error('db down'));
        try {
            await expect(emitDeleted(app.uid)).resolves.not.toThrow();
        } finally {
            spy.mockRestore();
        }
    });

    it('revokes a session whose app is already gone', async () => {
        const app = await makeApp(userId);
        await publish(app.token, {
            appUid: app.uid,
            name: 'ingestUpload',
            source: SOURCE,
        });
        const { actor } = await env.server.services.auth.authenticate(
            env.users.user.token,
        );
        await env.server.services.auth.createWorkerAppToken(
            actor!,
            app.uid,
            EVENTS_WORKER_SESSION_NAME,
        );

        // Reproduces the already-stranded rows: the app row goes without
        // either hook running — no `app.changed`, no `workers.destroy`. Goes
        // through the store (not a raw DELETE) so its cache is invalidated
        // the same way a real deletion leaves it.
        const row = await env.server.stores.app.getByUid(app.uid);
        await env.server.stores.app.delete((row as { id: number }).id);

        const revoked =
            await env.server.services.events.sweepStrandedWorkerSessions();
        expect(revoked).toBeGreaterThanOrEqual(1);

        // `authenticate()` can no longer resolve the token at all — the app
        // it names is truly gone, not just the session — so the row itself
        // is what confirms the revoke.
        const sessions = await env.server.stores.session.getByUserId(userId, {
            includeRevoked: true,
        });
        const session = sessions.find(
            (row: {
                kind: string;
                app_uid: string | null;
                meta?: { worker_name?: string };
                revoked_at: unknown;
            }) =>
                row.kind === 'worker' &&
                row.app_uid === app.uid &&
                row.meta?.worker_name === EVENTS_WORKER_SESSION_NAME,
        );
        expect(session?.revoked_at).not.toBeNull();
    });

    it('leaves a stranded session alone when its app still exists', async () => {
        const app = await makeApp(userId);
        await publish(app.token, {
            appUid: app.uid,
            name: 'ingestUpload',
            source: SOURCE,
        });
        const { actor } = await env.server.services.auth.authenticate(
            env.users.user.token,
        );
        const token = await env.server.services.auth.createWorkerAppToken(
            actor!,
            app.uid,
            EVENTS_WORKER_SESSION_NAME,
        );

        await env.server.services.events.sweepStrandedWorkerSessions();

        const reauth = await env.server.services.auth.authenticate(token);
        expect(reauth).not.toHaveProperty('reauth');
    });
});
