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

const APIError = require('../../api/APIError');
const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const StringParam = require('../../api/filesystem/StringParam');
const { get_app } = require('../../helpers');
const configurable_auth = require('../../middleware/configurable_auth');
const { Eq, Or } = require('../../om/query/query');
const { UserActorType, Actor, AppUnderUserActorType } = require('../../services/auth/Actor');
const { Context } = require('../../util/context');

module.exports = {
    route: '/check-app-acl',
    methods: ['POST'],

    // TODO: "alias" should be part of parameters somehow
    alias: {
        uid: 'subject',
        path: 'subject',
    },
    parameters: {
        subject: new FSNodeParam('subject'),
        mode: new StringParam('mode', { optional: true }),

        // TODO: There should be an "AppParam", but it feels wrong to include
        // so many concerns into `src/api/filesystem` like that. This needs to
        // be de-coupled somehow first.
        app: new StringParam('app'),
    },
    mw: [configurable_auth()],
    handler: async (req, res) => {
        const context = Context.get();
        const actor = req.actor;

        if ( ! (actor.type instanceof UserActorType) ) {
            throw APIError.create('forbidden');
        }

        const subject = req.values.subject;

        const svc_acl = context.get('services').get('acl');
        if ( ! await svc_acl.check(actor, subject, 'see') ) {
            throw APIError.create('subject_does_not_exist');
        }

        const es_app = context.get('services').get('es:app');
        const app = await es_app.read({
            predicate: new Or({
                children: [
                    new Eq({ key: 'uid', value: req.values.app }),
                    new Eq({ key: 'name', value: req.values.app }),
                ],
            }),
        });
        if ( ! app ) {
            throw APIError.create('app_does_not_exist', null, {
                identifier: req.values.app,
            });
        }

        const app_actor = new Actor({
            type: new AppUnderUserActorType({
                user: actor.type.user,
                // TODO: get legacy app object from entity instead of fetching again
                app: await get_app({ uid: await app.get('uid') }),
            }),
        });

        console.log('app?', app);

        res.json({
            allowed: await svc_acl.check(app_actor, subject,
                            // If mode is not specified, check the HIGHEST mode, because this
                            // will grant the LEAST cases
                            req.values.mode ?? svc_acl.get_highest_mode()),
        });
    },
};
