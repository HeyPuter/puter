/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { AdvancedBase } = require("@heyputer/puter-js-common");
const { Context } = require("../../util/context");
const { get_user, get_app } = require("../../helpers");

// TODO: add these to configuration; production deployments should change these!

// THIS IS NOT A LEAK
// We use this to obscure user UUIDs, as some APIs require a user identifier
// for abuse prevention. However, there are no services in selfhosted Puter
// that currently make use of this, and we use different values on `puter.com`.
const PRIVATE_UID_NAMESPACE = '1757dc3f-8f04-4d77-b939-ff899045696d';
const PRIVATE_UID_SECRET = 'bf03f0e52f5d93c83822ad8558c625277ce3dddff8dc4a5cb0d3c8493571f770';
// THIS IS NOT A LEAK (see above)

class Actor extends AdvancedBase {
    static MODULES = {
        uuidv5: require('uuid').v5,
        crypto: require('crypto'),
    }

    static system_actor_ = null;
    static get_system_actor () {
        if ( ! this.system_actor_ ) {
            this.system_actor_ = new Actor({
                type: new SystemActorType(),
            });
        }
        return this.system_actor_;
    }

    static async create (type, params) {
        params = { ...params };
        if ( params.user_uid ) {
            params.user = await get_user({ uuid: params.user_uid });
        }
        if ( params.app_uid ) {
            params.app = await get_app({ uid: params.app_uid });
        }
        return new Actor({
            type: new type(params),
        });
    }

    constructor (o, ...a) {
        super(o, ...a);
        for ( const k in o ) {
            this[k] = o[k];
        }
    }
    get uid () {
        return this.type.uid;
    }

    /**
     * Generate a cryptographically-secure deterministic UUID
     * from an actor's UID.
     */
    get private_uid () {
        // Pass the UUID through SHA-2 first because UUIDv5
        // is not cryptographically secure (it uses SHA-1)
        const hmac = this.modules.crypto.createHmac('sha256', PRIVATE_UID_SECRET)
            .update(this.uid)
            .digest('hex');

        // Generate a UUIDv5 from the HMAC
        // Note: this effectively does an additional SHA-1 hash,
        // but this is done only to format the result as a UUID
        // and not for cryptographic purposes
        let str = this.modules.uuidv5(hmac, PRIVATE_UID_NAMESPACE);

        // Uppercase UUID to avoid inference of what uuid library is being used
        str = ('' + str).toUpperCase();
        return str;
    }

    clone () {
        return new Actor({
            type: this.type,
        });
    }

    get_related_actor (type_class) {
        const actor = this.clone();
        actor.type = this.type.get_related_type(type_class);
        return actor;
    }
}

class SystemActorType {
    constructor (o, ...a) {
        // super(o, ...a);
        for ( const k in o ) {
            this[k] = o[k];
        }
    }
    get uid () {
        return 'system';
    }
    get_related_type (type_class) {
        if ( type_class === SystemActorType ) {
            return this;
        }
        throw new Error(`cannot get ${type_class.name} from ${this.constructor.name}`)
    }
}

class UserActorType {
    constructor (o, ...a) {
        // super(o, ...a);
        for ( const k in o ) {
            this[k] = o[k];
        }
    }
    get uid () {
        return 'user:' + this.user.uuid;
    }
    get_related_type (type_class) {
        if ( type_class === UserActorType ) {
            return this;
        }
        throw new Error(`cannot get ${type_class.name} from ${this.constructor.name}`)
    }
}
class AppUnderUserActorType {
    constructor (o, ...a) {
        // super(o, ...a);
        for ( const k in o ) {
            this[k] = o[k];
        }
    }
    get uid () {
        return 'app-under-user:' + this.user.uuid + ':' + this.app.uid;
    }
    get_related_type (type_class) {
        if ( type_class === UserActorType ) {
            return new UserActorType({ user: this.user });
        }
        if ( type_class === AppUnderUserActorType ) {
            return this;
        }
        throw new Error(`cannot get ${type_class.name} from ${this.constructor.name}`)
    }
}

class AccessTokenActorType {
    // authorizer: an Actor who authorized the token
    // authorized: an Actor who is authorized by the token
    // token: a string
    constructor (o, ...a) {
        // super(o, ...a);
        for ( const k in o ) {
            this[k] = o[k];
        }
    }
    get uid () {
        return 'access-token:' + this.authorizer.uid +
            ':' + ( this.authorized?.uid ?? '<none>' ) +
            ':' + this.token;
    }
    get_related_actor () {
        // This would be dangerous because of ambiguity
        // between authorizer and authorized
        throw new Error('cannot call get_related_actor on ' + this.constructor.name);
    }
}

Actor.adapt = function (actor) {
    actor = actor || Context.get('actor');

    if ( actor?.username ) {
        const user = actor;
        actor = new Actor({
            type: new UserActorType({ user }),
        });
    }
    // Legacy: if actor is undefined, use the user in the context
    if ( ! actor ) {
        const user = Context.get('user');
        actor = new Actor({
            type: new UserActorType({ user }),
        });
    }

    return actor;
}

module.exports = {
    Actor,
    SystemActorType,
    UserActorType,
    AppUnderUserActorType,
    AccessTokenActorType,
}
