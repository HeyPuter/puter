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

import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import type { Actor } from '../../core/actor.js';
import {
    CONCURRENT_SLOT_TTL_MS,
    acquireConcurrent,
} from '../../core/http/middleware/rateLimit.js';
import { readProviderKey } from '../../drivers/util/providerRegistry.js';
import type { UsageInput } from '../metering/types.js';
import { decideSocketAuth } from '../socket/SocketService.js';
import { PuterService } from '../types.js';

export const REALTIME_PATH = '/puterai/openai/v1/realtime';
const UPSTREAM_URL = 'wss://api.openai.com/v1/realtime';

/** Micro-cents per token (1 USD per 1M tokens = 100). */
interface RealtimeModelPrice {
    textIn: number;
    textCached: number;
    textOut: number;
    audioIn: number;
    audioCached: number;
    audioOut: number;
    imageIn: number;
    imageCached: number;
}

const FULL_PRICE: RealtimeModelPrice = {
    textIn: 400,
    textCached: 40,
    textOut: 2400,
    audioIn: 3200,
    audioCached: 40,
    audioOut: 6400,
    imageIn: 500,
    imageCached: 50,
};
const FULL_PRICE_V1 = { ...FULL_PRICE, textOut: 1600 };
const MINI_PRICE: RealtimeModelPrice = {
    textIn: 60,
    textCached: 6,
    textOut: 240,
    audioIn: 1000,
    audioCached: 30,
    audioOut: 2000,
    imageIn: 80,
    imageCached: 8,
};

export const REALTIME_MODELS: Record<string, RealtimeModelPrice> = {
    'gpt-realtime-2.1': FULL_PRICE,
    'gpt-realtime-2.1-mini': MINI_PRICE,
    'gpt-realtime-2': FULL_PRICE,
    'gpt-realtime-1.5': FULL_PRICE_V1,
    'gpt-realtime': FULL_PRICE_V1,
    'gpt-realtime-mini': MINI_PRICE,
};
export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1-mini';

/** The `usage` object OpenAI attaches to `response.done`. */
export interface RealtimeUsage {
    input_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
        image_tokens?: number;
        cached_tokens_details?: {
            text_tokens?: number;
            audio_tokens?: number;
            image_tokens?: number;
        };
    };
    output_token_details?: { text_tokens?: number; audio_tokens?: number };
}

const OPENAI_KEY_PROTOCOL = 'openai-insecure-api-key.';
const MAX_CLIENT_PAYLOAD = 16 * 1024 * 1024;
const MAX_PENDING_BYTES = 32 * 1024 * 1024;
const MAX_CLIENT_BUFFERED = 64 * 1024 * 1024;
const UPSTREAM_HANDSHAKE_MS = 10_000;
const STATS_INTERVAL_MS = 30_000;
const DEFAULT_MAX_PER_USER = 20;

/**
 * The credential a realtime client presents, in the places OpenAI's own clients
 * put it: an `Authorization` header (server SDKs), an
 * `openai-insecure-api-key.<token>` subprotocol (browsers), or `auth_token`.
 */
export const realtimeTokenFrom = (
    req: IncomingMessage,
    url: URL,
): string | undefined => {
    const header = req.headers.authorization;
    if (typeof header === 'string' && /^Bearer\s+\S/i.test(header)) {
        return header.replace(/^Bearer\s+/i, '').trim();
    }
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map((p) => p.trim());
    const keyProtocol = protocols.find((p) =>
        p.startsWith(OPENAI_KEY_PROTOCOL),
    );
    if (keyProtocol) return keyProtocol.slice(OPENAI_KEY_PROTOCOL.length);
    return url.searchParams.get('auth_token') || undefined;
};

