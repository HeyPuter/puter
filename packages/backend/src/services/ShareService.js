const APIError = require("../api/APIError");
const { get_user } = require("../helpers");
const configurable_auth = require("../middleware/configurable_auth");
const { Endpoint } = require("../util/expressutil");
const { whatis } = require("../util/langutil");
const { Actor, UserActorType } = require("./auth/Actor");
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");

class ShareService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
        validator: require('validator'),
        express: require('express'),
    };

    async _init () {
        this.db = await this.services.get('database').get(DB_WRITE, 'share');
    }
    
    ['__on_install.routes'] (_, { app }) {
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
                
                share.data = this.db.case({
                    mysql: () => share.data,
                    otherwise: () =>
                        JSON.parse(share.data ?? '{}'),
                })();
                
                if ( ! share ) {
                    throw APIError.create('share_expired');
                }
                
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
                
                res.json({
                    $: 'api:status-report',
                    status: 'success',
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

