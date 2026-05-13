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

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events';
import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from '../../core/context.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { configureRateLimit } from '../../core/http/middleware/rateLimit.js';
import { DriverController } from './DriverController.js';

// Focused integration coverage for the concurrent-acquire path inside
// `#handleCall`. The main DriverController.test.ts boots the full
// PuterServer, but exercising concurrent-slot behaviour through real
// drivers requires real provider machinery — too much for a unit test.
// Here we instantiate the controller directly with a synthetic driver
// that carries the only field we care about (`concurrent`), then drive
// `#handleCall` through the same captureRoutes trick the main file uses.

// ── Test harness ────────────────────────────────────────────────────

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

// `res.once('finish'|'close')` is the trigger for slot release, so the
// stub must actually be an EventEmitter — that's the contract the
// controller relies on.
class StubRes extends EventEmitter {
    statusCode = 200;
    body: unknown = undefined;
    headers: Record<string, string> = {};
    sentBody: string | undefined;
    contentType: string | undefined;
    status(code: number) {
        this.statusCode = code;
        return this;
    }
    json(body: unknown) {
        this.body = body;
        return this;
    }
    setHeader(key: string, value: string) {
        this.headers[key.toLowerCase()] = value;
        return this;
    }
    type(t: string) {
        this.contentType = t;
        return this;
    }
    send(body: string) {
        this.sentBody = body;
        return this;
    }
}

