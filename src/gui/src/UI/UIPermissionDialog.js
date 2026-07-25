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

// Keeps a second request for the same (entity, permission) from stacking a
// duplicate dialog; both callers await the same user decision.
const pending_dialogs = new Map();

// Buttons stay disabled briefly after the dialog opens so a click aimed at
// the page underneath (or a clickjacking attempt) can't land on "Allow".
const INPUT_PROTECTION_MS = 350;

// How long the grant request may take before it is aborted and the dialog
// re-enables its buttons for a retry.
const GRANT_TIMEOUT_MS = 15000;

/**
 * Shows a permission-request dialog and resolves with the user's decision.
 *
 * Rendered as a standalone top-layer `<dialog>` (not a UIWindow) so it works
 * identically on the desktop, in popups, and on mobile.
 *
 * @param {Object} options
 * @param {string} options.permission - The permission string being requested.
 * @param {string} [options.app_uid] - UID of the requesting app, if known.
 * @param {string} [options.app_name] - Name of the requesting app, if known.
 * @param {string} [options.origin] - Origin of the requesting site (popup flow).
 * @returns {Promise<boolean>} `true` only if the permission was granted.
 */
async function UIPermissionDialog (options) {
    options = options ?? {};

    if ( ! options.permission || typeof options.permission !== 'string' ) {
        return false;
    }

    // Never prompt the user on behalf of an unidentifiable requester; the
    // grant call would be rejected by the server anyway.
    if ( ! options.app_uid && ! options.origin && ! options.app_name ) {
        return false;
    }

    const pending_key = `${options.app_uid ?? options.origin ?? options.app_name ?? ''}\n${options.permission}`;
    if ( pending_dialogs.has(pending_key) ) {
        return pending_dialogs.get(pending_key);
    }

    const promise = show_permission_dialog(options);
    pending_dialogs.set(pending_key, promise);
    try {
        return await promise;
    } finally {
        pending_dialogs.delete(pending_key);
    }
}

