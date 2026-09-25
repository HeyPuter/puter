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
 * What each credential shape may see and remove, and whether it can hold a
 * connection at all.
 *
 * Every actor here is minted and then authenticated for real, because the whole
 * question is what `effectiveApp` resolves to at the end of a token chain: an
 * app sees only what it created, a credential acting for the account sees
 * across apps, and an id belonging to another app is answered as absent rather
 * than refused.
 */

import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { AuthResult } from '../auth/AuthService.js';
import { decideSocketAuth } from '../socket/SocketService.js';
import type { DeliveryEnvelope } from './EventsService.js';

const BOOT_TIMEOUT_MS = 120_000;
const SOCKET_ID = 'matrix-socket';

let env: PuterTestEnv;
let username: string;
let userId: number;
let anchor: string;

/** One actor per row of the scoping matrix, each from a real credential. */
let session: Actor;
let appOne: Actor;
let appTwo: Actor;
let appAccessToken: Actor;
let personalAccessToken: Actor;
let worker: Actor;

/** Raw token strings, for the shapes a live handshake is attempted with. */
let appAccessTokenStr: string;

let appOneUid: string;
let appTwoUid: string;

const events = () => env.server.services.events;
const auth = () => env.server.services.auth;

const actorFor = async (token: string): Promise<Actor> => {
    const result = await auth().authenticate(token);
    expect(result.actor, 'credential did not authenticate').toBeDefined();
    return result.actor!;
};

/** An app the user has granted `list` on the shared anchor. */
const makeAppActor = async (): Promise<{ uid: string; actor: Actor }> => {
    const uid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [uid, uid, uid, `https://${uid}.example/`, userId],
    );
    const entry = await env.server.stores.fsEntry.getEntryByPath(anchor);
    await env.server.services.permission.grantUserAppPermission(
        session,
        uid,
        `fs:${entry!.uid}:list`,
    );
    const token = await auth().getUserAppToken(session, uid);
    return { uid, actor: await actorFor(token) };
};

const subscribeAs = async (actor: Actor) =>
    (await events().subscribe(actor, SOCKET_ID, { subject: `fs:${anchor}` }))
        .sub;

