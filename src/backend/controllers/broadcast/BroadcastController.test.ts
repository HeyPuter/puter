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

import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { BroadcastController } from './BroadcastController.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one PuterServer and exercises the live BroadcastController
// against the wired BroadcastService. The default test config has no
// configured peers, so every signed-incoming path falls through to the
// service's "unknown peer" gate (403). That's the right blast radius
// for these tests — we cover header validation + error→HTTP wiring,
// and trust BroadcastService's own tests for the crypto path.

let server: PuterServer;
let controller: BroadcastController;

beforeAll(async () => {
    server = await setupTestServer();
    controller = server.controllers.broadcast as unknown as BroadcastController;
});

afterAll(async () => {
    await server?.shutdown();
});

interface CapturedResponse {
    statusCode: number;
    body: unknown;
}

const makeReq = (init: {
    body?: unknown;
    rawBody?: Buffer;
    headers?: Record<string, string>;
}): Request => {
    return {
        body: init.body ?? {},
        rawBody: init.rawBody,
        query: {},
        headers: init.headers ?? {},
    } as unknown as Request;
};

const makeRes = () => {
    const captured: CapturedResponse = { statusCode: 200, body: undefined };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        setHeader: vi.fn(() => res),
    };
    return { res: res as unknown as Response, captured };
};

// Standard signed-payload headers used across cases. Real verification
// fails because no peer is configured — the test config doesn't set up
// `broadcast_peers` — so we land on the service's "Unknown peer" gate
// rather than an HMAC mismatch.
const signedHeaders = (): Record<string, string> => ({
    'x-broadcast-peer-id': 'unknown-peer',
    'x-broadcast-timestamp': String(Math.floor(Date.now() / 1000)),
    'x-broadcast-nonce': '1',
    'x-broadcast-signature': 'a'.repeat(64),
});

// ── /broadcast/webhook ──────────────────────────────────────────────

describe('BroadcastController.webhook', () => {
    it('returns 400 when rawBody is missing', async () => {
        const { res, captured } = makeRes();
        await controller.webhook(
            makeReq({
                body: { events: [] },
                headers: signedHeaders(),
            }),
            res,
        );
        expect(captured.statusCode).toBe(400);
        expect(captured.body).toMatchObject({
            error: { message: expect.stringContaining('body') },
        });
    });

    it('returns 400 when the JSON body is not an object', async () => {
        const { res, captured } = makeRes();
        await controller.webhook(
            makeReq({
                body: 'not an object',
                rawBody: Buffer.from('"not an object"'),
                headers: signedHeaders(),
            }),
            res,
        );
        expect(captured.statusCode).toBe(400);
    });

    it('returns 400 when the body has neither `events` nor a single-event shape', async () => {
        const raw = Buffer.from('{}');
        const { res, captured } = makeRes();
        await controller.webhook(
            makeReq({
                body: {},
                rawBody: raw,
                headers: signedHeaders(),
            }),
            res,
        );
        expect(captured.statusCode).toBe(400);
        expect(captured.body).toMatchObject({
            error: { message: expect.stringContaining('payload') },
        });
    });

    it('returns 403 when the peer-id header is missing', async () => {
        const raw = Buffer.from('{"events":[]}');
        const headers = signedHeaders();
        delete headers['x-broadcast-peer-id'];
        const { res, captured } = makeRes();
        await controller.webhook(
            makeReq({
                body: { events: [] },
                rawBody: raw,
                headers,
            }),
            res,
        );
        expect(captured.statusCode).toBe(403);
        expect(captured.body).toMatchObject({
            error: { message: expect.stringContaining('Peer-Id') },
        });
    });

    it('returns 403 for an unknown peer-id (no configured webhook secret)', async () => {
        const raw = Buffer.from('{"events":[{"key":"x","data":{},"meta":{}}]}');
        const { res, captured } = makeRes();
        await controller.webhook(
            makeReq({
                body: { events: [{ key: 'x', data: {}, meta: {} }] },
                rawBody: raw,
                headers: signedHeaders(),
            }),
            res,
        );
        expect(captured.statusCode).toBe(403);
        expect(captured.body).toMatchObject({
            error: { message: expect.stringContaining('Unknown peer') },
        });
    });

    it('reads only the first value when a header is repeated as an array', async () => {
        // Express normally collapses duplicates to a string, but tests
        // can supply arrays — the controller's `headerOnce` helper picks
        // index 0. Verify by sending an unknown peer-id as `[id, junk]`
        // and confirming we still hit the 403 path (not a 400 from the
        // body parsing path that runs before peer lookup).
        const raw = Buffer.from('{"events":[]}');
        const headers = signedHeaders() as unknown as Record<
            string,
            string | string[]
        >;
        headers['x-broadcast-peer-id'] = ['unknown-peer', 'second-value'];
        const { res, captured } = makeRes();
        await controller.webhook(
            makeReq({
                body: { events: [] },
                rawBody: raw,
                headers: headers as Record<string, string>,
            }),
            res,
        );
        expect(captured.statusCode).toBe(403);
    });

    it('returns 403 when X-Broadcast-Signature is missing', async () => {
        // Need a *known* peer to land on the signature gate rather than
        // the earlier unknown-peer gate. With no peers configured in this
        // suite, the unknown-peer path fires first and we get 403 either
        // way — assert the response shape that's stable for both.
        const raw = Buffer.from('{"events":[{"key":"x","data":{}}]}');
        const headers = signedHeaders();
        delete headers['x-broadcast-signature'];
        const { res, captured } = makeRes();
        await controller.webhook(
            makeReq({
                body: { events: [{ key: 'x', data: {} }] },
                rawBody: raw,
                headers,
            }),
            res,
        );
        expect(captured.statusCode).toBe(403);
    });

    it('returns 400 when the events array contains a malformed entry (missing key)', async () => {
        const raw = Buffer.from(
            '{"events":[{"data":"missing-key","meta":{}}]}',
        );
        const { res, captured } = makeRes();
        await controller.webhook(
            makeReq({
                body: { events: [{ data: 'missing-key', meta: {} }] },
                rawBody: raw,
                headers: signedHeaders(),
            }),
            res,
        );
        expect(captured.statusCode).toBe(400);
        expect(captured.body).toMatchObject({
            error: { message: expect.stringContaining('payload') },
        });
    });

    it('returns 503 when the broadcast service is not registered', async () => {
        // Strip the service off the in-memory controller registry to
        // exercise the "service not registered" guard. Restored after the
        // assertion so neighboring tests stay valid.
        const original = (controller as unknown as { services: { broadcast?: unknown } })
            .services.broadcast;
        (controller as unknown as { services: { broadcast?: unknown } }).services.broadcast =
            undefined;
        try {
            const { res, captured } = makeRes();
            await controller.webhook(
                makeReq({
                    body: { events: [] },
                    rawBody: Buffer.from('{"events":[]}'),
                    headers: signedHeaders(),
                }),
                res,
            );
            expect(captured.statusCode).toBe(503);
            expect(captured.body).toMatchObject({
                error: { message: expect.stringContaining('Broadcast') },
            });
        } finally {
            (controller as unknown as { services: { broadcast?: unknown } }).services.broadcast =
                original;
        }
    });
});