/** Usage rows for one `response.done`, priced from the model's table. */
export const realtimeUsageRows = (
    model: string,
    usage: RealtimeUsage | undefined,
): UsageInput[] => {
    const price = REALTIME_MODELS[model];
    if (!price || !usage) return [];
    const input = usage.input_token_details ?? {};
    const cached = input.cached_tokens_details ?? {};
    const output = usage.output_token_details ?? {};
    const n = (v: number | undefined) =>
        typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    const counts: [string, number, number][] = [
        [
            'text_input',
            n(input.text_tokens) - n(cached.text_tokens),
            price.textIn,
        ],
        ['text_cached', n(cached.text_tokens), price.textCached],
        [
            'audio_input',
            n(input.audio_tokens) - n(cached.audio_tokens),
            price.audioIn,
        ],
        ['audio_cached', n(cached.audio_tokens), price.audioCached],
        [
            'image_input',
            n(input.image_tokens) - n(cached.image_tokens),
            price.imageIn,
        ],
        ['image_cached', n(cached.image_tokens), price.imageCached],
        ['text_output', n(output.text_tokens), price.textOut],
        ['audio_output', n(output.audio_tokens), price.audioOut],
    ];
    return counts
        .filter(([, amount]) => amount > 0)
        .map(([kind, amount, ucents]) => ({
            usageType: `openai:${model}:realtime:${kind}`,
            usageAmount: amount,
            costOverride: amount * ucents,
        }));
};

/** An error event in OpenAI's realtime shape. */
const errorEvent = (code: string, message: string): string =>
    JSON.stringify({
        type: 'error',
        event_id: `event_puter_${Date.now()}`,
        error: {
            type: 'invalid_request_error',
            code,
            message,
            param: null,
            event_id: null,
        },
    });

/**
 * Relays OpenAI's Realtime API over WebSocket at `REALTIME_PATH` on the api
 * host, one upstream connection per client connection. Frames pass through
 * untouched in both directions; only `response.done` is parsed, to meter its
 * usage.
 *
 * The client socket is accepted before authenticating: socket.io ends any
 * upgrade that hasn't written a byte within a second, which an auth lookup
 * under load can miss. Failures arrive as an `error` event and a 1008 close.
 * Limits, quirks and load-testing notes are in this directory's README.
 */
