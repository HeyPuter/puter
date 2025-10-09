import { MANAGE_PERM_PREFIX } from "./permissionConts.mjs";

/**
* The PermissionUtil class provides utility methods for handling
* permission strings and operations, including splitting, joining,
* escaping, and unescaping permission components. It also includes
* functionality to convert permission reading structures into options.
*/
export  const PermissionUtil =  {
    /**
     * Unescapes a permission component string, converting escape sequences to their literal characters.
     * @param {string} component - The escaped permission component string.
     * @returns {string} The unescaped permission component.
     */
    unescape_permission_component(component) {
        let unescaped_str = '';
        // Constant for unescaped permission component string
        const STATE_NORMAL = {};
        // Constant for escaping special characters in permission strings
        const STATE_ESCAPE = {};
        let state = STATE_NORMAL;
        const const_escapes = { C: ':' };
        for ( let i = 0 ; i < component.length ; i++ ) {
            const c = component[i];
            if ( state === STATE_NORMAL ) {
                if ( c === '\\' ) {
                    state = STATE_ESCAPE;
                } else {
                    unescaped_str += c;
                }
            } else if ( state === STATE_ESCAPE ) {
                unescaped_str += Object.prototype.hasOwnProperty.call(const_escapes, c)
                    ? const_escapes[c] : c;
                state = STATE_NORMAL;
            }
        }
        return unescaped_str;
    },

    /**
     * Escapes special characters in a permission component string for safe joining.
     * @param {string} component - The permission component string to escape.
     * @returns {string} The escaped permission component.
     */
    escape_permission_component(component) {
        let escaped_str = '';
        for ( let i = 0 ; i < component.length ; i++ ) {
            const c = component[i];
            if ( c === ':' ) {
                escaped_str += '\\C';
                continue;
            }
            escaped_str += c;
        }
        return escaped_str;
    },

    /**
     * Splits a permission string into its component parts, unescaping each component.
     * @param {string} permission - The permission string to split.
     * @returns {string[]} Array of unescaped permission components.
     */
    split(permission) {
        return permission
            .split(':')
            .map(PermissionUtil.unescape_permission_component)
        ;
    },

    /**
     * Joins permission components into a single permission string, escaping as needed.
     * @param {...string} components - The permission components to join.
     * @returns {string} The escaped, joined permission string.
     */
    join(...components) {
        return components
            .map(PermissionUtil.escape_permission_component)
            .join(':')
        ;
    },

    /**
     * Converts a permission reading structure into an array of option objects.
     * Recursively traverses the reading tree to collect all options with their associated path and data.
     * @param {Array<Object>} reading - The permission reading structure to convert.
     * @param {Object} [parameters={}] - Optional parameters for the conversion.
     * @param {Array<Object>} [options=[]] - Accumulator for options (used internally for recursion).
     * @param {Array<any>} [extras=[]] - Extra data to include (used internally for recursion).
     * @param {Array<Object>} [path=[]] - Current path in the reading tree (used internally for recursion).
     * @returns {Array<Object>} Array of option objects with path and data.
     */
    reading_to_options(
        // actual arguments
        reading, parameters = {},
        // recursion state
        options = [], extras = [], path = [],
    ) {
        const to_path_item = finding => ({
            key: finding.key,
            holder: finding.holder_username,
            data: finding.data,
        });
        for ( let finding of reading ) {
            if ( finding.$ === 'option' ) {
                path = [to_path_item(finding), ...path];
                options.push({
                    ...finding,
                    data: [
                        ...(finding.data ? [finding.data] : []),
                        ...extras,
                    ],
                    path,
                });
            }
            if ( finding.$ === 'path' ) {
                if ( finding.has_terminal === false ) continue;
                const new_extras = ( finding.data ) ? [
                    finding.data,
                    ...extras,
                ] : [];
                const new_path = [to_path_item(finding), ...path];
                this.reading_to_options(finding.reading, parameters, options, new_extras, new_path);
            }
        }
        return options;
    },
    /** @type {(permission:string)=>boolean} */
    isManage(permission ){
        return permission.startsWith(MANAGE_PERM_PREFIX + ':');
    },
};

