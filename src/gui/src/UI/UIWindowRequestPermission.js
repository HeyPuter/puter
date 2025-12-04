/**
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

import UIWindow from './UIWindow.js';

async function UIWindowRequestPermission (options) {
    options = options ?? {};
    options.reload_on_success = options.reload_on_success ?? false;

    return new Promise((resolve) => {
        get_permission_description(options.permission).then((permission_description) => {
            if ( ! permission_description ) {
                resolve(false);
                return;
            }

            create_permission_window(options, permission_description, resolve).then((el_window) => {
                setup_window_events(el_window, options, resolve);
            });
        });
    });
}

/**
 * Creates the permission dialog
 */
async function create_permission_window (options, permission_description, resolve) {
    const requestingEntity = options.app_name ?? options.origin;
    const h = create_window_content(requestingEntity, permission_description);

    return await UIWindow({
        title: null,
        app: 'request-authorization',
        single_instance: true,
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: true,
        selectable_body: false,
        draggable_body: true,
        allow_context_menu: false,
        is_draggable: true,
        is_droppable: false,
        is_resizable: false,
        stay_on_top: false,
        allow_native_ctxmenu: true,
        allow_user_select: true,
        ...options.window_options,
        width: 350,
        dominant: true,
        on_close: () => resolve(false),
        onAppend: function (this_window) {
        },
        window_class: 'window-login',
        window_css: {
            height: 'initial',
        },
        body_css: {
            width: 'initial',
            padding: '0',
            'background-color': 'rgba(231, 238, 245, .95)',
            'backdrop-filter': 'blur(3px)',
        },
    });
}

/**
 * Creates HTML content for permission dialog
 */
function create_window_content (requestingEntity, permission_description) {
    let h = '';
    h += '<div>';
    h += '<div style="padding: 20px; width: 100%; box-sizing: border-box;">';
    // title
    h += `<h1 class="perm-title">${html_encode(requestingEntity)}</h1>`;

    // description (already HTML encoded)
    h += `<p class="perm-description">${html_encode(requestingEntity)} is requesting permission to ${permission_description}</p>`;

    // Allow/Don't Allow
    h += `<button type="button" class="app-auth-allow button button-primary button-block" style="margin-top: 10px;">${i18n('allow')}</button>`;
    h += `<button type="button" class="app-auth-dont-allow button button-default button-block" style="margin-top: 10px;">${i18n('dont_allow')}</button>`;
    h += '</div>';
    h += '</div>';
    return h;
}

/**
 * Sets up event handlers for permission dialog
 */
