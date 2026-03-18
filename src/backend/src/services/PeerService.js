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
import BaseService from './BaseService.js';

export class PeerService extends BaseService {
    '__on_install.routes' (_, { app }) {
        Endpoint({
            route: '/peer/signaller-info',
            methods: ['GET'],
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
            handler: async (req, res) => {
                if ( ! this.config.cloudflare_turn ) {
                    res.status(500).send({ error: 'TURN is not configured' });
                    return;
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
                            customIdentifier: req.actor.type.user.uuid,
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
    }
}
