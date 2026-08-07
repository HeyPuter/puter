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

// Keeps a second request for the same (entity, permission) from stacking a
// duplicate dialog; both callers await the same user decision.
const pending_dialogs = new Map();

// Serializes the dialogs. `showModal()` makes the whole document inert, not
// just the requesting app's window, so several at once would bury the desktop
// under a pile of prompts the user has to clear before touching anything —
// including the app that asked. One at a time, in arrival order.
let dialog_queue = Promise.resolve();

// Buttons stay disabled briefly after the dialog opens so a click aimed at
// the page underneath (or a clickjacking attempt) can't land on "Allow".
const INPUT_PROTECTION_MS = 350;

// How long the grant request may take before it is aborted and the dialog
// re-enables its buttons for a retry.
const GRANT_TIMEOUT_MS = 15000;

// How long the lookups that run before the dialog appears may take. They hold
// the serialization slot, so a stall here would block every later request.
const LOOKUP_TIMEOUT_MS = 10000;

/**
 * Shows a permission-request dialog and resolves with the user's decision.
 *
 * Rendered as a standalone top-layer `<dialog>` (not a UIWindow) so it works
 * identically on the desktop, in popups, and on mobile.
 *
 * Requires `app_uid` or `origin`: those are the identities a grant can be
 * written against, so without one there is nothing to prompt about.
 *
 * @param {Object} options
 * @param {string} [options.permission] - A single permission string.
 * @param {string[]} [options.permissions] - Several, answered as one decision.
 * @param {string} [options.app_uid] - UID of the requesting app, if known.
 * @param {string} [options.app_name] - Registered name of the requesting app;
 *   used for display, never as the grant target.
 * @param {string} [options.origin] - Origin of the requesting site (popup flow).
 * @returns {Promise<boolean>} `true` only if the permission was granted.
 */
async function UIPermissionDialog (options) {
    options = options ?? {};

    // One decision can cover several scopes. Normalised here so everything
    // downstream — the pending key, the dialog body, the grant — sees a list.
    const permissions = Array.isArray(options.permissions)
        ? options.permissions
        : [options.permission];
    if ( permissions.length === 0
        || permissions.some(p => ! p || typeof p !== 'string') ) {
        return false;
    }
    // Sorted so two requests for the same set share one in-flight prompt
    // regardless of the order the caller listed them in.
    options = { ...options, permissions: [...permissions].sort() };

    // Never prompt the user on behalf of a requester the grant can't name.
    // Only `app_uid` and `origin` are sent to /auth/grant-user-app, so an
    // `app_name` on its own would buy a prompt whose "Allow" is guaranteed to
    // fail on the server.
    if ( ! options.app_uid && ! options.origin ) {
        return false;
    }

    // An origin the server would refuse to parse can't name a grant target
    // either, so there is nothing to prompt about — and showing it anyway would
    // put a string that is not a host into the identity line, which is styled to
    // elide *hosts* from the left (`direction: rtl`). Arbitrary text there can
    // render in an order it wasn't written in, on the one line of this dialog
    // whose whole job is saying who is asking. Mirrors the server's own check in
    // AuthService#originFromUrl: parseable, and http(s).
    if ( options.origin && ! is_web_origin(options.origin) ) {
        console.error('Permission dialog: unusable origin', options.origin);
        return false;
    }

    // `||`, not `??`: the gate above treats an empty uid as absent, so the key
    // has to fall through to the origin too — otherwise two different origins
    // arriving with a blank uid would share one decision.
    const pending_key = `${options.app_uid || options.origin || ''}\n${options.permissions.join('\n')}`;
    if ( pending_dialogs.has(pending_key) ) {
        return pending_dialogs.get(pending_key);
    }

    // Claim the next slot in the queue. Reading and replacing `dialog_queue`
    // happens before the first await, so slots are handed out in call order.
    const wait_for_turn = dialog_queue;
    let release_turn;
    dialog_queue = new Promise((r) => { release_turn = r; });

    const promise = (async () => {
        try {
            // A failed predecessor must not stall the queue behind it.
            await wait_for_turn.catch(() => {});
            return await show_permission_dialog(options);
        } catch (e) {
            // Callers treat this as the user's decision and some of them (the
            // IPC bridge) have no way to answer a rejection, which would leave
            // the requesting app waiting forever. Fail closed instead.
            console.error('Permission dialog failed', options.permissions, e);
            return false;
        } finally {
            release_turn();
        }
    })();
    pending_dialogs.set(pending_key, promise);
    try {
        return await promise;
    } finally {
        pending_dialogs.delete(pending_key);
    }
}

