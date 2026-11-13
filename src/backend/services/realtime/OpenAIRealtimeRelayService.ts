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

import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import express from 'express';
import type { AnyTokenPayload } from '../auth/types.js';
import type { EventMap } from '../../clients/event/types.js';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import type { Actor } from '../../core/actor.js';
import {
    CONCURRENT_SLOT_TTL_MS,
    acquireConcurrent,
    checkRateLimit,
} from '../../core/http/middleware/rateLimit.js';
import { SPEECH_TO_TEXT_COSTS } from '../../drivers/ai-speech2txt/costs.js';
import {
    type AiMeteringService,
    withAiCostFactor,
} from '../../drivers/util/aiCostFactor.js';
import { readProviderKey } from '../../drivers/util/providerRegistry.js';
import { runWithConcurrencyLimit } from '../../util/concurrency.js';
import { BoundedTtlMap } from '../../util/boundedTtlMap.js';
import { kv } from '../../util/kvSingleton.js';
import {
    assertActorHasSubscription,
    subscriptionEnforcementEnabled,
} from '../metering/enforcement.js';
import type { CreditHold, UsageInput } from '../metering/types.js';
import { decideSocketAuth } from '../socket/SocketService.js';
import type { ServerDrainInfo } from '../../types.js';
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
export const MAX_REALTIME_MESSAGE_BYTES = 64 * 1024;
// OpenAI events can carry whole items, such as a long reply, so upstream
// messages get far more room than client ones.
export const MAX_UPSTREAM_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_PENDING_MESSAGES = 32;
// Usage batches waiting on metering; past this the session closes, but every
// batch already received is still recorded.
const MAX_PENDING_USAGE = 32;
const MAX_CLIENT_MESSAGES_PER_SECOND = 100;
// Input retained while authentication and the upstream handshake run.
const MAX_PENDING_BYTES = MAX_REALTIME_MESSAGE_BYTES;
// Either side stops being read while the other has this much queued.
const HIGH_WATER_BYTES = 128 * 1024;
// A client that leaves the upstream paused this long is closed.
const SLOW_CLIENT_MS = 30_000;
// Sustained client → upstream rate; bursts up to one max-size frame.
const DEFAULT_CLIENT_BYTES_PER_SEC = 128 * 1024;
const HEARTBEAT_MS = 30_000;
const UPSTREAM_HANDSHAKE_MS = 10_000;
const SESSION_SETUP_MS = 15_000;
const DEFAULT_MAX_PER_USER = 20;
// Session attempts per signature-verified credential.
const CONNECTS_PER_MINUTE = 60;
const HANDOVER_CONNECTS_PER_MINUTE = 20;
const PREAUTH_PER_IP = 120;
const PREAUTH_PER_NODE = 600;
const MAX_AUTHENTICATING = 64;
const MAX_TOKEN_BYTES = 8192;
// Each response holds this much audio, at the session model's rates, from the
// account's budget until its usage is recorded.
const RESPONSE_HOLD_INPUT_TOKENS = 8_000;
const RESPONSE_HOLD_OUTPUT_TOKENS = 4_096;
// Committed input items whose transcription hasn't completed.
const MAX_PENDING_TRANSCRIPTIONS = 64;
// Reserved items kept ahead of the audio; each commit takes one and the pool
// refills in the background.
const SPARE_TRANSCRIPTIONS = 2;
const TRANSCRIPTION_TIMEOUT_MS = 30_000;
const TRANSCRIPTION_HOLD_TTL_MS = 90_000;
const TRANSCRIPTION_AUDIO_SECONDS = 160;
// Input audio bytes per second: 24 kHz PCM16 (the provider default) and G.711.
const PCM16_AUDIO_RATE = 48_000;
const G711_AUDIO_RATE = 8_000;
const TRANSCRIPTION_BUDGET_TOKENS = {
    audioIn: 8_000,
    textIn: 8_000,
    textOut: 4_096,
};
// Credentials are re-authenticated once their kv entry expires.
const AUTH_RECHECK_SEC = 60;
const AUTH_SWEEP_MS = 15_000;
// At shutdown, how long a session may finish its in-flight response.
const DRAIN_RESPONSE_MS = 5_000;
// After the client leaves, how long a cancelled response may take to report
// its usage before the upstream is cut.
const SETTLE_MS = 5_000;
// RFC 6455 "Service Restart": the client should reconnect.
const CLOSE_RESTART = 1012;
// RFC 6455 "Try Again Later": a temporary overload on our side.
const CLOSE_TRY_AGAIN_LATER = 1013;
// Puter's own server event asking the client to reconnect when idle. OpenAI
// event types never start with `puter.`.
export const RECONNECT_EVENT = 'puter.reconnect';
// A session is sent the reconnect notice at most this often.
const RECONNECT_NOTICE_INTERVAL_MS = 60_000;
const TRANSCRIPTION_DONE =
    'conversation.item.input_audio_transcription.completed';
const METERING_DRIVER = 'openai-realtime';
// Text awaiting a prompt check; past this it is checked without a response.
const MAX_PENDING_PROMPT_CHARS = 64 * 1024;
// Provider organization IDs, as OpenAI puts them in some error messages.
const ORG_ID = /\borg-[A-Za-z0-9]{8,}/g;

