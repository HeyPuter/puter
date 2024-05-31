const BaseService = require("./BaseService");
const { DB_READ } = require("./database/consts");

/**
 * Get user by one of a variety of identifying properties.
 * 
 * Pass `cached: false` to options to force a database read.
 * Pass `force: true` to options to force a primary database read.
 * 
 * This provides the functionality of `get_user` (helpers.js)
 * as a service so that other services can register identifying
 * properties for caching.
 * 
 * The original `get_user` function now uses this service.
 */
class GetUserService extends BaseService {
    _construct () {
        this.id_properties = new Set();

        this.id_properties.add('username');
        this.id_properties.add('uuid');
        this.id_properties.add('id');
        this.id_properties.add('email');
        this.id_properties.add('referral_code');
    }
    async _init () {
    }
    async get_user (options) {
        const user = await this.get_user_(options);
        if ( ! user ) return null;

        const svc_whoami = this.services.get('whoami');
        await svc_whoami.get_details({ user }, user);
        return user;
    }
    async get_user_ (options) {
        const services = this.services;

        /** @type BaseDatabaseAccessService */
        const db = services.get('database').get(DB_READ, 'filesystem');

        const cached = options.cached ?? true;

        if ( cached && ! options.force ) {
            for ( const prop of this.id_properties ) {
                if ( options.hasOwnProperty(prop) ) {
                    const user = kv.get(`users:${prop}:${options[prop]}`);
                    if ( user ) return user;
                }
            }
        }

        let user;

        if ( ! options.force ) {
            for ( const prop of this.id_properties ) {
                if ( options.hasOwnProperty(prop) ) {
                    [user] = await db.read(`SELECT * FROM \`user\` WHERE \`${prop}\` = ? LIMIT 1`, [options[prop]]);
                    if ( user ) break;
                }
            }
        }

        if ( ! user || ! user[0] ) {
            for ( const prop of this.id_properties ) {
                if ( options.hasOwnProperty(prop) ) {
                    [user] = await db.pread(`SELECT * FROM \`user\` WHERE \`${prop}\` = ? LIMIT 1`, [options[prop]]);
                    if ( user ) break;
                }
            }
        }

        if ( ! user ) return null;

        try {
            for ( const prop of this.id_properties ) {
                if ( user[prop] ) {
                    kv.set(`users:${prop}:${user[prop]}`, user);
                }
            }
            // kv.set('users:username:' + user.username, user);
            // kv.set('users:email:' + user.email, user);
            // kv.set('users:uuid:' + user.uuid, user);
            // kv.set('users:id:' + user.id, user);
            // kv.set('users:referral_code:' + user.referral_code, user);
        } catch (e) {
            console.error(e);
        }

        return user;
    }
    register_id_property (prop) {
        this.id_properties.add(prop);
    }
}

module.exports = { GetUserService };