async function show_permission_dialog (options) {
    let permission_description;
    try {
        permission_description = await get_permission_description(options.permission);
    } catch (e) {
        // Description lookup needs auth/whoami; treat failures as unsupported.
        console.error('Failed to describe permission', options.permission, e);
        return false;
    }

    // Unsupported permission strings are denied silently (existing contract).
    if ( ! permission_description ) {
        return false;
    }

    const entity = await resolve_requesting_entity(options);

    return new Promise((resolve) => {
        const el_dialog = create_dialog_element(entity, permission_description);
        document.body.appendChild(el_dialog);

        let settled = false;
        const settle = (granted) => {
            if ( settled ) return;
            settled = true;
            // `close()` fires the 'close' event; the handler below resolves
            // false, so resolve first.
            resolve(granted);
            el_dialog.close();
            el_dialog.remove();
        };

        const $allow = $(el_dialog).find('.perm-dialog-allow');
        const $deny = $(el_dialog).find('.perm-dialog-deny');
        const $error = $(el_dialog).find('.perm-dialog-error');

        // Input protection: ignore clicks for a moment after opening.
        $allow.prop('disabled', true);
        $deny.prop('disabled', true);
        setTimeout(() => {
            if ( settled ) return;
            $allow.prop('disabled', false);
            $deny.prop('disabled', false);
            $deny.get(0)?.focus();
        }, INPUT_PROTECTION_MS);

        $allow.on('click', async () => {
            $allow.prop('disabled', true).addClass('perm-dialog-busy');
            $deny.prop('disabled', true);
            $error.hide();

            try {
                const res = await fetch(`${window.api_origin}/auth/grant-user-app`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${window.auth_token}`,
                    },
                    body: JSON.stringify({
                        app_uid: options.app_uid,
                        origin: options.origin,
                        permission: options.permission,
                    }),
                    method: 'POST',
                    // A hung request would leave both buttons disabled
                    // forever; time out into the retryable error path.
                    // (Guarded: AbortSignal.timeout is missing from some
                    // older engines that otherwise run the GUI fine.)
                    ...(typeof AbortSignal !== 'undefined' && AbortSignal.timeout
                        ? { signal: AbortSignal.timeout(GRANT_TIMEOUT_MS) }
                        : {}),
                });
                if ( ! res.ok ) {
                    throw new Error(`HTTP error! Status: ${res.status}`);
                }
                settle(true);
            } catch (err) {
                console.error(err);
                $error.text(i18n('perm_dialog_error')).show();
                $allow.prop('disabled', false).removeClass('perm-dialog-busy');
                $deny.prop('disabled', false);
            }
        });

        $deny.on('click', () => settle(false));

        // Esc key (native 'cancel'), or anything else that closes the dialog,
        // counts as a denial.
        el_dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
            settle(false);
        });
        el_dialog.addEventListener('close', () => settle(false));

        el_dialog.showModal();
        // Focus the safe action by default; Enter must not grant by accident.
        $deny.get(0)?.focus();
    });
}

/**
 * Builds the dialog DOM from the requesting entity and the permission
 * description. Returns a detached <dialog> element.
 */
function create_dialog_element (entity, permission_description) {
    let h = '';
    h += '<div class="perm-dialog-body">';

    // requesting entity identity
    h += '<div class="perm-dialog-identity">';
    h += entity.icon_html;
    h += `<h1 class="perm-dialog-entity-name">${html_encode(entity.display_name)}</h1>`;
    if ( entity.origin_host ) {
        h += `<span class="perm-dialog-entity-origin">${html_encode(entity.origin_host)}</span>`;
    }
    h += '</div>';

    // what is being requested
    h += `<p class="perm-dialog-lead">${i18n('perm_dialog_wants_to')}</p>`;
    h += '<div class="perm-dialog-permission">';
    h += `<div class="perm-dialog-perm-icon">${permission_icon_svg(permission_description.icon)}</div>`;
    h += `<div class="perm-dialog-perm-text">${permission_description.html}</div>`;
    h += '</div>';

    // error message (hidden until a grant attempt fails)
    h += '<p class="perm-dialog-error" style="display: none;"></p>';

    // actions
    h += '<div class="perm-dialog-actions">';
    h += `<button type="button" class="perm-dialog-allow">${i18n('allow')}</button>`;
    h += `<button type="button" class="perm-dialog-deny">${i18n('dont_allow')}</button>`;
    h += '</div>';

    // footnote
    h += `<p class="perm-dialog-footnote">${i18n('perm_dialog_footnote')}</p>`;

    h += '</div>';

    const el_dialog = document.createElement('dialog');
    el_dialog.className = 'perm-dialog';
    el_dialog.setAttribute('aria-label', entity.display_name);
    el_dialog.innerHTML = h;
    return el_dialog;
}

/**
 * Resolves how the requesting app or site is presented: display name,
 * origin host (popup flow), and an icon (app icon or letter avatar).
 */
async function resolve_requesting_entity (options) {
    let display_name = options.app_name ?? options.origin ?? '';
    let origin_host = null;
    let icon_url = null;

    if ( options.origin ) {
        try {
            origin_host = new URL(options.origin).host;
        } catch (e) {
            origin_host = options.origin;
        }
    }

    // Prefer the app's human-readable title and icon when we can get them.
    if ( options.app_name ) {
        try {
            const app_info = await window.get_apps(options.app_name);
            if ( app_info && ! Array.isArray(app_info) ) {
                display_name = app_info.title || display_name;
                icon_url = app_info.icon || null;
            }
        } catch (e) {
            // Fall back to the app name / letter avatar.
        }
    }

    // Sites are identified by their host rather than a full origin URL.
    if ( ! options.app_name && origin_host ) {
        display_name = origin_host;
    }

    // Don't repeat the origin as a subtitle when it is already the title.
    if ( origin_host === display_name ) {
        origin_host = null;
    }

    let icon_html;
    if ( icon_url && ! is_safe_icon_url(icon_url) ) {
        icon_url = null;
    }
    if ( icon_url ) {
        icon_html = `<img class="perm-dialog-entity-icon" src="${html_encode(icon_url)}" alt="" />`;
    } else {
        const initial = (display_name || '?').trim().charAt(0).toUpperCase() || '?';
        icon_html = `<div class="perm-dialog-entity-icon perm-dialog-letter-avatar">${html_encode(initial)}</div>`;
    }

    return { display_name, origin_host, icon_html };
}

/**
 * App icons are author-controlled; only allow schemes that are inert as an
 * image source on this security-sensitive dialog.
 */
function is_safe_icon_url (url) {
    if ( url.startsWith('data:image/') ) return true;
    try {
        const parsed = new URL(url, window.location.origin);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (e) {
        return false;
    }
}

/**
 * Inline SVG icons for each permission category. Stroke uses currentColor so
 * they adapt to light/dark themes via CSS.
 */
function permission_icon_svg (icon) {
    const attrs = 'xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    const icons = {
        folder: `<svg ${attrs}><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
        file: `<svg ${attrs}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        mail: `<svg ${attrs}><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
        apps: `<svg ${attrs}><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`,
        globe: `<svg ${attrs}><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
        zap: `<svg ${attrs}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
        chat: `<svg ${attrs}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
        shield: `<svg ${attrs}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
    };
    return icons[icon] ?? icons.shield;
}

/**
 * Generates a user-friendly description of a permission string.
 *
 * @param {string} permission - The permission string to describe
 * @returns {Promise<{html: string, icon: string} | null>} Description (HTML)
 * and icon key, or null if the permission cannot be requested interactively.
 */
async function get_permission_description (permission) {
    const parts = split_permission(permission);

    if ( ['fs', 'thread', 'service', 'driver'].includes(parts[0]) ) {
        const [resource_type, resource_id, action, interface_name = null] = parts;

        if ( resource_type === 'fs' ) {
            // Check for standard folders using whoami().directories
            const standard_folder_description = await get_standard_folder_description(resource_id, action);
            if ( standard_folder_description ) {
                return { html: standard_folder_description, icon: 'folder' };
            }
            // Try to stat by path or UUID
            try {
                let fsentry;
                if ( resource_id.startsWith('/') ) {
                    fsentry = await puter.fs.stat({ path: resource_id, consistency: 'eventual' });
                } else {
                    fsentry = await puter.fs.stat({ uid: resource_id, consistency: 'eventual' });
                }
                return {
                    html: i18n('perm_fs_file_access', {
                        name: fsentry.name,
                        path: fsentry.dirpath,
                        access: action,
                    }),
                    icon: fsentry.is_dir ? 'folder' : 'file',
                };
            } catch (e) {
                // Can't stat, use resource_id directly
                return {
                    html: i18n('perm_fs_resource_access', {
                        resource_id: resource_id,
                        access: action,
                    }),
                    icon: 'file',
                };
            }
        }

        if ( resource_type === 'thread' && action === 'post' ) {
            return { html: i18n('perm_thread_post', { thread: resource_id }), icon: 'chat' };
        }
        if ( resource_type === 'service' && action === 'ii' ) {
            return { html: i18n('perm_service_invoke', { service: resource_id, interface: interface_name }), icon: 'zap' };
        }
        if ( resource_type === 'driver' ) {
            return { html: i18n('perm_driver_use', { driver: resource_id, action: action }), icon: 'zap' };
        }
        return null;
    }

    if ( parts[0] === 'user' ) {
        const whoami = await puter.auth.whoami();
        // An app can't ask to see other users' information
        if ( whoami.uuid !== parts[1] ) return null;

        if ( parts[2] === 'email' && parts[3] === 'read' ) {
            return { html: i18n('perm_email_read'), icon: 'mail' };
        }
    }

    if ( parts[0] === 'apps-of-user' ) {
        const whoami = await puter.auth.whoami();
        // An app can't ask to see other users' apps
        if ( whoami.uuid !== parts[1] ) return null;

        if ( parts[2] === 'read' ) {
            return { html: i18n('perm_apps_read'), icon: 'apps' };
        }
        if ( parts[2] === 'write' ) {
            return { html: i18n('perm_apps_write'), icon: 'apps' };
        }
    }

    if ( parts[0] === 'subdomains-of-user' ) {
        const whoami = await puter.auth.whoami();
        // An app can't ask to see other users' subdomains
        if ( whoami.uuid !== parts[1] ) return null;

        if ( parts[2] === 'read' ) {
            return { html: i18n('perm_subdomains_read'), icon: 'globe' };
        }
        if ( parts[2] === 'write' ) {
            return { html: i18n('perm_subdomains_write'), icon: 'globe' };
        }
    }

    if ( parts[0] === 'app-root-dir' ) {
        // Format: app-root-dir:<app_uid>:<read|write>
        if ( parts[2] === 'read' ) {
            return { html: i18n('perm_app_root_dir_read'), icon: 'folder' };
        }
        if ( parts[2] === 'write' ) {
            return { html: i18n('perm_app_root_dir_write'), icon: 'folder' };
        }
    }

    return null;
}

/**
 * Returns a user-friendly description for standard folder permissions.
 * Uses whoami().directories to verify the path/UUID belongs to the current user.
 * @param {string} resource_id - The filesystem path or UUID
 * @param {string} action - The access level (read, write, list, see)
 * @returns {Promise<string|null>} A friendly HTML description or null if not a standard folder belonging to current user
 */
async function get_standard_folder_description (resource_id, action) {
    const whoami = await puter.auth.whoami();
    const directories = whoami.directories || {};

    // Standard folder names we recognize - maps to i18n keys
    const folder_i18n_keys = {
        'Desktop': 'perm_folder_desktop',
        'Documents': 'perm_folder_documents',
        'Pictures': 'perm_folder_pictures',
        'Videos': 'perm_folder_videos',
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
        const folder_i18n_key = folder_i18n_keys[folder_name];
        if ( ! folder_i18n_key ) continue;

        const folder_desc = i18n(folder_i18n_key);
        return i18n('perm_folder_access', {
            access: `<strong>${html_encode(action)}</strong>`,
            folder: folder_desc,
        }, false);
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

export default UIPermissionDialog;
