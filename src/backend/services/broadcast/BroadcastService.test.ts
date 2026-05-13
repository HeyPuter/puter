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

/**
 * Integration tests for BroadcastService.
 *
 * Boots a real PuterServer (mock redis + in-memory everything) wired
 * with a single peer and our own webhook identity, then exercises the
 * service directly. Axios is mocked at the module boundary so outbound
 * POSTs never leave the process — that's the only external call this
 * service makes. Per AGENTS.md: "Prefer test server over mocking deps"
 * and "mock at a real boundary (a client/external service), not within
 * the same layer you're testing."
 */

import { createHmac } from 'node:crypto';
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
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { BroadcastService } from './BroadcastService.js';

// ── axios mock ──────────────────────────────────────────────────────
//
// BroadcastService POSTs to peers via axios.request. Mock at the SDK
// boundary so the test never opens a socket.

const { axiosRequestMock } = vi.hoisted(() => ({
    axiosRequestMock: vi.fn(),
}));

vi.mock('axios', () => ({
    default: { request: axiosRequestMock },
    request: axiosRequestMock,
}));

// ── Constants ───────────────────────────────────────────────────────

const SELF_PEER_ID = 'self-node';
const SELF_SECRET = 'self-shared-secret';
const PEER_ID = 'peer-a';
const PEER_SECRET = 'peer-a-shared-secret';
const PEER_URL = 'http://broadcast-peer.invalid/broadcast/webhook';

const sign = (
    secret: string,
    timestamp: number,
    nonce: number,
    rawBody: string,
): string =>
    createHmac('sha256', secret)
        .update(`${timestamp}.${nonce}.${rawBody}`)
        .digest('hex');

const headers = (
    peerId: string,
    timestamp: number,
    nonce: number,
    signature: string,
) => ({
    peerId,
    timestamp: String(timestamp),
    nonce: String(nonce),
    signature,
});

// Pull a fresh nonce per test so replay-cache state from earlier tests
// can't collide with this one. Combines a monotonic counter with the
// current time to stay unique across the suite even after the redis
// mock's INCR diverges from local state.
let nonceCounter = 1_000_000;
const nextNonce = () => ++nonceCounter;

// ── verifyAndEmit ───────────────────────────────────────────────────