interface RealtimeEvent {
    type: string;
    item_id?: unknown;
    session?: unknown;
    response?: { id?: unknown; usage?: RealtimeUsage | null };
    usage?: RealtimeTranscriptionUsage | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const validUsage = (usage: unknown): boolean => {
    if (usage === undefined || usage === null) return true;
    if (!isRecord(usage)) return false;
    const validNumbers = (value: Record<string, unknown>) =>
        [
            'text_tokens',
            'audio_tokens',
            'image_tokens',
            'input_tokens',
            'output_tokens',
            'seconds',
        ].every(
            (key) =>
                value[key] === undefined ||
                (typeof value[key] === 'number' &&
                    Number.isFinite(value[key]) &&
                    value[key] >= 0 &&
                    value[key] <= 1_000_000_000),
        );
    if (!validNumbers(usage)) return false;
    for (const key of ['input_token_details', 'output_token_details']) {
        const details = usage[key];
        if (details === undefined) continue;
        if (!isRecord(details) || !validNumbers(details)) return false;
        const cached = details.cached_tokens_details;
        if (
            cached !== undefined &&
            (!isRecord(cached) || !validNumbers(cached))
        )
            return false;
    }
    return true;
};

const parseEvent = (buffer: Buffer): RealtimeEvent | null => {
    try {
        const event = JSON.parse(buffer.toString('utf8'));
        if (
            !event ||
            typeof event !== 'object' ||
            Array.isArray(event) ||
            typeof event.type !== 'string' ||
            !event.type.length ||
            event.type.length > 128
        )
            return null;
        if (event.type === 'response.done' && event.response !== undefined) {
            if (!isRecord(event.response) || !validUsage(event.response.usage))
                return null;
        }
        if (event.type === TRANSCRIPTION_DONE && !validUsage(event.usage))
            return null;
        return event;
    } catch {
        return null;
    }
};

/**
 * The credential a realtime client presents, in the places OpenAI's own clients
 * put it: an `Authorization` header (server SDKs), an
 * `openai-insecure-api-key.<token>` subprotocol (browsers), or `auth_token`.
 */
export const realtimeTokenFrom = (
    req: Pick<IncomingMessage, 'headers'>,
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
    const price = Object.hasOwn(REALTIME_MODELS, model)
        ? REALTIME_MODELS[model]
        : undefined;
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

const transcriptionBillingModel = (model: string | undefined): string =>
    model &&
    (Object.hasOwn(TRANSCRIPTION_TOKEN_PRICES, model) ||
        Object.hasOwn(TRANSCRIPTION_SECOND_PRICES, model))
        ? model
        : 'unknown';

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
    const known = transcriptionBillingModel(model);
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

/** Budget held for one response of `model` until its usage is recorded. */
const responseHoldAmount = (model: string): number => {
    const price = REALTIME_MODELS[model];
    return (
        RESPONSE_HOLD_INPUT_TOKENS * price.audioIn +
        RESPONSE_HOLD_OUTPUT_TOKENS * price.audioOut
    );
};

/** Bills `count` responses that never reported usage at one hold each. */
const unreportedResponseRows = (model: string, count: number): UsageInput[] => [
    {
        usageType: `openai:${model}:realtime:unreported_response`,
        usageAmount: count,
        costOverride: count * responseHoldAmount(model),
    },
];

const tokenItemBudget = (price: {
    audioIn: number;
    textIn: number;
    textOut: number;
}): number =>
    TRANSCRIPTION_BUDGET_TOKENS.audioIn * price.audioIn +
    TRANSCRIPTION_BUDGET_TOKENS.textIn * price.textIn +
    TRANSCRIPTION_BUDGET_TOKENS.textOut * price.textOut;
const TRANSCRIPTION_ITEM_BUDGETS: Record<string, number> = Object.fromEntries([
    ...Object.entries(TRANSCRIPTION_TOKEN_PRICES).map(([name, price]) => [
        name,
        tokenItemBudget(price),
    ]),
    ...Object.entries(TRANSCRIPTION_SECOND_PRICES).map(([name, price]) => [
        name,
        TRANSCRIPTION_AUDIO_SECONDS * price,
    ]),
]);
TRANSCRIPTION_ITEM_BUDGETS.unknown = Math.max(
    ...Object.values(TRANSCRIPTION_ITEM_BUDGETS),
);

/**
 * Credit, before cost factors, that one input transcription item holds and is
 * billed when its usage never arrives, at the given model's rates.
 */
const transcriptionItemBudget = (model: string | undefined): number =>
    TRANSCRIPTION_ITEM_BUDGETS[transcriptionBillingModel(model)];

const unreportedTranscriptionRows = (
    model: string | undefined,
    items = 1,
): UsageInput[] => [
    {
        usageType: `openai:${transcriptionBillingModel(model)}:realtime:transcription_unreported`,
        usageAmount: items,
        costOverride: items * transcriptionItemBudget(model),
    },
];

/**
 * Why a client event is refused, or null. Retrieved items and MCP tool output
 * can exceed the upstream message cap.
 */
const clientEventRefusal = (event: RealtimeEvent): string | null => {
    if (event.type === 'conversation.item.retrieve') {
        return 'conversation.item.retrieve is not supported';
    }
    const config: unknown =
        event.type === 'session.update'
            ? event.session
            : event.type === 'response.create'
              ? event.response
              : undefined;
    if (
        isRecord(config) &&
        Array.isArray(config.tools) &&
        config.tools.some((tool) => isRecord(tool) && tool.type === 'mcp')
    ) {
        return 'MCP tools are not supported';
    }
    return null;
};

type PromptMessage = { role: string; content: string };

const itemPromptMessages = (item: unknown): PromptMessage[] => {
    if (!isRecord(item)) return [];
    if (item.type === 'function_call_output') {
        return typeof item.output === 'string' && item.output
            ? [{ role: 'tool', content: item.output }]
            : [];
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) return [];
    const role = typeof item.role === 'string' ? item.role : 'user';
    return item.content.flatMap((part) => {
        if (!isRecord(part)) return [];
        const text = part.text ?? part.transcript;
        return typeof text === 'string' && text
            ? [{ role, content: text }]
            : [];
    });
};

/** The text a client event adds to the model's context, as chat messages. */
export const promptMessagesOf = (event: unknown): PromptMessage[] => {
    if (!isRecord(event)) return [];
    if (event.type === 'conversation.item.create') {
        return itemPromptMessages(event.item);
    }
    const config =
        event.type === 'session.update'
            ? event.session
            : event.type === 'response.create'
              ? event.response
              : undefined;
    if (!isRecord(config)) return [];
    const messages: PromptMessage[] =
        typeof config.instructions === 'string' && config.instructions
            ? [{ role: 'system', content: config.instructions }]
            : [];
    if (Array.isArray(config.input)) {
        for (const item of config.input)
            messages.push(...itemPromptMessages(item));
    }
    return messages;
};

/** Whichever of two pricings of the same usage costs more. */
export const costlierRows = (
    a: UsageInput[],
    b: UsageInput[],
): UsageInput[] => {
    const total = (rows: UsageInput[]) =>
        rows.reduce((sum, row) => sum + (row.costOverride ?? 0), 0);
    return total(b) > total(a) ? b : a;
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

/**
 * The input audio bytes per second, and whether server turn detection commits
 * the buffer, as a session or `session.update` sets them. Fields the session
 * leaves out are undefined.
 */
const inputAudioOf = (session: unknown): { rate?: number; vad?: boolean } => {
    if (!isRecord(session)) return {};
    const input =
        isRecord(session.audio) && isRecord(session.audio.input)
            ? session.audio.input
            : undefined;
    const format = input ? input.format : session.input_audio_format;
    let rate: number | undefined;
    if (format === 'pcm16') rate = PCM16_AUDIO_RATE;
    else if (isRecord(format) && format.type === 'audio/pcm') {
        rate =
            typeof format.rate === 'number' && format.rate > 0
                ? 2 * format.rate
                : PCM16_AUDIO_RATE;
    } else if (format !== undefined && format !== null) {
        // G.711, or a format the relay doesn't know, counted at the lowest rate.
        rate = G711_AUDIO_RATE;
    }
    const turnDetection =
        input && 'turn_detection' in input
            ? input.turn_detection
            : session.turn_detection;
    return {
        rate,
        vad: turnDetection === undefined ? undefined : turnDetection !== null,
    };
};

/**
 * The realtime model a session event reports, mapped onto the price table
 * (dated snapshots resolve to their alias). Missing models use `fallback`;
 * explicitly unpriced models are refused.
 */
export const realtimeBillingModel = (
    session: unknown,
    fallback: string,
): string | undefined => {
    const model = isRecord(session) ? session.model : undefined;
    if (model === undefined) return fallback;
    if (typeof model !== 'string') return undefined;
    const alias = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
    return Object.hasOwn(REALTIME_MODELS, alias) ? alias : undefined;
};

const tokenHash = (token: string): string =>
    createHash('sha256').update(token).digest('base64url');

/** The kv key whose presence means `token` was verified recently. */
export const realtimeAuthKey = (token: string): string =>
    `realtime:auth:${tokenHash(token)}`;

/** The rate-limit key for session attempts with `token`. */
export const realtimeConnectKey = (token: string): string =>
    `realtime:connect:${tokenHash(token)}`;

/**
 * Redacts supported provider diagnostics without rewriting conversation
 * content.
 */
const redactDiagnostics = (event: RealtimeEvent, buf: Buffer): Buffer => {
    const record = event as unknown as Record<string, unknown>;
    let diagnostic: unknown;
    if (
        event.type === 'error' ||
        event.type === 'conversation.item.input_audio_transcription.failed'
    ) {
        diagnostic = record.error;
    } else if (event.type === 'response.done' && isRecord(record.response)) {
        const details = record.response.status_details;
        if (isRecord(details)) diagnostic = details.error;
    }
    if (!isRecord(diagnostic) || typeof diagnostic.message !== 'string')
        return buf;
    const message = diagnostic.message.replace(ORG_ID, 'org-redacted');
    if (message === diagnostic.message) return buf;
    diagnostic.message = message;
    return Buffer.from(JSON.stringify(event));
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
 * Asks the client to reconnect at its next idle moment. `close_in_ms`, when
 * known, is how long until the server closes the session itself.
 */
const reconnectEvent = (closeInMs: number | undefined): string =>
    JSON.stringify({
        type: RECONNECT_EVENT,
        event_id: `event_puter_${Date.now()}`,
        reason: 'server_restarting',
        ...(closeInMs !== undefined ? { close_in_ms: closeInMs } : {}),
    });

/**
 * Relays OpenAI's Realtime API over WebSocket at `REALTIME_PATH` on the api
 * host, one upstream connection per client connection. Frames pass through
 * untouched in both directions after bounded envelope validation. Usage events
 * are metered serially outside the forwarding path.
 *
 * The client socket is accepted before authenticating: socket.io ends any
 * upgrade that hasn't written a byte within a second, which an auth lookup
 * under load can miss. Failures arrive as an `error` event and a close frame.
 * Limits, quirks and load-testing notes are in this directory's README.
 */
export class OpenAIRealtimeRelayService extends PuterService {
    #wss: WebSocketServer | null = null;
    #sessions = new Set<{
        close: (code: number, reason: string) => void;
        heartbeat: () => void;
        recheck: () => Promise<void>;
        revoke: (sessionUids?: ReadonlySet<string>, tokenUid?: string) => void;
        planChanged: (userUuid: string) => void;
        drain: () => Promise<void>;
        notify: (closeInMs: number | undefined) => void;
    }>();
    #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    #authTimer: ReturnType<typeof setInterval> | null = null;
    // One re-authentication per token at a time, shared by its sessions.
    #authChecks = new Map<string, Promise<Actor | null>>();
    #draining = false;
    #authenticating = 0;
    #pendingUpgrades = 0;
    #sweeping = false;
    attachHttpServer(server: HttpServer): void {
        this.#wss = new WebSocketServer({
            noServer: true,
            maxPayload: MAX_REALTIME_MESSAGE_BYTES,
            maxFragments: 64,
            maxBufferedChunks: 128,
            perMessageDeflate: false,
            // Echo `realtime` so browsers that offered OpenAI's protocols
            // accept the handshake; the key protocol is never echoed.
            handleProtocols: (protocols) =>
                protocols.has('realtime') ? 'realtime' : false,
        });
        // Use Express itself so upgrades follow the ordinary HTTP trust policy.
        const ipApp = express();
        ipApp.set('trust proxy', this.config.trust_proxy ?? false);
        const domain = (this.config.domain ?? '').toLowerCase().trim();
        const apiHost = `api.${domain}`;

        server.on('upgrade', (req: IncomingMessage, socket: Duplex, head) => {
            if (!req.url?.startsWith(REALTIME_PATH)) return;
            const url = new URL(req.url, 'http://placeholder');
            if (url.pathname !== REALTIME_PATH) return;
            socket.on('error', () => socket.destroy());
            const refuseUpgrade = (
                status:
                    | '404 Not Found'
                    | '429 Too Many Requests'
                    | '503 Service Unavailable',
            ) => {
                socket.end(
                    `HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`,
                    () => socket.destroy(),
                );
            };
            const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
            if (!domain || host !== apiHost) {
                refuseUpgrade('404 Not Found');
                return;
            }
            if (
                this.#authenticating >= MAX_AUTHENTICATING ||
                this.#pendingUpgrades >= MAX_AUTHENTICATING
            ) {
                refuseUpgrade('503 Service Unavailable');
                return;
            }
            const ipRequest = Object.assign(Object.create(ipApp.request), {
                headers: req.headers,
                connection: req.socket,
                socket: req.socket,
            });
            const clientIp = ipRequest.ip as string;
            this.#pendingUpgrades++;
            let pendingUpgrade = true;
            const releaseUpgrade = () => {
                if (!pendingUpgrade) return;
                pendingUpgrade = false;
                this.#pendingUpgrades--;
                socket.removeListener('close', releaseUpgrade);
            };
            socket.once('close', releaseUpgrade);
            void (async () => {
                try {
                    if (
                        !(await checkRateLimit(
                            'realtime:preauth:node',
                            PREAUTH_PER_NODE,
                            60_000,
                            'memory',
                        )) ||
                        !(await checkRateLimit(
                            `realtime:preauth:ip:${clientIp}`,
                            PREAUTH_PER_IP,
                            60_000,
                            'memory',
                        ))
                    ) {
                        refuseUpgrade('429 Too Many Requests');
                        return;
                    }
                    if (socket.destroyed) return;
                    if (this.#authenticating >= MAX_AUTHENTICATING) {
                        refuseUpgrade('503 Service Unavailable');
                        return;
                    }
                    this.#wss!.handleUpgrade(req, socket, head, (client) => {
                        this.#authenticating++;
                        this.#runSession(
                            client,
                            req,
                            url,
                            clientIp,
                            releaseUpgrade,
                        )
                            .catch((err: unknown) => {
                                console.warn(
                                    '[realtime] session setup failed',
                                    err,
                                );
                                if (client.readyState !== WebSocket.OPEN)
                                    return;
                                client.send(
                                    errorEvent(
                                        'internal_error',
                                        'Realtime setup failed',
                                    ),
                                );
                                client.close(1011, 'internal error');
                            })
                            .finally(() => {
                                this.#authenticating--;
                            });
                    });
                } catch {
                    refuseUpgrade('503 Service Unavailable');
                }
            })();
        });

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
        if (this.#sweeping) return;
        this.#sweeping = true;
        try {
            await runWithConcurrencyLimit([...this.#sessions], 16, (s) =>
                s.recheck(),
            );
        } finally {
            this.#sweeping = false;
        }
    }

    /** A host extension can announce a restart before the drain starts. */
    override onServerStart(): void {
        this.clients.event.on('outer.auth.sessions.revoked', (_key, data) => {
            this.clients.event.emit(
                'pubsub.realtime.auth-revoked',
                { sessionUids: data.session_uids },
                {},
            );
        });
        this.clients.event.on(
            'outer.auth.access-token.revoked',
            (_key, data) => {
                const tokenUid = (data as { token_uid?: unknown } | null)
                    ?.token_uid;
                if (typeof tokenUid !== 'string' || !tokenUid) return;
                this.clients.event.emit(
                    'pubsub.realtime.auth-revoked',
                    { tokenUid },
                    {},
                );
            },
        );
        // Raw WebSockets do not participate in socket.io's cluster adapter.
        this.clients.event.on('pubsub.realtime.auth-revoked', (_key, data) => {
            const revoked = data.sessionUids
                ? new Set(data.sessionUids)
                : undefined;
            for (const session of this.#sessions)
                session.revoke(revoked, data.tokenUid);
        });
        this.clients.event.on(
            'outer.pubsub.metering.subscription-changed',
            (_key, data) => {
                for (const session of this.#sessions)
                    session.planChanged(data.userUuid);
            },
        );
        this.clients.event.on('serverRestartAnnounced', (_key, data) =>
            this.#announceRestart(data?.closeInMs),
        );
    }

    /**
     * New sessions are refused; open ones keep running through the drain and
     * are asked to reconnect.
     */
    override onServerDrainStart(info?: ServerDrainInfo): void {
        this.#draining = true;
        console.info(
            `[realtime] draining; ${this.#sessions.size} sessions stay open`,
        );
        this.#announceRestart(info?.drainMs);
    }

    /**
     * Sends every open session the reconnect notice, at most once a minute
     * each. Nothing is refused or closed here.
     */
    #announceRestart(closeInMs: unknown): void {
        const ms =
            typeof closeInMs === 'number' &&
            Number.isFinite(closeInMs) &&
            closeInMs >= 0
                ? Math.round(closeInMs)
                : undefined;
        for (const session of this.#sessions) session.notify(ms);
    }

    /**
     * Each session gets a moment to finish its in-flight response, then closes
     * with 1012 so the client reconnects to another node.
     */
    override async onServerPrepareShutdown(): Promise<void> {
        this.#draining = true;
        if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
        if (this.#authTimer) clearInterval(this.#authTimer);
        await Promise.all([...this.#sessions].map((s) => s.drain()));
        this.#wss?.close();
    }

    /** Metering with the AI cost factor applied. Lazy: services wire up late. */
    get #metering(): AiMeteringService {
        return withAiCostFactor(
            this.services.metering,
            this.clients.event,
            METERING_DRIVER,
        );
    }

    async #runSession(
        client: WebSocket,
        req: IncomingMessage,
        url: URL,
        clientIp: string,
        onAdmitted: () => void,
    ): Promise<void> {
        // Buffer what the client sends while auth and the upstream handshake
        // run; OpenAI clients send `session.update` immediately on open.
        const pending: { data: RawData; isBinary: boolean }[] = [];
        let pendingBytes = 0;
        let upstream: WebSocket | null = null;
        let closed = false;
        let setupTimer: ReturnType<typeof setTimeout> | null = null;
        let alive = true;
        const slots: { release: () => Promise<void> }[] = [];
        let renewTimer: ReturnType<typeof setInterval> | null = null;
        let budgetTimer: ReturnType<typeof setTimeout> | null = null;
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        let settleTimer: ReturnType<typeof setTimeout> | null = null;
        const token = realtimeTokenFrom(req, url);
        let actor: Actor | null = null;
        let rechecking: Promise<void> | undefined;
        let identity: AnyTokenPayload | undefined;
        let verificationFailedAt: number | undefined;
        // Responses started upstream and not yet done. A response bills its
        // usage on `response.done`, so the upstream outlives the client until
        // then; one the upstream closes on first is billed its hold.
        let inFlight = 0;
        const inFlightIds = new Set<string>();
        // Client `response.create` events whose response hasn't started; the
        // settle waits for them too.
        let requested = 0;
        // Credit holds of responses whose usage isn't recorded yet.
        const responseHolds = new Map<string, Promise<CreditHold | null>>();
        // Text sent since the last prompt check, checked when the next
        // response starts. Each started response maps to the completion id
        // its check logged, or null if the check refused it.
        const checkPrompts =
            this.clients.event.hasListeners('ai.prompt.validate');
        let promptMessages: PromptMessage[] = [];
        let promptChars = 0;
        const responseCompletions = new Map<string, Promise<string | null>>();
        // Committed input items awaiting usage, each with the transcription
        // model in force at commit and the credit held for it.
        const pendingTranscriptions = new Map<
            string,
            {
                model: string | undefined;
                timer: ReturnType<typeof setTimeout>;
                hold: Promise<CreditHold | null>;
            }
        >();
        // Reserved items not yet committed, priced at `spareModel`.
        const spareTranscriptions: CreditHold[] = [];
        let spareModel: string | undefined;
        let toppingUp = false;
        // Transcription holds of this session not yet released.
        let heldTranscriptions = 0;
        let reservations: Promise<unknown> = Promise.resolve();
        // Forwarded input audio as a timeline in ms, and where the audio the
        // provider may commit without an acknowledgement reaching the relay
        // begins (null: none). Without turn detection that is everything since
        // the last commit or clear; with it, only detected speech, since the
        // provider drops silence. If the upstream closes first, it bills one
        // item per TRANSCRIPTION_AUDIO_SECONDS, held as it arrives.
        let audioMs = 0;
        let ackedAtMs = 0;
        let unackedFromMs: number | null = null;
        let audioRate = PCM16_AUDIO_RATE;
        // A lower rate the client requested, until the provider reports it.
        let requestedAudioRate: number | undefined;
        let serverVad = false;
        const audioHolds: CreditHold[] = [];
        const unackedItems = () =>
            unackedFromMs === null
                ? 0
                : Math.max(
                      1,
                      Math.ceil(
                          (audioMs - unackedFromMs) /
                              (TRANSCRIPTION_AUDIO_SECONDS * 1000),
                      ),
                  );
        const claimAudioHolds = () => {
            while (
                audioHolds.length < unackedItems() &&
                spareTranscriptions.length
            )
                audioHolds.push(spareTranscriptions.shift()!);
        };
        // A commit or clear accounts for the audio; its holds become spares.
        const acknowledgeAudio = () => {
            ackedAtMs = audioMs;
            unackedFromMs = null;
            spareTranscriptions.unshift(...audioHolds.splice(0));
            for (const hold of spareTranscriptions.splice(
                SPARE_TRANSCRIPTIONS,
            )) {
                hold.release().catch((err) =>
                    console.warn('[realtime] credit hold release failed', err),
                );
            }
        };
        // The provider's input format and turn detection.
        const noteInputAudio = (session: unknown) => {
            const { rate, vad } = inputAudioOf(session);
            if (rate !== undefined) {
                audioRate = rate;
                if (rate === requestedAudioRate) requestedAudioRate = undefined;
            }
            if (vad !== undefined) serverVad = vad;
        };
        // The transcription model last requested or reported.
        let selectedTranscriptionModel: string | undefined;
        let wantsTranscription = false;
        let pumping = false;
        let pumpAgain = false;
        const releaseSpareTranscriptions = () => {
            for (const hold of spareTranscriptions.splice(0)) {
                hold.release().catch((err) =>
                    console.warn('[realtime] credit hold release failed', err),
                );
            }
        };
        let providerReady = false;
        const finishedTranscriptions = new BoundedTtlMap<string, true>({
            maxEntries: MAX_PENDING_TRANSCRIPTIONS * 2,
        });
        let onIdle: (() => void) | null = null;
        let noticeAt = -Infinity;
        const model = url.searchParams.get('model') || DEFAULT_REALTIME_MODEL;
        let billingModel = model;
        let transcriptionModel: string | undefined;

        // Client reads stay paused while any reason holds.
        const holds = new Set<'upstream' | 'budget' | 'transcription'>();
        const holdClient = (
            reason: 'upstream' | 'budget' | 'transcription',
        ) => {
            holds.add(reason);
            client.pause();
        };
        const releaseClient = (
            reason: 'upstream' | 'budget' | 'transcription',
        ) => {
            if (holds.delete(reason) && holds.size === 0 && !closed) {
                client.resume();
            }
        };

        const endUpstream = () => {
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = null;
            if (
                upstream &&
                (upstream.readyState === WebSocket.OPEN ||
                    upstream.readyState === WebSocket.CONNECTING)
            ) {
                upstream.terminate();
            }
        };

        // Cancels whatever is still generating and keeps the upstream open
        // until each response reports its usage, or SETTLE_MS passes.
        const settleUpstream = () => {
            const up = upstream;
            if (
                !up ||
                up.readyState !== WebSocket.OPEN ||
                (inFlight === 0 &&
                    requested === 0 &&
                    pendingTranscriptions.size === 0 &&
                    unackedFromMs === null)
            ) {
                endUpstream();
                return;
            }
            if (up.isPaused) up.resume();
            if (unackedFromMs !== null)
                up.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            settleTimer = setTimeout(endUpstream, SETTLE_MS);
            // A requested response is cancelled once it starts.
            if (inFlight === 0) return;
            const cancels = inFlightIds.size
                ? [...inFlightIds].map((id) => ({
                      type: 'response.cancel',
                      response_id: id,
                  }))
                : [{ type: 'response.cancel' }];
            for (const cancel of cancels) up.send(JSON.stringify(cancel));
        };

        const session = {
            revoke: (sessionUids?: ReadonlySet<string>, tokenUid?: string) => {
                const sessionUid =
                    identity?.session_uid ??
                    (identity &&
                    (identity.type === 'session' || identity.type === 'gui')
                        ? identity.uuid
                        : undefined);
                const parentUid =
                    identity?.type === 'app-under-user'
                        ? identity.session
                        : undefined;
                if (
                    !(
                        sessionUids?.has(sessionUid ?? '') ||
                        sessionUids?.has(parentUid ?? '') ||
                        (tokenUid &&
                            identity?.type === 'access-token' &&
                            identity.token_uid === tokenUid)
                    )
                )
                    return;
                if (token) {
                    kv.del(realtimeAuthKey(token));
                    this.#authChecks.delete(realtimeAuthKey(token));
                }
                reject('invalid_api_key', 'Credentials are no longer valid');
            },
            planChanged: (userUuid: string) => {
                if (actor?.user?.uuid === userUuid) void session.recheck();
            },
            close: (code: number, reason: string) => {
                if (closed) return;
                closed = true;
                if (setupTimer) clearTimeout(setupTimer);
                pending.length = 0;
                pendingBytes = 0;
                this.#sessions.delete(session);
                if (renewTimer) clearInterval(renewTimer);
                if (budgetTimer) clearTimeout(budgetTimer);
                if (stallTimer) clearTimeout(stallTimer);
                onIdle?.();
                void Promise.all(slots.map((s) => s.release()));
                if (client.readyState === WebSocket.OPEN) {
                    client.resume();
                    client.close(code, reason);
                }
                settleUpstream();
                // Uncommitted audio may still need a reserved item to bill.
                if (unackedFromMs === null) releaseSpareTranscriptions();
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
                void Promise.all([
                    ...spareTranscriptions,
                    ...audioHolds,
                    ...[...pendingTranscriptions.values()].map((p) => p.hold),
                ])
                    .then((held) =>
                        Promise.all(held.map((hold) => hold?.extend?.())),
                    )
                    .catch(() =>
                        reject(
                            'internal_error',
                            'Could not renew transcription budget',
                            1011,
                        ),
                    );
            },
            // Called every AUTH_SWEEP_MS; re-authenticates once the token's kv
            // entry has expired. A failed lookup is retried on the next sweep.
            recheck: () => {
                if (!actor || !token || closed) return Promise.resolve();
                if (rechecking) return rechecking;
                rechecking = (async () => {
                    try {
                        const next =
                            kv.get(realtimeAuthKey(token)) !== undefined
                                ? actor
                                : await this.#authenticateCached(
                                      token,
                                      req,
                                      clientIp,
                                  );
                        if (closed) return;
                        if (!next || next.user?.uuid !== actor.user?.uuid) {
                            reject(
                                'invalid_api_key',
                                'Credentials are no longer valid',
                            );
                            return;
                        }
                        actor = next;
                        if (subscriptionEnforcementEnabled(this.config)) {
                            if (await planProvisional())
                                throw new Error('subscription unavailable');
                            try {
                                await assertActorHasSubscription(
                                    this.services.metering,
                                    actor,
                                    true,
                                    this.config,
                                    {
                                        events: this.clients.event,
                                        surface: 'realtime.openai',
                                    },
                                );
                            } catch (error) {
                                if (
                                    [402, 403].includes(
                                        (error as { statusCode?: number })
                                            .statusCode ?? 0,
                                    ) &&
                                    !(await planProvisional())
                                ) {
                                    reject(
                                        'subscription_required',
                                        'Realtime conversations require a subscription',
                                    );
                                    return;
                                }
                                throw error;
                            }
                        }
                        verificationFailedAt = undefined;
                    } catch {
                        verificationFailedAt ??= Date.now();
                        if (
                            Date.now() - verificationFailedAt >=
                            AUTH_RECHECK_SEC * 1000
                        ) {
                            reject(
                                'internal_error',
                                'Could not verify continued access',
                                1011,
                            );
                        }
                    } finally {
                        rechecking = undefined;
                    }
                })();
                return rechecking;
            },
            drain: async () => {
                if (
                    (inFlight > 0 || pendingTranscriptions.size > 0) &&
                    !closed
                ) {
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
            notify: (closeInMs: number | undefined) => {
                if (closed || client.readyState !== WebSocket.OPEN) return;
                const now = Date.now();
                if (now - noticeAt < RECONNECT_NOTICE_INTERVAL_MS) return;
                noticeAt = now;
                client.send(reconnectEvent(closeInMs));
            },
        };
        this.#sessions.add(session);
        // Before any refusal: a frame can still error the socket while its close
        // handshake runs, and an error without a listener ends the process.
        client.on('close', (code) =>
            session.close(code === 1005 || code === 1006 ? 1000 : code, ''),
        );
        client.on('error', (err: Error & { code?: string }) =>
            session.close(
                err.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH' ? 1009 : 1011,
                'client error',
            ),
        );

        const reject = (code: string, message: string, closeCode = 1008) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(errorEvent(code, message));
            }
            session.close(closeCode, code);
        };
        // Whether the account's plan is, right now, a fallback for a failed
        // lookup. Unknown counts as a fallback.
        const planProvisional = async (): Promise<boolean> => {
            try {
                return (
                    await this.services.metering.getActorSubscriptionStatus(
                        actor!,
                    )
                ).provisional;
            } catch (err) {
                console.warn('[realtime] plan lookup failed', err);
                return true;
            }
        };
        // A plan or balance refusal decided on a plan whose lookup failed may
        // not apply to this account, so the client is told to retry instead.
        // The plan is checked on both sides of the decision: a fallback is
        // only cached briefly, and one that ran out before the check after
        // was still the plan the decision used.
        const refuse = async (
            code: string,
            message: string,
            provisionalBefore: boolean,
        ) => {
            if (provisionalBefore || (await planProvisional())) {
                reject('internal_error', 'Could not verify subscription', 1011);
            } else {
                reject(code, message);
            }
        };

        if (this.#draining) {
            reject(
                'server_restarting',
                'Server is restarting; reconnect',
                CLOSE_RESTART,
            );
            return;
        }

        setupTimer = setTimeout(
            () =>
                reject('connection_timeout', 'Realtime setup timed out', 1011),
            SESSION_SETUP_MS,
        );

        // Token bucket over client bytes: one max-size frame of burst, then
        // reads pause until the sustained rate catches up.
        const rate = DEFAULT_CLIENT_BYTES_PER_SEC;
        let budget = MAX_REALTIME_MESSAGE_BYTES;
        let budgetAt = Date.now();
        const spend = (size: number) => {
            const now = Date.now();
            budget = Math.min(
                MAX_REALTIME_MESSAGE_BYTES,
                budget + ((now - budgetAt) * rate) / 1000,
            );
            budgetAt = now;
            budget -= size;
            if (budget < -MAX_REALTIME_MESSAGE_BYTES) {
                reject('rate_limit_exceeded', 'Realtime byte rate exceeded');
                return;
            }
            if (budget >= 0) return;
            if (budgetTimer) clearTimeout(budgetTimer);
            holdClient('budget');
            budgetTimer = setTimeout(
                () => {
                    budgetTimer = null;
                    releaseClient('budget');
                },
                Math.ceil((-budget / rate) * 1000),
            );
        };

        // Client message rate. Upstream traffic is OpenAI's and isn't capped:
        // replies arrive faster than real time, and backpressure already
        // bounds what a slow client can make us queue.
        let messageTokens = MAX_CLIENT_MESSAGES_PER_SECOND;
        let messageTokensAt = Date.now();
        const admitClientMessage = () => {
            const now = Date.now();
            messageTokens = Math.min(
                MAX_CLIENT_MESSAGES_PER_SECOND,
                messageTokens +
                    ((now - messageTokensAt) * MAX_CLIENT_MESSAGES_PER_SECOND) /
                        1000,
            );
            messageTokensAt = now;
            if (messageTokens < 1) {
                reject('rate_limit_exceeded', 'Realtime message rate exceeded');
                return false;
            }
            messageTokens--;
            return true;
        };
        client.on('pong', () => {
            if (!closed && admitClientMessage()) alive = true;
        });
        client.on('ping', () => {
            if (!closed) admitClientMessage();
        });

        // Usage is recorded serially, off the forwarding path, and keeps
        // draining after the session closes.
        const usageQueue: {
            rows: UsageInput[];
            holds: Promise<CreditHold | null>[];
        }[] = [];
        let recording = false;
        const drainUsage = async () => {
            while (usageQueue.length) {
                const { rows, holds } = usageQueue[0];
                if (rows.length) {
                    const provisional = await planProvisional();
                    await this.#record(
                        actor!,
                        rows,
                        () =>
                            void refuse(
                                'insufficient_funds',
                                'No usage left for request',
                                provisional,
                            ),
                    );
                }
                await Promise.all(holds.map((hold) => releaseHold(hold)));
                usageQueue.shift();
            }
            recording = false;
        };
        // `holds` are released once `rows` are recorded.
        const meter = (
            rows: UsageInput[],
            ...maybeHolds: (Promise<CreditHold | null> | undefined)[]
        ) => {
            const holds = maybeHolds.filter((hold) => hold !== undefined);
            if (!rows.length && !holds.length) return;
            usageQueue.push({ rows, holds });
            if (!recording) {
                recording = true;
                setImmediate(() => void drainUsage());
            }
            if (usageQueue.length > MAX_PENDING_USAGE) {
                reject(
                    'rate_limit_exceeded',
                    'Too many pending usage events',
                    CLOSE_TRY_AGAIN_LATER,
                );
            }
        };

        const holdResponse = (id: string) => {
            const hold = (async () => {
                try {
                    const provisional = await planProvisional();
                    const taken = await this.#metering.reserveAiCredits(
                        actor!,
                        `openai:${billingModel}:realtime:audio_output`,
                        responseHoldAmount(billingModel),
                    );
                    if (!taken) {
                        await refuse(
                            'insufficient_funds',
                            'No usage left for request',
                            provisional,
                        );
                    }
                    return taken;
                } catch (err) {
                    console.warn('[realtime] credit hold failed', err);
                    return null;
                }
            })();
            responseHolds.set(id, hold);
        };
        const takeHold = (id: unknown) => {
            if (typeof id !== 'string') return undefined;
            const hold = responseHolds.get(id);
            responseHolds.delete(id);
            return hold;
        };
        const releaseHold = async (hold?: Promise<CreditHold | null>) => {
            try {
                await (await hold)?.release();
            } catch (err) {
                console.warn('[realtime] credit hold release failed', err);
            }
        };

        // Runs the host's prompt check on the pending text, which also logs
        // it. A refusal closes the session.
        const checkPrompt = async (): Promise<string | null> => {
            const completionId = randomUUID().replaceAll('-', '').slice(0, 25);
            const check: EventMap['ai.prompt.validate'] = {
                username: actor!.user?.username || '',
                actor,
                completionId,
                allow: true,
                intended_service: METERING_DRIVER,
                parameters: { model: billingModel, messages: promptMessages },
            };
            promptMessages = [];
            promptChars = 0;
            try {
                await this.clients.event.emitAndWait(
                    'ai.prompt.validate',
                    check,
                    {},
                );
            } catch (err) {
                console.warn('[realtime] prompt check failed', err);
            }
            if (check.allow !== false) return completionId;
            reject('permission_denied', 'Prompt blocked by policy');
            return null;
        };
        const notePrompt = (event: RealtimeEvent) => {
            for (const message of promptMessagesOf(event)) {
                if (
                    promptChars + message.content.length >
                    MAX_PENDING_PROMPT_CHARS
                )
                    void checkPrompt();
                promptMessages.push(message);
                promptChars += message.content.length;
            }
        };
        // Adds a response's cost to the row its prompt check logged.
        const logResponseCost = async (
            id: string,
            rows: UsageInput[],
            usage: unknown,
        ) => {
            const completion = responseCompletions.get(id);
            if (!completion) return;
            responseCompletions.delete(id);
            const completionId = await completion;
            if (!completionId) return;
            const input = { tokens: 0, ucents: 0 };
            const output = { tokens: 0, ucents: 0 };
            for (const row of rows) {
                const side = row.usageType.endsWith('_output') ? output : input;
                side.tokens += row.usageAmount;
                side.ucents += row.costOverride ?? 0;
            }
            this.clients.event.emit(
                'ai.prompt.cost-calculated',
                {
                    completionId,
                    username: actor!.user?.username || '',
                    usage,
                    input_tokens: input.tokens,
                    output_tokens: output.tokens,
                    input_ucents: input.ucents,
                    output_ucents: output.ucents,
                    total_ucents: input.ucents + output.ucents,
                    costs_currency: 'usd-cents',
                    model_used: billingModel,
                    service_used: 'openai',
                    intended_service: METERING_DRIVER,
                },
                {},
            );
        };

        // One transcription item's credit at `name`'s price and cost factor,
        // or null when the account can't cover it. Reservations run one at a
        // time, so a session's own holds don't race each other's balance check.
        const reserveTranscription = (
            name: string,
        ): Promise<CreditHold | null> => {
            const next = reservations.then(async () => {
                const hold = await this.#metering.reserveAiCredits(
                    actor!,
                    `openai:${name}:realtime:transcription_unreported`,
                    transcriptionItemBudget(name),
                    { ttlMs: TRANSCRIPTION_HOLD_TTL_MS },
                );
                if (!hold) return null;
                heldTranscriptions++;
                let released = false;
                return {
                    release: async () => {
                        if (released) return;
                        released = true;
                        try {
                            await hold.release();
                        } finally {
                            heldTranscriptions--;
                            // Freed credit may admit audio waiting for an item.
                            pumpPending();
                        }
                    },
                    extend: async () => {
                        if (!released) await hold.extend?.();
                    },
                } satisfies CreditHold;
            });
            reservations = next.catch(() => {});
            return next;
        };
        // Adds one spare item at the current price. False when refused.
        const reserveSpareTranscription = async (): Promise<boolean> => {
            const name = spareModel ?? 'unknown';
            const hold = await reserveTranscription(name);
            if (!hold) return false;
            if (
                closed ||
                name !== (spareModel ?? 'unknown') ||
                pendingTranscriptions.size +
                    spareTranscriptions.length +
                    audioHolds.length >=
                    MAX_PENDING_TRANSCRIPTIONS
            ) {
                await hold.release();
            } else {
                spareTranscriptions.push(hold);
            }
            return true;
        };
        const topUpTranscriptions = () => {
            if (
                spareModel === undefined ||
                toppingUp ||
                closed ||
                spareTranscriptions.length + audioHolds.length >=
                    SPARE_TRANSCRIPTIONS ||
                pendingTranscriptions.size +
                    spareTranscriptions.length +
                    audioHolds.length >=
                    MAX_PENDING_TRANSCRIPTIONS
            )
                return;
            toppingUp = true;
            reserveSpareTranscription().then(
                (reserved) => {
                    toppingUp = false;
                    if (reserved) topUpTranscriptions();
                },
                (err) => {
                    toppingUp = false;
                    console.warn('[realtime] transcription hold failed', err);
                },
            );
        };
        // Spare items priced at another model are swapped for this one's.
        const priceTranscriptionsAt = (requested: string | undefined) => {
            const name = transcriptionBillingModel(requested);
            if (name === spareModel) return;
            releaseSpareTranscriptions();
            spareModel = name;
        };
        // The credit for an item the provider committed with no spare left.
        const holdCommittedTranscription = (
            name: string | undefined,
        ): Promise<CreditHold | null> => {
            const spare = spareTranscriptions.shift();
            if (spare) return Promise.resolve(spare);
            if (closed) return Promise.resolve(null);
            return (async (): Promise<CreditHold | null> => {
                const provisional = await planProvisional();
                const hold = await reserveTranscription(
                    transcriptionBillingModel(name),
                );
                if (!hold && !closed) {
                    await refuse(
                        'insufficient_funds',
                        'No transcription budget left',
                        provisional,
                    );
                }
                return hold;
            })().catch((err): null => {
                console.warn('[realtime] transcription hold failed', err);
                return null;
            });
        };
        const settleTranscription = (itemId: string) => {
            const pending = pendingTranscriptions.get(itemId);
            if (!pending) return undefined;
            pendingTranscriptions.delete(itemId);
            finishedTranscriptions.set(itemId, true);
            clearTimeout(pending.timer);
            // A slot under the pending cap may admit waiting audio.
            pumpPending();
            topUpTranscriptions();
            return pending;
        };

        // Upstream state the meter and the settle need. Runs for every
        // upstream event, before (and regardless of) forwarding.
        const track = (event: RealtimeEvent) => {
            switch (event.type) {
                case 'response.created': {
                    inFlight++;
                    requested = Math.max(0, requested - 1);
                    const id = event.response?.id;
                    if (typeof id !== 'string') break;
                    inFlightIds.add(id);
                    holdResponse(id);
                    if (checkPrompts)
                        responseCompletions.set(id, checkPrompt());
                    if (closed) {
                        upstream?.send(
                            JSON.stringify({
                                type: 'response.cancel',
                                response_id: id,
                            }),
                        );
                    }
                    break;
                }
                case 'response.done': {
                    inFlight = Math.max(0, inFlight - 1);
                    const usage = event.response?.usage ?? undefined;
                    const rows = realtimeUsageRows(billingModel, usage);
                    meter(rows, takeHold(event.response?.id));
                    if (typeof event.response?.id === 'string') {
                        inFlightIds.delete(event.response.id);
                        void logResponseCost(event.response.id, rows, usage);
                    }
                    if (inFlight === 0) {
                        onIdle?.();
                        if (
                            closed &&
                            requested === 0 &&
                            pendingTranscriptions.size === 0 &&
                            unackedFromMs === null
                        )
                            endUpstream();
                    }
                    break;
                }
                case 'input_audio_buffer.speech_started': {
                    // Detected speech is committed when it stops, from where
                    // the provider says it began.
                    if (unackedFromMs !== null || audioMs === ackedAtMs) break;
                    const start = (event as { audio_start_ms?: unknown })
                        .audio_start_ms;
                    unackedFromMs =
                        typeof start === 'number'
                            ? Math.min(Math.max(start, ackedAtMs), audioMs)
                            : ackedAtMs;
                    claimAudioHolds();
                    break;
                }
                case 'error':
                    // A commit of an empty buffer added no item.
                    if (
                        (event as { error?: { code?: unknown } }).error
                            ?.code === 'input_audio_buffer_commit_empty'
                    )
                        acknowledgeAudio();
                    break;
                case 'input_audio_buffer.cleared':
                    acknowledgeAudio();
                    break;
                case 'input_audio_buffer.committed': {
                    acknowledgeAudio();
                    if (
                        !transcriptionModel ||
                        typeof event.item_id !== 'string' ||
                        pendingTranscriptions.has(event.item_id) ||
                        finishedTranscriptions.has(event.item_id)
                    )
                        break;
                    if (
                        pendingTranscriptions.size >= MAX_PENDING_TRANSCRIPTIONS
                    ) {
                        finishedTranscriptions.set(event.item_id, true);
                        reject(
                            'rate_limit_exceeded',
                            'Transcription capacity exceeded',
                            CLOSE_TRY_AGAIN_LATER,
                        );
                        // Work beyond the pending cap has no reliable identity.
                        meter(unreportedTranscriptionRows(undefined));
                        endUpstream();
                        break;
                    }
                    const itemId = event.item_id;
                    const timer = setTimeout(() => {
                        const pending = settleTranscription(itemId);
                        if (!pending) return;
                        meter(
                            unreportedTranscriptionRows(pending.model),
                            pending.hold,
                        );
                        reject(
                            'upstream_error',
                            'Transcription usage timed out',
                            1011,
                        );
                    }, TRANSCRIPTION_TIMEOUT_MS);
                    pendingTranscriptions.set(itemId, {
                        model: transcriptionModel,
                        timer,
                        hold: holdCommittedTranscription(transcriptionModel),
                    });
                    topUpTranscriptions();
                    break;
                }
                case 'session.created':
                case 'session.updated':
                    transcriptionModel = transcriptionModelOf(event.session);
                    noteInputAudio(event.session);
                    // The provider's model reprices spare items; disabling
                    // keeps them, since audio already sent may still commit.
                    if (transcriptionModel) {
                        selectedTranscriptionModel = transcriptionModel;
                        if (spareModel !== undefined) {
                            priceTranscriptionsAt(transcriptionModel);
                            topUpTranscriptions();
                        }
                    }
                    {
                        const nextModel = realtimeBillingModel(
                            event.session,
                            billingModel,
                        );
                        if (!nextModel) {
                            billingModel = 'gpt-realtime-2.1';
                            reject(
                                'upstream_error',
                                'Provider reported an unsupported model',
                                1011,
                            );
                            endUpstream();
                            break;
                        }
                        billingModel = nextModel;
                    }
                    if (event.type === 'session.created') {
                        providerReady = true;
                        if (setupTimer) clearTimeout(setupTimer);
                        pumpPending();
                    }
                    break;
                case 'conversation.item.input_audio_transcription.failed':
                case TRANSCRIPTION_DONE: {
                    const itemId = event.item_id;
                    if (typeof itemId !== 'string') break;
                    const pending = settleTranscription(itemId);
                    if (!pending) break;
                    const rows =
                        event.type !== TRANSCRIPTION_DONE
                            ? unreportedTranscriptionRows(pending.model)
                            : event.usage
                              ? costlierRows(
                                    realtimeTranscriptionRows(
                                        pending.model,
                                        event.usage,
                                    ),
                                    realtimeTranscriptionRows(
                                        transcriptionModel,
                                        event.usage,
                                    ),
                                )
                              : unreportedTranscriptionRows(pending.model);
                    meter(rows, pending.hold);
                    if (!pendingTranscriptions.size && inFlight === 0) {
                        onIdle?.();
                        if (closed && requested === 0 && unackedFromMs === null)
                            endUpstream();
                    }
                    break;
                }
            }
        };

        const sendUpstream = (data: RawData, isBinary: boolean) => {
            const up = upstream!;
            if (
                up.bufferedAmount + (data as Buffer).length >
                HIGH_WATER_BYTES + MAX_REALTIME_MESSAGE_BYTES
            ) {
                reject('rate_limit_exceeded', 'Upstream queue is full');
                return;
            }
            up.send(data, { binary: isBinary }, () => {
                if (up.bufferedAmount < HIGH_WATER_BYTES) {
                    releaseClient('upstream');
                }
            });
            if (up.bufferedAmount >= HIGH_WATER_BYTES) holdClient('upstream');
        };

        // Reserves a spare item. Waits, with client reads paused, while the
        // pending cap is full or the account can't cover another item but
        // this session's held items may still free credit; refuses once
        // nothing is left to wait for.
        const admitTranscription = async (): Promise<boolean> => {
            while (!spareTranscriptions.length) {
                if (pendingTranscriptions.size >= MAX_PENDING_TRANSCRIPTIONS) {
                    holdClient('transcription');
                    return false;
                }
                const provisional = await planProvisional();
                const reserved = await reserveSpareTranscription();
                if (closed) return false;
                if (reserved) continue;
                if (heldTranscriptions > 0) {
                    holdClient('transcription');
                    return false;
                }
                await refuse(
                    'insufficient_funds',
                    'No transcription budget left',
                    provisional,
                );
                return false;
            }
            return true;
        };

        // Forwards queued client events in order. Returns a promise only while
        // an event waits for a transcription reservation.
        const forwardPending = (): Promise<void> | undefined => {
            while (pending.length && !closed) {
                const next = pending[0];
                const event = parseEvent(next.data as Buffer)!;
                const requestedModel =
                    event.type === 'session.update'
                        ? transcriptionModelOf(event.session)
                        : undefined;
                if (requestedModel) wantsTranscription = true;
                if (
                    (wantsTranscription || transcriptionModel) &&
                    (event.type === 'input_audio_buffer.append' ||
                        requestedModel)
                ) {
                    priceTranscriptionsAt(
                        requestedModel ?? selectedTranscriptionModel,
                    );
                    if (!spareTranscriptions.length) {
                        return admitTranscription().then((admitted) =>
                            admitted ? forwardPending() : undefined,
                        );
                    }
                    releaseClient('transcription');
                    topUpTranscriptions();
                    if (requestedModel)
                        selectedTranscriptionModel = requestedModel;
                    const audio = (event as unknown as { audio?: unknown })
                        .audio;
                    if (typeof audio === 'string' && audio) {
                        // Until the provider confirms a requested format,
                        // the lower rate counts the longer duration.
                        const rate = Math.min(
                            audioRate,
                            requestedAudioRate ?? audioRate,
                        );
                        if (!serverVad && unackedFromMs === null)
                            unackedFromMs = audioMs;
                        audioMs +=
                            (Buffer.byteLength(audio, 'base64') * 1000) / rate;
                        claimAudioHolds();
                    }
                } else if (
                    event.type === 'input_audio_buffer.commit' &&
                    unackedFromMs === null &&
                    audioMs > ackedAtMs
                ) {
                    // An explicit commit takes the buffer, silence included.
                    unackedFromMs = ackedAtMs;
                    claimAudioHolds();
                }
                if (event.type === 'session.update') {
                    const { rate } = inputAudioOf(event.session);
                    if (rate !== undefined) requestedAudioRate = rate;
                }
                pending.shift();
                pendingBytes -= (next.data as Buffer).length;
                if (event.type === 'response.create') requested++;
                if (checkPrompts) notePrompt(event);
                sendUpstream(next.data, next.isBinary);
            }
            return undefined;
        };

        const pumpPending = (): void => {
            if (
                closed ||
                !providerReady ||
                upstream?.readyState !== WebSocket.OPEN
            )
                return;
            if (pumping) {
                pumpAgain = true;
                return;
            }
            pumping = true;
            pumpAgain = false;
            const finish = () => {
                pumping = false;
                if (pumpAgain) pumpPending();
            };
            const failed = () => {
                reject(
                    'internal_error',
                    'Could not reserve transcription budget',
                    1011,
                );
                finish();
            };
            let waiting: Promise<void> | undefined;
            try {
                waiting = forwardPending();
            } catch {
                failed();
                return;
            }
            if (waiting) waiting.then(finish, failed);
            else finish();
        };

        client.on('message', (data, isBinary) => {
            if (closed) return;
            const size = (data as Buffer).length;
            if (!admitClientMessage()) return;
            const event = isBinary ? null : parseEvent(data as Buffer);
            if (!event) {
                reject(
                    'invalid_event',
                    'Expected a JSON object with a nonempty type',
                );
                return;
            }
            // Pricing follows the connection's model.
            if (
                event.type === 'session.update' &&
                isRecord(event.session) &&
                event.session.model !== undefined &&
                event.session.model !== model
            ) {
                reject(
                    'invalid_event',
                    'The session model is set by the connection URL',
                );
                return;
            }
            const refusal = clientEventRefusal(event);
            if (refusal) {
                reject('invalid_event', refusal);
                return;
            }
            spend(size);
            if (closed) return;

            if (
                pending.length >= MAX_PENDING_MESSAGES ||
                pendingBytes + size > MAX_PENDING_BYTES
            ) {
                reject(
                    'rate_limit_exceeded',
                    'Too much data before session readiness',
                );
                return;
            }
            pending.push({ data, isBinary });
            pendingBytes += size;
            pumpPending();
        });

        if (!Object.hasOwn(REALTIME_MODELS, model)) {
            reject(
                'model_not_found',
                `Model '${model}' is not available for realtime`,
            );
            return;
        }

        const ipGate = { allow: true, ip: clientIp };
        await this.clients.event.emitAndWait('ip.validate', ipGate, {});
        if (closed) return;
        if (!ipGate.allow) {
            reject('permission_denied', 'Connection refused');
            return;
        }
        try {
            if (!token || Buffer.byteLength(token) > MAX_TOKEN_BYTES)
                throw new Error('invalid token');
            identity = this.services.token.verify<AnyTokenPayload>(
                'auth',
                token,
            );
        } catch {
            reject('invalid_api_key', 'Authentication failed');
            return;
        }
        if (
            url.searchParams.get('purpose') === 'handover' &&
            !(await checkRateLimit(
                `${realtimeConnectKey(token!)}:handover`,
                HANDOVER_CONNECTS_PER_MINUTE,
                60_000,
                undefined,
                { failOpen: false },
            ))
        ) {
            reject(
                'rate_limit_exceeded',
                'Too many realtime handover attempts',
            );
            return;
        }
        if (
            !(await checkRateLimit(
                realtimeConnectKey(token!),
                CONNECTS_PER_MINUTE,
                60_000,
                undefined,
                { failOpen: false },
            ))
        ) {
            reject(
                'rate_limit_exceeded',
                'Too many realtime connection attempts',
            );
            return;
        }
        if (closed) return;
        try {
            actor = token
                ? await this.#authenticateCached(token, req, clientIp)
                : null;
        } catch (err) {
            // A lookup that failed says nothing about the credential.
            console.warn('[realtime] credential lookup failed', err);
            reject('internal_error', 'Could not verify credentials', 1011);
            return;
        }
        if (closed) return;
        if (!actor) {
            reject('invalid_api_key', 'Authentication failed');
            return;
        }
        const provisional = await planProvisional();
        try {
            await assertActorHasSubscription(
                this.services.metering,
                actor,
                true,
                this.config,
                { events: this.clients.event, surface: 'realtime.openai' },
            );
        } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 402 || status === 403) {
                await refuse(
                    'subscription_required',
                    'Realtime conversations require a subscription',
                    provisional,
                );
            } else {
                console.warn('[realtime] subscription check failed', err);
                reject('internal_error', 'Could not verify subscription', 1011);
            }
            return;
        }
        if (closed) return;
        // Enough for one response's hold, so a session that opens can answer.
        const probeProvisional = await planProvisional();
        const probe = await this.#metering.reserveAiCredits(
            actor,
            `openai:${model}:realtime:audio_output`,
            responseHoldAmount(model),
        );
        if (!probe) {
            await refuse(
                'insufficient_funds',
                'No usage left for request',
                probeProvisional,
            );
            return;
        }
        await probe.release();
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

        upstream = new WebSocket(
            `${this.config.realtime?.upstreamUrl ?? UPSTREAM_URL}?model=${encodeURIComponent(model)}`,
            {
                headers: { Authorization: `Bearer ${apiKey}` },
                handshakeTimeout: UPSTREAM_HANDSHAKE_MS,
                perMessageDeflate: false,
                maxPayload: MAX_UPSTREAM_MESSAGE_BYTES,
                // A large message arrives in many TLS records.
                maxFragments: 1024,
                maxBufferedChunks: 16 * 1024,
            },
        );
        const up = upstream;

        up.on('open', () => {
            if (closed) return;
            pumpPending();
        });
        up.on('message', (data, isBinary) => {
            const buf = data as Buffer;
            const event = !isBinary && parseEvent(buf);
            if (!event) {
                if (closed) endUpstream();
                else reject('upstream_error', 'Invalid upstream event', 1011);
                return;
            }
            track(event);
            if (closed || client.readyState !== WebSocket.OPEN) return;
            // Rate limits describe Puter's provider account, not the caller's.
            if (event.type === 'rate_limits.updated') return;
            const out = redactDiagnostics(event, buf);
            if (
                client.bufferedAmount + out.length >
                HIGH_WATER_BYTES + MAX_UPSTREAM_MESSAGE_BYTES
            ) {
                reject('rate_limit_exceeded', 'Client queue is full');
                return;
            }
            client.send(out, { binary: isBinary }, () => {
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
        });
        up.on('unexpected-response', (_req, res) => {
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
            console.warn('[realtime] upstream error', err.message);
            session.close(1011, 'upstream error');
        });
        up.on('close', (code, reason) => {
            if (settleTimer) clearTimeout(settleTimer);
            session.close(
                code === 1005 || code === 1006 ? 1011 : code,
                reason.toString().replace(ORG_ID, 'org-redacted').slice(0, 120),
            );
            const transcriptionRows: UsageInput[] = [];
            const transcriptionHolds: Promise<CreditHold | null>[] = [];
            for (const pending of pendingTranscriptions.values()) {
                clearTimeout(pending.timer);
                transcriptionRows.push(
                    ...unreportedTranscriptionRows(pending.model),
                );
                transcriptionHolds.push(pending.hold);
            }
            pendingTranscriptions.clear();
            // Audio the provider may have committed without acknowledging it.
            const unacked = unackedItems();
            if (unacked) {
                claimAudioHolds();
                unackedFromMs = null;
                transcriptionRows.push(
                    ...unreportedTranscriptionRows(
                        transcriptionModel ?? spareModel,
                        unacked,
                    ),
                );
                for (const hold of audioHolds.splice(0))
                    transcriptionHolds.push(Promise.resolve(hold));
            }
            meter(transcriptionRows, ...transcriptionHolds);
            releaseSpareTranscriptions();
            const holds = [...responseHolds.values()];
            responseHolds.clear();
            if (inFlight === 0) {
                for (const hold of holds) void releaseHold(hold);
                return;
            }
            this.clients.alarm.create(
                'realtime_unreported_response',
                'Realtime upstream closed before a response reported usage',
                {
                    userId: actor?.user?.uuid,
                    model: billingModel,
                    inFlight,
                    code,
                },
                'warning',
                { dedup: true },
            );
            // The holds are released once this charge is recorded.
            meter(unreportedResponseRows(billingModel, inFlight), ...holds);
        });
        onAdmitted();
    }

    async #record(
        actor: Actor,
        rows: UsageInput[],
        onExhausted: () => void,
    ): Promise<void> {
        try {
            const recorded = await this.#metering.batchIncrementUsages(
                actor,
                rows,
            );
            // Continuation asks whether settled credit remains; new work still
            // requires atomic admission including every outstanding hold.
            if (
                recorded.total > 0 &&
                !(await this.services.metering.hasAnyUsageCached(actor))
            ) {
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
        clientIp: string,
    ): Promise<Actor | null> {
        const key = realtimeAuthKey(token);
        let check = this.#authChecks.get(key);
        if (!check) {
            check = (async () => {
                try {
                    const actor = await this.#authenticate(
                        token,
                        req,
                        clientIp,
                    );
                    if (actor && this.#authChecks.get(key) === check) {
                        kv.set(key, actor.user!.uuid, { EX: AUTH_RECHECK_SEC });
                    }
                    return actor;
                } finally {
                    if (this.#authChecks.get(key) === check)
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
        clientIp: string,
    ): Promise<Actor | null> {
        const ua = req.headers['user-agent'];
        const result = await this.services.auth.authenticate(token, {
            ip: clientIp,
            touch: false,
            userAgent: typeof ua === 'string' ? ua : undefined,
        });
        if (result.blocked) return null;
        const user = result.actor?.user;
        const seat =
            user && !user.otp_enabled && typeof user.id === 'number'
                ? await this.stores.team?.getOrgSeat(user.id)
                : null;
        const decision = decideSocketAuth(result, {
            allowAppActors: true,
            teamRequires2fa: Number(seat?.require_2fa) === 1,
        });
        return 'accept' in decision ? decision.accept : null;
    }
}
