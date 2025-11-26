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

    // show the real description of action
    h += `<p class="perm-description">${html_encode(requestingEntity)} is requesting for permission to ${html_encode(permission_description)}</p>`;

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
 * fs:UUID-OF-FILE:read, thread:UUID-OF-THREAD:post, service:name-of-service:ii:name-of-interface, driver:driver-name:action-name
 */
async function get_permission_description (permission) {
    const parts = split_permission(permission);
    const [resource_type, resource_id, action, interface_name = null] = parts;
    let fsentry;
    let app;

    if ( resource_type === 'fs' ) {
        fsentry = await puter.fs.stat({ uid: resource_id, consistency: 'eventual' });
    }
    if ( resource_type === 'app' ) {
        // resource_id may be uid#<appUid>, owner#<userId>, owner@<username>, or name
        const id = resource_id ?? '';
        if ( id.startsWith('uid#') ) {
            const app_uid = id.slice('uid#'.length);
            try {
                app = await puter.apps.get(app_uid);
            } catch (e) {
                // ignore lookup failures; fallback to generic text
            }
        } else if ( ! id.startsWith('owner#') && ! id.startsWith('owner@') && id ) {
            try {
                app = await puter.apps.get(id);
            } catch (e) {
                // ignore lookup failures
            }
        }
    }
    if ( resource_type === 'site' ) {
        // resource_id may be uid#<siteUid>, owner#<userId>, owner@<username>, or subdomain name
        const id = resource_id ?? '';
        if ( id.startsWith('uid#') ) {
            const site_uid = id.slice('uid#'.length);
            try {
                // There is no dedicated site getter in puter.js here; fall back to name display
                // if available in permission string.
            } catch (e) {
                // ignore
            }
        }
    }

    const permission_mappings = {
        'fs': fsentry ? `use ${fsentry.name} located at ${fsentry.dirpath} with ${action} access.` : null,
        'thread': action === 'post' ? `post to thread ${resource_id}.` : null,
        'service': action === 'ii' ? `use ${resource_id} to invoke ${interface_name}.` : null,
        'driver': `use ${resource_id} to ${action}.`,
        'app': (() => {
            if ( (resource_id ?? '').startsWith('owner#') || (resource_id ?? '').startsWith('owner@') ) {
                const label = resource_id.startsWith('owner#')
                    ? resource_id.slice('owner#'.length)
                    : resource_id.slice('owner@'.length);
                if ( action === 'write' ) {
                    return `modify all protected apps owned by ${label}`;
                }
                if ( action === 'read' ) {
                    return `access all protected apps owned by ${label}`;
                }
                return `access all protected apps owned by ${label}`;
            }
            if ( action === 'access' ) {
                if ( app?.name ) return `access app "${app.name}".`;
                if ( app?.uid ) return `access app with UID ${app.uid}.`;
                return `access app ${resource_id}.`;
            }
            if ( action === 'read' ) {
                if ( app?.name ) return `access app "${app.name}".`;
                if ( app?.uid ) return `access app with UID ${app.uid}.`;
                return `access app ${resource_id}.`;
            }
            if ( action === 'write' ) {
                if ( app?.name ) return `modify settings for app "${app.name}".`;
                if ( app?.uid ) return `modify settings for app with UID ${app.uid}.`;
                return `modify settings for app ${resource_id}.`;
            }
            return null;
        })(),
        'site': (() => {
            if ( (resource_id ?? '').startsWith('owner#') || (resource_id ?? '').startsWith('owner@') ) {
                const label = resource_id.startsWith('owner#')
                    ? resource_id.slice('owner#'.length)
                    : resource_id.slice('owner@'.length);
                if ( action === 'write' ) {
                    return `modify all protected sites owned by ${label}`;
                }
                if ( action === 'read' ) {
                    return `access all protected sites owned by ${label}`;
                }
                return `access all protected sites owned by ${label}`;
            }
            if ( action === 'access' || action === 'read' ) {
                return `access site ${resource_id}.`;
            }
            if ( action === 'write' ) {
                return `modify settings for site ${resource_id}.`;
            }
            return null;
        })(),
    };

    return permission_mappings[resource_type];
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
