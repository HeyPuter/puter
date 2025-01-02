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
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const svc_token = this.services.get('token');
                const actor = req.actor;
                const token = svc_token.sign('wisp', {
                    $: 'token:wisp',
                    $v: '0.0.0',
                    user_uid: actor.type.user.uuid,
                }, {
                    expiresIn: '1d',
                });
                res.json({ token });
            }
        }).attach(r_wisp);

        Endpoint({
            route: '/relay-token/verify',
            methods: ['POST'],
            handler: async (req, res) => {
                const svc_token = this.services.get('token');
                const svc_apiError = this.services.get('api-error');
                const svc_event = this.services.get('event');

                const decoded = svc_token.verify('wisp', req.body.token);
                if ( decoded.$ !== 'token:wisp' ) {
                    throw svc_apiError.create('invalid_token');
                }
                
                const svc_getUser = this.services.get('get-user');

                const event = {
                    allow: true,
                    policy: {},
                    user: await svc_getUser.get_user({
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