/**
 * Permission rewriters are used to map one set of permission strings to another.
 * These are invoked during permission scanning and when permissions are granted or revoked.
 *
 * For example, Puter's filesystem uses this to map 'fs:/some/path:mode' to
 * 'fs:SOME-UUID:mode'.
 *
 * A rewriter is constructed using the static method PermissionRewriter.create({ matcher, rewriter }).
 * The matcher is a function that takes a permission string and returns true if the rewriter should be applied.
 * The rewriter is a function that takes a permission string and returns the rewritten permission string.
 */
export class PermissionRewriter {
    static create({ id, matcher, rewriter }) {
        return new PermissionRewriter({ id, matcher, rewriter });
    }

    constructor({ id, matcher, rewriter }) {
        this.id = id;
        this.matcher = matcher;
        this.rewriter = rewriter;
    }

    matches(permission) {
        return this.matcher(permission);
    }

    /**
    * Determines if the given permission matches the criteria set for this rewriter.
    *
    * @param {string} permission - The permission string to check.
    * @returns {boolean} - True if the permission matches, false otherwise.
    */
    async rewrite(permission) {
        return await this.rewriter(permission);
    }
}

/**
 * Permission implicators are used to manage implicit permissions.
 * It defines a method to check if a given permission is implicitly granted to an actor.
 *
 * For example, Puter's filesystem uses this to grant permission to a file if the specified
 * 'actor' is the owner of the file.
 *
 * An implicator is constructed using the static method PermissionImplicator.create({ matcher, checker }).
 * `matcher  is a function that takes a permission string and returns true if the implicator should be applied.
 * `checker` is a function that takes an actor and a permission string and returns true if the permission is implied.
 * The actor and permission are passed to checker({ actor, permission }) as an object.
 */
export class PermissionImplicator {
    static create({ id, matcher, checker, ...options }) {
        return new PermissionImplicator({ id, matcher, checker, options });
    }

    constructor({ id, matcher, checker, options }) {
        this.id = id;
        this.matcher = matcher;
        this.checker = checker;
        this.options = options;
    }

    matches(permission) {
        return this.matcher(permission);
    }

    /**
     * Check if the permission is implied by this implicator
     * @param  {Actor} actor
     * @param  {string} permission
     * @returns
     */
    /**
    * Rewrites a permission string if it matches any registered rewriter.
    * @param {string} permission - The permission string to potentially rewrite.
    * @returns {Promise<string>} The possibly rewritten permission string.
    */
    async check({ actor, permission, recurse }) {
        return await this.checker({ actor, permission, recurse });
    }
}

/**
 * Permission exploders are used to map any permission to a list of permissions
 * which are considered to imply the specified permission.
 *
 * It uses a matcher function to determine if a permission should be exploded
 * and an exploder function to perform the expansion.
 *
 * The exploder is constructed using the static method PermissionExploder.create({ matcher, explode }).
 * The `matcher` is a function that takes a permission string and returns true if the exploder should be applied.
 * The `explode` is a function that takes an actor and a permission string and returns a list of implied permissions.
 * The actor and permission are passed to explode({ actor, permission }) as an object.
 */
export class PermissionExploder {
    static create({ id, matcher, exploder }) {
        return new PermissionExploder({ id, matcher, exploder });
    }

    constructor({ id, matcher, exploder }) {
        this.id = id;
        this.matcher = matcher;
        this.exploder = exploder;
    }

    matches(permission) {
        return this.matcher(permission);
    }

    /**
    * Explodes a permission into a set of implied permissions.
    *
    * This method takes a permission string and an actor object,
    * then uses the associated exploder function to derive additional
    * permissions that are implied by the given permission.
    *
    * @param {Object} options - The options object containing:
    * @param {Actor} options.actor - The actor requesting the permission explosion.
    * @param {string} options.permission - The base permission to be exploded.
    * @returns {Promise<Array<string>>} A promise resolving to an array of implied permissions.
    */
    async explode({ actor, permission }) {
        return await this.exploder({ actor, permission });
    }
}