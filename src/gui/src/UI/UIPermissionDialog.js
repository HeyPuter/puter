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

import { fsCreateKindFor } from '../helpers/fsCreateKind.js';
import { get_app_by_uid } from '../helpers/getAppByUid.js';

// Keeps a second request for the same (entity, permission) from stacking a
// duplicate dialog; both callers await the same user decision.
const pending_dialogs = new Map();

// Serializes the dialogs. `showModal()` makes the whole document inert, not
// just the requesting app's window, so several at once would bury the desktop
// under a pile of prompts the user has to clear before touching anything —
// including the app that asked. One at a time, in arrival order.
let dialog_queue = Promise.resolve();

// Buttons stay disabled until the dialog has been visible and focused this long
// without a break, so a click aimed at whatever covered it can't land on
// "Allow". See `guard_input`.
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
 * @param {boolean|'dir'|'file'} [options.create] - Create the fs path if it
 *   does not exist, after the user approves. Defaults to `true`; `false` opts
 *   out. Forwarded to the grant only.
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
    // regardless of the order the caller listed them in. `create` is resolved
    // here so the pending key, the dialog body and the grant all see one value.
    options = {
        ...options,
        permissions: [...permissions].sort(),
        create: options.create ?? true,
    };

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
    const pending_key = `${options.app_uid || options.origin || ''}\n${options.permissions.join('\n')}\n${options.create ?? ''}`;
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

/**
 * One description per requested permission, in order, or null when the request
 * can't be put to the user. Unsupported permission strings are denied silently
 * (existing contract), and a lookup that timed out lands here too.
 *
 * One undescribable scope denies the whole prompt rather than being dropped
 * from it: a scope the user was never shown must not ride along on an Allow
 * that described the others.
 *
 * @param {{ permissions: string[] }} options - The dialog options.
 * @returns {Promise<Array<{html: string, icon: string}> | null>}
 */
export async function describe_permissions (options) {
    const descriptions = await with_timeout(
        Promise.all(options.permissions.map(
            permission => get_permission_description(permission, options),
        )),
        LOOKUP_TIMEOUT_MS,
        null,
    );
    if ( ! descriptions || descriptions.some(d => ! d) ) return null;
    // The grant route refuses a request that would create more entries.
    const creating = new Set(options.permissions.filter((_, i) => descriptions[i].creates));
    if ( creating.size > MAX_CREATED_ENTRIES_PER_GRANT ) return null;
    return descriptions;
}

async function show_permission_dialog (options) {
    let descriptions;
    try {
        descriptions = await describe_permissions(options);
    } catch (e) {
        // Description lookup needs auth/whoami; treat failures as unsupported.
        console.error('Failed to describe permission', options.permissions, e);
        return false;
    }
    if ( ! descriptions ) return false;

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
        let input_guard = null;
        const settle = (granted) => {
            if ( settled ) return;
            settled = true;
            input_guard?.stop();
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

        // True while the grant POST is outstanding. Dismissing the dialog then
        // would answer "denied" for a permission the server may be in the
        // middle of committing, leaving the user believing they cancelled
        // something that is now granted.
        let granting = false;

        // Buttons take clicks only once the input guard is ready and no grant
        // is in flight.
        const sync_buttons = () => {
            const enabled = !!input_guard?.ready && ! granting;
            $allow.prop('disabled', ! enabled);
            $deny.prop('disabled', ! enabled);
        };
        sync_buttons();

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
            $allow.removeClass('perm-dialog-busy');
            sync_buttons();
        };

        $allow.on('click', async () => {
            if ( granting ) return;
            granting = true;
            $allow.addClass('perm-dialog-busy');
            sync_buttons();
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
                        // Always sent, so an explicit `false` reaches the
                        // server instead of falling back to its default.
                        create: options.create,
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
        input_guard = guard_input({
            win: window,
            doc: document,
            ms: INPUT_PROTECTION_MS,
            on_change: (ready) => {
                sync_buttons();
                // Focus the safe action by default; Enter must not grant by
                // accident. A disabled button can't take focus, so this waits
                // for the guard.
                if ( ready && ! granting ) $deny.get(0)?.focus();
            },
        });
    });
}

