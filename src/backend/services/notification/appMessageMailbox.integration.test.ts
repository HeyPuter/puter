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

/** An app's messages reach that app; the desktop shows only Puter's own. */

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { DeliveryEnvelope } from '../events/EventsService.js';

const BOOT_TIMEOUT_MS = 120_000;

/** One server, one user, and a fresh app per test that messages them. */
const bootEnv = (config: Record<string, unknown>) => {
    const state = {
        env: null as unknown as PuterTestEnv,
        actor: null as unknown as Actor,
        userId: 0,
    };

    beforeAll(async () => {
        state.env = await setupPuterTestEnv({
            unlimitedMetering: true,
            ...config,
        } as IConfig);
        const row = await state.env.server.stores.user.getByUsername(
            state.env.users.user.username,
        );
        state.actor = makeActor({ user: row as never });
        state.userId = row!.id;
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await state.env?.shutdown();
    });

    const makeApp = async () => {
        const name = `app-message-${uuidv4().slice(0, 8)}`;
        return state.env.server.stores.app.create(
            {
                name,
                title: 'Messaging App',
                index_url: `https://${name}.example.test/index.html`,
            },
            { ownerUserId: state.userId },
        );
    };

    const appActor = (app: { uid: string; id: number }) =>
        makeActor({
            user: state.actor.user as never,
            app: { uid: app.uid, id: app.id },
        });

    const notify = async (
        type:
            | 'app.message'
            | 'share.received'
            | 'app.worker.deployFailed'
            | 'app.events.ended',
        appUid?: string,
    ) =>
        (await state.env.server.services.notification.notify(
            [state.userId],
            { title: `${type} title` },
            appUid ? { type, appUid } : { type },
        ))!;

    return { state, makeApp, appActor, notify };
};

const select = (
    state: { env: PuterTestEnv },
    actor: Actor,
    args: Record<string, unknown> = {},
) =>
    (
        runWithContext({ actor }, () =>
            state.env.server.drivers.notifications.select(args),
        ) as Promise<Array<{ uid: unknown }>>
    ).then((rows) => rows.map((row) => row.uid));

describe('app messages and the desktop', () => {
    const { state, makeApp, appActor, notify } = bootEnv({});

    it('are not pushed to the desktop, while shares and Puter`s own are', async () => {
        const app = await makeApp();
        const emit = vi.spyOn(state.env.server.clients.event, 'emit');
        try {
            const message = await notify('app.message', app.uid);
            const share = await notify('share.received');
            const deploy = await notify('app.worker.deployFailed', app.uid);
            const pushed = emit.mock.calls
                .filter(([key]) => key === 'outer.gui.notif.message')
                .map(([, data]) => JSON.stringify(data));
            expect(pushed.some((one) => one.includes(message))).toBe(false);
            expect(pushed.some((one) => one.includes(share))).toBe(true);
            expect(pushed.some((one) => one.includes(deploy))).toBe(true);
        } finally {
            emit.mockRestore();
        }
    });

    it('stay out of the desktop`s listing, but not out of the app`s', async () => {
        const app = await makeApp();
        const message = await notify('app.message', app.uid);
        const share = await notify('share.received');

        const desktop = await select(state, state.actor);
        expect(desktop).not.toContain(message);
        expect(desktop).toContain(share);
        const unread = await select(state, state.actor, {
            predicate: 'unacknowledged',
        });
        expect(unread).not.toContain(message);
        expect(unread).toContain(share);
        expect(
            await select(state, state.actor, { subject: 'notif:app-user' }),
        ).not.toContain(message);

        expect(await select(state, appActor(app))).toContain(message);
        expect(
            await select(state, state.actor, {
                subject: `notif:${app.uid}:app-user`,
            }),
        ).toContain(message);
    });

    it('are left out of the unread replay a desktop gets on connecting', async () => {
        const app = await makeApp();
        const message = await notify('app.message', app.uid);
        const share = await notify('share.received');
        // A live push to a connected user marks it shown; this one is offline.
        await state.env.server.clients.db.write(
            'UPDATE `notification` SET `shown` = NULL WHERE `uid` IN (?, ?)',
            [message, share],
        );
        const emit = vi.spyOn(state.env.server.clients.event, 'emit');
        try {
            state.env.server.clients.event.emit(
                'web.socket.user-connected',
                { user: { id: state.userId } } as never,
                {},
            );
            // The replay is debounced by two seconds.
            await new Promise((resolve) => setTimeout(resolve, 2_300));
            const replayed = emit.mock.calls
                .filter(([key]) => key === 'outer.gui.notif.unreads')
                .map(([, data]) => JSON.stringify(data));
            expect(replayed.some((one) => one.includes(message))).toBe(false);
            expect(replayed.some((one) => one.includes(share))).toBe(true);
        } finally {
            emit.mockRestore();
        }
    });
});

describe('app messages and the desktop with notification dispatch on', () => {
    const { state, makeApp, appActor, notify } = bootEnv({
        events: { enabled: true, notificationsFoldIn: true },
    });

    it('reach the app`s own feed and never the desktop`s, live or fetched', async () => {
        const events = state.env.server.services.events;
        const app = await makeApp();
        const delivered: DeliveryEnvelope[] = [];
        events.onDelivered = (envelope) => delivered.push(envelope);
        const { sub: desktopSub } = await events.subscribe(
            state.actor,
            'app-message-desktop',
            { subject: 'notif:app-user' },
        );
        const { sub: accountSub } = await events.subscribe(
            state.actor,
            'app-message-account',
            { subject: 'notif:account' },
        );
        const { sub: appSub } = await events.subscribe(
            appActor(app),
            'app-message-app',
            { subject: 'notif:app-user' },
        );
        const deliveredTo = (subId: string, uid: string) =>
            delivered.some(
                (one) =>
                    one.subId === subId &&
                    (one.event as { uid?: string }).uid === uid,
            );
        const waitFor = (check: () => boolean) =>
            vi.waitFor(() => expect(check()).toBe(true), {
                timeout: EVENTS_COALESCE_WINDOW_MS * 12,
                interval: 25,
            });
        const send = vi.spyOn(state.env.server.services.socket, 'send');
        try {
            const message = await notify('app.message', app.uid);
            await waitFor(() => deliveredTo(appSub.subId, message));
            const share = await notify('share.received');
            await waitFor(() => deliveredTo(accountSub.subId, share));
            // Another app-user row about the same app still reaches the desktop.
            const ended = await notify('app.events.ended', app.uid);
            await waitFor(() => deliveredTo(desktopSub.subId, ended));
            expect(deliveredTo(desktopSub.subId, message)).toBe(false);

            const wire = send.mock.calls
                .filter(([, key]) => key === 'notif.message')
                .map(([, , data]) => JSON.stringify(data));
            expect(wire.some((one) => one.includes(message))).toBe(false);
            expect(wire.some((one) => one.includes(share))).toBe(true);

            const fetched = async (actor: Actor, subject: string) =>
                (await events.fetchMissed(actor, { subject })).items.map(
                    (item) => item.uid,
                );
            expect(await fetched(state.actor, 'notif:app-user')).not.toContain(
                message,
            );
            expect(await fetched(appActor(app), 'notif:app-user')).toContain(
                message,
            );
        } finally {
            send.mockRestore();
            for (const socketId of [
                'app-message-desktop',
                'app-message-account',
                'app-message-app',
            ])
                await events.reapSocket(state.userId, socketId);
        }
    });
});
