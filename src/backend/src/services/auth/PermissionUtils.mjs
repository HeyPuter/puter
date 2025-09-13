/**
* The PermissionUtil class provides utility methods for handling
* permission strings and operations, including splitting, joining,
* escaping, and unescaping permission components. It also includes
* functionality to convert permission reading structures into options.
*/
export class PermissionUtil {
    /**
     * Unescapes a permission component string, converting escape sequences to their literal characters.
     * @param {string} component - The escaped permission component string.
     * @returns {string} The unescaped permission component.
     */
    static unescape_permission_component(component) {
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
    }

    /**
     * Escapes special characters in a permission component string for safe joining.
     * @param {string} component - The permission component string to escape.
     * @returns {string} The escaped permission component.
     */
    static escape_permission_component(component) {
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
    }

    /**
     * Splits a permission string into its component parts, unescaping each component.
     * @param {string} permission - The permission string to split.
     * @returns {string[]} Array of unescaped permission components.
     */
    static split(permission) {
        return permission
            .split(':')
            .map(PermissionUtil.unescape_permission_component)
        ;
    }

    /**
     * Joins permission components into a single permission string, escaping as needed.
     * @param {...string} components - The permission components to join.
     * @returns {string} The escaped, joined permission string.
     */
    static join(...components) {
        return components
            .map(PermissionUtil.escape_permission_component)
            .join(':')
        ;
    }

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
    static reading_to_options(
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
    }
}