async function show_permission_dialog (options) {
    let descriptions;
    try {
        descriptions = await with_timeout(
            Promise.all(options.permissions.map(
                permission => get_permission_description(permission, options),
            )),
            LOOKUP_TIMEOUT_MS,
            null,
        );
    } catch (e) {
        // Description lookup needs auth/whoami; treat failures as unsupported.
        console.error('Failed to describe permission', options.permissions, e);
        return false;
    }

    // Unsupported permission strings are denied silently (existing contract).
    // A lookup that timed out lands here too: nothing to describe, so nothing
    // to prompt about.
    //
    // One undescribable scope denies the whole prompt rather than being dropped
    // from it: a scope the user was never shown must not ride along on an Allow
    // that described the others.
    if ( ! descriptions || descriptions.some(d => ! d) ) {
        return false;
    }

    const entity = await resolve_requesting_entity(options);

    return new Promise((resolve) => {
        const el_dialog = create_dialog_element(entity, descriptions);
        document.body.appendChild(el_dialog);

        // Set once a grant request has been sent without the server definitively
        // refusing it. A client-side timeout or a dropped response says nothing
        // about whether the row was written, so a later denial has to undo it —
        // otherwise the user is told "denied" while the grant is live in their
        // account. Declared before `settle`, which reads it.
        let grant_may_have_committed = false;

        let settled = false;
        const settle = (granted) => {
            if ( settled ) return;
            settled = true;
            if ( ! granted && grant_may_have_committed ) {
                // Not awaited: the requester gets its answer now, and the
                // account is reconciled in the background.
                undo_uncertain_grant(options);
            }
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

        // True while the grant POST is outstanding. Dismissing the dialog then
        // would answer "denied" for a permission the server may be in the
        // middle of committing, leaving the user believing they cancelled
        // something that is now granted.
        let granting = false;

        // Hands the dialog back to the user after a failed attempt: re-enables
        // the buttons, restores dismissability, and shows a retryable error.
        const fail_grant = () => {
            if ( settled ) return;
            granting = false;
            // The browser can force-close the dialog past the `cancel`
            // handler (repeated close requests can't be suppressed forever),
            // and the `close` handler defers to the in-flight grant. If that
            // grant then fails there is no visible retry UI to hand back —
            // settle as a denial or the requester waits forever.
            if ( ! el_dialog.open ) {
                settle(false);
                return;
            }
            // `.text()` escapes for display, so hand it the unencoded string —
            // the default encoding would surface entities like `&#39;`
            // verbatim in translations that contain an apostrophe.
            $error.text(i18n('perm_dialog_error', [], false)).show();
            $allow.prop('disabled', false).removeClass('perm-dialog-busy');
            $deny.prop('disabled', false);
        };

        $allow.on('click', async () => {
            if ( granting ) return;
            granting = true;
            $allow.prop('disabled', true).addClass('perm-dialog-busy');
            $deny.prop('disabled', true);
            $error.hide();

            // Time-box the request: while it is outstanding the dialog can't
            // be dismissed, so a hung network must not strand the user in
            // front of a modal with both buttons disabled. AbortController is
            // available wherever the GUI runs; AbortSignal.timeout is not.
            const controller = typeof AbortController !== 'undefined'
                ? new AbortController()
                : null;
            const grant_timer = setTimeout(() => {
                // A request still outstanding after the timeout has left this
                // browser with an unknown outcome, so record that before
                // anything can settle. The `catch` below sets the same flag,
                // but only from a microtask that cannot run until this timer
                // callback returns — by which time `fail_grant` may already
                // have settled the dialog as a denial (it does exactly that
                // when the dialog was force-closed mid-grant), leaving a
                // committed grant with no revoke behind it.
                grant_may_have_committed = true;
                controller?.abort();
                // Also recover on engines with no AbortController, where the
                // fetch above may never settle on its own.
                fail_grant();
            }, GRANT_TIMEOUT_MS);

            // True once we have an answer that proves nothing was written.
            let refused_outright = false;
            try {
                const res = await fetch(`${window.api_origin}/auth/grant-user-app`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${window.auth_token}`,
                    },
                    body: JSON.stringify({
                        app_uid: options.app_uid,
                        origin: options.origin,
                        // One request for the whole set: the server validates
                        // every entry before writing any, so a partial grant
                        // can't survive a rejected scope — and the
                        // uncertain-commit handling below stays single-flight.
                        permissions: options.permissions,
                    }),
                    method: 'POST',
                    ...(controller ? { signal: controller.signal } : {}),
                });
                if ( ! res.ok ) {
                    // A 4xx is the server refusing outright, so nothing was
                    // written. Anything else leaves the outcome unknown.
                    refused_outright = res.status >= 400 && res.status < 500;
                    throw new Error(`HTTP error! Status: ${res.status}`);
                }
                settle(true);
            } catch (err) {
                // An abort or a dropped response says nothing about whether the
                // server committed the request that already left this browser.
                if ( ! refused_outright ) {
                    grant_may_have_committed = true;
                }
                console.error(err);
                fail_grant();
            } finally {
                clearTimeout(grant_timer);
            }
        });

        $deny.on('click', () => settle(false));

        // Esc key (native 'cancel'), or anything else that closes the dialog,
        // counts as a denial — unless a grant is mid-flight, in which case the
        // request's own outcome is the answer.
        el_dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
            if ( granting ) return;
            settle(false);
        });
        el_dialog.addEventListener('close', () => {
            if ( granting ) return;
            settle(false);
        });

        try {
            el_dialog.showModal();
        } catch (e) {
            // `showModal()` throws when modals are blocked for the document,
            // e.g. the GUI embedded in an `<iframe sandbox>` without
            // `allow-modals`. Deny rather than leave an invisible dialog
            // behind and the caller waiting on it.
            console.error('Permission dialog could not be shown', e);
            el_dialog.remove();
            settle(false);
            return;
        }
        // Focus the safe action by default; Enter must not grant by accident.
        $deny.get(0)?.focus();
    });
}

/**
 * Withdraws a grant whose POST may have committed even though the dialog never
 * saw a success response, so a "Don't Allow" can't leave a live permission the
 * user believes they refused. Addressed by the same identifiers the grant used.
 */
async function undo_uncertain_grant (options) {
    try {
        await fetch(`${window.api_origin}/auth/revoke-user-app`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.auth_token}`,
            },
            body: JSON.stringify({
                app_uid: options.app_uid,
                origin: options.origin,
                permissions: options.permissions,
            }),
            method: 'POST',
            // In the popup flow the answer is posted and the window closed
            // right after `settle`, and a plain fetch is cancelled with its
            // document — taking this reconciliation down with it.
            keepalive: true,
        });
    } catch (e) {
        console.error('Failed to withdraw uncertain permission grants', e);
    }
}

/**
 * Whether `origin` is a real web origin: something `new URL()` accepts, on a
 * scheme the platform actually serves apps over. `new URL()` alone is far too
 * permissive here — it happily parses `javascript:`, `data:` and `file:`.
 *
 * @param {string} origin
 * @returns {boolean}
 */
function is_web_origin (origin) {
    try {
        const { protocol } = new URL(origin);
        return protocol === 'https:' || protocol === 'http:';
    } catch (e) {
        return false;
    }
}

/**
 * Resolves `promise`, or `fallback` if it hasn't settled within `ms`.
 *
 * The lookups before the dialog appears run while this request holds the
 * serialization slot, and none of them (`whoami`, `fs.stat`, `get_apps`) has a
 * timeout of its own. One stalled request would hold the slot forever and every
 * later permission request in the page would wait behind it.
 */
function with_timeout (promise, ms, fallback) {
    let timer;
    return Promise.race([
        promise,
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(fallback), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * Builds the dialog DOM from the requesting entity and the permission
 * description. Returns a detached <dialog> element.
 */
function create_dialog_element (entity, descriptions) {
    let h = '';
    h += '<div class="perm-dialog-body">';

    // requesting entity identity
    h += '<div class="perm-dialog-identity">';
    h += entity.icon_html;
    // A host is elided from the left, keeping the registrable domain visible —
    // the part that says who is actually asking. Truncating the other end would
    // let `accounts.google.com.attacker.example` read as `accounts.google.com…`.
    const name_class = entity.is_host
        ? 'perm-dialog-entity-name perm-dialog-entity-host'
        : 'perm-dialog-entity-name';
    h += `<h1 class="${name_class}">${html_encode(entity.display_name)}</h1>`;
    if ( entity.subtitle ) {
        h += `<span class="perm-dialog-entity-origin">${html_encode(entity.subtitle)}</span>`;
    }
    h += '</div>';

    // what is being requested
    h += `<p class="perm-dialog-lead">${i18n('perm_dialog_wants_to')}</p>`;
    for ( const description of descriptions ) {
        h += '<div class="perm-dialog-permission">';
        h += `<div class="perm-dialog-perm-icon">${permission_icon_svg(description.icon)}</div>`;
        h += `<div class="perm-dialog-perm-text">${description.html}</div>`;
        h += '</div>';
    }

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
 * Resolves how the requesting app or site is presented: display name, a
 * subtitle carrying the identity that is actually unique (the app's registered
 * name, or the site's host), and an icon (app icon or letter avatar).
 */
async function resolve_requesting_entity (options) {
    let display_name = options.app_name ?? options.origin ?? '';
    let subtitle = null;
    let icon_url = null;

    if ( options.origin ) {
        try {
            subtitle = new URL(options.origin).host;
        } catch (e) {
            subtitle = options.origin;
        }
    }

    // Prefer the app's human-readable title and icon when we can get them.
    if ( options.app_name ) {
        try {
            const app_info = await with_timeout(
                window.get_apps(options.app_name),
                LOOKUP_TIMEOUT_MS,
                null,
            );
            if ( app_info && ! Array.isArray(app_info) ) {
                display_name = app_info.title || display_name;
                icon_url = app_info.icon || null;
            }
        } catch (e) {
            // Fall back to the app name / letter avatar.
        }
        // An app's title is free-form text its author chooses and two apps can
        // share one, so the title alone can impersonate another app on this
        // dialog. Name the app underneath it: `name` is unique per app and
        // format-restricted, which the title is not.
        subtitle = options.app_name;
    }

    // Sites are identified by their host rather than a full origin URL.
    let is_host = false;
    if ( ! options.app_name && subtitle ) {
        display_name = subtitle;
        is_host = true;
    }

    // Don't repeat the same string twice.
    if ( subtitle === display_name ) {
        subtitle = null;
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

    return { display_name, subtitle, icon_html, is_host };
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
 * @param {Object} [options] - The dialog options, for checks that depend on who
 * is asking (a request for the requester's own data, for instance).
 * @returns {Promise<{html: string, icon: string} | null>} Description (HTML)
 * and icon key, or null if the permission cannot be requested interactively.
 */
async function get_permission_description (permission, options = {}) {
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

    if ( parts[0] === 'app-data' ) {
        return await get_app_data_description(parts, options);
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
 * KV operation, or access class, → the verb the user sees. Deletion is named
 * explicitly: a scope that can remove another app's entries must not read as
 * "change".
 */
// `write` satisfies a read check via the exploder, so its wording names
// reading too — "change" alone would understate the grant.
const APP_DATA_VERBS = {
    read: 'read', get: 'read', list: 'read',
    write: 'change', set: 'change', add: 'change',
    incr: 'change', decr: 'change', update: 'change',
    delete: 'delete', del: 'delete', remove: 'delete',
    expire: 'delete', expireAt: 'delete',
};

/**
 * Look up the app a cross-app request names. Returns null when it does not
 * exist, so an unresolvable target never reaches the prompt.
 */
async function get_app_by_uid (uid) {
    try {
        const res = await fetch(`${window.api_origin}/drivers/call`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.auth_token}`,
            },
            body: JSON.stringify({
                interface: 'puter-apps',
                driver: 'es:app',
                method: 'read',
                args: { uid },
            }),
            method: 'POST',
        });
        if ( ! res.ok ) return null;
        const body = await res.json();
        return body?.result ?? null;
    } catch (e) {
        console.error('Failed to look up app', uid, e);
        return null;
    }
}

/**
 * Describes `app-data:<uid>[:<store>[:<op>]]` — one app using another's data.
 *
 * Returns null (which denies without prompting) when there is nothing to ask:
 * the target is the requester itself, the target does not exist, or its
 * developer has opted out of sharing. In each case the grant would be refused or
 * redundant, so a prompt would only mislead.
 */
export async function get_app_data_description (parts, options) {
    const [, target_uid, store, op] = parts;
    if ( ! target_uid ) return null;

    // An app already reaches its own data; approving that would mean nothing.
    if ( options.app_uid && target_uid === options.app_uid ) return null;

    const app = await get_app_by_uid(target_uid);
    if ( ! app ) return null;
    if ( app.metadata?.share_app_data === false ) return null;

    const app_label = app.title || app.name || target_uid;

    // No op named means every op under it, by prefix implication — so the copy
    // has to cover deletion too, not just reading and changing.
    const verb = op ? APP_DATA_VERBS[op] : null;
    if ( op && ! verb ) return null;

    if ( ! store ) {
        return {
            html: i18n('perm_app_data_all', { app: app_label }),
            icon: 'shield',
        };
    }
    if ( store !== 'kv' && store !== 'fs' ) return null;

    // `false` so only the outer `i18n` encodes: it encodes the whole
    // interpolated string, so two levels show a literal `&#39;`.
    const subject = store === 'fs'
        ? i18n('perm_app_data_subject_files', { app: app_label }, false)
        : i18n('perm_app_data_subject_data', { app: app_label }, false);

    if ( ! verb ) {
        return {
            html: i18n('perm_app_data_store_all', { subject }),
            icon: store === 'fs' ? 'folder' : 'shield',
        };
    }
    return {
        html: i18n(`perm_app_data_${verb}`, { subject }),
        icon: store === 'fs' ? 'folder' : 'shield',
    };
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