async function setup_window_events (el_window, options, resolve) {
    $(el_window).find('.app-auth-allow').on('click', async function (e) {
        $(this).addClass('disabled');

        try {
            // register granted permission to app or website
            const res = await fetch(`${window.api_origin }/auth/grant-user-app`, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ window.auth_token}`,
                },
                body: JSON.stringify({
                    app_uid: options.app_uid,
                    origin: options.origin,
                    permission: options.permission,
                }),
                method: 'POST',
            });

            if ( ! res.ok ) {
                throw new Error(`HTTP error! Status: ${res.status}`);
            }

            $(el_window).close();
            resolve(true);
        } catch ( err ) {
            console.error(err);
            resolve(err);
        }
    });

    $(el_window).find('.app-auth-dont-allow').on('click', function (e) {
        $(this).addClass('disabled');
        $(el_window).close();
        resolve(false);
    });
}

/**
 * Generates user-friendly description of permission string. Currently handles:
 * fs:UUID-OF-FILE:read, fs:/path/to/file:read, thread:UUID-OF-THREAD:post,
 * service:name-of-service:ii:name-of-interface, driver:driver-name:action-name
 */
async function get_permission_description (permission) {
    const parts = split_permission(permission);

    if ( ['fs', 'thread', 'service', 'driver'].includes(parts[0]) ) {
        const [resource_type, resource_id, action, interface_name = null] = parts;
        let fsentry;
        let fs_description = null;

        if ( resource_type === 'fs' ) {
            // Check for standard folders using whoami().directories
            const standard_folder_description = await get_standard_folder_description(resource_id, action);
            if ( standard_folder_description ) {
                fs_description = standard_folder_description;
            } else {
                // Try to stat by path or UUID
                try {
                    if ( resource_id.startsWith('/') ) {
                        fsentry = await puter.fs.stat({ path: resource_id, consistency: 'eventual' });
                    } else {
                        fsentry = await puter.fs.stat({ uid: resource_id, consistency: 'eventual' });
                    }
                    fs_description = `use ${fsentry.name} located at ${fsentry.dirpath} with ${action} access.`;
                } catch (e) {
                    // Can't stat, use resource_id directly
                    fs_description = `access ${resource_id} with ${action} access.`;
                }
            }
        }

        const permission_mappings = {
            'fs': fs_description,
            'thread': action === 'post' ? `post to thread ${resource_id}.` : null,
            'service': action === 'ii' ? `use ${resource_id} to invoke ${interface_name}.` : null,
            'driver': `use ${resource_id} to ${action}.`,
        };

        return permission_mappings[resource_type];
    }

    if ( parts[0] === 'user' ) {
        const whoami = await puter.auth.whoami();
        // An app can't ask to see other users' information
        if ( whoami.uuid !== parts[1] ) return null;

        if ( parts[2] === 'email' && parts[3] === 'read' ) {
            return 'see your email address';
        }
    }

    return null;
}

/**
 * Returns a user-friendly description for standard folder permissions.
 * Uses whoami().directories to verify the path/UUID belongs to the current user.
 * @param {string} resource_id - The filesystem path or UUID
 * @param {string} action - The access level (read, write, list, see)
 * @returns {string|null} A friendly HTML description or null if not a standard folder belonging to current user
 */
async function get_standard_folder_description (resource_id, action) {
    const whoami = await puter.auth.whoami();
    const directories = whoami.directories || {};

    // Standard folder names we recognize
    const folder_descriptions = {
        'Desktop': 'your Desktop folder',
        'Documents': 'your Documents folder',
        'Pictures': 'your Pictures folder',
        'Videos': 'your Videos folder',
    };

    // Check if resource_id matches any of the user's standard directories
    // directories is an object like { "/username/Desktop": "uuid-here", ... }
    for ( const [path, uuid] of Object.entries(directories) ) {
        // Check if resource_id matches either the path or the UUID
        if ( resource_id !== path && resource_id !== uuid ) continue;

        // Extract folder name from path (e.g., "/username/Desktop" -> "Desktop")
        const path_parts = path.split('/').filter(Boolean);
        if ( path_parts.length !== 2 ) continue;

        const folder_name = path_parts[1];
        const folder_desc = folder_descriptions[folder_name];
        if ( ! folder_desc ) continue;

        return `<strong>${html_encode(action)}</strong> ${folder_desc}.`;
    }

    return null;
}

function split_permission (permission) {
    return permission
        .split(':')
        .map(unescape_permission_component);
}

function unescape_permission_component (component) {
    let unescaped_str = '';
    // Constant for unescaped permission component string
    const STATE_NORMAL = {};
    // Constant for escaping special characters in permission strings
    const STATE_ESCAPE = {};
    let state = STATE_NORMAL;
    const const_escapes = { C: ':' };
    for ( let i = 0; i < component.length; i++ ) {
        const c = component[i];
        if ( state === STATE_NORMAL ) {
            if ( c === '\\' ) {
                state = STATE_ESCAPE;
            } else {
                unescaped_str += c;
            }
        } else if ( state === STATE_ESCAPE ) {
            unescaped_str += const_escapes.hasOwnProperty(c) ? const_escapes[c] : c;
            state = STATE_NORMAL;
        }
    }
    return unescaped_str;
}

export default UIWindowRequestPermission;
