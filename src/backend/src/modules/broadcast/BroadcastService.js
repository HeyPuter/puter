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
const BaseService = require('../../services/BaseService');
const { CLink } = require('./connection/CLink');
const { SLink } = require('./connection/SLink');
const { Context } = require('../../util/context');
const { Endpoint } = require('../../util/expressutil');
const crypto = require('crypto');

class BroadcastService extends BaseService {
    static MODULES = {
        express: require('express'),
        // ['socket.io']: require('socket.io'),
    };

    _construct () {
        this.peers_ = [];
        this.connections_ = [];
        this.trustedPublicKeys_ = {};
        this.peersByKey_ = {};
        this.webhookPeers_ = [];
        this.incomingLastNonceByPeer_ = new Map();
        this.outgoingNonceByPeer_ = new Map();
    }

    async _init () {
        const peers = this.config.peers ?? [];
        const replayWindowSeconds = this.config.webhook_replay_window_seconds ?? 300;

        for ( const peer_config of peers ) {
            this.trustedPublicKeys_[peer_config.key] = true;
            this.peersByKey_[peer_config.key] = {
                webhook_secret: peer_config.webhook_secret,
                webhook_url: peer_config.webhook_url,
                webhook: !!peer_config.webhook,
            };

            if ( peer_config.webhook ) {
                this.webhookPeers_.push(peer_config);
            } else {
                const peer = new CLink({
                    keys: this.config.keys,
                    config: peer_config,
                    log: this.log,
                });
                this.peers_.push(peer);
                peer.connect();
            }
        }

        this.webhookReplayWindowSeconds_ = replayWindowSeconds;

        this._register_commands(this.services.get('commands'));

        const svc_event = this.services.get('event');
        svc_event.on('outer.*', this.on_event.bind(this));

        // Test event (logs a message to console if DEBUG is set in env)
        svc_event.on('test', (key, data, _meta) => {
            const { contents } = data;
            console.log(`Test Message: ${contents}`);
        });
    }

    async on_event (key, data, meta) {
        if ( meta.from_outside ) return;

        for ( const peer of this.peers_ ) {
            try {
                peer.send({ key, data, meta });
            } catch (e) {
                //
            }
        }

        for ( const peer_config of this.webhookPeers_ ) {
            try {
                await this.sendWebhookToPeer_(peer_config, key, data, meta);
            } catch (e) {
                this.log?.warn?.('broadcast webhook send failed', { peer: peer_config.key, error: e });
            }
        }
    }

    async '__on_install.routes' (_, { app }) {
        const svc_web = this.services.get('web-server');
        svc_web.allow_undefined_origin('/broadcast/webhook');

        Endpoint({
            route: '/broadcast/webhook',
            methods: ['POST'],
            handler: this.handleWebhookRequest_.bind(this),
        }).attach(app);
    }

    async handleWebhookRequest_ (req, res) {
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

        // Validate required properties
        const { key, data, meta } = body;
        if ( key === undefined || key === null ) {
            res.status(400).send({ error: { message: 'Missing key' } });
            return;
        }
        if ( data === undefined ) {
            res.status(400).send({ error: { message: 'Missing data' } });
            return;
        }
        if ( meta === undefined ) {
            res.status(400).send({ error: { message: 'Missing meta' } });
            return;
        }

        const peerId = req.headers['x-broadcast-peer-id'];
        if ( ! peerId ) {
            res.status(403).send({ error: { message: 'Missing X-Broadcast-Peer-Id' } });
            return;
        }

        this.log.debug('received peerId', { value: peerId });

        const peer = this.peersByKey_[peerId];
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
        const window = this.webhookReplayWindowSeconds_;
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
        const lastNonce = this.incomingLastNonceByPeer_.get(peerId) ?? -1;
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
        const expectedHmac = crypto.createHmac('sha256', peer.webhook_secret).update(payloadToSign).digest('hex');
        const signatureBuffer = Buffer.from(signatureHeader, 'hex');
        const expectedBuffer = Buffer.from(expectedHmac, 'hex');
        if ( signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer) ) {
            res.status(403).send({ error: { message: 'Invalid signature' } });
            return;
        }

        this.incomingLastNonceByPeer_.set(peerId, nonce);

        // We emit the event sent to this webhook endpoint so other services
        // can react to it. We set the `from_outside` flag to avoid feedback.
        const svc_event = this.services.get('event');
        const metaOut = { ...meta, from_outside: true };
        const context = Context.get(undefined, { allow_fallback: true });
        await context.arun(async () => {
            this.log.debug('Emitting to the event service', {
                key, data, metaOut,
            });
            await svc_event.emit(key, data, metaOut);
        });

        res.status(200).send({ ok: true });
    }

    async sendWebhookToPeer_ (peer_config, key, data, meta) {
        const peerId = peer_config.key;
        const url = peer_config.webhook_url;
        const mySecretKey = this.config.webhook?.secret ?? '';
        if ( !url || !mySecretKey ) return;

        let nextNonce = this.outgoingNonceByPeer_.get(peerId) ?? 0;
        this.outgoingNonceByPeer_.set(peerId, nextNonce + 1);

        const timestamp = Math.floor(Date.now() / 1000);
        const body = { key, data, meta };
        const rawBody = JSON.stringify(body);
        const payloadToSign = `${timestamp}.${nextNonce}.${rawBody}`;
        const signature = crypto.createHmac('sha256', mySecretKey).update(payloadToSign).digest('hex');

        const myPublicKey = this.config.webhook?.key ?? '';
        this.log.debug('Sending webhook message to peer', { peerId });
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
        const svc_event = this.services.get('event');
        const svc_webServer = this.services.get('web-server');

        const server = svc_webServer.get_server();

        const io = require('socket.io')(server, {
            cors: { origin: '*' },
            path: '/wssinternal',
        });

        io.on('connection', async socket => {
            const conn = new SLink({
                keys: this.config.keys,
                trustedKeys: this.trustedPublicKeys_,
                socket,
            });
            this.connections_.push(conn);

            conn.channels.message.on(({ key, data, meta }) => {
                if ( meta.from_outside ) {
                    console.warn('possible over-sending');
                    return;
                }

                if ( key === 'test' ) {
                    console.debug(`test message: ${
                        JSON.stringify(data)}`);
                }

                meta.from_outside = true;
                const context = Context.get(undefined, { allow_fallback: true });
                context.arun(async () => {
                    await svc_event.emit(key, data, meta);
                });
            });
        });
    }

    _register_commands (commands) {
        commands.registerCommands('broadcast', [
            {
                id: 'test',
                description: 'send a test message',
                handler: async () => {
                    this.log.info('broadcast service test command was run');
                    this.on_event('test', {
                        contents: 'I am a test message',
                    }, {});
                },
            },
        ]);
    }
}

module.exports = { BroadcastService };
