import { createHmac, timingSafeEqual } from 'node:crypto';
import { Agent as HttpsAgent } from 'node:https';
import axios from 'axios';
import { PuterService } from '../types.js';

// ── Config shape ────────────────────────────────────────────────────

interface PeerConfig {
    /** Stable id of the peer (also sent as `X-Broadcast-Peer-Id`). */
    peerId?: string;
    /** Whether this peer should receive webhooks. Non-webhook peers are skipped. */
    webhook?: boolean;
    /** HTTPS endpoint to POST broadcast events to. */
    webhook_url?: string;
    /** HMAC-SHA256 secret shared with the peer for signing. */
    webhook_secret?: string;
}

interface SelfConfig {
    /** This server's peerId, sent in outbound POSTs as `X-Broadcast-Peer-Id`. */
    peerId?: string;
    /** Secret used to sign OUTBOUND POSTs. Peers verify with their copy. */
    secret?: string;
}

interface BroadcastConfig {
    peers?: PeerConfig[];
    webhook?: SelfConfig;
    /** Reject webhooks whose timestamp is more than this many seconds in the past. Default 300. */
    webhook_replay_window_seconds?: number;
    /** Time to wait coalescing outbound events into a single peer POST. Default 2000ms. */
    outbound_flush_ms?: number;
}

// ── Wire types ──────────────────────────────────────────────────────

interface BroadcastEvent {
    key: string;
    data: unknown;
    meta: Record<string, unknown>;
}

interface IncomingPayload {
    events?: unknown;
    key?: string;
    data?: unknown;
    meta?: unknown;
}

interface IncomingResult {
    ok: boolean;
    /** HTTP status to send when ok===false. */
    status?: number;
    /** Error message body when ok===false. */
    message?: string;
    /** Optional informational payload to include when ok===true. */
    info?: Record<string, unknown>;
}

interface IncomingHeaders {
    peerId: string | undefined;
    timestamp: string | undefined;
    nonce: string | undefined;
    signature: string | undefined;
}

// ── Service ─────────────────────────────────────────────────────────

/**
 * Cross-node event replication via signed HTTP webhooks.
 *
 * **Outbound** — subscribes to local `outer.*` events on the event bus.
 * Each event is added to a small in-memory map (deduped by serialized
 * shape), then flushed every `outbound_flush_ms` as a single POST per
 * configured peer. Each POST carries:
 *
 *   - `X-Broadcast-Peer-Id` — this server's own peerId
 *   - `X-Broadcast-Timestamp` — unix seconds, peer rejects ±5min
 *   - `X-Broadcast-Nonce` — monotonic per-peer counter, peer rejects replays
 *   - `X-Broadcast-Signature` — HMAC-SHA256 of `<ts>.<nonce>.<rawBody>`
 *
 * **Inbound** — `BroadcastController` accepts POSTs at `/broadcast/webhook`
 * and hands each one off to `verifyAndEmit()`. The service validates the
 * HMAC + nonce + timestamp window, then re-emits each contained event
 * onto the local bus tagged with `meta.from_outside = true` so the
 * outbound subscriber doesn't bounce it back.
 *
 * Self-loop avoidance:
 *   - Outbound subscriber skips events with `meta.from_outside`.
 *   - Inbound handler ignores POSTs whose `X-Broadcast-Peer-Id` matches
 *     this server's own peerId (catches misconfigured loopbacks).
 *
 * No Redis pub/sub here — webhooks are the only transport. Same-cluster
 * fan-out is handled by sockets via the Redis streams adapter, so an
 * additional Redis channel here would just duplicate work.
 */
export class BroadcastService extends PuterService {
    /** peerId → resolved peer config, used for incoming-verify lookup. */
    #peersByKey: Record<string, PeerConfig> = {};
    /** Subset of peers with `webhook: true`, used for outbound fan-out. */
    #webhookPeers: PeerConfig[] = [];
    /** peerId → last accepted {timestamp, nonce} pair (replay protection). */
    #incomingLastNonceByPeer = new Map<string, { timestamp: number; nonce: number }>();
    /** peerId → next nonce we'll send. Monotonic; bumped on every send. */
    #outgoingNonceByPeer = new Map<string, number>();

