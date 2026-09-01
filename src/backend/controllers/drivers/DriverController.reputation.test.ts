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
import { beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from '../../core/context.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { configureRateLimit } from '../../core/http/middleware/rateLimit.js';
import type { IConfig } from '../../types';
import { DriverController } from './DriverController.js';

// The reputation requirement a driver declares per method, exercised through
// `#handleCall` the same way the subscription test does: a synthetic driver
// carrying only the field under test, plus a config that says what its tiers
// are worth.

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

const makeReq = (
    method: string,
    tag: string,
    reputation: number | undefined,
): Request =>
    ({
        body: { interface: 'test-iface', method },
        actor: { user: { uuid: `u-${tag}`, username: 'u', reputation } },
        headers: { 'user-agent': tag },
        query: {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as Request;

const syntheticDriver = {
    driverInterface: 'test-iface',
    driverName: 'test-driver',
    isDefault: true,
    requireReputation: {
        methods: { gated: 'standard', strict: 'trusted', ungated: false },
    },
    onServerStart() {},
    onServerPrepareShutdown() {},
    onServerShutdown() {},
    open: async () => 'open-ok',
    ungated: async () => 'ungated-ok',
    gated: async () => 'gated-ok',
    strict: async () => 'strict-ok',
};

const buildController = (config: IConfig) =>
    new DriverController(
        config,
        { alarm: { create: () => {} } } as any,
        {} as any,
        {} as any,
        { syntheticDriver } as any,
    );

const call = (
    config: IConfig,
    method: string,
    tag: string,
    reputation?: number,
) => {
    const handler = captureCallHandler(buildController(config));
    const res = new StubRes();
    return runWithContext({}, () =>
        handler(
            makeReq(method, tag, reputation),
            res as unknown as Response,
            () => {},
        ),
    ).then(() => res);
};

const tiers = {
    reputationGate: { tiers: { standard: 60, trusted: 90 } },
} as unknown as IConfig;

const expect403 = (promise: Promise<unknown>) =>
    expect(promise).rejects.toSatisfy(
        (e) =>
            isHttpError(e) &&
            (e as { statusCode: number }).statusCode === 403 &&
            (e as { legacyCode?: string }).legacyCode === 'reputation_required',
    );

describe('DriverController — per-method reputation requirement', () => {
    beforeEach(() => {
        configureRateLimit();
    });

    it('leaves a method that declares nothing open to a low-scoring account', async () => {
        const res = await call(tiers, 'open', 'open', 10);
        expect(res.body).toMatchObject({ success: true, result: 'open-ok' });
    });

    it('leaves a method that opts out open to the same account', async () => {
        const res = await call(tiers, 'ungated', 'ungated', 10);
        expect(res.body).toMatchObject({ success: true, result: 'ungated-ok' });
    });

    it('rejects an account below the tier a method asks for', async () => {
        await expect403(call(tiers, 'gated', 'low', 30));
    });

    it('admits an account that clears it', async () => {
        const res = await call(tiers, 'gated', 'high', 70);
        expect(res.body).toMatchObject({ success: true, result: 'gated-ok' });
    });

    it('holds each method to its own tier', async () => {
        await expect403(call(tiers, 'strict', 'strict-low', 70));
        const res = await call(tiers, 'strict', 'strict-high', 95);
        expect(res.body).toMatchObject({ success: true, result: 'strict-ok' });
    });

    it('enforces nothing on a deployment that defines no tiers', async () => {
        const res = await call({} as IConfig, 'gated', 'no-tiers', 0);
        expect(res.body).toMatchObject({ success: true, result: 'gated-ok' });
    });

    it('enforces nothing once the master switch is off', async () => {
        const off = {
            reputationGate: { enabled: false, tiers: { standard: 60 } },
        } as unknown as IConfig;
        const res = await call(off, 'gated', 'switched-off', 0);
        expect(res.body).toMatchObject({ success: true, result: 'gated-ok' });
    });
});
