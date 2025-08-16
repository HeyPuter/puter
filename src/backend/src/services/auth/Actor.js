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

    /**
     * Creates a new Actor instance with the specified type and parameters.
     * Resolves user and app references from UIDs if provided in the parameters.
     * 
     * @param {Function} type - The ActorType constructor to instantiate.
     * @param {Object} params - Parameters for the actor type.
     * @param {string} [params.user_uid] - UUID of the user to resolve.
     * @param {string} [params.app_uid] - UID of the app to resolve.
     * @returns {Promise<Actor>} A new Actor instance.
     */
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

    /**
     * Initializes the Actor instance with the provided parameters.
     * This constructor assigns object properties from the input object to the instance.
     * 
     * @param {Object} o - The object containing actor parameters.
     * @param {...any} a - Additional arguments passed to the parent class constructor.
     */
    constructor (o, ...a) {
        super(o, ...a);
        for ( const k in o ) {
            this[k] = o[k];
        }
    }

    /**
     * Gets the unique identifier for this actor.
     * 
     * @returns {string} The actor's UID from its type.
     */
    get uid () {
        return this.type.uid;
    }
    
    /**
     * Returns fields suitable for logging this actor.
     * 
     * @returns {Object} Object containing UID and optionally username for logging.
     */
    toLogFields () {
        return {
            uid: this.type.uid,
            ...(this.type.user ? {
                username: this.type.user.username,
            } : {})
        }
    }

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

    /**
     * Creates a related actor of the specified type based on the current actor.
     * 
     * @param {Function} type_class - The ActorType class to create a related actor for.
     * @returns {Actor} A new Actor instance with the related type.
     */
    get_related_actor (type_class) {
        const actor = this.clone();
        actor.type = this.type.get_related_type(type_class);
        return actor;
    }
}

/**
 * Base class for all actor types in the system.
 * Provides common initialization functionality for actor type instances.
 */
class ActorType {
    /**
     * Initializes the ActorType with the provided properties.
     * 
     * @param {Object} o - Object containing properties to assign to this instance.
     */
    constructor (o) {
        for ( const k in o ) {
            this[k] = o[k];
        }
    }
}

/**
 * Class representing the system actor type within the actor framework.
 * This type serves as a specific implementation of an actor that 
 * represents a system-level entity and provides methods for UID retrieval 
 * and related type management.
 */
class SystemActorType extends ActorType {
    /**
     * Gets the unique identifier for the system actor.
     * 
     * @returns {string} Always returns 'system'.
     */
    get uid () {
        return 'system';
    }
    
    /**
     * Gets a related actor type for the system actor.
     * 
     * @param {Function} type_class - The ActorType class to get a related type for.
     * @returns {SystemActorType} Returns this instance if type_class is SystemActorType.
     * @throws {Error} If the requested type_class is not supported.
     */
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
class UserActorType extends ActorType {
    /**
     * Gets the unique identifier for the user actor.
     * 
     * @returns {string} The UID in format 'user:{uuid}'.
     */
    get uid () {
        return 'user:' + this.user.uuid;
    }
    
    /**
     * Gets a related actor type for the user actor.
     * 
     * @param {Function} type_class - The ActorType class to get a related type for.
     * @returns {UserActorType} Returns this instance if type_class is UserActorType.
     * @throws {Error} If the requested type_class is not supported.
     */
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
class AppUnderUserActorType extends ActorType {
    /**
     * Gets the unique identifier for the app-under-user actor.
     * 
     * @returns {string} The UID in format 'app-under-user:{user_uuid}:{app_uid}'.
     */
    get uid () {
        return 'app-under-user:' + this.user.uuid + ':' + this.app.uid;
    }
    
    /**
     * Gets a related actor type for the app-under-user actor.
     * 
     * @param {Function} type_class - The ActorType class to get a related type for.
     * @returns {UserActorType|AppUnderUserActorType} The related actor type instance.
     * @throws {Error} If the requested type_class is not supported.
     */
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
class AccessTokenActorType extends ActorType {
    // authorizer: an Actor who authorized the token
    // authorized: an Actor who is authorized by the token
    // token: a string

    /**
     * Gets the unique identifier for the access token actor.
     * The UID is constructed based on the authorizer's UID, the authorized actor's UID (if available),
     * and the token string. This UID format is useful for identifying the access token's context.
     * 
     * @returns {string} The generated UID for the access token.
     */
    get uid () {
        return 'access-token:' + this.authorizer.uid +
            ':' + ( this.authorized?.uid ?? '<none>' ) +
            ':' + this.token;
    }
    
    /**
     * Throws an error as getting related actors is not supported for access tokens.
     * This would be dangerous because of ambiguity between authorizer and authorized.
     * 
     * @throws {Error} Always throws an error indicating this operation is not supported.
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
    /**
     * Constructor for the SiteActorType class.
     * Initializes a new instance of SiteActorType with the provided properties.
     * 
     * @param {Object} o - The properties to initialize the SiteActorType with.
     * @param {...*} a - Additional arguments.
     */
    constructor (o, ...a) {
        for ( const k in o ) {
            this[k] = o[k];
        }
    }

    /**
     * Gets the unique identifier for the site actor.
     * 
     * @returns {string} The UID in format 'site:{site_name}'.
     */
    get uid () {
        return `site:` + this.site.name
    }
}

/**
 * Adapts various input types to a proper Actor instance.
 * If no actor is provided, attempts to get one from the current context.
 * Handles legacy user objects by wrapping them in UserActorType.
 * 
 * @param {Actor|Object} [actor] - The actor to adapt, or undefined to use context.
 * @returns {Actor} A properly formatted Actor instance.
 */
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
