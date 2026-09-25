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
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

/**
 * The vendor-compatible wire routes are subscriber-only, over real HTTP.
 *
 * The gate's decision is unit-tested in
 * `services/metering/enforcement.test.ts`; what this covers is that the route
 * option reaches the middleware chain on these four routes, that it sits behind
 * the credential gates (a session token is still turned away for being the
 * wrong credential, not for the plan), and that the model catalogue stays open
 * — clients fetch it before they have any reason to have authenticated at all.
 */
describe('AI wire routes require a subscription', () => {
    let env: PuterTestEnv;

    const WIRE_ROUTES = [
        '/puterai/openai/v1/chat/completions',
        '/puterai/openai/v1/completions',
        '/puterai/openai/v1/responses',
        '/puterai/anthropic/v1/messages',
    ];

    /**
     * The plan the test user is on. A single resolver reads this, since
     * resolvers are registered for the life of the service and can't be taken
     * back off — flipping a variable is what keeps one test's plan out of the
     * next one's.
     */
    let plan: string | null = null;
    let userUuid = '';

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        const row = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        userUuid = row!.uuid;
        // Paid plans are registered by an extension in production, so a
        // resolver alone resolves to nothing here — the policy has to exist
        // for the id to be found.
        env.server.services.metering.registerPolicy({
            id: 'business',
            monthUsageAllowance: 45 * 1_000_000 * 100,
            monthlyStorageAllowance: 1024 ** 3,
        });
        env.server.services.metering.registerSubscriptionResolver((actor) =>
            actor.user?.uuid === userUuid ? plan : null,
        );
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const call = (route: string, token: string) =>
        fetch(new URL(route, env.apiOrigin), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                Origin: env.apiOrigin,
            },
            body: JSON.stringify({
                model: 'fake',
                provider: 'fake-chat',
                prompt: 'hi',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 16,
            }),
        });

    /** Put the test user on a plan for the duration of one block. */
    const withSubscription = async <T>(
        id: string | null,
        fn: () => Promise<T>,
    ): Promise<T> => {
        const metering = env.server.services.metering;
        plan = id;
        metering.invalidateActorSubscription(userUuid);
        try {
            return await fn();
        } finally {
            plan = null;
            metering.invalidateActorSubscription(userUuid);
        }
    };

    it('turns a free account away with 402 subscription_required', async () => {
        for (const route of WIRE_ROUTES) {
            const res = await call(route, env.users.user.apiToken);
            expect(res.status, route).toBe(402);
            expect(await res.json(), route).toMatchObject({
                code: 'subscription_required',
            });
        }
    });

    it('lets a subscriber past the gate', async () => {
        await withSubscription('business', async () => {
            for (const route of WIRE_ROUTES) {
                const res = await call(route, env.users.user.apiToken);
                // Whether the fake provider answers is the controller's
                // business; all this asserts is that the plan gate is not
                // what stopped the request.
                expect(res.status, route).not.toBe(402);
            }
        });
    });

    it('answers a session token on credential shape, not plan', async () => {
        // Credential gates run first, so a caller with the wrong token shape
        // never learns anything about the account's plan.
        const res = await call(WIRE_ROUTES[0]!, env.users.user.token);
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({
            code: 'app_or_api_token_required',
        });
    });

    it('leaves the model catalogue open', async () => {
        const res = await fetch(new URL('/puterai/chat/models', env.apiOrigin));
        expect(res.status).toBe(200);
    });

    it('leaves the video proxy outside the plan gate', async () => {
        // Unsigned, so this is turned away on the signature — the point is
        // that a free account gets that answer rather than a 402. The proxy
        // delivers a video the account already paid to generate.
        const res = await fetch(
            new URL(
                '/puterai/video/proxy?url=https://x.test/v.mp4',
                env.apiOrigin,
            ),
        );
        expect(res.status).not.toBe(402);
    });
});