// Memory-backend counters are module-level state that persists across
// tests. To avoid one test's held slot leaking into the next we vary
// the request fingerprint per test (the helper keys off
// `req.actor?.user?.uuid || fingerprint(req)`, where fingerprint mixes
// IP + UA + accept headers).
const makeReq = (
    body: Record<string, unknown> = {},
    fingerprintTag = 'default',
): Request =>
    ({
        body,
        // Anonymous — `#handleCall` skips the permission gate when there's no
        // actor, which keeps this test focused on the concurrent path.
        actor: undefined,
        headers: { 'user-agent': fingerprintTag },
        query: {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as Request;

// Synthetic driver with a single-slot `concurrent` cap. `ping` doesn't
// touch the network; it just returns a string so the controller can
// json-respond.
const makeSyntheticDriver = () => ({
    driverInterface: 'test-iface',
    driverName: 'test-driver',
    isDefault: true,
    concurrent: {
        default: { limit: 1 },
    },
    onServerStart() {},
    onServerPrepareShutdown() {},
    onServerShutdown() {},
    ping: async () => 'pong',
});

const buildController = (driver: ReturnType<typeof makeSyntheticDriver>) => {
    // The controller reads `this.services?.permission` only when an actor
    // is on the request; otherwise the services bag is unused. Empty
    // objects are sufficient for this path.
    return new DriverController(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { syntheticDriver: driver } as any,
    );
};

// ── Tests ───────────────────────────────────────────────────────────

describe('DriverController — concurrent acquire/release', () => {
    beforeEach(() => {
        // Memory backend is sufficient and avoids cross-test redis state.
        configureRateLimit();
    });

    // `#handleCall` writes to Context (e.g. `driverName`) which requires
    // a request scope — same as the main test file does.
    const callInScope = (
        handler: RequestHandler,
        req: Request,
        res: Response,
    ) => runWithContext({}, () => handler(req, res, () => {}));

    it('admits a call up to the per-method concurrent limit', async () => {
        const controller = buildController(makeSyntheticDriver());
        const handler = captureCallHandler(controller);

        const res = new StubRes();
        await callInScope(
            handler,
            makeReq({ interface: 'test-iface', method: 'ping' }, 'admit'),
            res as unknown as Response,
        );
        // Slot freed before next test runs.
        res.emit('finish');

        // Driver method ran and produced the wrapped envelope.
        expect(res.body).toMatchObject({
            success: true,
            result: 'pong',
            service: { name: 'test-driver' },
        });
    });

    it("rejects a second concurrent call with 429 while the first slot is still held", async () => {
        const controller = buildController(makeSyntheticDriver());
        const handler = captureCallHandler(controller);

        // First call admits and finishes synchronously — but we DO NOT
        // emit `finish`/`close`, so its slot stays held.
        const res1 = new StubRes();
        await callInScope(
            handler,
            makeReq({ interface: 'test-iface', method: 'ping' }, 'reject'),
            res1 as unknown as Response,
        );

        try {
            // Second call must throw a 429 — slot is full.
            await expect(
                callInScope(
                    handler,
                    makeReq(
                        { interface: 'test-iface', method: 'ping' },
                        'reject',
                    ),
                    new StubRes() as unknown as Response,
                ),
            ).rejects.toSatisfy(
                (e) =>
                    isHttpError(e) &&
                    (e as { statusCode: number }).statusCode === 429,
            );
        } finally {
            // Clean up so the held slot doesn't pin the bucket on subsequent
            // suites that reuse the same fingerprint.
            res1.emit('finish');
            await new Promise((r) => setImmediate(r));
        }
    });

    it("releases the slot on res 'finish' so the next caller is admitted", async () => {
        const controller = buildController(makeSyntheticDriver());
        const handler = captureCallHandler(controller);

        const res1 = new StubRes();
        await callInScope(
            handler,
            makeReq({ interface: 'test-iface', method: 'ping' }, 'finish'),
            res1 as unknown as Response,
        );
        // Emulate response completion.
        res1.emit('finish');
        // The release path uses `Promise.resolve().then(...)`, so flush
        // the microtask queue before re-attempting.
        await new Promise((r) => setImmediate(r));

        // A fresh call must now succeed.
        const res2 = new StubRes();
        await callInScope(
            handler,
            makeReq({ interface: 'test-iface', method: 'ping' }, 'finish'),
            res2 as unknown as Response,
        );
        res2.emit('finish');
        expect(res2.body).toMatchObject({ success: true, result: 'pong' });
    });

    it("releases on 'close' too — aborted requests don't pin the slot", async () => {
        const controller = buildController(makeSyntheticDriver());
        const handler = captureCallHandler(controller);

        const res1 = new StubRes();
        await callInScope(
            handler,
            makeReq({ interface: 'test-iface', method: 'ping' }, 'abort'),
            res1 as unknown as Response,
        );
        // Simulate the client closing the connection mid-flight.
        res1.emit('close');
        await new Promise((r) => setImmediate(r));

        const res2 = new StubRes();
        await callInScope(
            handler,
            makeReq({ interface: 'test-iface', method: 'ping' }, 'abort'),
            res2 as unknown as Response,
        );
        res2.emit('finish');
        expect(res2.body).toMatchObject({ success: true, result: 'pong' });
    });

    it('does not attach release listeners when the driver declares no concurrent config', async () => {
        // The optimisation that lets the existing test stubs in
        // DriverController.test.ts get away without an EventEmitter-shaped
        // `res`: skip the once() wiring entirely when there's no spec.
        const driver = makeSyntheticDriver();
        (driver as { concurrent?: unknown }).concurrent = undefined;
        const controller = buildController(driver);
        const handler = captureCallHandler(controller);

        // Bare object with no event-emitter surface — exposes the bug
        // case where the gate would try to call `res.once`.
        const bareRes = {
            statusCode: 200,
            body: undefined as unknown,
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            json(body: unknown) {
                this.body = body;
                return this;
            },
            setHeader() {
                return this;
            },
            type() {
                return this;
            },
            send() {
                return this;
            },
        };

        await callInScope(
            handler,
            makeReq({ interface: 'test-iface', method: 'ping' }, 'no-spec'),
            bareRes as unknown as Response,
        );
        expect(bareRes.body).toMatchObject({ success: true, result: 'pong' });
    });
});
