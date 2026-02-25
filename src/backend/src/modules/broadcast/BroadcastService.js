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
import { createHmac, timingSafeEqual } from 'crypto';
import { Server as SocketIoServer } from 'socket.io';
import { BaseService } from '../../services/BaseService.js';
import { Context } from '../../util/context.js';
import { Endpoint } from '../../util/expressutil.js';
import { CLink } from './connection/CLink.js';
import { SLink } from './connection/SLink.js';

export class BroadcastService extends BaseService {
    #peers = [];
    #connections = [];
    #trustedPublicKeys = {};
    #peersByKey = {};
    #webhookPeers = [];
    #incomingLastNonceByPeer = new Map();
    #outgoingNonceByPeer = new Map();
    #outboundEventsByDedupKey = new Map();
    #outboundFlushTimer = null;
    #outboundIsFlushing = false;
    #incomingEmitChain = Promise.resolve();
    #dedupFallbackCounter = 0;
    #webhookReplayWindowSeconds = 300;
    #outboundFlushMs = 5000;

    async _init () {
        const peers = this.config.peers ?? [];
        const replayWindowSeconds = this.config.webhook_replay_window_seconds ?? 300;
        const outboundFlushMs = Number(this.config.outbound_flush_ms ?? 5000);

        for ( const peer_config of peers ) {
            this.#trustedPublicKeys[peer_config.key] = true;
            this.#peersByKey[peer_config.key] = {
                webhook_secret: peer_config.webhook_secret,
                webhook_url: peer_config.webhook_url,
                webhook: !!peer_config.webhook,
            };

            if ( peer_config.webhook ) {
                this.#webhookPeers.push(peer_config);
            } else {
                const peer = new CLink({
                    keys: this.config.keys,
                    config: peer_config,
                    log: this.log,
                });
                this.#peers.push(peer);
                peer.connect();
            }
        }

        this.#webhookReplayWindowSeconds = replayWindowSeconds;
        this.#outboundFlushMs = Number.isFinite(outboundFlushMs) && outboundFlushMs >= 0
            ? outboundFlushMs
            : 5000;

        this._register_commands(this.services.get('commands'));

        const svc_event = this.services.get('event');
        svc_event.on('outer.*', this.outBroadcastEventHandler.bind(this));
    }

    async outBroadcastEventHandler (key, data, meta) {
        if ( meta?.from_outside ) return;

        const safeMeta = this.#normalizeMeta(meta);
        this.#enqueueOutboundEvent({ key, data, meta: safeMeta });
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

        this.#outboundFlushTimer = setTimeout(() => {
            this.#outboundFlushTimer = null;
            this.#flushOutboundEvents().catch(error => {
                console.warn('outbound broadcast flush failed', { error });
            });
        }, this.#outboundFlushMs);
    }

    async #flushOutboundEvents () {
        if ( this.#outboundIsFlushing || this.#outboundEventsByDedupKey.size === 0 ) return;

        this.#outboundIsFlushing = true;
        try {
            const events = [...this.#outboundEventsByDedupKey.values()];
            this.#outboundEventsByDedupKey.clear();
            const message = { events };

            for ( const peer of this.#peers ) {
                try {
                    peer.send(message);
                } catch (e) {
                    console.warn(`ws broadcast send error: ${ JSON.stringify({ peer: peer.key, error: e })}`);
                }
            }

            for ( const peer_config of this.#webhookPeers ) {
                try {
                    await this.#sendWebhookToPeer(peer_config, events);
                } catch (e) {
                    console.warn(`webhook broadcast send error: ${ JSON.stringify({ peer: peer_config.key, error: e })}`);
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

    #enqueueIncomingEvents (events) {
        const emitPromise = this.#incomingEmitChain.then(
            () => this.#emitIncomingEventsSequentially(events),
        );

        this.#incomingEmitChain = emitPromise.catch(error => {
            console.warn('inbound broadcast emit failed', { error });
        });

        return emitPromise;
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

        Endpoint({
            route: '/broadcast/webhook',
            methods: ['POST'],
            handler: this.#handleWebhookRequest.bind(this),
        }).attach(app);
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

        const peerId = req.headers['x-broadcast-peer-id'];
        if ( ! peerId ) {
            res.status(403).send({ error: { message: 'Missing X-Broadcast-Peer-Id' } });
            return;
        }

        console.debug('received peerId', { value: peerId });

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
        const lastNonce = this.#incomingLastNonceByPeer.get(peerId) ?? -1;
        if ( nonce <= lastNonce ) {
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

        this.#incomingLastNonceByPeer.set(peerId, nonce);

        await this.#enqueueIncomingEvents(incomingEvents);

        res.status(200).send({ ok: true });
    }

    async #sendWebhookToPeer (peer_config, events) {
        const peerId = peer_config.key;
        const url = peer_config.webhook_url;
        const mySecretKey = this.config.webhook?.secret ?? '';
        if ( !url || !mySecretKey ) return;

        let nextNonce = this.#outgoingNonceByPeer.get(peerId) ?? 0;
        this.#outgoingNonceByPeer.set(peerId, nextNonce + 1);

        const timestamp = Math.floor(Date.now() / 1000);
        const body = { events };
        const rawBody = JSON.stringify(body);
        const payloadToSign = `${timestamp}.${nextNonce}.${rawBody}`;
        const signature = createHmac('sha256', mySecretKey).update(payloadToSign).digest('hex');

        const myPublicKey = this.config.webhook?.key ?? '';
        console.debug('Sending webhook message to peer', { peerId });
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Broadcast-Peer-Id': myPublicKey,
                'X-Broadcast-Timestamp': String(timestamp),
                'X-Broadcast-Nonce': String(nextNonce),
                'X-Broadcast-Signature': signature,
            },
            body: rawBody,
        });

        if ( ! response.ok ) {
            throw new Error(`Webhook POST failed: ${response.status} ${response.statusText}`);
        }
    }

    async '__on_install.websockets' () {
        const svc_webServer = this.services.get('web-server');

        const server = svc_webServer.get_server();

        const io = new SocketIoServer(server, {
            cors: { origin: '*' },
            path: '/wssinternal',
        });

        io.on('connection', async socket => {
            const conn = new SLink({
                keys: this.config.keys,
                trustedKeys: this.#trustedPublicKeys,
                socket,
            });
            this.#connections.push(conn);

            conn.channels.message.on(message => {
                const incomingEvents = this.#normalizeIncomingPayload(message);
                if ( ! incomingEvents ) {
                    console.warn('invalid ws broadcast payload');
                    return;
                }

                this.#enqueueIncomingEvents(incomingEvents).catch(error => {
                    console.warn('ws broadcast receive error', { error });
                });
            });
        });
    }
}
