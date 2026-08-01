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

import { afterEach, describe, expect, it } from 'vitest';
import { EventClient } from '../clients/event/EventClient.ts';
import type { IConfig } from '../types';
import {
    resolvePrivateLaunchAccess,
    type PrivateLaunchDecision,
} from './privateLaunchAccess.ts';

const EVENT_KEY = 'app.privateAccess.resolveLaunch';

interface LaunchEventPayload {
    appUid?: string;
    appName?: string;
    userUid: string | null;
    source: string;
    args: unknown;
    result: PrivateLaunchDecision;
}

// A real EventClient (no server needed) so the emit/await plumbing under
// test is the production one; only the *listener* is a fixture.
const makeEventClient = () => new EventClient({} as IConfig);

const privateApp = { uid: 'app-1', name: 'secret app', is_private: true };

const call = (
    eventClient: EventClient | undefined,
    app: unknown = privateApp,
) =>
    resolvePrivateLaunchAccess({
        app: app as { uid?: string; name?: string; is_private?: boolean },
        eventClient,
        userUid: 'user-uid-1',
        source: 'launch_app',
        args: { path: '/foo' },
    });

describe('resolvePrivateLaunchAccess', () => {
    const registered: Array<() => void> = [];

    afterEach(() => {
        while (registered.length) registered.pop()!();
    });

    const listen = (
        client: EventClient,
        fn: (payload: LaunchEventPayload) => void,
    ) => {
        const handler = (_key: unknown, data: unknown) => {
            fn(data as LaunchEventPayload);
        };
        client.on(EVENT_KEY, handler as never);
        registered.push(() => client.off(EVENT_KEY, handler as never));
    };

    it('short-circuits public apps without emitting anything', async () => {
        const client = makeEventClient();
        let emitted = false;
        listen(client, () => {
            emitted = true;
        });

        expect(
            await call(client, { uid: 'a', name: 'pub', is_private: false }),
        ).toEqual({ hasAccess: true, checkedBy: 'core/public-app' });
        expect(emitted).toBe(false);
    });

    it('treats a missing app the same as a public one', async () => {
        expect(await call(makeEventClient(), null)).toEqual({
            hasAccess: true,
            checkedBy: 'core/public-app',
        });
        expect(
            await resolvePrivateLaunchAccess({
                app: undefined,
                eventClient: makeEventClient(),
                userUid: null,
                source: 'launch_app',
                args: undefined,
            }),
        ).toEqual({
            hasAccess: true,
            checkedBy: 'core/public-app',
        });
    });

    it('denies a private app when no event client is wired up', async () => {
        expect(await call(undefined)).toEqual({
            hasAccess: false,
            fallbackAppName: 'app-center',
            fallbackArgs: { path: '/app/secret%20app' },
            reason: 'private-access-event-service-unavailable',
            checkedBy: 'core/private-launch-access',
        });
    });

    it('hands the listener the app, user and launch context', async () => {
        const client = makeEventClient();
        let seen: LaunchEventPayload | undefined;
        listen(client, (payload) => {
            seen = payload;
        });

        await call(client);

        expect(seen).toMatchObject({
            appUid: 'app-1',
            appName: 'secret app',
            userUid: 'user-uid-1',
            source: 'launch_app',
            args: { path: '/foo' },
        });
        // The default the listener is expected to overwrite.
        expect(seen?.result).toMatchObject({
            hasAccess: false,
            reason: 'private-access-required',
        });
    });

    it('denies with the pre-seeded default when no listener answers', async () => {
        expect(await call(makeEventClient())).toEqual({
            hasAccess: false,
            fallbackAppName: 'app-center',
            fallbackArgs: { path: '/app/secret%20app' },
            reason: 'private-access-required',
            checkedBy: 'core/private-launch-access',
        });
    });

    it('grants access and drops fallback fields when a listener allows', async () => {
        const client = makeEventClient();
        listen(client, (payload) => {
            payload.result = {
                hasAccess: true,
                reason: 'purchased',
                checkedBy: 'marketplace',
                fallbackAppName: 'ignored',
            };
        });

        expect(await call(client)).toEqual({
            hasAccess: true,
            reason: 'purchased',
            checkedBy: 'marketplace',
        });
    });

    it('normalizes non-string reason/checkedBy on a grant to undefined', async () => {
        const client = makeEventClient();
        listen(client, (payload) => {
            payload.result = {
                hasAccess: true,
                reason: 42,
                checkedBy: {},
            } as unknown as PrivateLaunchDecision;
        });

        expect(await call(client)).toEqual({
            hasAccess: true,
            reason: undefined,
            checkedBy: undefined,
        });
    });

    it('keeps a listener-supplied fallback app and path on denial', async () => {
        const client = makeEventClient();
        listen(client, (payload) => {
            payload.result = {
                hasAccess: false,
                fallbackAppName: '  storefront  ',
                fallbackArgs: { path: '  /buy/secret  ' },
                reason: 'not-purchased',
                checkedBy: 'marketplace',
            };
        });

        expect(await call(client)).toEqual({
            hasAccess: false,
            fallbackAppName: 'storefront',
            fallbackArgs: { path: '/buy/secret' },
            reason: 'not-purchased',
            checkedBy: 'marketplace',
        });
    });

    it('falls back to app-center and the derived path when the denial is under-specified', async () => {
        const client = makeEventClient();
        listen(client, (payload) => {
            payload.result = {
                hasAccess: false,
                fallbackAppName: '   ',
                fallbackArgs: { path: '   ' },
            } as PrivateLaunchDecision;
        });

        expect(await call(client)).toEqual({
            hasAccess: false,
            fallbackAppName: 'app-center',
            fallbackArgs: { path: '/app/secret%20app' },
            reason: undefined,
            checkedBy: undefined,
        });
    });

    it('denies when a listener replaces the result with a non-object', async () => {
        const client = makeEventClient();
        listen(client, (payload) => {
            (payload as { result: unknown }).result = 'nope';
        });

        expect(await call(client)).toMatchObject({
            hasAccess: false,
            reason: 'invalid-private-access-result',
        });
    });

    it('falls back to a bare /app path when the app has no usable name', async () => {
        const decision = await resolvePrivateLaunchAccess({
            app: { uid: 'app-2', name: '   ', is_private: true },
            eventClient: undefined,
            userUid: null,
            source: 'launch_app',
            args: undefined,
        });
        expect(decision.fallbackArgs).toEqual({ path: '/app' });
    });

    it('denies when the event bus itself fails', async () => {
        // Listener errors are swallowed by EventClient, so the only way to
        // reach this branch is the bus rejecting — stub that boundary.
        const broken = {
            emitAndWait: async () => {
                throw new Error('bus down');
            },
        } as unknown as EventClient;

        expect(await call(broken)).toEqual({
            hasAccess: false,
            fallbackAppName: 'app-center',
            fallbackArgs: { path: '/app/secret%20app' },
            reason: 'private-access-check-error',
            checkedBy: 'core/private-launch-access',
        });
    });
});