/** A write by the user, through the route a client actually calls. */
const writeAsUser = async (path: string): Promise<void> => {
    const response = await fetch(new URL('/mkdir', env.apiOrigin), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${env.users.user.token}`,
        },
        body: JSON.stringify({ path, create_missing_parents: true }),
    });
    expect(response.status).toBe(200);
};

const heldBy = async (actor: Actor): Promise<string[]> =>
    (await events().listSubscriptions(actor, SOCKET_ID)).map((sub) => sub.subId);

const absent = (err: unknown) =>
    isHttpError(err) &&
    err.statusCode === 404 &&
    err.legacyCode === 'subscription_does_not_exist';

/** Attempt a live handshake; resolves with the rejection message, or throws if it connects. */
const attemptConnect = (token: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const socket: ClientSocket = ioClient(env.origin, {
            auth: { auth_token: token },
            transports: ['websocket'],
            reconnection: false,
        });
        socket.on('connect', () => {
            socket.disconnect();
            reject(new Error('socket connected; expected a handshake rejection'));
        });
        socket.on('connect_error', (err: Error) => {
            socket.disconnect();
            resolve(err.message);
        });
    });

beforeAll(async () => {
    env = await setupPuterTestEnv({ events: { enabled: true } } as IConfig);
    username = env.users.user.username;
    const row = await env.server.stores.user.getByUsername(username);
    userId = row!.id;

    anchor = `/${username}/matrix`;
    await env.server.services.fs.mkdir(userId, {
        path: anchor,
        createMissingParents: true,
    });

    session = await actorFor(env.users.user.token);
    ({ uid: appOneUid, actor: appOne } = await makeAppActor());
    ({ uid: appTwoUid, actor: appTwo } = await makeAppActor());

    const entry = await env.server.stores.fsEntry.getEntryByPath(anchor);
    appAccessTokenStr = await auth().createAccessToken(
        appOne,
        [[`fs:${entry!.uid}:list`]],
        { label: 'matrix' },
    );
    appAccessToken = await actorFor(appAccessTokenStr);
    personalAccessToken = await actorFor(env.users.user.apiToken);
    worker = await actorFor(env.users.user.workerToken);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

describe('which credentials reach the session verbs at all', () => {
    const accepted = (actor: Actor) => {
        const decision = decideSocketAuth({ actor } as AuthResult, {
            allowAppActors: true,
        });
        return 'accept' in decision;
    };

    it('admits a session, an app and a worker, and refuses access tokens', () => {
        expect(accepted(session)).toBe(true);
        expect(accepted(appOne)).toBe(true);
        // A worker session is user-shaped — no app, no access token — so it
        // connects like one and is scoped by what it was minted with.
        expect(worker.session?.kind).toBe('worker');
        expect(accepted(worker)).toBe(true);

        // Both access-token shapes are refused at the handshake, so neither
        // ever holds a socket to call a session verb on.
        expect(accepted(appAccessToken)).toBe(false);
        expect(accepted(personalAccessToken)).toBe(false);
    });

    it('refuses both access-token shapes at a live handshake, even with events on', async () => {
        // `accepted` above is the pure decision function; this drives an
        // actual connection against a server booted with events enabled, so
        // the wiring — not just the predicate — is what is on the hook.
        await expect(
            attemptConnect(env.users.user.apiToken),
        ).resolves.toMatch(/only user tokens/);
        await expect(attemptConnect(appAccessTokenStr)).resolves.toMatch(
            /only user tokens/,
        );
    });

    it('refuses an app while events are off, whatever the token says', () => {
        expect(
            'reject' in decideSocketAuth({ actor: appOne } as AuthResult),
        ).toBe(true);
    });
});

describe('what an actor sees and removes', () => {
    it('stamps the creating app on the row, and nothing on a session`s', async () => {
        const own = await subscribeAs(session);
        const theirs = await subscribeAs(appOne);

        const rows = await env.server.stores.eventSubscription.listForSocket(
            userId,
            SOCKET_ID,
        );
        const byId = new Map(rows.map((row) => [row.subId, row]));
        expect(byId.get(own.subId)?.appUid).toBeNull();
        expect(byId.get(theirs.subId)?.appUid).toBe(appOneUid);

        // An access token an app issued acts as that app, one hop through its
        // issuer — which is what the whole scope keys on.
        expect(appAccessToken.effectiveApp?.uid).toBe(appOneUid);
        expect(personalAccessToken.effectiveApp).toBeNull();
        expect(worker.effectiveApp).toBeNull();

        await events().unsubscribe(session, SOCKET_ID, { subId: own.subId });
        await events().unsubscribe(session, SOCKET_ID, { subId: theirs.subId });
    });

    it('shows an app its own rows and no others', async () => {
        const mine = await subscribeAs(appOne);
        const theirs = await subscribeAs(appTwo);
        const account = await subscribeAs(session);

        await expect(heldBy(appOne)).resolves.toEqual([mine.subId]);
        await expect(heldBy(appTwo)).resolves.toEqual([theirs.subId]);
        // The token the app issued inherits exactly the app's view.
        await expect(heldBy(appAccessToken)).resolves.toEqual([mine.subId]);

        for (const wide of [session, personalAccessToken, worker])
            expect((await heldBy(wide)).sort()).toEqual(
                [mine.subId, theirs.subId, account.subId].sort(),
            );

        await events().unsubscribe(session, SOCKET_ID, { subId: mine.subId });
        await events().unsubscribe(session, SOCKET_ID, { subId: theirs.subId });
        await events().unsubscribe(session, SOCKET_ID, {
            subId: account.subId,
        });
    });

    it('answers another app`s subscription id as absent', async () => {
        const mine = await subscribeAs(appOne);

        await expect(
            events().unsubscribe(appTwo, SOCKET_ID, { subId: mine.subId }),
        ).rejects.toSatisfy(absent);
        // Still there: the refusal removed nothing.
        await expect(heldBy(appOne)).resolves.toEqual([mine.subId]);

        await events().unsubscribe(appOne, SOCKET_ID, { subId: mine.subId });
        await expect(heldBy(appOne)).resolves.toEqual([]);
    });

    it('answers a session`s subscription id as absent to an app', async () => {
        const account = await subscribeAs(session);

        await expect(
            events().unsubscribe(appOne, SOCKET_ID, { subId: account.subId }),
        ).rejects.toSatisfy(absent);

        await events().unsubscribe(session, SOCKET_ID, {
            subId: account.subId,
        });
    });

    it('lets the account remove what an app left behind', async () => {
        const theirs = await subscribeAs(appTwo);
        expect(appTwoUid).not.toBe(appOneUid);

        await events().unsubscribe(session, SOCKET_ID, { subId: theirs.subId });

        await expect(heldBy(session)).resolves.toEqual([]);
    });
});

describe('an app`s row is delivered as the app', () => {
    it('follows the grant the app holds, and stops when it is taken back', async () => {
        const delivered: DeliveryEnvelope[] = [];
        events().onDelivered = (envelope) => delivered.push(envelope);
        const sub = await subscribeAs(appOne);
        const entry = await env.server.stores.fsEntry.getEntryByPath(anchor);

        await writeAsUser(`${anchor}/granted-${uuidv4().slice(0, 8)}`);
        await vi.waitFor(() => expect(delivered).toHaveLength(1), {
            timeout: EVENTS_COALESCE_WINDOW_MS * 12,
            interval: 25,
        });
        expect(delivered[0].subId).toBe(sub.subId);

        // The user takes the app's access away; the row outlives the grant,
        // and the re-check is what makes it stop.
        await env.server.services.permission.revokeUserAppPermission(
            session,
            appOneUid,
            `fs:${entry!.uid}:list`,
        );
        delivered.length = 0;

        await writeAsUser(`${anchor}/revoked-${uuidv4().slice(0, 8)}`);
        await new Promise((resolve) =>
            setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
        );
        expect(delivered).toEqual([]);
    });
});
