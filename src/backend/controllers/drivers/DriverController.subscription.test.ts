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

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events';
import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithContext } from '../../core/context.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { configureRateLimit } from '../../core/http/middleware/rateLimit.js';
import { DriverController } from './DriverController.js';

// The subscription requirement a driver declares per method, exercised
// through `#handleCall` the same way the concurrent test does: a synthetic
// driver carrying only the field under test, plus a stub metering service
// that answers with a fixed plan.

const captureCallHandler = (controller: DriverController): RequestHandler => {
    let handler: RequestHandler | undefined;
    const fakeRouter = {
        post: (path: string, _opts: unknown, h: RequestHandler) => {
            if (path === '/call') handler = h;
            return fakeRouter;
        },
        get: () => fakeRouter,
        use: () => fakeRouter,
    };
    controller.registerRoutes(
        fakeRouter as unknown as Parameters<
            typeof controller.registerRoutes
        >[0],
    );
    if (!handler) throw new Error('failed to capture POST /call handler');
    return handler;
};

class StubRes extends EventEmitter {
    statusCode = 200;
    body: unknown = undefined;
    status(code: number) {
        this.statusCode = code;
        return this;
    }
    json(body: unknown) {
        this.body = body;
        return this;
    }
    setHeader() {
        return this;
    }
    type() {
        return this;
    }
    send() {
        return this;
    }
}

const makeReq = (method: string, tag: string): Request =>
    ({
        body: { interface: 'test-iface', method },
        actor: { user: { uuid: `u-${tag}`, username: 'u' } },
        headers: { 'user-agent': tag },
        query: {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as Request;

const syntheticDriver = {
    driverInterface: 'test-iface',
    driverName: 'test-driver',
    isDefault: true,
    requireSubscription: {
        methods: { paid: true, premium: ['business', 'pro'] },
    },
    onServerStart() {},
    onServerPrepareShutdown() {},
    onServerShutdown() {},
    free: async () => 'free-ok',
    paid: async () => 'paid-ok',
    premium: async () => 'premium-ok',
};

const buildController = (plan: string | null) => {
    const clients = { alarm: { create: () => {} } };
    const services = plan
        ? {
              metering: {
                  getActorSubscription: vi.fn().mockResolvedValue({ id: plan }),
              },
          }
        : {};
    return new DriverController(
        {} as any,
        clients as any,
        {} as any,
        services as any,
        { syntheticDriver } as any,
    );
};

const call = (plan: string | null, method: string, tag: string) => {
    const handler = captureCallHandler(buildController(plan));
    const res = new StubRes();
    return runWithContext({}, () =>
        handler(makeReq(method, tag), res as unknown as Response, () => {}),
    ).then(() => res);
};

const expect402 = (promise: Promise<unknown>) =>
    expect(promise).rejects.toSatisfy(
        (e) =>
            isHttpError(e) &&
            (e as { statusCode: number }).statusCode === 402 &&
            (e as { legacyCode?: string }).legacyCode ===
                'subscription_required',
    );

describe('DriverController — per-method subscription requirement', () => {
    beforeEach(() => {
        configureRateLimit();
    });

    it('leaves a method that declares nothing open to a free account', async () => {
        const res = await call('user_free', 'free', 'open');
        expect(res.body).toMatchObject({ success: true, result: 'free-ok' });
    });

    it('rejects a free account on a method that requires a subscription', async () => {
        await expect402(call('user_free', 'paid', 'paid-free'));
    });

    it('admits a subscriber on that same method', async () => {
        const res = await call('basic', 'paid', 'paid-sub');
        expect(res.body).toMatchObject({ success: true, result: 'paid-ok' });
    });

    it('honours a per-method plan allowlist', async () => {
        await expect402(call('basic', 'premium', 'premium-basic'));
        const res = await call('pro', 'premium', 'premium-pro');
        expect(res.body).toMatchObject({ success: true, result: 'premium-ok' });
    });

    it('enforces nothing on a deployment with no metering service', async () => {
        const res = await call(null, 'paid', 'no-metering');
        expect(res.body).toMatchObject({ success: true, result: 'paid-ok' });
    });
});