export class OpenAIRealtimeRelayService extends PuterService {
    #wss: WebSocketServer | null = null;
    #statsTimer: ReturnType<typeof setInterval> | null = null;
    #loopDelay: IntervalHistogram | null = null;
    #sessions = new Set<{ close: (code: number, reason: string) => void }>();
    #stats = {
        opened: 0,
        closed: 0,
        rejected: 0,
        upstreamFailed: 0,
        connectMsTotal: 0,
        connectCount: 0,
        framesUp: 0,
        framesDown: 0,
        bytesUp: 0,
        bytesDown: 0,
    };

    attachHttpServer(server: HttpServer): void {
        this.#wss = new WebSocketServer({
            noServer: true,
            maxPayload: MAX_CLIENT_PAYLOAD,
            perMessageDeflate: false,
            // Echo `realtime` so browsers that offered OpenAI's protocols
            // accept the handshake; the key protocol is never echoed.
            handleProtocols: (protocols) =>
                protocols.has('realtime') ? 'realtime' : false,
        });
        const domain = (this.config.domain ?? '').toLowerCase().trim();
        const apiHost = `api.${domain}`;

        server.on('upgrade', (req: IncomingMessage, socket: Duplex, head) => {
            const url = new URL(req.url ?? '/', 'http://placeholder');
            if (url.pathname !== REALTIME_PATH) return;
            const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
            if (!domain || host !== apiHost) {
                socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
                return;
            }
            this.#wss!.handleUpgrade(req, socket, head, (client) => {
                this.#runSession(client, req, url).catch((err: unknown) => {
                    console.warn('[realtime] session setup failed', err);
                    client.close(1011, 'internal error');
                });
            });
        });

        this.#loopDelay = monitorEventLoopDelay({ resolution: 10 });
        this.#loopDelay.enable();
        this.#statsTimer = setInterval(
            () => this.#logStats(),
            STATS_INTERVAL_MS,
        );
        this.#statsTimer.unref?.();
    }

    override onServerPrepareShutdown(): void {
        if (this.#statsTimer) clearInterval(this.#statsTimer);
        this.#loopDelay?.disable();
        for (const session of this.#sessions) {
            session.close(1001, 'server shutting down');
        }
        this.#wss?.close();
    }

    /**
     * Counters for this node, cumulative since boot, plus event-loop delay (ms)
     * and memory (MiB) sampled since the previous stats line.
     */
    stats() {
        const ns = (v: number | undefined) =>
            Math.round(((v ?? 0) / 1e6) * 10) / 10;
        const mem = process.memoryUsage();
        return {
            active: this.#sessions.size,
            ...this.#stats,
            loopP50Ms: ns(this.#loopDelay?.percentile(50)),
            loopP99Ms: ns(this.#loopDelay?.percentile(99)),
            loopMaxMs: ns(this.#loopDelay?.max),
            rssMb: Math.round(mem.rss / 1048576),
            heapMb: Math.round(mem.heapUsed / 1048576),
        };
    }

    #logStats(): void {
        const s = this.stats();
        if (s.active === 0 && s.opened === 0) return;
        const avgConnect = s.connectCount
            ? Math.round(s.connectMsTotal / s.connectCount)
            : 0;
        console.info(
            `[realtime] active=${s.active} opened=${s.opened} closed=${s.closed} rejected=${s.rejected} upstreamFailed=${s.upstreamFailed} avgUpstreamConnectMs=${avgConnect} framesUp=${s.framesUp} framesDown=${s.framesDown} bytesUp=${s.bytesUp} bytesDown=${s.bytesDown} loopP50Ms=${s.loopP50Ms} loopP99Ms=${s.loopP99Ms} loopMaxMs=${s.loopMaxMs} rssMb=${s.rssMb} heapMb=${s.heapMb}`,
        );
        this.#loopDelay?.reset();
    }

    async #runSession(
        client: WebSocket,
        req: IncomingMessage,
        url: URL,
    ): Promise<void> {
        // Buffer what the client sends while auth and the upstream handshake
        // run; OpenAI clients send `session.update` immediately on open.
        const pending: { data: RawData; isBinary: boolean }[] = [];
        let pendingBytes = 0;
        let upstream: WebSocket | null = null;
        let closed = false;
        const slots: { release: () => Promise<void> }[] = [];
        let renewTimer: ReturnType<typeof setInterval> | null = null;

        const session = {
            close: (code: number, reason: string) => {
                if (closed) return;
                closed = true;
                this.#sessions.delete(session);
                this.#stats.closed++;
                if (renewTimer) clearInterval(renewTimer);
                void Promise.all(slots.map((s) => s.release()));
                if (client.readyState === WebSocket.OPEN) {
                    client.close(code, reason);
                }
                if (
                    upstream &&
                    (upstream.readyState === WebSocket.OPEN ||
                        upstream.readyState === WebSocket.CONNECTING)
                ) {
                    upstream.terminate();
                }
            },
        };
        this.#sessions.add(session);
        this.#stats.opened++;

        const reject = (code: string, message: string) => {
            this.#stats.rejected++;
            if (client.readyState === WebSocket.OPEN) {
                client.send(errorEvent(code, message));
            }
            session.close(1008, code);
        };

        client.on('message', (data, isBinary) => {
            this.#stats.framesUp++;
            const size = (data as Buffer).length ?? 0;
            this.#stats.bytesUp += size;
            if (upstream?.readyState === WebSocket.OPEN) {
                upstream.send(data, { binary: isBinary });
                return;
            }
            pendingBytes += size;
            if (pendingBytes > MAX_PENDING_BYTES) {
                reject(
                    'buffer_exceeded',
                    'Too much data sent before the session opened',
                );
                return;
            }
            pending.push({ data, isBinary });
        });
        client.on('close', (code) =>
            session.close(code === 1005 || code === 1006 ? 1000 : code, ''),
        );
        client.on('error', () => session.close(1011, 'client error'));

        const model = url.searchParams.get('model') || DEFAULT_REALTIME_MODEL;
        if (!REALTIME_MODELS[model]) {
            reject(
                'model_not_found',
                `Model '${model}' is not available for realtime`,
            );
            return;
        }

        const actor = await this.#authenticate(req, url).catch(
            (): null => null,
        );
        if (closed) return;
        if (!actor) {
            reject('invalid_api_key', 'Authentication failed');
            return;
        }
        if (
            !(await this.services.metering.hasEnoughCredits(actor, 1_000_000))
        ) {
            reject('insufficient_funds', 'No usage left for request');
            return;
        }
        if (closed) return;

        const userId = actor.user!.uuid;
        const slot = await acquireConcurrent(
            `realtime:conn:${userId}`,
            this.config.realtime?.maxConnectionsPerUser ?? DEFAULT_MAX_PER_USER,
        );
        if (closed) {
            await slot.release();
            return;
        }
        slots.push(slot);
        if (!slot.ok) {
            reject(
                'rate_limit_exceeded',
                'Too many concurrent realtime sessions',
            );
            return;
        }
        renewTimer = setInterval(
            () => void slot.renew(),
            Math.floor(CONCURRENT_SLOT_TTL_MS / 3),
        );
        renewTimer.unref?.();

        const providers = this.config.providers ?? {};
        const apiKey = readProviderKey(
            providers['openai-realtime'],
            providers['openai-completion'],
            providers['openai'],
        );
        if (!apiKey) {
            reject('provider_unavailable', 'Realtime is not configured');
            return;
        }

        const connectStart = Date.now();
        upstream = new WebSocket(
            `${this.config.realtime?.upstreamUrl ?? UPSTREAM_URL}?model=${encodeURIComponent(model)}`,
            {
                headers: { Authorization: `Bearer ${apiKey}` },
                handshakeTimeout: UPSTREAM_HANDSHAKE_MS,
                perMessageDeflate: false,
            },
        );
        const up = upstream;

        up.on('open', () => {
            this.#stats.connectMsTotal += Date.now() - connectStart;
            this.#stats.connectCount++;
            for (const { data, isBinary } of pending) {
                up.send(data, { binary: isBinary });
            }
            pending.length = 0;
            pendingBytes = 0;
        });
        up.on('message', (data, isBinary) => {
            const buf = data as Buffer;
            this.#stats.framesDown++;
            this.#stats.bytesDown += buf.length;
            if (client.readyState !== WebSocket.OPEN) return;
            if (client.bufferedAmount > MAX_CLIENT_BUFFERED) {
                session.close(1008, 'client too slow');
                return;
            }
            client.send(buf, { binary: isBinary });
            if (!isBinary && buf.subarray(0, 64).includes('"response.done"')) {
                this.#meter(actor, model, buf, () =>
                    reject('insufficient_funds', 'No usage left for request'),
                );
            }
        });
        up.on('unexpected-response', (_req, res) => {
            this.#stats.upstreamFailed++;
            console.warn(
                `[realtime] upstream rejected: HTTP ${res.statusCode}`,
            );
            if (client.readyState === WebSocket.OPEN) {
                client.send(
                    errorEvent(
                        'upstream_error',
                        `Upstream returned HTTP ${res.statusCode}`,
                    ),
                );
            }
            session.close(1011, 'upstream error');
        });
        up.on('error', (err) => {
            // Our own terminate() of a half-open upstream also lands here.
            if (closed) return;
            if (up.readyState !== WebSocket.OPEN) this.#stats.upstreamFailed++;
            console.warn('[realtime] upstream error', err.message);
            session.close(1011, 'upstream error');
        });
        up.on('close', (code, reason) => {
            session.close(
                code === 1005 || code === 1006 ? 1011 : code,
                reason.toString().slice(0, 120),
            );
        });
    }

    #meter(
        actor: Actor,
        model: string,
        buf: Buffer,
        onExhausted: () => void,
    ): void {
        let usage: RealtimeUsage | undefined;
        try {
            usage = JSON.parse(buf.toString('utf8'))?.response?.usage;
        } catch {
            return;
        }
        const rows = realtimeUsageRows(model, usage);
        if (rows.length === 0) return;
        void this.services.metering
            .batchIncrementUsages(actor, rows)
            .then(() => this.services.metering.hasEnoughCredits(actor, 1))
            .then((ok) => {
                if (!ok) onExhausted();
            })
            .catch((err: unknown) =>
                console.warn('[realtime] metering failed', err),
            );
    }

    async #authenticate(req: IncomingMessage, url: URL): Promise<Actor | null> {
        const token = realtimeTokenFrom(req, url);
        if (!token) return null;
        const ua = req.headers['user-agent'];
        const result = await this.services.auth.authenticate(token, {
            ip: req.socket.remoteAddress,
            userAgent: typeof ua === 'string' ? ua : undefined,
        });
        if (result.blocked) return null;
        const decision = decideSocketAuth(result, { allowAppActors: true });
        return 'accept' in decision ? decision.accept : null;
    }
}
