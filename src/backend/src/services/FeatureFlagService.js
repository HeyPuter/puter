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

// METADATA // {"ai-commented":{"service":"claude"}}
const { Context } = require("../util/context");
const { whatis } = require("../util/langutil");
const { PermissionUtil } = require("./auth/PermissionService");
const BaseService = require("./BaseService");

/**
 * @class FeatureFlagService
 * @extends BaseService
 *
 * FeatureFlagService is a way to let the client (frontend) know what features
 * are enabled or disabled for the current user.
 *
 * A service that manages feature flags to control feature availability across the application.
 * Provides methods to register, check, and retrieve feature flags based on user permissions and configurations.
 * Integrates with the permission system to determine feature access for different users.
 * Supports both static configuration flags and dynamic function-based feature flags.
 */
class FeatureFlagService extends BaseService {
    /**
    * Initializes the FeatureFlagService instance by setting up an empty Map for known flags
    * @private
    * @method
    */
    _construct () {
        this.known_flags = new Map();
    }

    /**
    * Initializes the feature flag service by registering a provider with the whoami service.
    * This provider adds feature flag information to user details when requested.
    * 
    * @async
    * @private
    * @returns {Promise<void>}
    */
    async _init () {
        const svc_detailProvider = this.services.get('whoami');
        svc_detailProvider.register_provider(async (context, out) => {
            if ( ! context.actor ) return;
            out.feature_flags = await this.get_summary(context.actor);
        });
    }

    /**
    * Registers a new feature flag with the service
    * @param {string} name - The name/identifier of the feature flag
    * @param {Object|boolean} spec - The specification for the flag. Can be a boolean value or an object with $ property indicating flag type
    */
    register (name, spec) {
        this.known_flags.set(name, spec);
    }

    /**
     * checks is a feature flag is enabled for the current user
     * @return {boolean} - true if the feature flag is enabled, false otherwise
     * 
     * Usage:
     *   check({ actor }, 'flag-name')
     */
    async check (...a) {
        // allows binding call with multiple options objects;
        // the last argument is the permission to check
        const { options, value: permission } = (() => {
            let value;
            const options = {};
            for ( const arg of a ) {
                if ( whatis(arg) === 'object' ) {
                    Object.assign(options, arg);
                    continue;
                }
                value = arg;
                break;
            }
            return { options, value };
        })();
        
        if ( ! this.known_flags.has(permission) ) {
            this.known_flags.set(permission, true);
        }

        if(this.known_flags.get(permission)?.$ === "config-flag") {
            return this.known_flags.get(permission)?.value;
        }

        const actor = options.actor ?? Context.get('actor');

        if ( this.known_flags.get(permission)?.$ === 'function-flag' ) {
            return await this.known_flags.get(permission)?.fn({
                ...options,
                actor
            });
        }
        
        const svc_permission = this.services.get('permission');
        const reading = await svc_permission.scan(actor, `feature:${permission}`);
        const l = PermissionUtil.reading_to_options(reading);
        if ( l.length === 0 ) return false;
        return true;
    }


    /**
    * Gets a summary of all feature flags for a given actor
    * @param {Object} actor - The actor to check feature flags for
    * @returns {Promise<Object>} Object mapping feature flag names to their values:
    *   - For config flags: returns the configured value
    *   - For function flags: returns result of calling the flag function
    *   - For permission flags: returns true if actor has any matching permissions, false otherwise
    */
    async get_summary (actor) {
        const summary = {};
        for ( const [key, value] of this.known_flags.entries() ) {
            if ( value.$ === 'config-flag' ) {
                summary[key] = value.value;
                continue;
            }
            if ( value.$ === 'function-flag' ) {
                summary[key] = await value.fn({ actor });
                continue;
            }
            const svc_permission = this.services.get('permission');
            const reading = await svc_permission.scan(actor, `feature:${key}`);
            const l = PermissionUtil.reading_to_options(reading);
            summary[key] = l.length > 0;
        }

        return summary;
    }
}

module.exports = {
    FeatureFlagService
};