describe('BroadcastService.verifyAndEmit', () => {
    let server: PuterServer;
    let broadcast: BroadcastService;

    beforeAll(async () => {
        server = await setupTestServer({
            broadcast: {
                webhook: { peerId: SELF_PEER_ID, secret: SELF_SECRET },
                peers: [
                    {
                        peerId: PEER_ID,
                        webhook: true,
                        webhook_url: PEER_URL,
                        webhook_secret: PEER_SECRET,
                    },
                ],
                // Long flush window so the outbound timer never trips
                // during the inbound tests in this block.
                outbound_flush_ms: 60_000,
            },
        } as never);
        broadcast = server.services
            .broadcast as unknown as BroadcastService;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('rejects when rawBody is missing', async () => {
        const ts = Math.floor(Date.now() / 1000);
        const result = await broadcast.verifyAndEmit(
            undefined,
            { events: [] },
            headers(PEER_ID, ts, nextNonce(), 'a'.repeat(64)),
        );
        expect(result).toMatchObject({
            ok: false,
            status: 400,
            message: expect.stringContaining('body'),
        });
    });

    it('rejects when body is not an object', async () => {
        const ts = Math.floor(Date.now() / 1000);
        const result = await broadcast.verifyAndEmit(
            Buffer.from('"oops"'),
            'oops',
            headers(PEER_ID, ts, nextNonce(), 'a'.repeat(64)),
        );
        expect(result).toMatchObject({ ok: false, status: 400 });
    });

    it('rejects when payload is neither `events` array nor a single event', async () => {
        const raw = Buffer.from('{}');
        const result = await broadcast.verifyAndEmit(
            raw,
            {},
            headers(
                PEER_ID,
                Math.floor(Date.now() / 1000),
                nextNonce(),
                'a'.repeat(64),
            ),
        );
        expect(result).toMatchObject({
            ok: false,
            status: 400,
            message: expect.stringContaining('payload'),
        });
    });

    it('rejects an event with a missing `key` field', async () => {
        const raw = Buffer.from(
            '{"events":[{"data":"no-key-here","meta":{}}]}',
        );
        const result = await broadcast.verifyAndEmit(
            raw,
            { events: [{ data: 'no-key-here', meta: {} }] },
            headers(
                PEER_ID,
                Math.floor(Date.now() / 1000),
                nextNonce(),
                'a'.repeat(64),
            ),
        );
        expect(result).toMatchObject({ ok: false, status: 400 });
    });

    it('rejects an event whose `data` is undefined', async () => {
        // Direct object — JSON would have dropped `data: undefined`, so we
        // call the service straight without round-tripping through JSON.
        const raw = Buffer.from('{"events":[{"key":"x"}]}');
        const result = await broadcast.verifyAndEmit(
            raw,
            { events: [{ key: 'x' }] },
            headers(
                PEER_ID,
                Math.floor(Date.now() / 1000),
                nextNonce(),
                'a'.repeat(64),
            ),
        );
        expect(result).toMatchObject({ ok: false, status: 400 });
    });

    it('rejects an empty peer-id header', async () => {
        const raw = Buffer.from('{"events":[{"key":"x","data":{}}]}');
        const result = await broadcast.verifyAndEmit(
            raw,
            { events: [{ key: 'x', data: {} }] },
            headers(
                '',
                Math.floor(Date.now() / 1000),
                nextNonce(),
                'a'.repeat(64),
            ),
        );
        expect(result).toMatchObject({ ok: false, status: 403 });
    });

    it('returns `ignored: self-peer` when the peer-id matches our own webhook id', async () => {
        const raw = Buffer.from('{"events":[{"key":"x","data":{}}]}');
        const result = await broadcast.verifyAndEmit(
            raw,
            { events: [{ key: 'x', data: {} }] },
            // Even with a *valid* signature for the self-peer case we
            // want the short-circuit to fire, so build proper headers.
            (() => {
                const ts = Math.floor(Date.now() / 1000);
                const nonce = nextNonce();
                return headers(
                    SELF_PEER_ID,
                    ts,
                    nonce,
                    sign(SELF_SECRET, ts, nonce, raw.toString('utf8')),
                );
            })(),
        );
        expect(result).toMatchObject({
            ok: true,
            info: { ignored: 'self-peer' },
        });
    });

    it('rejects an unknown peer-id (no webhook secret on file)', async () => {
        const raw = Buffer.from('{"events":[{"key":"x","data":{}}]}');
        const result = await broadcast.verifyAndEmit(
            raw,
            { events: [{ key: 'x', data: {} }] },
            headers(
                'not-configured',
                Math.floor(Date.now() / 1000),
                nextNonce(),
                'a'.repeat(64),
            ),
        );
        expect(result).toMatchObject({
            ok: false,
            status: 403,
            message: expect.stringContaining('Unknown peer'),
        });
    });

    it('rejects a stale timestamp outside the replay window', async () => {
        const raw = Buffer.from('{"events":[{"key":"x","data":{}}]}');
        const ts = Math.floor(Date.now() / 1000) - 3600; // 1h in the past
        const nonce = nextNonce();
        const result = await broadcast.verifyAndEmit(
            raw,
            { events: [{ key: 'x', data: {} }] },
            headers(
                PEER_ID,
                ts,
                nonce,
                sign(PEER_SECRET, ts, nonce, raw.toString('utf8')),
            ),
        );
        expect(result).toMatchObject({
            ok: false,
            status: 400,
            message: expect.stringContaining('window'),
        });
    });

    it('rejects a malformed signature length (timing-safe compare guard)', async () => {
        const raw = Buffer.from('{"events":[{"key":"x","data":{}}]}');
        const ts = Math.floor(Date.now() / 1000);
        const result = await broadcast.verifyAndEmit(
            raw,
            { events: [{ key: 'x', data: {} }] },
            headers(PEER_ID, ts, nextNonce(), 'abcd'), // wrong length
        );
        expect(result).toMatchObject({
            ok: false,
            status: 403,
            message: expect.stringContaining('Invalid signature'),
        });
    });

    it('rejects a correctly-shaped but wrong signature', async () => {
        const raw = Buffer.from('{"events":[{"key":"x","data":{}}]}');
        const ts = Math.floor(Date.now() / 1000);
        const nonce = nextNonce();
        // Sign with the WRONG secret — same hex length, fails HMAC compare.
        const badSig = sign(
            'definitely-not-the-peer-secret',
            ts,
            nonce,
            raw.toString('utf8'),
        );
        const result = await broadcast.verifyAndEmit(
            raw,
            { events: [{ key: 'x', data: {} }] },
            headers(PEER_ID, ts, nonce, badSig),
        );
        expect(result).toMatchObject({
            ok: false,
            status: 403,
            message: expect.stringContaining('Invalid signature'),
        });
    });

    it('verifies a valid payload and re-emits each event tagged `from_outside: true`', async () => {
        const rawObj = {
            events: [
                {
                    key: 'outer.broadcast-test-a',
                    data: { hello: 'world' },
                    meta: { source: 'test' },
                },
            ],
        };
        const raw = Buffer.from(JSON.stringify(rawObj));
        const ts = Math.floor(Date.now() / 1000);
        const nonce = nextNonce();
        const sig = sign(PEER_SECRET, ts, nonce, raw.toString('utf8'));

        const seen: Array<{ key: string; data: unknown; meta: unknown }> = [];
        server.clients.event.on(
            'outer.broadcast-test-a' as never,
            (key, data, meta) => {
                seen.push({ key: key as string, data, meta });
            },
        );

        const result = await broadcast.verifyAndEmit(
            raw,
            rawObj,
            headers(PEER_ID, ts, nonce, sig),
        );
        expect(result).toMatchObject({ ok: true });

        // Listener fires synchronously inside the service, so by the time
        // verifyAndEmit resolves the event has been delivered.
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({
            key: 'outer.broadcast-test-a',
            data: { hello: 'world' },
            meta: {
                source: 'test',
                from_outside: true,
            },
        });
    });

    it('rejects a replayed (peer, ts, nonce) tuple on second presentation', async () => {
        const rawObj = {
            events: [{ key: 'outer.replay-test', data: { n: 1 } }],
        };
        const raw = Buffer.from(JSON.stringify(rawObj));
        const ts = Math.floor(Date.now() / 1000);
        const nonce = nextNonce();
        const sig = sign(PEER_SECRET, ts, nonce, raw.toString('utf8'));

        const first = await broadcast.verifyAndEmit(
            raw,
            rawObj,
            headers(PEER_ID, ts, nonce, sig),
        );
        expect(first).toMatchObject({ ok: true });

        const second = await broadcast.verifyAndEmit(
            raw,
            rawObj,
            headers(PEER_ID, ts, nonce, sig),
        );
        expect(second).toMatchObject({
            ok: false,
            status: 403,
            message: expect.stringContaining('Duplicate'),
        });
    });

    it('drops incoming events that already carry `from_outside: true` rather than bouncing them', async () => {
        const rawObj = {
            events: [
                {
                    key: 'outer.bounce-guard',
                    data: { x: 1 },
                    meta: { from_outside: true },
                },
            ],
        };
        const raw = Buffer.from(JSON.stringify(rawObj));
        const ts = Math.floor(Date.now() / 1000);
        const nonce = nextNonce();
        const sig = sign(PEER_SECRET, ts, nonce, raw.toString('utf8'));

        const seen: string[] = [];
        server.clients.event.on(
            'outer.bounce-guard' as never,
            (key) => {
                seen.push(key as string);
            },
        );

        const result = await broadcast.verifyAndEmit(
            raw,
            rawObj,
            headers(PEER_ID, ts, nonce, sig),
        );
        // The webhook itself is still accepted (the peer signed it correctly);
        // the guard is on the *re-emit* step, which silently drops the event.
        expect(result).toMatchObject({ ok: true });
        expect(seen).toHaveLength(0);
    });

    it('accepts a single-event top-level shape (no `events` array)', async () => {
        const rawObj = {
            key: 'outer.single-event',
            data: { value: 42 },
            meta: {},
        };
        const raw = Buffer.from(JSON.stringify(rawObj));
        const ts = Math.floor(Date.now() / 1000);
        const nonce = nextNonce();
        const sig = sign(PEER_SECRET, ts, nonce, raw.toString('utf8'));

        const seen: unknown[] = [];
        server.clients.event.on(
            'outer.single-event' as never,
            (_key, data) => {
                seen.push(data);
            },
        );

        const result = await broadcast.verifyAndEmit(
            raw,
            rawObj,
            headers(PEER_ID, ts, nonce, sig),
        );
        expect(result).toMatchObject({ ok: true });
        expect(seen).toEqual([{ value: 42 }]);
    });
});

// ── Outbound flush ──────────────────────────────────────────────────

describe('BroadcastService outbound flush', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer({
            broadcast: {
                webhook: { peerId: SELF_PEER_ID, secret: SELF_SECRET },
                peers: [
                    {
                        peerId: PEER_ID,
                        webhook: true,
                        webhook_url: PEER_URL,
                        webhook_secret: PEER_SECRET,
                    },
                ],
                outbound_flush_ms: 25,
            },
        } as never);
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    beforeEach(() => {
        axiosRequestMock.mockReset();
        axiosRequestMock.mockResolvedValue({
            status: 200,
            statusText: 'OK',
            data: 'ok',
        });
    });

    afterEach(() => {
        axiosRequestMock.mockReset();
    });

    /**
     * Drain currently-queued outbound events. Polls instead of using a
     * single timeout so we don't race the 25ms flush window — the timer
     * is scheduled lazily and "no calls yet" doesn't mean "no calls
     * coming."
     */
    const waitForFlush = async (predicate: () => boolean, timeoutMs = 1000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (predicate()) return;
            await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error('Timed out waiting for outbound flush');
    };

    const findCallByEventKey = (eventKey: string) => {
        return axiosRequestMock.mock.calls.find((call) => {
            const body = (call[0] as { data?: string } | undefined)?.data;
            if (typeof body !== 'string') return false;
            return body.includes(`"${eventKey}"`);
        });
    };

    it('coalesces and signs outbound `outer.*` events with the right headers', async () => {
        server.clients.event.emit(
            'outer.fs.write-hash' as never,
            { hash: 'h1', uuid: 'u1' } as never,
            {},
        );

        await waitForFlush(() => !!findCallByEventKey('outer.fs.write-hash'));

        const call = findCallByEventKey('outer.fs.write-hash');
        expect(call).toBeDefined();
        const request = call![0] as {
            method: string;
            url: string;
            data: string;
            headers: Record<string, string>;
        };
        expect(request.method).toBe('POST');
        // `#normalizeWebhookUrl` coerces the URL's protocol to the
        // service's configured outbound protocol (https by default).
        expect(request.url).toContain('broadcast-peer.invalid');
        expect(request.headers['X-Broadcast-Peer-Id']).toBe(SELF_PEER_ID);
        expect(request.headers['X-Broadcast-Timestamp']).toMatch(/^\d+$/);
        expect(request.headers['X-Broadcast-Nonce']).toMatch(/^\d+$/);
        expect(request.headers['X-Broadcast-Signature']).toMatch(/^[a-f0-9]{64}$/);

        const ts = Number(request.headers['X-Broadcast-Timestamp']);
        const nonce = Number(request.headers['X-Broadcast-Nonce']);
        const expected = sign(SELF_SECRET, ts, nonce, request.data);
        expect(request.headers['X-Broadcast-Signature']).toBe(expected);

        // Parse body and confirm our event is in there.
        const parsed = JSON.parse(request.data) as {
            events: { key: string; data: unknown }[];
        };
        const ours = parsed.events.find(
            (e) => e.key === 'outer.fs.write-hash',
        );
        expect(ours).toBeDefined();
        expect(ours!.data).toMatchObject({ hash: 'h1', uuid: 'u1' });
    });

    it('skips events that arrived from outside (meta.from_outside)', async () => {
        // Emit an event marked as already-broadcast — outbound handler
        // must drop it so we don't bounce peer traffic.
        server.clients.event.emit(
            'outer.fs.write-hash' as never,
            { hash: 'h2', uuid: 'u2' } as never,
            { from_outside: true },
        );

        // Give the flush timer time to fire even if it has nothing to send.
        await new Promise((r) => setTimeout(r, 100));
        expect(findCallByEventKey('outer.fs.write-hash')).toBeUndefined();
    });

    it('dedupes identical outbound events emitted in the same flush window', async () => {
        // Same key/data/meta tuple three times — should serialize once.
        for (let i = 0; i < 3; i++) {
            server.clients.event.emit(
                'outer.cacheUpdate' as never,
                { cacheKey: ['dedupe-test'] } as never,
                {},
            );
        }

        await waitForFlush(() => !!findCallByEventKey('outer.cacheUpdate'));

        // Look at every flush that carried our key — across all of them,
        // the event should appear exactly once total (coalesced).
        const occurrences = axiosRequestMock.mock.calls.reduce(
            (count, call) => {
                const body = (call[0] as { data?: string } | undefined)?.data;
                if (typeof body !== 'string') return count;
                const parsed = JSON.parse(body) as {
                    events: { key: string; data: unknown }[];
                };
                return (
                    count +
                    parsed.events.filter(
                        (e) =>
                            e.key === 'outer.cacheUpdate' &&
                            Array.isArray(
                                (e.data as { cacheKey?: unknown }).cacheKey,
                            ) &&
                            (
                                e.data as { cacheKey: string[] }
                            ).cacheKey.includes('dedupe-test'),
                    ).length
                );
            },
            0,
        );
        expect(occurrences).toBe(1);
    });
});
