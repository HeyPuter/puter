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

const configurable_auth = require("../middleware/configurable_auth");
const { Endpoint } = require("../util/expressutil");
const BaseService = require("./BaseService");

class WispService extends BaseService {
    ['__on_install.routes'] (_, { app }) {
        const r_wisp = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();

        app.use('/wisp', r_wisp);

        Endpoint({
            route: '/relay-token/create',
            methods: ['POST'],
            mw: [configurable_auth({ optional: true })],
            handler: async (req, res) => {
                const svc_token = this.services.get('token');
                const actor = req.actor;
                
                if ( actor ) {
                    const token = svc_token.sign('wisp', {
                        $: 'token:wisp',
                        $v: '0.0.0',
                        user_uid: actor.type.user.uuid,
                    }, {
                        expiresIn: '1d',
                    });
                    this.log.info(`creating wisp token`, {
                        actor: actor.uid,
                        token: token,
                    });
                    res.json({
                        token,
                        server: this.config.server,
                    });
                } else {
                    const token = svc_token.sign('wisp', {
                        $: 'token:wisp',
                        $v: '0.0.0',
                        guest: true,
                    }, {
                        expiresIn: '1d',
                    });
                    res.json({
                        token,
                        server: this.config.server,
                    });
                }
            }
        }).attach(r_wisp);

        Endpoint({
            route: '/relay-token/verify',
            methods: ['POST'],
            handler: async (req, res) => {
                const svc_token = this.services.get('token');
                const svc_apiError = this.services.get('api-error');
                const svc_event = this.services.get('event');

                const decoded = (() => {
                    try {
                        const decoded = svc_token.verify('wisp', req.body.token);
                        if ( decoded.$ !== 'token:wisp' ) {
                            throw svc_apiError.create('invalid_token');
                        }
                        return decoded;
                    } catch (e) {
                        throw svc_apiError.create('forbidden');
                    }
                })();
                
                const svc_getUser = this.services.get('get-user');

                const event = {
                    allow: true,
                    policy: { allow: true },
                    guest: decoded.guest,
                    user: decoded.guest ? undefined : await svc_getUser.get_user({
                        uuid: decoded.user_uid,
                    }),
                };
                await svc_event.emit('wisp.get-policy', event);
                if ( ! event.allow ) {
                    this.log.noticeme('here')
                    throw svc_apiError.create('forbidden');
                }

                res.json(event.policy);
            }
        }).attach(r_wisp);
    }
}

module.exports = {
    WispService,
};
