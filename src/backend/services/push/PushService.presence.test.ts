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

import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { makeActor } from '../../core/actor.js';
import { PRESENCE_NO_APP } from '../../stores/events/PresenceStore.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { PermissionService } from '../permission/PermissionService.js';
import { NOTIFICATIONS_PUSH_PERMISSION } from './pushConsent.js';
import type { PushBatch, PushProvider, PushResult } from './types.js';

const { axiosRequestMock } = vi.hoisted(() => ({
    axiosRequestMock: vi.fn(),
}));

vi.mock('axios', () => ({
    default: { request: axiosRequestMock },
    request: axiosRequestMock,
}));

const BOOT_TIMEOUT_MS = 120_000;
const PEER_ID = 'peer-a';

class FakeProvider implements PushProvider {
    readonly platforms = ['web'] as const;
    readonly calls: PushBatch[] = [];
    async send(batch: PushBatch): Promise<PushResult[]> {
        this.calls.push(batch);
        return batch.tokens.map(() => ({ status: 'delivered' }));
    }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

let env: PuterTestEnv;
const provider = new FakeProvider();
const openSockets: ClientSocket[] = [];

interface Person {
    id: number;
    uuid: string;
    token: string;
    app: { uid: string; token: string };
}

const makePerson = async (): Promise<Person> => {
    const username = `pp${Math.random().toString(36).slice(2, 10)}`;
    const { token } = await createTestUser(env.server, {
        username,
        password: 'pw-test-1234',
    });
    const user = (await env.server.stores.user.getByUsername(username))!;
    const appUid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [appUid, appUid, appUid, `https://${appUid}.example/`, user.id],
    );
    const appToken = await env.server.services.auth.getUserAppToken(
        { user: user as never, effectiveApp: null },
        appUid,
    );
    await (
        env.server.services.permission as unknown as PermissionService
    ).grantUserAppPermission(
        makeActor({ user }),
        appUid,
        NOTIFICATIONS_PUSH_PERMISSION,
    );
    await env.server.stores.pushDevice.register({
        userId: user.id,
        sessionUid: `sess-${uuidv4()}`,
        platform: 'web',
        token: `tok-${uuidv4()}`,
    });
    return {
        id: user.id,
        uuid: user.uuid,
        token,
        app: { uid: appUid, token: appToken },
    };
};

const connect = (token: string): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
        const socket = ioClient(env.origin, {
            auth: { auth_token: token },
            transports: ['websocket'],
            reconnection: false,
        });
        openSockets.push(socket);
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', (err: Error) => reject(err));
    });

const puterNotification = (person: Person) =>
    env.server.services.notification.notify(
        [person.id],
        { title: 'A subscription ended' },
        { type: 'app.events.ended' },
    );

const appMessage = (person: Person) =>
    env.server.services.notification.notify(
        [person.id],
        { title: 'New reply' },
        { type: 'app.message', appUid: person.app.uid },
    );

/** How many pushes went out after `send`, once it has had time to. */
const pushesAfter = async (send: () => Promise<unknown>): Promise<number> => {
    const before = provider.calls.length;
    await send();
    await settle();
    return provider.calls.length - before;
};

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true },
        push: { enabled: true },
        broadcast: {
            webhook: { peerId: 'self-node', secret: 'self-secret' },
            peers: [
                {
                    peerId: PEER_ID,
                    webhook: true,
                    webhook_url: 'http://push-peer.invalid/broadcast/webhook',
                    webhook_secret: 'peer-secret',
                },
            ],
        },
    } as unknown as IConfig);
    env.server.services.push.registerProvider(provider);
}, BOOT_TIMEOUT_MS);

beforeEach(() => {
    axiosRequestMock.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: 'ok',
    });
});

afterEach(() => {
    while (openSockets.length) openSockets.pop()?.disconnect();
});

afterAll(async () => {
    await env?.shutdown();
});

describe('PushService presence', () => {
    it('pushes when nothing is connected', async () => {
        const person = await makePerson();
        expect(await pushesAfter(() => puterNotification(person))).toBe(1);
        expect(await pushesAfter(() => appMessage(person))).toBe(1);
    });

    it('does not push while the desktop is connected', async () => {
        const person = await makePerson();
        await connect(person.token);

        expect(await pushesAfter(() => puterNotification(person))).toBe(0);
        expect(await pushesAfter(() => appMessage(person))).toBe(0);
    });

    it('does not push an app’s message while that app is connected', async () => {
        const person = await makePerson();
        await connect(person.app.token);

        expect(await pushesAfter(() => appMessage(person))).toBe(0);
        // The app's socket does not show Puter's own notifications.
        expect(await pushesAfter(() => puterNotification(person))).toBe(1);
    });

    it('does not push while another node in this region holds the desktop', async () => {
        const person = await makePerson();
        await env.server.stores.presence.addConnection(
            person.id,
            PRESENCE_NO_APP,
            `sibling-${uuidv4()}`,
        );

        expect(await pushesAfter(() => puterNotification(person))).toBe(0);
    });

    it('does not push while another region holds the app', async () => {
        const person = await makePerson();
        await env.server.stores.presence.join(
            person.uuid,
            person.app.uid,
            PEER_ID,
        );

        expect(await pushesAfter(() => appMessage(person))).toBe(0);
        expect(await pushesAfter(() => puterNotification(person))).toBe(1);
    });
});
