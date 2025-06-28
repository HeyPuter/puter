// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const APIError = require("../api/APIError");
const { get_user } = require("../helpers");
const configurable_auth = require("../middleware/configurable_auth");
const featureflag = require("../middleware/featureflag.js");
const { Endpoint } = require("../util/expressutil");
const { whatis } = require("../util/langutil");
const { Actor, UserActorType } = require("./auth/Actor");
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");
const { UsernameNotifSelector } = require("./NotificationService");

class ShareService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
        validator: require('validator'),
        express: require('express'),
    };


    async _init () {
        this.db = await this.services.get('database').get(DB_WRITE, 'share');

        // registry "share" as a feature flag so gui is informed
        // about whether or not a user has access to this feature
        const svc_featureFlag = this.services.get('feature-flag');
        svc_featureFlag.register('share', {
            $: 'function-flag',
            fn: async ({ actor }) => {
                const user = actor.type.user ?? null;
                if ( ! user ) {
                    throw new Error('expected user');
                }
                return !! user.email_confirmed;
            }
        });

        const svc_event = this.services.get('event');
        svc_event.on('user.email-confirmed', async (_, { user_uid, email }) => {
            const user = await get_user({ uuid: user_uid });
            const relevant_shares = await this.db.read(
                'SELECT * FROM share WHERE recipient_email = ?',
                [email],
            );

            for ( const share of relevant_shares ) {
                share.data = this.db.case({
                    mysql: () => share.data,
                    otherwise: () =>
                        JSON.parse(share.data ?? '{}'),
                })();

                const issuer_user = await get_user({
                    id: share.issuer_user_id,
                });

                if ( ! issuer_user ) {
                    continue;
                }

                const issuer_actor = await Actor.create(UserActorType, {
                    user: issuer_user,
                });

                const svc_acl = this.services.get('acl');

                for ( const permission of share.data.permissions ) {
                    await svc_acl.set_user_user(
                        issuer_actor, user.username, permission, undefined,
                        { only_if_higher: true },
                    );
                }

                await this.db.write(
                    'DELETE FROM share WHERE uid = ?',
                    [share.uid],
                );
            }
        });
    }

    ['__on_install.routes'] (_, { app }) {
        this.install_sharelink_endpoints({ app });
        this.install_share_endpoint({ app });
    }
    
    /**
    * This method is responsible for processing the share link application request.
    * It checks if the share token is valid and if the user making the request is the intended recipient.
    * If both conditions are met, it grants the requested permissions to the user and deletes the share from the database.
    *
    * @param {Object} req - Express request object.
    * @param {Object} res - Express response object.
    * @returns {Promise<void>}
    */
    install_sharelink_endpoints ({ app }) {
        // track: scoping iife
        const router = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();
        
        app.use('/sharelink', router);
        
        const svc_share = this.services.get('share');
        const svc_token = this.services.get('token');
        
        Endpoint({
            route: '/check',
            methods: ['POST'],
            handler: async (req, res) => {
                // Potentially confusing:
                //   The "share token" and "share cookie token" are different!
                //   -> "share token" is from the email link;
                //      it has a longer expiry time and can be used again
                //      if the share session expires.
                //   -> "share cookie token" lets the backend know it
                //      should grant permissions when the correct user
                //      is logged in.
                
                const share_token = req.body.token;
                
                if ( ! share_token ) {
                    throw APIError.create('field_missing', null, {
                        key: 'token',
                    });
                }
                
                const decoded = await svc_token.verify('share', share_token);
                console.log('decoded?', decoded);
                if ( decoded.$ !== 'token:share' ) {
                    throw APIError.create('invalid_token');
                }
                
                const share = await svc_share.get_share({
                    uid: decoded.uid,
                });
                
                if ( ! share ) {
                    throw APIError.create('invalid_token');
                }
                
                res.json({
                    $: 'api:share',
                    uid: share.uid,
                    email: share.recipient_email,
                });
            },
        }).attach(router);
        
        Endpoint({
            route: '/apply',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const share_uid = req.body.uid;
                
                const share = await svc_share.get_share({
                    uid: share_uid,
                });
                
                if ( ! share ) {
                    throw APIError.create('share_expired');
                }
                
                share.data = this.db.case({
                    mysql: () => share.data,
                    otherwise: () =>
                        JSON.parse(share.data ?? '{}'),
                })();
                
                const actor = Actor.adapt(req.actor ?? req.user);
                if ( ! actor ) {
                    // this shouldn't happen; auth should catch it
                    throw new Error('actor missing');
                }
                
                if ( ! actor.type.user.email_confirmed ) {
                    throw APIError.create('email_must_be_confirmed');
                }
                
                if ( actor.type.user.email !== share.recipient_email ) {
                    throw APIError.create('can_not_apply_to_this_user');
                }
                
                const issuer_user = await get_user({
                    id: share.issuer_user_id,
                });
                
                if ( ! issuer_user ) {
                    throw APIError.create('share_expired');
                }
                
                const issuer_actor = await Actor.create(UserActorType, {
                    user: issuer_user,
                });
                
                const svc_permission = this.services.get('permission');
                
                for ( const permission of share.data.permissions ) {
                    await svc_permission.grant_user_user_permission(
                        issuer_actor,
                        actor.type.user.username,
                        permission,
                    );
                }

                await this.db.write(
                    'DELETE FROM share WHERE uid = ?',
                    [share.uid],
                );
                
                res.json({
                    $: 'api:status-report',
                    status: 'success',
                });
            }
        }).attach(router);

        Endpoint({
            route: '/request',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const share_uid = req.body.uid;
                
                const share = await svc_share.get_share({
                    uid: share_uid,
                });
                
                // track: null check before processing
                if ( ! share ) {
                    throw APIError.create('share_expired');
                }
                
                share.data = this.db.case({
                    mysql: () => share.data,
                    otherwise: () =>
                        JSON.parse(share.data ?? '{}'),
                })();
                
                const actor = Actor.adapt(req.actor ?? req.user);
                if ( ! actor ) {
                    // this shouldn't happen; auth should catch it
                    throw new Error('actor missing');
                }
                
                // track: opposite condition of sibling
                // :: sibling: /apply endpoint
                if (
                    actor.type.user.email_confirmed &&
                    actor.type.user.email === share.recipient_email
                ) {
                    throw APIError.create('no_need_to_request');
                }
                
                const issuer_user = await get_user({
                    id: share.issuer_user_id,
                });

                if ( ! issuer_user ) {
                    throw APIError.create('share_expired');
                }
                
                const svc_notification = this.services.get('notification');
                svc_notification.notify(
                    UsernameNotifSelector(issuer_user.username),
                    {
                        source: 'sharing',
                        title: `User ${actor.type.user.username} is ` +
                            `trying to open a share you sent to ` +
                            share.recipient_email,
                        template: 'user-requesting-share',
                        fields: {
                            username: actor.type.user.username,
                            intended_recipient: share.recipient_email,
                            permissions: share.data.permissions,
                        },
                    }
                );
                res.json({
                    $: 'api:status-report',
                    status: 'success',
                });
            }
        }).attach(router);
    }
    
    install_share_endpoint ({ app }) {
        // track: scoping iife
        const router = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();
        
        app.use('/share', router);
        
        const share_sequence = require('../structured/sequence/share.js');
        Endpoint({
            route: '/',
            methods: ['POST'],
            mw: [
                configurable_auth(),
                // featureflag({ feature: 'share' }),
            ],
            handler: async (req, res) => {
                const svc_edgeRateLimit = req.services.get('edge-rate-limit');
                if ( ! svc_edgeRateLimit.check('verify-pass-recovery-token') ) {
                    return res.status(429).send('Too many requests.');
                }

                const actor = req.actor;
                if ( ! (actor.type instanceof UserActorType) ) {
                    throw APIError.create('forbidden');
                }

                if ( ! actor.type.user.email_confirmed ) {
                    throw APIError.create('email_must_be_confirmed', null, {
                        action: 'share something',
                    });
                }

                return await share_sequence.call(this, {
                    actor, req, res,
                });
            }
        }).attach(router);
    }
    
    async get_share ({ uid }) {
        const [share] = await this.db.read(
            'SELECT * FROM share WHERE uid = ?',
            [uid],
        );
        
        return share;
    }
    
    /**
    * Method to handle the creation of a new share
    *
    * This method creates a new share and saves it to the database.
    * It takes three parameters: the issuer of the share, the recipient's email address, and the data to be shared.
    * The method returns the UID of the created share.
    *
    * @param {Actor} issuer - The actor who is creating the share
    * @param {string} email - The email address of the recipient
    * @param {object} data - The data to be shared
    * @returns {string} - The UID of the created share
    */
    async create_share ({
        issuer,
        email,
        data,
    }) {
        const require = this.require;
        const validator = require('validator');
        
        // track: type check
        if ( typeof email !== 'string' ) {
            throw new Error('email must be a string');
        }
        // track: type check
        if ( whatis(data) !== 'object' ) {
            throw new Error('data must be an object');
        }

        // track: adapt
        issuer = Actor.adapt(issuer);
        // track: type check
        if ( ! (issuer instanceof Actor) ) {
            throw new Error('expected issuer to be Actor');
        }
        
        // track: actor type
        if ( ! (issuer.type instanceof UserActorType) ) {
            throw new Error('only users are allowed to create shares');
        }
        
        if ( ! validator.isEmail(email) ) {
            throw new Error('invalid email');
        }
        
        const uuid = this.modules.uuidv4();
        
        await this.db.write(
            'INSERT INTO `share` ' +
            '(`uid`, `issuer_user_id`, `recipient_email`, `data`) ' +
            'VALUES (?, ?, ?, ?)',
            [uuid, issuer.type.user.id, email, JSON.stringify(data)]
        );
        
        return uuid;
    }
}

module.exports = {
    ShareService,
};

