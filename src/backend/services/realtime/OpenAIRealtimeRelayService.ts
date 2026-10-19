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

import { createHash } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import {
    monitorEventLoopDelay,
    performance,
    type EventLoopUtilization,
    type IntervalHistogram,
} from 'node:perf_hooks';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import type { Actor } from '../../core/actor.js';
import {
    CONCURRENT_SLOT_TTL_MS,
    acquireConcurrent,
} from '../../core/http/middleware/rateLimit.js';
import { SPEECH_TO_TEXT_COSTS } from '../../drivers/ai-speech2txt/costs.js';
import { readProviderKey } from '../../drivers/util/providerRegistry.js';
import { kv } from '../../util/kvSingleton.js';
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

/** Micro-cents per token for input transcription billed in tokens. */
const TRANSCRIPTION_TOKEN_PRICES: Record<
    string,
    { textIn: number; audioIn: number; textOut: number }
> = {
    'gpt-4o-transcribe': { textIn: 250, audioIn: 600, textOut: 1000 },
    'gpt-4o-mini-transcribe': { textIn: 125, audioIn: 300, textOut: 500 },
};
/** Micro-cents per second for input transcription billed by duration. */
const TRANSCRIPTION_SECOND_PRICES: Record<string, number> = {
    'whisper-1': 10_000,
    'gpt-transcribe': SPEECH_TO_TEXT_COSTS['openai:gpt-transcribe:second'],
};

/** The `usage` on `conversation.item.input_audio_transcription.completed`. */
export interface RealtimeTranscriptionUsage {
    type?: 'tokens' | 'duration';
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: { text_tokens?: number; audio_tokens?: number };
    seconds?: number;
}

const OPENAI_KEY_PROTOCOL = 'openai-insecure-api-key.';
const MAX_CLIENT_PAYLOAD = 16 * 1024 * 1024;
// Client reads pause past this much buffered before the upstream opens.
const MAX_PENDING_BYTES = 1024 * 1024;
// Either side stops being read while the other has this much queued.
const HIGH_WATER_BYTES = 1024 * 1024;
// A client that leaves the upstream paused this long is closed.
const SLOW_CLIENT_MS = 30_000;
// Sustained client → upstream rate; bursts up to one max-size frame.
const DEFAULT_CLIENT_BYTES_PER_SEC = 1024 * 1024;
const HEARTBEAT_MS = 30_000;
const UPSTREAM_HANDSHAKE_MS = 10_000;
const STATS_INTERVAL_MS = 30_000;
const DEFAULT_MAX_PER_USER = 20;
// Credentials are re-authenticated once their kv entry expires.
const AUTH_RECHECK_SEC = 60;
const AUTH_SWEEP_MS = 15_000;
// At shutdown, how long a session may finish its in-flight response.
const DRAIN_RESPONSE_MS = 5_000;
// RFC 6455 "Service Restart": the client should reconnect.
const CLOSE_RESTART = 1012;
const TYPE_PREFIX = /^\{\s*"type"\s*:\s*"([^"]+)"/;
const TRANSCRIPTION_DONE =
    'conversation.item.input_audio_transcription.completed';

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

/**
 * Usage rows for one completed input transcription. A model missing from the
 * tables is billed at the highest known rate, so it is never free.
 */
export const realtimeTranscriptionRows = (
    model: string | undefined,
    usage: RealtimeTranscriptionUsage | undefined,
): UsageInput[] => {
    if (!usage) return [];
    const n = (v: number | undefined) =>
        typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    const known =
        model &&
        (TRANSCRIPTION_TOKEN_PRICES[model] ||
            TRANSCRIPTION_SECOND_PRICES[model])
            ? model
            : 'unknown';
    const usageType = (kind: string) =>
        `openai:${known}:realtime:transcription_${kind}`;
    if (usage.type === 'duration') {
        const seconds = n(usage.seconds);
        const ucents =
            TRANSCRIPTION_SECOND_PRICES[known] ??
            Math.max(...Object.values(TRANSCRIPTION_SECOND_PRICES));
        if (seconds === 0) return [];
        return [
            {
                usageType: usageType('seconds'),
                usageAmount: seconds,
                costOverride: Math.ceil(seconds * ucents),
            },
        ];
    }
    const price =
        TRANSCRIPTION_TOKEN_PRICES[known] ??
        TRANSCRIPTION_TOKEN_PRICES['gpt-4o-transcribe'];
    const details = usage.input_token_details;
    const audioIn = details ? n(details.audio_tokens) : n(usage.input_tokens);
    const counts: [string, number, number][] = [
        ['text_input', n(details?.text_tokens), price.textIn],
        ['audio_input', audioIn, price.audioIn],
        ['text_output', n(usage.output_tokens), price.textOut],
    ];
    return counts
        .filter(([, amount]) => amount > 0)
        .map(([kind, amount, ucents]) => ({
            usageType: usageType(kind),
            usageAmount: amount,
            costOverride: amount * ucents,
        }));
};