    /** Coalesced outbound events, keyed by serialized shape. */
    #outboundEventsByDedupKey = new Map<string, BroadcastEvent>();
    #outboundFlushTimer: ReturnType<typeof setTimeout> | null = null;
    #outboundIsFlushing = false;
    #dedupFallbackCounter = 0;

    #webhookReplayWindowSeconds = 300;
    #outboundFlushMs = 2000;
    #webhookProtocol: 'http' | 'https' = 'https';
    #webhookHostHeader: string | null = null;
    /** Self-signed certs are common between Puter nodes — accept them. */
    #webhookHttpsAgent = new HttpsAgent({ rejectUnauthorized: false });

    // ── Lifecycle ───────────────────────────────────────────────────

    override onServerStart (): void {
        this.#loadConfig();
        this.#subscribeOutbound();
    }

    override async onServerPrepareShutdown (): Promise<void> {
        if ( this.#outboundFlushTimer ) {
            clearTimeout(this.#outboundFlushTimer);
            this.#outboundFlushTimer = null;
        }
        // Best-effort drain — try one final flush so events queued near
        // shutdown make it out.
        try {
            await this.#flushOutboundEvents();
        } catch ( err ) {
            console.warn('[broadcast] final flush failed', err);
        }
    }

    // ── Public API used by BroadcastController ──────────────────────

    /**
     * Verify an incoming webhook POST and, if valid, fan its events
     * onto the local event bus (tagged `from_outside: true`).
     *
     * Caller (controller) provides the request's parsed JSON body, the
     * raw bytes that JSON came from (HMAC verifies over those exact
     * bytes), and the four broadcast headers.
     */
    async verifyAndEmit (
        rawBody: Buffer | undefined,
        body: unknown,
        headers: IncomingHeaders,
    ): Promise<IncomingResult> {
        if ( ! rawBody ) {
            return { ok: false, status: 400, message: 'Missing or invalid body' };
        }
        if ( !body || typeof body !== 'object' ) {
            return { ok: false, status: 400, message: 'Invalid JSON body' };
        }

        const incomingEvents = this.#normalizeIncomingPayload(body as IncomingPayload);
        if ( ! incomingEvents ) {
            return { ok: false, status: 400, message: 'Invalid broadcast payload' };
        }

        const peerId = headers.peerId;
        if ( ! peerId ) {
            return { ok: false, status: 403, message: 'Missing X-Broadcast-Peer-Id' };
        }

        // Defend against a misconfigured peer that includes us in its
        // own peer list — easy mistake when bootstrapping a cluster.
        const localPeerId = this.#resolveLocalPeerId();
        if ( localPeerId && peerId === localPeerId ) {
            return { ok: true, info: { ignored: 'self-peer' } };
        }

        const peer = this.#peersByKey[peerId];
        if ( !peer || !peer.webhook_secret ) {
            return { ok: false, status: 403, message: 'Unknown peer or webhook not configured' };
        }

        const tsCheck = this.#parseTimestamp(headers.timestamp);
        if ( ! tsCheck.ok ) return tsCheck;
        const timestamp = tsCheck.timestamp;

        const nonceCheck = this.#parseNonce(headers.nonce);
        if ( ! nonceCheck.ok ) return nonceCheck;
        const nonce = nonceCheck.nonce;

        if ( this.#isNonceReplayForPeer({ timestamp, nonce, peerId }) ) {
            return { ok: false, status: 403, message: 'Duplicate or stale nonce' };
        }

        if ( ! headers.signature ) {
            return { ok: false, status: 403, message: 'Missing X-Broadcast-Signature' };
        }

        const payloadToSign = `${timestamp}.${nonce}.${rawBody.toString('utf8')}`;
        const expectedHmac = createHmac('sha256', peer.webhook_secret).update(payloadToSign).digest('hex');
        const signatureBuffer = Buffer.from(headers.signature, 'hex');
        const expectedBuffer = Buffer.from(expectedHmac, 'hex');
        if (
            signatureBuffer.length !== expectedBuffer.length
            || !timingSafeEqual(signatureBuffer, expectedBuffer)
        ) {
            return { ok: false, status: 403, message: 'Invalid signature' };
        }

        // Verified — record nonce and dispatch.
        this.#incomingLastNonceByPeer.set(peerId, { timestamp, nonce });
        await this.#emitIncomingEventsSequentially(incomingEvents);
        return { ok: true };
    }

    // ── Outbound: subscribe + queue + flush ────────────────────────

    #subscribeOutbound (): void {
        // Wildcard: every `outer.*` event gets considered for broadcast.
        // The handler skips events that came in via webhook (meta.from_outside)
        // so we don't bounce them back to peers.
        this.clients.event.on('outer.*', (key: string, data: unknown, meta: object) => {
            this.#handleOutbound(key, data, meta);
        });
    }

