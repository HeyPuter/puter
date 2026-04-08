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
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Agent as HttpsAgent } from 'https';
import axios from 'axios';
import { redisClient } from '../../clients/redis/redisSingleton.js';
import eggspress from '../../api/eggspress.js';
import { BaseService } from '../../services/BaseService.js';
import { Context } from '../../util/context.js';

export class BroadcastService extends BaseService {
    #peersByKey = {};
    #webhookPeers = [];
    #incomingLastNonceByPeer = new Map();
    #outgoingNonceByPeer = new Map();
    #outboundEventsByDedupKey = new Map();
    #outboundFlushTimer = null;
    #outboundIsFlushing = false;
    #dedupFallbackCounter = 0;
    #webhookReplayWindowSeconds = 300;
    #outboundFlushMs = 5000;
    #webhookHostHeader = null;
    #webhookProtocol = 'https';
    #webhookHttpsAgent = new HttpsAgent({ rejectUnauthorized: false });
    #redisPubSubChannel = 'broadcast.webhook.events';
    #redisSubscriber = null;
    #redisSourceId = randomUUID();

    async _init () {
        const peers = this.config.peers ?? [];
        const replayWindowSeconds = this.config.webhook_replay_window_seconds ?? 300;
        const outboundFlushMs = Number(this.config.outbound_flush_ms ?? 2000);

        for ( const peer_config of peers ) {
            const peerId = this.#resolvePeerId(peer_config);
            if ( ! peerId ) {
                console.warn('ignoring broadcast peer config with missing key/peerId', { peer_config });
                continue;
            }

            if ( this.#peersByKey[peerId] ) {
                console.warn('duplicate broadcast peer id configured', {
                    peerId,
                    existing: this.#peersByKey[peerId]?.webhook_url,
                    duplicate: peer_config.webhook_url,
                });
            }

            this.#peersByKey[peerId] = {
                webhook_secret: peer_config.webhook_secret,
                webhook_url: peer_config.webhook_url,
                webhook: !!peer_config.webhook,
            };

            if ( peer_config.webhook ) {
                this.#webhookPeers.push({
                    ...peer_config,
                    peerId,
                });
            } else {
                console.warn('ignoring non-webhook broadcast peer; websocket transport is disabled', {
                    peerId,
                });
            }
        }

        this.#webhookReplayWindowSeconds = replayWindowSeconds;
        this.#outboundFlushMs = Number.isFinite(outboundFlushMs) && outboundFlushMs >= 0
            ? outboundFlushMs
            : 5000;
        this.#webhookHostHeader = this.global_config.domain;
        {
            const protocol = String(this.global_config.protocol ?? '').trim().replace(/:$/, '').toLowerCase();
            this.#webhookProtocol = protocol === 'http' || protocol === 'https' ? protocol : 'https';
        }
        this.#redisSourceId = `${String(this.global_config?.server_id ?? 'local')}:${randomUUID()}`;

        await this.#initRedisPubSub();

        const svc_event = this.services.get('event');
        svc_event.on('outer.*', this.outBroadcastEventHandler.bind(this));
    }

    async outBroadcastEventHandler (key, data, meta) {
        if ( meta?.from_outside ) return;

        const safeMeta = this.#normalizeMeta(meta);
        const outboundEvent = { key, data, meta: safeMeta };

        // Mirror local outer.pub events to Redis so same-cluster replicas
        // receive them even when this instance is the originator.
        this.#publishWebhookEventsToRedis([outboundEvent]).catch(error => {
            console.warn('local redis pubsub publish failed', { error, key });
        });

        this.#enqueueOutboundEvent(outboundEvent);
    }

    #enqueueOutboundEvent (event) {
        const dedupKey = this.#createDedupKey(event);
        this.#outboundEventsByDedupKey.set(dedupKey, event);
        this.#scheduleOutboundFlush();
    }

    #createDedupKey (event) {
        try {
            return JSON.stringify(event);
        } catch {
            const fallbackKey = `fallback-${this.#dedupFallbackCounter}`;
            this.#dedupFallbackCounter += 1;
            return fallbackKey;
        }
    }

    #scheduleOutboundFlush () {
        if ( this.#outboundFlushTimer ) return;

        this.#outboundFlushTimer = setTimeout(async () => {
            this.#outboundFlushTimer = null;
            try {
                await this.#flushOutboundEvents();
            } catch ( error ) {
                console.warn('outbound broadcast flush failed', { error });
            }
        }, this.#outboundFlushMs);
    }

    async #flushOutboundEvents () {
        if ( this.#outboundIsFlushing || this.#outboundEventsByDedupKey.size === 0 ) return;

        this.#outboundIsFlushing = true;
        try {
            const events = [...this.#outboundEventsByDedupKey.values()];
            this.#outboundEventsByDedupKey.clear();

            for ( const peer_config of this.#webhookPeers ) {
                try {
                    await this.#sendWebhookToPeer(peer_config, events);
                } catch (e) {
                    console.warn(`webhook broadcast send error: ${ JSON.stringify({ peer: peer_config.peerId ?? peer_config.key, error: e.message })}`);
                }
            }
        } finally {
            this.#outboundIsFlushing = false;
            if ( this.#outboundEventsByDedupKey.size > 0 ) {
                this.#scheduleOutboundFlush();
            }
        }
    }

    #normalizeMeta (meta) {
        if ( !meta || typeof meta !== 'object' || Array.isArray(meta) ) {
            return {};
        }
        return meta;
    }

    #resolveLocalPeerId () {
        const localPeerId = this.config?.webhook?.peerId ?? this.config?.webhook?.key;
        if ( typeof localPeerId !== 'string' || localPeerId.trim() === '' ) return null;
        return localPeerId.trim();
    }

    #resolvePeerId (peerConfig) {
        if ( !peerConfig || typeof peerConfig !== 'object' ) return null;
        const peerId = peerConfig.peerId ?? peerConfig.key;
        if ( typeof peerId !== 'string' || peerId.trim() === '' ) return null;
        return peerId.trim();
    }

    #isNonceReplayForPeer ({ timestamp, nonce, peerId }) {
        const lastSeen = this.#incomingLastNonceByPeer.get(peerId);
        if ( ! lastSeen ) return false;

        // A newer timestamp should reset nonce ordering for this peer.
        if ( timestamp > lastSeen.timestamp ) return false;
        if ( timestamp < lastSeen.timestamp ) return true;
        return nonce <= lastSeen.nonce;
    }

    async #initRedisPubSub () {
        if ( typeof redisClient?.duplicate !== 'function' ) {
            console.warn('redis pubsub unavailable; duplicate client is not supported');
            return;
        }

        try {
            this.#redisSubscriber = redisClient.duplicate();
            this.#redisSubscriber.on('error', error => {
                console.warn('redis pubsub subscriber error', { error });
            });
            this.#redisSubscriber.on('message', (channel, message) => {
                this.#handleRedisPubSubMessage(channel, message).catch(error => {
                    console.warn('redis pubsub message handling error', { error });
                });
            });
            await this.#redisSubscriber.subscribe(this.#redisPubSubChannel);
        } catch ( error ) {
            console.warn('failed to initialize redis pubsub subscriber', { error });
            this.#redisSubscriber = null;
        }
    }

    #isRedisWebhookEventKey (key) {
        if ( typeof key !== 'string' ) return false;
        return key === 'outer.pub' ||
            key.startsWith('outer.pub.');
    }

    #filterRedisWebhookEvents (events) {
        return events.filter(event => this.#isRedisWebhookEventKey(event?.key));
    }

    async #publishWebhookEventsToRedis (events) {
        if ( !Array.isArray(events) || events.length === 0 ) return;

        const eventsToPublish = this.#filterRedisWebhookEvents(events);
        if ( eventsToPublish.length === 0 ) return;

        let payload;
        try {
            payload = JSON.stringify({
                sourceId: this.#redisSourceId,
                events: eventsToPublish,
            });
        } catch ( error ) {
            console.warn('redis pubsub publish failed: payload not serializable', { error });
            return;
        }

        try {
            await redisClient.publish(this.#redisPubSubChannel, payload);
        } catch ( error ) {
            console.warn('redis pubsub publish failed', { error });
        }
    }

    async #handleRedisPubSubMessage (channel, message) {
        if ( channel !== this.#redisPubSubChannel ) return;

        let payload;
        try {
            payload = JSON.parse(message);
        } catch {
            console.warn('invalid redis pubsub payload: not json');
            return;
        }

        if ( !payload || typeof payload !== 'object' || Array.isArray(payload) ) {
            console.warn('invalid redis pubsub payload: expected object');
            return;
        }

        if ( payload.sourceId && payload.sourceId === this.#redisSourceId ) {
            return;
        }

        const incomingEvents = this.#normalizeIncomingPayload(payload);
        if ( ! incomingEvents ) {
            console.warn('invalid redis pubsub payload: invalid events');
            return;
        }

        const eventsToEmit = this.#filterRedisWebhookEvents(incomingEvents);
        if ( eventsToEmit.length === 0 ) return;

        await this.#emitIncomingEventsSequentially(eventsToEmit);
    }

    #normalizeIncomingPayload (payload) {
        if ( !payload || typeof payload !== 'object' || Array.isArray(payload) ) {
            return null;
        }

        if ( Array.isArray(payload.events) ) {
            const events = [];
            for ( const event of payload.events ) {
                const normalized = this.#normalizeIncomingEvent(event);
                if ( ! normalized ) return null;
                events.push(normalized);
            }
            return events;
        }

        const normalized = this.#normalizeIncomingEvent(payload);
        if ( ! normalized ) return null;
        return [normalized];
    }

    #normalizeIncomingEvent (event) {
        if ( !event || typeof event !== 'object' || Array.isArray(event) ) {
            return null;
        }

        const { key, data } = event;
        if ( key === undefined || key === null ) {
            return null;
        }
        if ( data === undefined ) {
            return null;
        }

        return {
            key,
            data,
            meta: this.#normalizeMeta(event.meta),
        };
    }

    async #emitIncomingEventsSequentially (events) {
        const svcEvent = this.services.get('event');
        const context = Context.get(undefined, { allow_fallback: true });

        for ( const event of events ) {
            if ( event.meta?.from_outside ) {
                console.warn('possible over-sending');
                continue;
            }

            if ( event.key === 'test' ) {
                console.debug(`test message: ${JSON.stringify(event.data)}`);
            }

            const metaOut = { ...event.meta, from_outside: true };
            await context.arun(async () => {
                await svcEvent.emit(event.key, event.data, metaOut);
            });
        }
    }

    async '__on_install.routes' (_, { app }) {
        const svc_web = this.services.get('web-server');
        svc_web.allow_undefined_origin('/broadcast/webhook');

        app.use(eggspress('/broadcast/webhook', {
            allowedMethods: ['POST'],
        }, this.#handleWebhookRequest.bind(this)));
    }

    async #handleWebhookRequest (req, res) {
        const rawBody = req.rawBody;
        if ( rawBody === undefined || rawBody === null ) {
            res.status(400).send({ error: { message: 'Missing or invalid body' } });
            return;
        }

        const body = req.body;
        if ( !body || typeof body !== 'object' ) {
            res.status(400).send({ error: { message: 'Invalid JSON body' } });
            return;
        }

        const incomingEvents = this.#normalizeIncomingPayload(body);
        if ( ! incomingEvents ) {
            res.status(400).send({ error: { message: 'Invalid broadcast payload' } });
            return;
        }

        const peerIdHeader = req.headers['x-broadcast-peer-id'];
        const peerId = Array.isArray(peerIdHeader) ? peerIdHeader[0] : peerIdHeader;
        if ( ! peerId ) {
            res.status(403).send({ error: { message: 'Missing X-Broadcast-Peer-Id' } });
            return;
        }
        const localPeerId = this.#resolveLocalPeerId();
        if ( localPeerId && peerId === localPeerId ) {
            res.status(200).send({ ok: true, ignored: 'self-peer' });
            return;
        }

        const peer = this.#peersByKey[peerId];
        if ( !peer || !peer.webhook_secret ) {
            res.status(403).send({ error: { message: 'Unknown peer or webhook not configured' } });
            return;
        }

        // Timestamp avoids nonce-reuse after a restart
        const timestampHeader = req.headers['x-broadcast-timestamp'];
        if ( ! timestampHeader ) {
            res.status(400).send({ error: { message: 'Missing X-Broadcast-Timestamp' } });
            return;
        }
        const timestamp = Number(timestampHeader);
        if ( Number.isNaN(timestamp) ) {
            res.status(400).send({ error: { message: 'Invalid X-Broadcast-Timestamp' } });
            return;
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        const window = this.#webhookReplayWindowSeconds;
        if ( timestamp < nowSeconds - window || timestamp > nowSeconds + 60 ) {
            res.status(400).send({ error: { message: 'Timestamp out of window' } });
            return;
        }

        // Nonce avoids replay attacks
        const nonceHeader = req.headers['x-broadcast-nonce'];
        if ( nonceHeader === undefined || nonceHeader === null || nonceHeader === '' ) {
            res.status(400).send({ error: { message: 'Missing X-Broadcast-Nonce' } });
            return;
        }
        const nonce = Number(nonceHeader);
        if ( Number.isNaN(nonce) ) {
            res.status(400).send({ error: { message: 'Invalid X-Broadcast-Nonce' } });
            return;
        }
        if ( this.#isNonceReplayForPeer({ timestamp, nonce, peerId }) ) {
            res.status(403).send({ error: { message: 'Duplicate or stale nonce' } });
            return;
        }

        // We verify a signature to ensure the message came from an authorized peer
        const signatureHeader = req.headers['x-broadcast-signature'];
        if ( ! signatureHeader ) {
            res.status(403).send({ error: { message: 'Missing X-Broadcast-Signature' } });
            return;
        }

        const payloadToSign = `${timestamp}.${nonce}.${rawBody}`;
        const expectedHmac = createHmac('sha256', peer.webhook_secret).update(payloadToSign).digest('hex');
        const signatureBuffer = Buffer.from(signatureHeader, 'hex');
        const expectedBuffer = Buffer.from(expectedHmac, 'hex');
        if ( signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer) ) {
            res.status(403).send({ error: { message: 'Invalid signature' } });
            return;
        }

        this.#incomingLastNonceByPeer.set(peerId, { timestamp, nonce });

        await this.#publishWebhookEventsToRedis(incomingEvents);
        await this.#emitIncomingEventsSequentially(incomingEvents);

        res.status(200).send({ ok: true });
    }

    async #sendWebhookToPeer (peer_config, events) {
        const peerId = this.#resolvePeerId(peer_config);
        if ( ! peerId ) return;
        const url = peer_config.webhook_url;
        const requestUrl = this.#normalizeWebhookUrl(url);
        const mySecretKey = this.config.webhook?.secret ?? '';

        if ( !requestUrl || !mySecretKey ) return;

        let nextNonce = this.#outgoingNonceByPeer.get(peerId) ?? 0;
        this.#outgoingNonceByPeer.set(peerId, nextNonce + 1);

        const timestamp = Math.floor(Date.now() / 1000);
        const body = { events };
        const rawBody = JSON.stringify(body);
        const payloadToSign = `${timestamp}.${nextNonce}.${rawBody}`;
        const signature = createHmac('sha256', mySecretKey).update(payloadToSign).digest('hex');

        const myPublicKey = this.config.webhook?.peerId ?? this.config.webhook?.key ?? '';
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(rawBody)),
            'X-Broadcast-Peer-Id': myPublicKey,
            'X-Broadcast-Timestamp': String(timestamp),
            'X-Broadcast-Nonce': String(nextNonce),
            'X-Broadcast-Signature': signature,
            ...(this.#webhookHostHeader ? { Host: this.#webhookHostHeader } : {}),
        };

        const response = await axios.request({
            method: 'POST',
            url: requestUrl,
            headers,
            data: rawBody,
            timeout: 15000,
            validateStatus: () => true,
            responseType: 'text',
            transformResponse: value => value,
            ...(requestUrl.startsWith('https:')
                ? { httpsAgent: this.#webhookHttpsAgent }
                : {}),
        });

        if ( response.status < 200 || response.status >= 300 ) {
            console.warn(`error with body: ${response.data}`);
            throw new Error(`Webhook POST failed: ${response.status} ${response.statusText}`);
        }
    }

    #normalizeWebhookUrl (url) {
        if ( typeof url !== 'string' || url.trim() === '' ) {
            return null;
        }

        const urlValue = url.trim();
        let parsedUrl;
        try {
            parsedUrl = urlValue.includes('://')
                ? new URL(urlValue)
                : new URL(`${this.#webhookProtocol}://${urlValue}`);
        } catch {
            return null;
        }

        parsedUrl.protocol = `${this.#webhookProtocol}:`;
        return parsedUrl.toString();
    }
}