/**
 * Reports `ready` only once the page has been visible and focused for `ms`
 * without a break. Losing visibility or focus resets it, and the wait starts
 * over when both come back or anything enters or leaves fullscreen. A delay
 * counted from opening alone can run out while the dialog is covered by a
 * popup, another tab or a fullscreen element, leaving it live for a click the
 * user aimed at whatever covered it.
 *
 * @param {Object} opts
 * @param {Window} opts.win
 * @param {Document} opts.doc
 * @param {number} opts.ms
 * @param {(ready: boolean) => void} opts.on_change - Called when `ready` flips.
 * @returns {{ readonly ready: boolean, stop: () => void }}
 */
export function guard_input ({ win, doc, ms, on_change }) {
    let ready = false;
    let timer = null;
    let seen = false;
    const set_ready = (value) => {
        if ( ready === value ) return;
        ready = value;
        on_change(value);
    };
    const restart = () => {
        clearTimeout(timer);
        timer = null;
        set_ready(false);
        seen = doc.visibilityState === 'visible' && doc.hasFocus();
        if ( ! seen ) return;
        timer = setTimeout(() => {
            timer = null;
            set_ready(true);
        }, ms);
    };
    // Window `blur`/`focus` also fire when focus moves into or out of an app's
    // iframe, while the page stays focused throughout. Only a real change counts,
    // or the click that pulls focus out of an iframe would reset the wait and be
    // swallowed.
    const on_focus_change = () => {
        if ( seen !== (doc.visibilityState === 'visible' && doc.hasFocus()) ) {
            restart();
        }
    };
    const listeners = [
        [win, 'focus', on_focus_change],
        [win, 'blur', on_focus_change],
        [doc, 'visibilitychange', on_focus_change],
        [doc, 'fullscreenchange', restart],
    ];
    for ( const [target, name, fn] of listeners ) target.addEventListener(name, fn);
    restart();
    return {
        get ready () {
            return ready;
        },
        stop () {
            clearTimeout(timer);
            timer = null;
            for ( const [target, name, fn] of listeners ) target.removeEventListener(name, fn);
        },
    };
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

/** Access modes an `fs:` permission can ask for; anything else is not shown. */
const FS_ACCESS_MODES = ['see', 'list', 'read', 'write'];

/** The uuids (v1-8, nil, max) the grant route accepts as an `fs:` uid. */
const FS_UID_SHAPE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

/** The shape the grant route requires of an app uid a permission names. */
const APP_UID_SHAPE = /^app-[A-Za-z0-9_-]{1,64}$/;

// Limits the grant route enforces, so the dialog never offers what it refuses.
/** Most path components a created path may have below the home folder. */
const MAX_CREATE_DEPTH = 16;
/** Most entries one grant may create. */
const MAX_CREATED_ENTRIES_PER_GRANT = 4;
/** Home folders a grant never creates inside. Compared lowercased. */
const NON_CREATABLE_HOME_FOLDERS = ['appdata', 'trash'];
/** Width of the column a granted permission is stored in. */
const PERMISSION_MAX_LEN = 255;

/** The special folders described by name rather than by path. */
const STANDARD_FOLDER_KEYS = {
    Desktop: 'perm_folder_desktop',
    Documents: 'perm_folder_documents',
    Pictures: 'perm_folder_pictures',
    Videos: 'perm_folder_videos',
};

/**
 * Share-delegation roots (`manage:<root>:…`) → the line for each. One per level
 * of share the app may create for the user.
 */
const KV_SHARE_ROOT_KEYS = {
    'kv-share': 'perm_kv_share_manage',
    'kv-share-read': 'perm_kv_share_manage_read',
    'kv-share-write': 'perm_kv_share_manage_write',
};

/** What each key segment of a share consent's region may contain. */
const KV_SHARE_SEGMENT = /^[a-z0-9_.-]+$/;

/** `apps-of-user` / `subdomains-of-user` → the lines for read and write. */
const ACCOUNT_LIST_KEYS = {
    'apps-of-user': { read: 'perm_apps_read', write: 'perm_apps_write' },
    'subdomains-of-user': { read: 'perm_subdomains_read', write: 'perm_subdomains_write' },
};

const own = (map, key) => Object.hasOwn(map, key) ? map[key] : undefined;

/**
 * Generates a user-friendly description of a permission string.
 *
 * Only the families an app can be granted have a description, each in its
 * exact shape; the grant route refuses the same set. Anything else returns
 * null, which denies the request without a prompt.
 *
 * @param {string} permission - The permission string to describe
 * @param {Object} [options] - The dialog options, for checks that depend on who
 * is asking (a request for the requester's own data, for instance).
 * @returns {Promise<{html: string, icon: string} | null>} Description (HTML)
 * and icon key, or null if the permission cannot be requested interactively.
 */
export async function get_permission_description (permission, options = {}) {
    if ( permission === 'events:background' ) {
        return { html: i18n('perm_events_background'), icon: 'zap' };
    }

    const parts = split_permission(permission);
    // The grant route refuses any other spelling of the same parts.
    if ( parts.map(escape_permission_component).join(':') !== permission ) return null;
    const [head] = parts;

    if ( head === 'fs' ) {
        const [, resource_id, mode] = parts;
        if ( parts.length !== 3 || ! resource_id || ! FS_ACCESS_MODES.includes(mode) ) {
            return null;
        }
        if ( ! resource_id.startsWith('/') && ! FS_UID_SHAPE.test(resource_id) ) return null;
        return await get_fs_description(resource_id, mode, options);
    }

    if ( head === 'user' ) {
        if ( parts.length !== 4 || parts[2] !== 'email' || parts[3] !== 'read' ) return null;
        // An app can't ask to see other users' information
        const whoami = await puter.auth.whoami();
        if ( whoami.uuid !== parts[1] ) return null;
        return { html: i18n('perm_email_read'), icon: 'mail' };
    }

    const account_list_keys = own(ACCOUNT_LIST_KEYS, head);
    if ( account_list_keys ) {
        const key = parts.length === 3 ? own(account_list_keys, parts[2]) : undefined;
        if ( ! key ) return null;
        // An app can't ask about other users' apps or subdomains
        const whoami = await puter.auth.whoami();
        if ( whoami.uuid !== parts[1] ) return null;
        return { html: i18n(key), icon: head === 'apps-of-user' ? 'apps' : 'globe' };
    }

    if ( head === 'app-data' ) {
        return await get_app_data_description(parts, options);
    }

    if ( head === 'manage' && own(KV_SHARE_ROOT_KEYS, parts[1]) ) {
        return await get_kv_share_description(parts, options);
    }

    if ( head === 'app-root-dir' ) {
        const [, app_uid, mode] = parts;
        if ( parts.length !== 3 || (mode !== 'read' && mode !== 'write') ) return null;
        if ( ! APP_UID_SHAPE.test(app_uid) ) return null;
        const app = await get_app_exact(app_uid);
        if ( ! app ) return null;
        return {
            html: i18n(`perm_app_root_dir_${mode}`, { app: app.title || app.name }),
            icon: 'folder',
        };
    }

    return null;
}

/**
 * Describes `fs:<path|uid>:<mode>`: a special folder by name, an existing entry
 * by name and location, or a missing path `create` will make on Allow. Null for
 * an entry the user can't see and nothing will create, since the grant would
 * fail anyway.
 *
 * A description of a path to create carries `creates`, so the dialog can hold
 * the request to the grant route's per-request count.
 */
async function get_fs_description (resource_id, mode, options) {
    // A path that exists as the other kind than a forced `create` is a
    // conflict the grant route refuses. A uid is never created.
    const conflicts = (kind) => resource_id.startsWith('/')
        && (options.create === 'dir' || options.create === 'file')
        && options.create !== kind;

    const folder = await get_standard_folder_description(resource_id, mode);
    if ( folder ) return conflicts('dir') ? null : { html: folder, icon: 'folder' };

    let fsentry;
    try {
        fsentry = resource_id.startsWith('/')
            ? await puter.fs.stat({ path: resource_id, consistency: 'eventual' })
            : await puter.fs.stat({ uid: resource_id, consistency: 'eventual' });
    } catch (e) {
        // Only a missing entry can be created; any other failure says nothing
        // about what is there.
        if ( ! is_not_found(e) ) return null;
        fsentry = null;
    }

    if ( fsentry ) {
        const kind = fsentry.is_dir ? 'dir' : 'file';
        if ( conflicts(kind) ) return null;
        return {
            html: i18n(fs_access_key(kind, mode), { name: fsentry.name, path: fsentry.dirpath }),
            icon: fsentry.is_dir ? 'folder' : 'file',
        };
    }

    // Only a path in the user's own home can be created, and only when the
    // request allows it.
    if ( ! options.create ) return null;
    const { username } = await puter.auth.whoami();
    const home = `/${username}`;
    if ( ! resource_id.startsWith(`${home}/`) ) return null;
    const segments = resource_id.slice(home.length + 1).split('/');
    if ( segments.some(segment => segment === '' || segment === '.' || segment === '..') ) return null;
    if ( NON_CREATABLE_HOME_FOLDERS.includes(segments[0].toLowerCase()) ) return null;
    if ( segments.length > MAX_CREATE_DEPTH ) return null;
    const name = segments[segments.length - 1];
    const dirpath = resource_id.slice(0, resource_id.lastIndexOf('/'));
    // An explicit `'dir'`/`'file'` wins; `create: true` falls back to the same
    // basename heuristic the backend uses.
    const kind = options.create === 'dir' || options.create === 'file'
        ? options.create
        : fsCreateKindFor(name);
    const tier = mode === 'write' ? 'write' : 'read';
    return {
        html: i18n(`perm_fs_create_${kind}_${tier}`, { name, path: dirpath }),
        icon: kind === 'dir' ? 'folder' : 'file',
        creates: true,
    };
}

/** Whether a failed `puter.fs.stat` means the entry does not exist. */
function is_not_found (e) {
    return e?.code === 'subject_does_not_exist' || e?.status === 404;
}

/**
 * The line for an existing entry. On a file, `list` shows no more than `see`;
 * on a folder, both reach every subfolder.
 */
function fs_access_key (kind, mode) {
    if ( kind === 'file' && (mode === 'see' || mode === 'list') ) return 'perm_fs_see';
    return `perm_fs_${kind}_${mode}`;
}

/**
 * KV operation, or access class, → the verb the user sees. Deletion is named
 * explicitly: a scope that can remove another app's entries must not read as
 * "change".
 */
// Classes imply the ones below them (delete > write > read), so their wording
// names those too: "change" or "delete" alone would understate the grant.
const APP_DATA_VERBS = {
    read: 'read', get: 'read', list: 'read',
    write: 'change', set: 'change', add: 'change',
    incr: 'change', decr: 'change', update: 'change',
    delete: 'store_all', del: 'delete', remove: 'delete',
    expire: 'delete', expireAt: 'delete',
};

const APP_DATA_CLASSES = ['read', 'write', 'delete'];

/**
 * The uid of the app making the request, for the describers that compare it
 * against a uid the permission itself names.
 *
 * The in-GUI path knows the uid outright (IPC.js passes it); the popup and
 * iframe flows know the requester only by origin, so it is resolved here. It is
 * resolved for the description alone and never sent to /auth/grant-user-app,
 * which keeps receiving the origin and re-resolving it server-side: an origin
 * with no app row of its own resolves to a synthetic `app-<uuidv5(origin)>`,
 * and the grant endpoint reads its `app_uid` as uid-or-name, so a forwarded
 * synthetic uid would hand the grant to whoever registered an app under that
 * literal name.
 *
 * Null when there is nothing to resolve or the lookup fails —
 * `getAppUIDFromOrigin` reports failure by resolving to a null or undefined uid
 * rather than throwing (a refused origin comes back as an error body with no
 * uid), and throws only when the call itself cannot be made.
 */
async function resolve_requesting_app_uid (options) {
    if ( options.app_uid ) return options.app_uid;
    if ( ! options.origin ) return null;
    try {
        const uid = await window.getAppUIDFromOrigin(options.origin);
        return uid ?? null;
    } catch (e) {
        console.error('Failed to resolve requesting app', options.origin, e);
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
    if ( parts.length > 4 || ! APP_UID_SHAPE.test(target_uid ?? '') ) return null;
    // `app-data:<uid>:` and `app-data:<uid>:kv:` name no store or no op.
    if ( parts.some(part => part === '') ) return null;
    // Files take an access class only; KV also takes a single operation.
    if ( store === 'fs' && op && ! APP_DATA_CLASSES.includes(op) ) return null;

    // An app already reaches its own data; approving that would mean nothing.
    // A requester that will not resolve is not fatal here, unlike in the
    // delegation describer below: this check only suppresses a prompt that
    // would mean nothing, and denying on a failed lookup would refuse a
    // cross-app request that is perfectly good.
    const requester_app_uid = await resolve_requesting_app_uid(options);
    if ( requester_app_uid && target_uid === requester_app_uid ) return null;

    const app = await get_app_exact(target_uid);
    if ( ! app ) return null;
    if ( app.metadata?.share_app_data === false ) return null;

    const app_label = app.title || app.name || target_uid;

    // No op named means every op under it, by prefix implication — so the copy
    // has to cover deletion too, not just reading and changing.
    const verb = op ? own(APP_DATA_VERBS, op) : null;
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
 * Describes `manage:<kv-share root>:<owner>:<app>:<key segments>` — the app
 * handing a region of the data it keeps for this user to other people it picks.
 *
 * Returns null (which denies without prompting) for anything this copy cannot
 * honestly bound: another user's data, a requester this copy cannot name, a
 * namespace that is not the requester's own, or a request naming no region —
 * that last one is the whole of the app's data, which is a different decision
 * and not one a prompt can put in a line.
 */
export async function get_kv_share_description (parts, options) {
    const [, root, owner_uuid, namespace_app_uid, ...segments] = parts;
    const key = own(KV_SHARE_ROOT_KEYS, root);
    if ( ! key || ! owner_uuid || segments.length === 0 ) return null;
    if ( ! APP_UID_SHAPE.test(namespace_app_uid ?? '') ) return null;
    // The segments the grant route accepts for a new consent.
    if ( segments.some(segment => ! KV_SHARE_SEGMENT.test(segment)) ) return null;
    // Also refuses every region over the `read`/`write` share prefix limit,
    // which is longer than the column leaves room for.
    if ( parts.join(':').length > PERMISSION_MAX_LEN ) return null;
    const region = `${segments.join(':')}:`;

    // An app reaches its own namespace and no other, so a request naming
    // another one describes access it could not use. Checking that at all
    // needs the requester named, so an origin that will not resolve is refused
    // here rather than prompted for.
    const requester_app_uid = await resolve_requesting_app_uid(options);
    if ( ! requester_app_uid || namespace_app_uid !== requester_app_uid ) return null;

    const whoami = await puter.auth.whoami();
    if ( whoami.uuid !== owner_uuid ) return null;

    const app = await get_app_exact(namespace_app_uid);
    if ( ! app ) return null;

    return {
        html: i18n(key, {
            app: app.title || app.name || options.app_name,
            region,
        }),
        icon: 'shield',
    };
}

/**
 * The app with exactly this uid, or null. `get_app_by_uid` also follows the
 * alias a merged app leaves behind, and the grant route does not.
 */
async function get_app_exact (uid) {
    const app = await get_app_by_uid(uid);
    return app?.uid === uid ? app : null;
}

/**
 * The line for one of the user's own special folders (Desktop, Documents,
 * Pictures, Videos), matched by path or uid through `whoami().directories`, or
 * null for anything else.
 *
 * @param {string} resource_id - The filesystem path or UUID
 * @param {string} mode - see, list, read, or write
 * @returns {Promise<string|null>}
 */
async function get_standard_folder_description (resource_id, mode) {
    const whoami = await puter.auth.whoami();
    const directories = whoami.directories || {};

    // directories is an object like { "/username/Desktop": "uuid-here", ... }
    for ( const [path, uuid] of Object.entries(directories) ) {
        if ( resource_id !== path && resource_id !== uuid ) continue;

        const path_parts = path.split('/').filter(Boolean);
        if ( path_parts.length !== 2 ) continue;

        const folder_key = own(STANDARD_FOLDER_KEYS, path_parts[1]);
        if ( ! folder_key ) continue;

        // `false` so only the outer `i18n` encodes.
        return i18n(`perm_folder_${mode}`, { folder: i18n(folder_key, [], false) });
    }

    return null;
}

function split_permission (permission) {
    return permission
        .split(':')
        .map(unescape_permission_component);
}

/** One component as it is written canonically: `\` as `\\`, `:` as `\C`. */
function escape_permission_component (component) {
    return component.replace(/\\/g, '\\\\').replace(/:/g, '\\C');
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
