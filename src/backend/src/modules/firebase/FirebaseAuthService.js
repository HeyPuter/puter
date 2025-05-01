const BaseService = require("../../services/BaseService");

const admin = require('firebase-admin');
const { Endpoint } = require("../../util/expressutil");
const configurable_auth = require("../../middleware/configurable_auth");

class FirebaseAuthService extends BaseService {
    async _init () {
        admin.initializeApp({
            credential: admin.credential.cert(this.config.serviceAccount),
        });
    }

    async ['__on_install.routes'] (_, { app }) {
        const r_firebase = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();

        Endpoint({
            route: '/get-token',
            methods: ['GET'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const token = await admin.auth().createCustomToken(req.actor.uid);
                res.json(token);
            }
        }).attach(r_firebase);

        app.use('/firebase', r_firebase);
    }
}

module.exports = {
    FirebaseAuthService,
};