/** The transcription model a `session.created`/`session.updated` configures. */
const transcriptionModelOf = (session: unknown): string | undefined => {
    const s = session as {
        audio?: { input?: { transcription?: { model?: unknown } | null } };
        input_audio_transcription?: { model?: unknown } | null;
    } | null;
    const model =
        s?.audio?.input?.transcription?.model ??
        s?.input_audio_transcription?.model;
    return typeof model === 'string' ? model : undefined;
};

/** The kv key whose presence means `token` was verified recently. */
export const realtimeAuthKey = (token: string): string =>
    `realtime:auth:${createHash('sha256').update(token).digest('base64url')}`;

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
    #elu: EventLoopUtilization | null = null;
    #sessions = new Set<{
        close: (code: number, reason: string) => void;
        heartbeat: () => void;
        recheck: () => Promise<void>;
        drain: () => Promise<void>;
    }>();
    #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    #authTimer: ReturnType<typeof setInterval> | null = null;
    // One re-authentication per token at a time, shared by its sessions.
    #authChecks = new Map<string, Promise<Actor | null>>();
    #draining = false;
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
            // Frames are relayed, not read; the receiving end validates.
            skipUTF8Validation: true,
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
        this.#elu = performance.eventLoopUtilization();
        this.#statsTimer = setInterval(
            () => this.#logStats(),
            STATS_INTERVAL_MS,
        );
        this.#statsTimer.unref?.();
        this.#heartbeatTimer = setInterval(() => {
            for (const session of this.#sessions) session.heartbeat();
        }, HEARTBEAT_MS);
        this.#heartbeatTimer.unref?.();
        this.#authTimer = setInterval(
            () => void this.recheckSessions(),
            AUTH_SWEEP_MS,
        );
        this.#authTimer.unref?.();
    }

    /** Re-authenticates every session whose token's kv entry has expired. */
    async recheckSessions(): Promise<void> {
        await Promise.all([...this.#sessions].map((s) => s.recheck()));
    }

    /** New sessions are refused; open ones keep running through the drain. */
    override onServerDrainStart(): void {
        this.#draining = true;
        console.info(
            `[realtime] draining; ${this.#sessions.size} sessions stay open`,
        );
    }

    /**
     * Each session gets a moment to finish its in-flight response, then closes
     * with 1012 so the client reconnects to another node.
     */
    override async onServerPrepareShutdown(): Promise<void> {
        this.#draining = true;
        if (this.#statsTimer) clearInterval(this.#statsTimer);
        if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
        if (this.#authTimer) clearInterval(this.#authTimer);
        this.#loopDelay?.disable();
        await Promise.all([...this.#sessions].map((s) => s.drain()));
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
            elu: this.#elu
                ? Math.round(
                      performance.eventLoopUtilization(this.#elu).utilization *
                          1000,
                  ) / 1000
                : 0,
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
            `[realtime] active=${s.active} opened=${s.opened} closed=${s.closed} rejected=${s.rejected} upstreamFailed=${s.upstreamFailed} avgUpstreamConnectMs=${avgConnect} framesUp=${s.framesUp} framesDown=${s.framesDown} bytesUp=${s.bytesUp} bytesDown=${s.bytesDown} loopP50Ms=${s.loopP50Ms} loopP99Ms=${s.loopP99Ms} loopMaxMs=${s.loopMaxMs} elu=${s.elu} rssMb=${s.rssMb} heapMb=${s.heapMb}`,
        );
        this.#loopDelay?.reset();
        this.#elu = performance.eventLoopUtilization();
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
        let alive = true;
        const slots: { release: () => Promise<void> }[] = [];
        let renewTimer: ReturnType<typeof setInterval> | null = null;
        let budgetTimer: ReturnType<typeof setTimeout> | null = null;
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const token = realtimeTokenFrom(req, url);
        let actor: Actor | null = null;
        let rechecking = false;
        // Responses started upstream and not yet done, for the drain.
        let inFlight = 0;
        let onIdle: (() => void) | null = null;
        // Decoded upstream state the meter needs.
        const decoded: { transcriptionModel?: string } = {};

        // Client reads stay paused while any reason holds.
        const holds = new Set<'pending' | 'upstream' | 'budget'>();
        const holdClient = (reason: 'pending' | 'upstream' | 'budget') => {
            holds.add(reason);
            client.pause();
        };
        const releaseClient = (reason: 'pending' | 'upstream' | 'budget') => {
            if (holds.delete(reason) && holds.size === 0 && !closed) {
                client.resume();
            }
        };

        const session = {
            close: (code: number, reason: string) => {
                if (closed) return;
                closed = true;
                this.#sessions.delete(session);
                this.#stats.closed++;
                if (renewTimer) clearInterval(renewTimer);
                if (budgetTimer) clearTimeout(budgetTimer);
                if (stallTimer) clearTimeout(stallTimer);
                onIdle?.();
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
            // Called every HEARTBEAT_MS; a client that missed the last ping is
            // gone without a close frame.
            heartbeat: () => {
                if (!alive) {
                    client.terminate();
                    return;
                }
                alive = false;
                if (client.readyState === WebSocket.OPEN) client.ping();
            },
            // Called every AUTH_SWEEP_MS; re-authenticates once the token's kv
            // entry has expired. A failed lookup is retried on the next sweep.
            recheck: async () => {
                if (!actor || !token || closed || rechecking) return;
                if (kv.get(realtimeAuthKey(token)) !== undefined) return;
                rechecking = true;
                try {
                    const next = await this.#authenticateCached(token, req);
                    if (closed) return;
                    if (!next || next.user?.uuid !== actor.user?.uuid) {
                        reject(
                            'invalid_api_key',
                            'Credentials are no longer valid',
                        );
                        return;
                    }
                    actor = next;
                } catch (err) {
                    console.warn('[realtime] credential recheck failed', err);
                } finally {
                    rechecking = false;
                }
            },
            drain: async () => {
                if (inFlight > 0 && !closed) {
                    await new Promise<void>((resolve) => {
                        const timer = setTimeout(resolve, DRAIN_RESPONSE_MS);
                        onIdle = () => {
                            clearTimeout(timer);
                            resolve();
                        };
                    });
                }
                session.close(CLOSE_RESTART, 'server restarting');
            },
        };
        this.#sessions.add(session);
        this.#stats.opened++;
        client.on('pong', () => (alive = true));

        const reject = (code: string, message: string, closeCode = 1008) => {
            this.#stats.rejected++;
            if (client.readyState === WebSocket.OPEN) {
                client.send(errorEvent(code, message));
            }
            session.close(closeCode, code);
        };

        if (this.#draining) {
            reject(
                'server_restarting',
                'Server is restarting; reconnect',
                CLOSE_RESTART,
            );
            return;
        }

        // Token bucket over client bytes: one max-size frame of burst, then
        // reads pause until the sustained rate catches up.
        const rate =
            this.config.realtime?.maxClientBytesPerSecond ??
            DEFAULT_CLIENT_BYTES_PER_SEC;
        let budget = MAX_CLIENT_PAYLOAD;
        let budgetAt = Date.now();
        const spend = (size: number) => {
            const now = Date.now();
            budget = Math.min(
                MAX_CLIENT_PAYLOAD,
                budget + ((now - budgetAt) * rate) / 1000,
            );
            budgetAt = now;
            budget -= size;
            if (budget >= 0 || budgetTimer) return;
            holdClient('budget');
            budgetTimer = setTimeout(
                () => {
                    budgetTimer = null;
                    releaseClient('budget');
                },
                Math.ceil((-budget / rate) * 1000),
            );
        };

        const sendUpstream = (data: RawData, isBinary: boolean) => {
            const up = upstream!;
            up.send(data, { binary: isBinary }, () => {
                if (up.bufferedAmount < HIGH_WATER_BYTES) {
                    releaseClient('upstream');
                }
            });
            if (up.bufferedAmount >= HIGH_WATER_BYTES) holdClient('upstream');
        };

        client.on('message', (data, isBinary) => {
            if (closed) return;
            this.#stats.framesUp++;
            const size = (data as Buffer).length ?? 0;
            this.#stats.bytesUp += size;
            spend(size);
            if (upstream?.readyState === WebSocket.OPEN) {
                sendUpstream(data, isBinary);
                return;
            }
            pending.push({ data, isBinary });
            pendingBytes += size;
            if (pendingBytes > MAX_PENDING_BYTES) holdClient('pending');
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

        try {
            actor = token ? await this.#authenticateCached(token, req) : null;
        } catch {
            actor = null;
        }
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
                // Masking protects proxies from browser-crafted frames; on a
                // TLS socket to a fixed host a zero key is valid and lets ws
                // skip copying and XOR-ing every frame.
                generateMask: (mask) => mask.fill(0),
                skipUTF8Validation: true,
            },
        );
        const up = upstream;

        up.on('open', () => {
            this.#stats.connectMsTotal += Date.now() - connectStart;
            this.#stats.connectCount++;
            for (const { data, isBinary } of pending) {
                sendUpstream(data, isBinary);
            }
            pending.length = 0;
            pendingBytes = 0;
            releaseClient('pending');
        });
        up.on('message', (data, isBinary) => {
            const buf = data as Buffer;
            this.#stats.framesDown++;
            this.#stats.bytesDown += buf.length;
            if (client.readyState !== WebSocket.OPEN) return;
            client.send(buf, { binary: isBinary }, () => {
                if (
                    up.isPaused &&
                    client.bufferedAmount < HIGH_WATER_BYTES &&
                    !closed
                ) {
                    up.resume();
                    if (stallTimer) clearTimeout(stallTimer);
                    stallTimer = null;
                }
            });
            // A client that can't keep up pauses the upstream rather than
            // growing a queue here; one that stays stuck is dropped.
            if (client.bufferedAmount >= HIGH_WATER_BYTES && !up.isPaused) {
                up.pause();
                stallTimer = setTimeout(
                    () => session.close(1008, 'client too slow'),
                    SLOW_CLIENT_MS,
                );
            }
            if (isBinary) return;
            // Audio deltas dominate; only the type prefix is read per frame.
            const type = TYPE_PREFIX.exec(
                buf.subarray(0, 96).toString('latin1'),
            )?.[1];
            if (type === 'response.created') inFlight++;
            if (type === 'response.done') {
                inFlight = Math.max(0, inFlight - 1);
                if (inFlight === 0) onIdle?.();
            }
            if (
                type === 'response.done' ||
                type === TRANSCRIPTION_DONE ||
                type === 'session.created' ||
                type === 'session.updated'
            ) {
                // Parsed and billed after the frame is forwarded, in arrival
                // order, so metering never holds up the relay.
                setImmediate(() =>
                    this.#decode(type, buf, model, decoded, actor!, () =>
                        reject(
                            'insufficient_funds',
                            'No usage left for request',
                        ),
                    ),
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

    async #decode(
        type: string,
        buf: Buffer,
        model: string,
        decoded: { transcriptionModel?: string },
        actor: Actor,
        onExhausted: () => void,
    ): Promise<void> {
        let event: {
            session?: unknown;
            response?: { usage?: RealtimeUsage };
            usage?: RealtimeTranscriptionUsage;
        };
        try {
            event = JSON.parse(buf.toString('utf8'));
        } catch {
            return;
        }
        if (type === 'session.created' || type === 'session.updated') {
            decoded.transcriptionModel = transcriptionModelOf(event?.session);
            return;
        }
        const rows =
            type === 'response.done'
                ? realtimeUsageRows(model, event?.response?.usage)
                : realtimeTranscriptionRows(
                      decoded.transcriptionModel,
                      event?.usage,
                  );
        if (rows.length === 0) return;
        try {
            await this.services.metering.batchIncrementUsages(actor, rows);
            if (!(await this.services.metering.hasEnoughCredits(actor, 1))) {
                onExhausted();
            }
        } catch (err) {
            console.warn('[realtime] metering failed', err);
        }
    }

    /**
     * Authenticates `token`, caching success in kv for AUTH_RECHECK_SEC so
     * sessions sharing a token re-check it once per expiry. Throws on lookup
     * errors, which callers treat as "unknown" rather than "revoked".
     */
    #authenticateCached(
        token: string,
        req: IncomingMessage,
    ): Promise<Actor | null> {
        const key = realtimeAuthKey(token);
        let check = this.#authChecks.get(key);
        if (!check) {
            check = (async () => {
                try {
                    const actor = await this.#authenticate(token, req);
                    if (actor) {
                        kv.set(key, actor.user!.uuid, { EX: AUTH_RECHECK_SEC });
                    }
                    return actor;
                } finally {
                    this.#authChecks.delete(key);
                }
            })();
            this.#authChecks.set(key, check);
        }
        return check;
    }

    async #authenticate(
        token: string,
        req: IncomingMessage,
    ): Promise<Actor | null> {
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
