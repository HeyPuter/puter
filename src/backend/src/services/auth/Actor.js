// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const { AdvancedBase } = require("../../../../putility");
const { Context } = require("../../util/context");
const { get_user, get_app } = require("../../helpers");
const config = require("../../config");

// TODO: add these to configuration; production deployments should change these!

const PRIVATE_UID_NAMESPACE = config.private_uid_namespace
    ?? require('crypto').randomUUID();
const PRIVATE_UID_SECRET = config.private_uid_secret
    ?? require('crypto').randomBytes(24).toString('hex');


/**
* Represents an Actor in the system, extending functionality from AdvancedBase.
* The Actor class is responsible for managing actor instances, including
* creating new actors, generating unique identifiers, and handling related types
* that represent different roles within the context of the application.
*/
class Actor extends AdvancedBase {
    static MODULES = {
        uuidv5: require('uuid').v5,
        crypto: require('crypto'),
    }

    static system_actor_ = null;
    /**
     * Retrieves the system actor instance, creating it if it doesn't exist.
     * 
     * This static method ensures that there is only one instance of the system actor.
     * If the system actor has not yet been created, it will be instantiated with a
     * new SystemActorType.
     * 
     * @returns {Actor} The system actor instance.
     */
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
    /**
    * Initializes the Actor instance with the provided parameters.
    * This constructor assigns object properties from the input object to the instance.
    * 
    * @param {Object} o - The object containing actor parameters.
    * @param {...any} a - Additional arguments passed to the parent class constructor.
    */
    get uid () {
        return this.type.uid;
    }

    /**
     * Generate a cryptographically-secure deterministic UUID
     * from an actor's UID.
     */
    /**
    * Generates a cryptographically-secure deterministic UUID
    * from an actor's UID. The generated UUID is derived by 
    * applying SHA-256 HMAC to the actor's UID using a secret, 
    * then formatting the result as a UUID V5. 
    * 
    * @returns {string} The derived UUID corresponding to the actor's UID.
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


    /**
     * Clones the current Actor instance, returning a new Actor object with the same type.
     * 
     * @returns {Actor} A new Actor instance that is a copy of the current one.
     */
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


/**
* Class representing the system actor type within the actor framework.
* This type serves as a specific implementation of an actor that 
* represents a system-level entity and provides methods for UID retrieval 
* and related type management.
*/
class SystemActorType {
    constructor (o, ...a) {
        // super(o, ...a);
        for ( const k in o ) {
            this[k] = o[k];
        }
    }
    /**
     * Constructs a new instance of the actor type.
     * 
     * @param {Object} o - The initial properties for the actor type.
     * @param {...*} a - Additional arguments to pass to the super class constructor.
     * 
     * @throws {Error} If there is an issue in initializing the actor type.
     */
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


/**
* Represents the type of a User Actor in the system, allowing operations and relations 
* specific to user actors. This class extends the base functionality to uniquely identify
* user actors and define how they relate to other types of actors within the system.
*/
class UserActorType {
    constructor (o, ...a) {
        // super(o, ...a);
        for ( const k in o ) {
            this[k] = o[k];
        }
    }
    /**
    * Constructs a new UserActorType instance.
    * 
    * @param {Object} o - The initial properties to set on the instance.
    * @param {...any} a - Additional arguments to pass to the constructor.
    */
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
/**
* Represents a user actor type in the application. This class defines the structure 
* and behavior specific to user actors, including obtaining unique identifiers and 
* retrieving related actor types. It extends the base actor type functionality 
* to cater to user-specific needs.
*/
class AppUnderUserActorType {
    constructor (o, ...a) {
        // super(o, ...a);
        for ( const k in o ) {
            this[k] = o[k];
        }
    }
    /**
    * Create a new instance of the actor type, initializing it with the given parameters.
    * 
    * This method first checks for associated user and app UIDs in the params, 
    * fetching their respective data asynchronously if present. It then 
    * constructs a new Actor with the provided type.
    * 
    * @param {Function} type - The class constructor for the actor type.
    * @param {Object} params - Initialization parameters for the actor (optional).
    * @returns {Actor} A new instance of the Actor type.
    */
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


/**
* Represents the type of access tokens in the system.
* An AccessTokenActorType associates an authorizer and an authorized actor 
* with a string token, facilitating permission checks and identity management.
*/
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
    /**
     * Constructs an instance of AccessTokenActorType.
     * This class represents an access token actor containing information 
     * about the authorizer and authorized actors, as well as the token string.
     * 
     * @param {Object} o - The object containing properties to initialize the access token actor.
     * @param {...*} a - Additional arguments for further initialization.
     */
    get uid () {
        return 'access-token:' + this.authorizer.uid +
            ':' + ( this.authorized?.uid ?? '<none>' ) +
            ':' + this.token;
    }
    /**
     * Generate a unique identifier (UID) for the access token.
     * The UID is constructed based on the authorizer's UID, the authorized actor's UID (if available),
     * and the token string. This UID format is useful for identifying the access token's context.
     * 
     * @returns {string} The generated UID for the access token.
     */
    get_related_actor () {
        // This would be dangerous because of ambiguity
        // between authorizer and authorized
        throw new Error('cannot call get_related_actor on ' + this.constructor.name);
    }
}


/**
* Represents a Site Actor Type, which encapsulates information about a site-specific actor.
* This class is used to manage details related to the site and implement functionalities 
* pertinent to site-level operations and interactions in the actor framework.
*/
class SiteActorType {
    constructor (o, ...a) {
        for ( const k in o ) {
            this[k] = o[k];
        }
    }
    /**
    * Constructor for the SiteActorType class.
    * Initializes a new instance of SiteActorType with the provided properties.
    * 
    * @param {Object} o - The properties to initialize the SiteActorType with.
    * @param {...*} a - Additional arguments.
    */
    get uid () {
        return `site:` + this.site.name
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
    SiteActorType,
}