    #handleOutbound (key: string, data: unknown, meta: object | undefined): void {
        const safeMeta = this.#normalizeMeta(meta);
        if ( safeMeta.from_outside ) return;

        const event: BroadcastEvent = { key, data, meta: safeMeta };
        const dedupKey = this.#createDedupKey(event);
        this.#outboundEventsByDedupKey.set(dedupKey, event);
        this.#scheduleOutboundFlush();
    }

    #createDedupKey (event: BroadcastEvent): string {
        try {
            return JSON.stringify(event);
        } catch {
            this.#dedupFallbackCounter += 1;
            return `fallback-${this.#dedupFallbackCounter}`;
        }
    }

    #scheduleOutboundFlush (): void {
        if ( this.#outboundFlushTimer ) return;
        this.#outboundFlushTimer = setTimeout(() => {
            this.#outboundFlushTimer = null;
            void this.#flushOutboundEvents().catch((err) => {
                console.warn('[broadcast] outbound flush failed', err);
            });
        }, this.#outboundFlushMs);
    }

    async #flushOutboundEvents (): Promise<void> {
        if ( this.#outboundIsFlushing || this.#outboundEventsByDedupKey.size === 0 ) return;

        this.#outboundIsFlushing = true;
        try {
            const events = [...this.#outboundEventsByDedupKey.values()];
            this.#outboundEventsByDedupKey.clear();

            for ( const peer of this.#webhookPeers ) {
                try {
                    await this.#sendWebhookToPeer(peer, events);
                } catch ( err ) {
                    const peerId = peer.peerId ?? 'unknown';
                    console.warn(`[broadcast] webhook send to peer ${peerId} failed`, err);
                }
            }
        } finally {
            this.#outboundIsFlushing = false;
            // Anything that arrived during flush gets the next tick.
            if ( this.#outboundEventsByDedupKey.size > 0 ) {
                this.#scheduleOutboundFlush();
            }
        }
    }

    async #sendWebhookToPeer (peer: PeerConfig, events: BroadcastEvent[]): Promise<void> {
        const peerId = this.#resolvePeerIdOf(peer);
        if ( ! peerId ) return;
        const requestUrl = this.#normalizeWebhookUrl(peer.webhook_url);
        const mySecret = this.#self()?.secret;
        if ( !requestUrl || !mySecret ) return;

        const nextNonce = this.#outgoingNonceByPeer.get(peerId) ?? 0;
        this.#outgoingNonceByPeer.set(peerId, nextNonce + 1);

        const timestamp = Math.floor(Date.now() / 1000);
        const rawBody = JSON.stringify({ events });
        const payloadToSign = `${timestamp}.${nextNonce}.${rawBody}`;
        const signature = createHmac('sha256', mySecret).update(payloadToSign).digest('hex');

        const myPublicId = this.#resolveLocalPeerId() ?? '';
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(rawBody)),
            'X-Broadcast-Peer-Id': myPublicId,
            'X-Broadcast-Timestamp': String(timestamp),
            'X-Broadcast-Nonce': String(nextNonce),
            'X-Broadcast-Signature': signature,
        };
        if ( this.#webhookHostHeader ) headers.Host = this.#webhookHostHeader;

        const response = await axios.request({
            method: 'POST',
            url: requestUrl,
            headers,
            data: rawBody,
            timeout: 15_000,
            // We translate non-2xx into a thrown error ourselves so we
            // can log the response body on failure.
            validateStatus: () => true,
            responseType: 'text',
            transformResponse: (value: unknown) => value,
            ...(requestUrl.startsWith('https:') ? { httpsAgent: this.#webhookHttpsAgent } : {}),
        });

        if ( response.status < 200 || response.status >= 300 ) {
            console.warn(`[broadcast] peer ${peerId} responded ${response.status}: ${response.data}`);
            throw new Error(`Webhook POST failed: ${response.status} ${response.statusText}`);
        }
    }

    // ── Inbound helpers ─────────────────────────────────────────────

    #normalizeIncomingPayload (payload: IncomingPayload): BroadcastEvent[] | null {
        if ( !payload || typeof payload !== 'object' || Array.isArray(payload) ) return null;

        // Either `{ events: [...] }` or a single event spread at top level.
        if ( Array.isArray(payload.events) ) {
            const out: BroadcastEvent[] = [];
            for ( const ev of payload.events ) {
                const norm = this.#normalizeIncomingEvent(ev);
                if ( ! norm ) return null;
                out.push(norm);
            }
            return out;
        }

        const norm = this.#normalizeIncomingEvent(payload);
        return norm ? [norm] : null;
    }

    #normalizeIncomingEvent (event: unknown): BroadcastEvent | null {
        if ( !event || typeof event !== 'object' || Array.isArray(event) ) return null;
        const e = event as { key?: unknown; data?: unknown; meta?: unknown };
        if ( typeof e.key !== 'string' || e.key.length === 0 ) return null;
        if ( e.data === undefined ) return null;
        return {
            key: e.key,
            data: e.data,
            meta: this.#normalizeMeta(e.meta),
        };
    }

    async #emitIncomingEventsSequentially (events: BroadcastEvent[]): Promise<void> {
        for ( const event of events ) {
            // Belt-and-braces: a misbehaving peer that forwards already
            // outside-tagged events would otherwise bounce ad infinitum.
            if ( event.meta?.from_outside ) {
                console.warn('[broadcast] dropping incoming event already tagged from_outside', { key: event.key });
                continue;
            }
            const metaOut = { ...event.meta, from_outside: true };
            try {
                this.clients.event.emit(event.key, event.data, metaOut);
            } catch ( err ) {
                console.warn('[broadcast] event re-emit failed', { key: event.key, err });
            }
        }
    }

    #isNonceReplayForPeer ({ timestamp, nonce, peerId }: { timestamp: number; nonce: number; peerId: string }): boolean {
        const last = this.#incomingLastNonceByPeer.get(peerId);
        if ( ! last ) return false;
        // A newer timestamp resets the nonce window for this peer.
        if ( timestamp > last.timestamp ) return false;
        if ( timestamp < last.timestamp ) return true;
        return nonce <= last.nonce;
    }

    #parseTimestamp (raw: string | undefined): { ok: true; timestamp: number } | (IncomingResult & { ok: false }) {
        if ( ! raw ) return { ok: false, status: 400, message: 'Missing X-Broadcast-Timestamp' };
        const ts = Number(raw);
        if ( Number.isNaN(ts) ) return { ok: false, status: 400, message: 'Invalid X-Broadcast-Timestamp' };
        const nowSec = Math.floor(Date.now() / 1000);
        const window = this.#webhookReplayWindowSeconds;
        // 60s of forward tolerance for clock skew; the rest is replay-
        // window backstop.
        if ( ts < nowSec - window || ts > nowSec + 60 ) {
            return { ok: false, status: 400, message: 'Timestamp out of window' };
        }
        return { ok: true, timestamp: ts };
    }

    #parseNonce (raw: string | undefined): { ok: true; nonce: number } | (IncomingResult & { ok: false }) {
        if ( raw === undefined || raw === null || raw === '' ) {
            return { ok: false, status: 400, message: 'Missing X-Broadcast-Nonce' };
        }
        const n = Number(raw);
        if ( Number.isNaN(n) ) return { ok: false, status: 400, message: 'Invalid X-Broadcast-Nonce' };
        return { ok: true, nonce: n };
    }

    // ── Misc ────────────────────────────────────────────────────────

    #normalizeMeta (meta: unknown): Record<string, unknown> {
        if ( !meta || typeof meta !== 'object' || Array.isArray(meta) ) return {};
        return meta as Record<string, unknown>;
    }

    #resolveLocalPeerId (): string | null {
        const id = this.#self()?.peerId;
        if ( typeof id !== 'string' || id.trim() === '' ) return null;
        return id.trim();
    }

    #resolvePeerIdOf (peer: PeerConfig): string | null {
        const id = peer.peerId;
        if ( typeof id !== 'string' || id.trim() === '' ) return null;
        return id.trim();
    }

    #self (): SelfConfig | undefined {
        return this.#broadcastConfig().webhook;
    }

    #broadcastConfig (): BroadcastConfig {
        return this.config.broadcast ?? {};
    }

    #normalizeWebhookUrl (url: string | undefined): string | null {
        if ( typeof url !== 'string' || url.trim() === '' ) return null;
        const trimmed = url.trim();
        let parsed: URL;
        try {
            parsed = trimmed.includes('://')
                ? new URL(trimmed)
                : new URL(`${this.#webhookProtocol}://${trimmed}`);
        } catch {
            return null;
        }
        // Coerce protocol so a misconfigured `http://...` peer URL still
        // gets sent over our preferred transport.
        parsed.protocol = `${this.#webhookProtocol}:`;
        return parsed.toString();
    }

    #loadConfig (): void {
        const cfg = this.#broadcastConfig();
        const peers = cfg.peers ?? [];

        for ( const peerCfg of peers ) {
            const peerId = this.#resolvePeerIdOf(peerCfg);
            if ( ! peerId ) {
                console.warn('[broadcast] ignoring peer config with missing key/peerId', { peerCfg });
                continue;
            }
            if ( this.#peersByKey[peerId] ) {
                console.warn('[broadcast] duplicate peer id', {
                    peerId,
                    existing: this.#peersByKey[peerId]?.webhook_url,
                    duplicate: peerCfg.webhook_url,
                });
            }
            this.#peersByKey[peerId] = {
                peerId,
                webhook_secret: peerCfg.webhook_secret,
                webhook_url: peerCfg.webhook_url,
                webhook: !!peerCfg.webhook,
            };
            if ( peerCfg.webhook ) {
                this.#webhookPeers.push({ ...peerCfg, peerId });
            } else {
                console.warn('[broadcast] non-webhook peer ignored (websocket transport disabled in v2)', { peerId });
            }
        }

        this.#webhookReplayWindowSeconds = Number(cfg.webhook_replay_window_seconds ?? 300);
        const flushMs = Number(cfg.outbound_flush_ms ?? 2000);
        this.#outboundFlushMs = Number.isFinite(flushMs) && flushMs >= 0 ? flushMs : 2000;

        this.#webhookHostHeader = this.config.domain ?? null;
        const protoRaw = String(this.config.protocol ?? '')
            .trim().replace(/:$/, '').toLowerCase();
        this.#webhookProtocol = protoRaw === 'http' || protoRaw === 'https' ? protoRaw : 'https';
    }
}
