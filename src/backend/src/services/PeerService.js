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

import configurable_auth from '../middleware/configurable_auth.js';
import { Endpoint } from '../util/expressutil.js';
import { Actor, UserActorType } from './auth/Actor.js';
import BaseService from './BaseService.js';

function addDashesToUUID (i) {
    return `${i.substr(0, 8) }-${ i.substr(8, 4) }-${ i.substr(12, 4) }-${ i.substr(16, 4) }-${ i.substr(20)}`;
}

export class PeerService extends BaseService {
    '__on_install.routes' (_, { app }) {
        Endpoint({
            route: '/peer/signaller-info',
            methods: ['GET'],
            subdomain: 'api',
            handler: async (req, res) => {
                res.json({
                    url: this.config.signaller_url,
                    fallbackIce: this.config.fallback_ice,
                });
            },
        }).attach(app);

        Endpoint({
            route: '/peer/generate-turn',
            methods: ['POST'],
            mw: [configurable_auth()],
            subdomain: 'api',
            handler: async (req, res) => {
                if ( ! this.config.cloudflare_turn ) {
                    res.status(500).send({ error: 'TURN is not configured' });
                    return;
                }

                // Build the custom identifier (short max length, we must compress it from hex to b64)
                let customIdentifier = '';
                customIdentifier += Buffer.from(req.actor.type.user.uuid.replaceAll('-', ''), 'hex').toString('base64url');
                if ( req.actor.type?.app ) {
                    customIdentifier += `:${ Buffer.from(req.actor.type.app.uid.replace('app-', '').replaceAll('-', ''), 'hex').toString('base64url')}`;
                }
                let response = await fetch(
                    `https://rtc.live.cloudflare.com/v1/turn/keys/${this.config.cloudflare_turn.turn_key_id}/credentials/generate-ice-servers`,
                    {
                        headers: {
                            Authorization: `Bearer ${this.config.cloudflare_turn.turn_key_api_token}`,
                            'Content-Type': 'application/json',
                        },
                        method: 'POST',
                        body: JSON.stringify({
                            ttl: this.config.cloudflare_turn.ttl_ms,
                            customIdentifier,
                        }),
                    },
                );

                if ( ! response.ok ) {
                    res.status(500).send({ error: 'Failed to generate TURN credentials' });
                    return;
                }

                const { iceServers } = await response.json();

                res.json({
                    ttl: this.config.cloudflare_turn.ttl_ms,
                    iceServers,
                });
            },
        }).attach(app);

        const svc_web = this.services.get('web-server');
        const meteringService = this.services.get('meteringService').meteringService;
        svc_web.allow_undefined_origin('/turn/ingest-usage');

        Endpoint({
            route: '/turn/ingest-usage',
            methods: ['POST'],
            subdomain: 'api',
            handler: async (req, res) => {
                if ( req.headers['x-puter-internal-auth'] !== this.config.turn_meter_secret ) {
                    res.status(403).send({ error: 'Failed to meter TURN credentials' });
                    return;
                }
                /** @type {{timestamp: string, userId: string, origin: string, customIdentifier: Number, egressBytes: number, ingressBytes: number}[]} */
                const records = req.body.records;
                for ( const record of records ) {
                    try {
                        const actor = await Actor.create(UserActorType, {
                            user_uid: addDashesToUUID(Buffer.from(record.userId, 'base64url').toString('hex')),
                        });
                        const costInMicrocents = record.egressBytes * 0.005;
                        meteringService.incrementUsage(actor, 'turn:egress-bytes', record.egressBytes, costInMicrocents);
                    } catch (e) {
                        // failed to get user likely
                        console.error('TURN metering error: ', e);
                    }
                    res.send('ok');
                }
            },
        }).attach(app);
    }
}
