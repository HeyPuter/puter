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

import UIDashboard from './UI/Dashboard/UIDashboard.js';
import TabApps from './UI/Dashboard/TabApps.js';
import UIAlert from './UI/UIAlert.js';
import UIComponentWindow from './UI/UIComponentWindow.js';
import UIDesktop from './UI/UIDesktop.js';
import UIWindow from './UI/UIWindow.js';
import UIWindowAppFeedback from './UI/UIWindowAppFeedback.js';
import UIWindowAuthMe from './UI/UIWindowAuthMe.js';
import UIWindowChangeUsername from './UI/UIWindowChangeUsername.js';
import UIWindowCopyToken from './UI/UIWindowCopyToken.js';
import UIWindowEmailConfirmationRequired from './UI/UIWindowEmailConfirmationRequired.js';
import UIWindowPhoneVerificationRequired from './UI/UIWindowPhoneVerificationRequired.js';
import UIWindowCardVerificationRequired from './UI/UIWindowCardVerificationRequired.js';
import UIWindowLogin from './UI/UIWindowLogin.js';
import UIWindowLoginInProgress from './UI/UIWindowLoginInProgress.js';
import UIWindowNewPassword from './UI/UIWindowNewPassword.js';
import UIPermissionDialog from './UI/UIPermissionDialog.js';
import UIWindowSaveAccount from './UI/UIWindowSaveAccount.js';
import UIWindowSessionList from './UI/UIWindowSessionList.js';
import UIWindowSignup from './UI/UIWindowSignup.js';
import UIWindowRecoverPassword from './UI/UIWindowRecoverPassword.js';
import { PROCESS_RUNNING } from './definitions.js';
import create_access_token from './helpers/create_access_token.js';
import create_gui_token from './helpers/create_gui_token.js';
import {
    authmeRequestUrl,
    authmeReturnUrl,
    fullTokenAllowed,
    isDeliverableRedirect,
    shouldUseRemoteAuthme,
    urlTokenParam,
    wantsFullToken,
} from './util/authmeGrant.js';
import init_device_signals from './helpers/device_signals.js';
import item_icon from './helpers/item_icon.js';
import launch_app from './helpers/launch_app.js';
import { parse_url_paths } from './helpers/url_paths.js';
import update_last_touch_coordinates from './helpers/update_last_touch_coordinates.js';
import update_mouse_position from './helpers/update_mouse_position.js';
import update_title_based_on_uploads from './helpers/update_title_based_on_uploads.js';
import path from './lib/path.js';
import { AntiCSRFService } from './services/AntiCSRFService.js';
import { BroadcastService } from './services/BroadcastService.js';
import { DebugService } from './services/DebugService.js';
import { ExecService } from './services/ExecService.js';
import { IPCService } from './services/IPCService.js';
import { LaunchOnInitService } from './services/LaunchOnInitService.js';
import { LocaleService } from './services/LocaleService.js';
import { ProcessService } from './services/ProcessService.js';
import { ThemeService } from './services/ThemeService.js';
// Curried: takes `{ window }` and returns the path mapper. Import under a
// factory name so a bare `privacy_aware_path(path)` call in this module can't
// silently resolve to the factory — use `window.privacy_aware_path` instead.
import { privacy_aware_path as privacy_aware_path_factory } from './util/desktop.js';
import { resolveAPIOrigin } from './util/apiOrigin.js';
import { deliversTokenToOpener, runsUserAppTokenExchange } from './util/popupAuth.js';
import { verifyOidcPopupReturn } from './util/popupOidcReturn.js';

const postAuthActions = async (action) => {
    // Set when a popup's user-app token exchange fails. The exchange is what
    // bootstraps the app row a permission grant is written against, so an
    // action that depends on it has to report failure rather than prompt.
    let token_exchange_failed = false;
    // -------------------------------------------------------------------------------------
    // Action: AuthMe — redirect to a third-party URL with the user's auth token
    // -------------------------------------------------------------------------------------
    if ( action === 'authme' ) {
        const redirectURL = window.url_query_params.get('redirectURL');
        // Refuse an undeliverable destination before the dialog, not after:
        // `javascript:` and `data:` targets execute in *this* document when
        // assigned to `location`, which would be script execution on the
        // account origin rather than a redirect. See `isDeliverableRedirect`.
        if ( redirectURL && ! isDeliverableRedirect(redirectURL) ) {
            await UIAlert({ message: i18n('authme_bad_redirect_url') });
            return;
        }
        // A full account session is only ever *offered* when the caller names
        // it. Without `token_type=session` this flow can hand over nothing but
        // the restricted API token, so an ordinary AuthMe link can't be
        // dressed up into a session grant by whoever crafted it.
        //
        // Naming it isn't sufficient either: the session grade is only offered
        // to a loopback destination, the one setup it exists for. Anywhere
        // else falls back to the restricted token — see `fullTokenAllowed`.
        const wants_full_token = fullTokenAllowed(
            window.url_query_params,
            redirectURL,
        );
        if ( wantsFullToken(window.url_query_params) && ! wants_full_token ) {
            console.warn(
                '[authme] token_type=session ignored for a non-loopback ' +
                'destination; granting the restricted API token instead.',
            );
        }
        if ( redirectURL ) {
            const approved = await UIWindowAuthMe({
                redirect_url: redirectURL,
                full_token: wants_full_token,
            });
            if ( approved ) {
                // Default: a named, revocable full-API-access token rather
                // than the raw GUI/session token — it can use the whole API
                // but can't manage the account.
                //
                // `token_type=session` (approved via type-to-confirm) hands
                // over a GUI token instead. That exists for a locally served
                // GUI pointed at a remote backend: `/login` only accepts its
                // own origin, so this is the sanctioned way for a dev GUI to
                // get a session — the password is still only ever typed here.
                let host = '';
                try { host = new URL(redirectURL).host; } catch ( e ) { /* ignore */ }
                let token;
                try {
                    token = wants_full_token
                        ? await create_gui_token()
                        : await create_access_token({
                            label: host
                                ? `${i18n('token_label_external_app')} (${host})`
                                : i18n('token_label_external_app'),
                        });
                } catch ( e ) {
                    await UIAlert({ message: e?.message ?? String(e) });
                    return;
                }
                window.location.href = authmeReturnUrl(
                    redirectURL,
                    token,
                ).href;
                return;
            }
        }
    }

    // -------------------------------------------------------------------------------------
    // Action: CopyAuth — show dialog to copy auth token
    // -------------------------------------------------------------------------------------
    if ( action === 'copyauth' ) {
        await UIWindowCopyToken({ show_header: true });
    }

    // -------------------------------------------------------------------------------------
    // Load desktop, only if we're not embedded in a popup and not on the dashboard page
    // -------------------------------------------------------------------------------------
    if ( !window.embedded_in_popup && !window.is_dashboard_mode ) {
        if ( window.is_fullpage_mode ) {
            // In fullpage mode, skip loading desktop items and background
            UIDesktop({});
        } else {
            await window.get_auto_arrange_data();
            puter.fs.stat({ path: window.desktop_path, consistency: 'eventual' }).then(desktop_fsentry => {
                UIDesktop({ desktop_fsentry: desktop_fsentry });
            });
        }
    }
    // -------------------------------------------------------------------------------------
    // Dashboard mode
    // -------------------------------------------------------------------------------------
    else if ( window.is_dashboard_mode ) {
        const el_dashboard_promise = UIDashboard();
        // Direct landing on /app/<name>: open the app in the dashboard the
        // same way a tile launch does. The dashboard's route is slotted
        // underneath first (replaceState) and the launch re-claims
        // /app/<name> as a real history entry, so Back minimizes to the
        // dashboard exactly like an in-dashboard launch. (`?c` suppresses
        // the auto-launch, mirroring the desktop URL-launch flow.)
        if ( window.url_paths[0]?.toLocaleLowerCase() === 'app'
            && window.url_paths[1]
            && ! window.url_query_params.has('c') ) {
            const app_name = window.url_paths[1];
            // any query param that doesn't start with 'puter.' is passed
            // through to the app (mirrors the desktop URL-launch flow)
            const app_query_params = {};
            for ( const [key, value] of window.url_query_params ) {
                if ( ! key.startsWith('puter.') ) {
                    app_query_params[key] = value;
                }
            }
            let posargs;
            if ( app_query_params.posargs ) {
                try {
                    posargs = JSON.parse(app_query_params.posargs);
                } catch (e) {
                    // malformed posargs: launch without them
                }
            }
            // The server titles /app/<name> pages after the app, so the
            // launch's lazy base-title capture would keep the app's name
            // forever — preset the title to fall back to when the app's
            // history entry is popped.
            window.dashboard_base_title = i18n('window_title_puter');
            // ...and make it the DOCUMENT title before the replaceState
            // below commits the dashboard's own entry. Chrome stamps a
            // session entry with the document title current at commit and
            // shows that stored title in the tab strip whenever a traversal
            // lands on the entry — so with the server's app-name title
            // still in place, closing the app (whose close consumes the
            // /app/<name> entry via history.back()) left the tab named
            // after an app that was no longer on screen: the popstate
            // handler's document.title reset updates the DOM title, but the
            // tab strip keeps displaying the entry's stored one.
            document.title = window.dashboard_base_title;
            window.history.replaceState(null, '', '/');
            // Resolve the app's info NOW, in parallel with the tile wait
            // below, so the intro never delays the launch's own server
            // round-trip; the result is handed to launch_app as app_obj (the
            // same object its own fetch would produce, at the grid tiles'
            // 128px icon size — the intro may have to DRAW a tile from it,
            // when the landing is what installs the app). A failed prefetch
            // hands nothing over — launch_app refetches and fails exactly
            // the way it always did.
            const app_info_promise = puter.apps.get(app_name, { icon_size: 128 })
                .catch(() => null);
            (async () => {
                // If the app already has a tile in the Apps tab, play the
                // whole click→morph→open sequence a real tile click plays —
                // paced so it can be followed: the grid appears, a beat, the
                // tile visibly acknowledges (icon ghost), a beat, and the
                // window grows out of its slot — so the landing tells the
                // user what is being opened and where minimize puts it back.
                // No tile (not installed, grid too slow, apps fetch failed,
                // animations off): the launch proceeds immediately with the
                // plain fade, as before. The intro also steps aside on its
                // own: user input skips its remaining beats, and once this
                // account has watched it a few times the beats collapse for
                // good (see beginDeepLinkLaunch).
                let tile = null;
                try {
                    const el_dashboard = await el_dashboard_promise;
                    // The app-info promise lets the intro materialize a tile
                    // for an app the dashboard doesn't have yet — landing on
                    // an app is what installs it (see _spliceDeepLinkApp).
                    tile = await TabApps.beginDeepLinkLaunch(app_name, $(el_dashboard), app_info_promise);
                } catch ( _e ) {
                    // No dashboard window — no intro; still launch.
                }
                const app_obj = await app_info_promise;
                launch_app({
                    name: app_name,
                    maximized: true,
                    params: app_query_params,
                    readURL: window.url_query_params.get('readURL'),
                    ...(app_obj ? { app_obj } : {}),
                    ...(posargs ? {
                        args: {
                            command_line: { args: posargs },
                        },
                    } : {}),
                    window_options: { morph_from_dashboard_tile: true },
                }).catch((err) => {
                    console.error(`Failed to launch ${app_name} from URL:`, err);
                }).finally(() => {
                    TabApps.settleDeepLinkLaunch(app_name, tile);
                });
            })();
        }
    }
    // -------------------------------------------------------------------------------------
    // If embedded in a popup, send the token to the opener and close the popup
    // -------------------------------------------------------------------------------------
    else {
        let msg_id = window.url_query_params.get('msg_id');
        // `cross_origin_isolated` routes the token to the opener through
        // `/login/set`, which `/login/wait` then hands to anyone holding the
        // session id. That is a sign-in mechanism, so it is gated by the same
        // rule as the postMessage hand-off below — otherwise adding one query
        // parameter to a `request-permission` URL turns the permission prompt
        // into a token grant, and skips the prompt entirely.
        let isolated = window.url_query_params.get("cross_origin_isolated") === 'true'
            && deliversTokenToOpener(action);
        let session = window.url_query_params.get('signin_session');

        // Signing the opener in is something the user has to have asked for.
        // The gates upstream record that decision — picking an account,
        // finishing signup, or already holding a token for this opener — and
        // a first visit that mints a throwaway temp user has no existing
        // account to hand over. Without this check the hand-off below runs
        // unconditionally, so a popup that showed the user nothing still
        // ended in a token: dismissing the account picker skipped only the
        // early exchange, not the delivery.
        //
        // Scoped to the popups whose whole purpose is signing in. The
        // file-picker actions also reach the hand-off, but they answer for
        // themselves — they have their own dialogs and never show an account
        // picker, so requiring one here would just break them.
        const is_signin_popup = !action || action === 'sign-in';
        const consented =
            window.popup_signin_consent ||
            (window.attempt_temp_user_creation && window.first_visit_ever);
        if (is_signin_popup && !consented) {
            console.error(
                'popup sign-in was not consented to; not delivering a token',
            );
            if (isolated) {
                window.close();
                window.open('', '_self').close();
                return;
            }
            window.opener?.postMessage({
                msg: 'puter.token',
                success: false,
                token: null,
                msg_id: msg_id,
            }, window.openerOrigin);
            window.close();
            window.open('', '_self').close();
            return;
        }

        if (isolated) {
            try {
                const data = await window.getUserAppToken(new URL(window.openerOrigin).origin);
                // Same two failure modes the postMessage path below guards
                // against: `getUserAppToken` reports a network failure by
                // returning null, and an HTTP failure (a blocked origin, an
                // unparseable origin, a 5xx) by returning the parsed *error*
                // body — truthy, but carrying no token. Without this check the
                // missing token is handed to `/login/set`, which rejects it as
                // a 400, and every distinct cause — including the ones that
                // only occur on a deployment with a populated origin blocklist
                // — collapses into the same unattributable alert below.
                if ( ! data?.token ) {
                    const detail = data?.code
                        ? `${data.code}: ${data.message ?? ''}`
                        : 'no response';
                    throw new Error(
                        `user-app token exchange returned no token (${detail})`,
                    );
                }
                const resp = await fetch(`${window.api_origin}/login/set`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        auth_token: data.token,
                        session: session,
                    }),
                });
                if (!resp.ok) {
                    throw new Error(`/login/set failed: ${resp.status} ${resp.statusText}`);
                }
                window.close();
                window.open('', '_self').close();
            } catch (err) {
                console.error(err);
                await UIAlert({
                    message: "Couldn't sign you in. Please try again.",
                });
            }
            return;
        } else if ( runsUserAppTokenExchange(action) ) {
            const deliver_token_to_opener = deliversTokenToOpener(action);
            try {
                let data = await window.getUserAppToken(new URL(window.openerOrigin).origin);
                // `getUserAppToken` reports a network failure by returning
                // null, and an HTTP failure (a blocked origin, a 5xx) by
                // returning the parsed *error* body — which is truthy but
                // carries no token. Both mean the exchange did not happen, so
                // say what went wrong instead of handing the opener an
                // `undefined` token and, for actions that depend on the app row
                // this bootstraps, prompting for a grant that could only fail.
                if ( ! data?.token ) {
                    throw new Error('user-app token exchange returned no token');
                }
                // This is an implicit app and the app_uid is sent back from the server
                // we cache it here so that we can use it later
                window.host_app_uid = data.app_uid;
                // send token to parent. The opener is unreachable when it is
                // cross-origin isolated (COOP severs the relationship); those
                // flows learn the outcome server-side instead.
                if ( deliver_token_to_opener ) {
                    window.opener?.postMessage({
                        msg: 'puter.token',
                        success: true,
                        token: data.token,
                        app_uid: data.app_uid,
                        username: window.user.username,
                        msg_id: msg_id,
                    }, window.openerOrigin);
                }
                // close popup
                if ( !action || action === 'sign-in' ) {
                    window.close();
                    window.open('', '_self').close();
                }
            } catch ( err ) {
                // send error to parent
                if ( deliver_token_to_opener ) {
                    window.opener?.postMessage({
                        msg: 'puter.token',
                        success: false,
                        token: null,
                        msg_id: msg_id,
                    }, window.openerOrigin);
                    // close popup
                    window.close();
                    window.open('', '_self').close();
                } else {
                    // The requester is waiting on a decision, not a token, so
                    // closing here would leave it with no answer at all. Record
                    // the failure and let the action below report a denial and
                    // close — the exchange is what bootstraps the app row a
                    // grant needs, so there is nothing to prompt about.
                    console.error('token exchange failed before permission prompt', err);
                    token_exchange_failed = true;
                }
            }
        }

        let app_uid;

        if ( window.openerOrigin ) {
            try {
                // `getAppUIDFromOrigin` reports failure by resolving to a
                // null/undefined uid, not by throwing — so check the value,
                // and on either failure mode keep the host_app_uid set by
                // the token exchange above, which resolved the same origin.
                const resolved_app_uid = await window.getAppUIDFromOrigin(window.openerOrigin);
                app_uid = resolved_app_uid ?? window.host_app_uid;
            } catch (e) {
                console.error('getAppUIDFromOrigin failed', e);
                app_uid = window.host_app_uid;
            }
            window.host_app_uid = app_uid;
        }

        if ( action === 'show-open-file-picker' ) {
            let options = window.url_query_params.get('options');
            options = JSON.parse(options ?? '{}');

            // Open dialog
            UIWindow({
                allowed_file_types: options?.accept,
                selectable_body: options?.multiple,
                path: `/${ window.user.username }/Desktop`,
                // this is the uuid of the window to which this dialog will return
                return_to_parent_window: true,
                show_maximize_button: false,
                show_minimize_button: false,
                title: 'Open',
                is_dir: true,
                is_openFileDialog: true,
                is_resizable: false,
                has_head: false,
                cover_page: true,
                // selectable_body: is_selectable_body,
                iframe_msg_uid: msg_id,
                center: true,
                initiating_app_uuid: app_uid,
                on_close: function () {
                    window.opener.postMessage({
                        msg: 'fileOpenCanceled',
                        original_msg_id: msg_id,
                    }, '*');
                },
            });
        }
        //--------------------------------------------------------------------------------------
        // Action: Show Directory Picker
        //--------------------------------------------------------------------------------------
        else if ( action === 'show-directory-picker' ) {
            // open directory picker dialog
            UIWindow({
                path: `/${ window.user.username }/Desktop`,
                // this is the uuid of the window to which this dialog will return
                // parent_uuid: event.data.appInstanceID,
                return_to_parent_window: true,
                show_maximize_button: false,
                show_minimize_button: false,
                title: 'Open',
                is_dir: true,
                is_directoryPicker: true,
                is_resizable: false,
                has_head: false,
                cover_page: true,
                // selectable_body: is_selectable_body,
                iframe_msg_uid: msg_id,
                center: true,
                initiating_app_uuid: app_uid,
                on_close: function () {
                    window.opener.postMessage({
                        msg: 'directoryOpenCanceled',
                        original_msg_id: msg_id,
                    }, '*');
                },
            });
        }
        //--------------------------------------------------------------------------------------
        // Action: Show Save File Dialog
        //--------------------------------------------------------------------------------------
        else if ( action === 'show-save-file-picker' ) {
            let allowed_file_types = window.url_query_params.get('allowed_file_types');

            // send 'sendMeFileData' event to parent
            window.opener.postMessage({
                msg: 'sendMeFileData',
            }, '*');

            // listen for 'showSaveFilePickerPopup' event from parent
            window.addEventListener('message', async (event) => {
                if ( event.data.msg !== 'showSaveFilePickerPopup' )
                {
                    return;
                }

                // Open dialog
                UIWindow({
                    allowed_file_types: allowed_file_types,
                    path: `/${ window.user.username }/Desktop`,
                    // this is the uuid of the window to which this dialog will return
                    return_to_parent_window: true,
                    show_maximize_button: false,
                    show_minimize_button: false,
                    title: 'Save',
                    is_dir: true,
                    is_saveFileDialog: true,
                    is_resizable: false,
                    has_head: false,
                    cover_page: true,
                    // selectable_body: is_selectable_body,
                    iframe_msg_uid: msg_id,
                    center: true,
                    initiating_app_uuid: app_uid,
                    on_close: function () {
                        window.opener.postMessage({
                            msg: 'fileSaveCanceled',
                            original_msg_id: msg_id,
                        }, '*');
                    },
                    onSaveFileDialogSave: async function (target_path, el_filedialog_window) {
                        $(el_filedialog_window).find('.window-disable-mask, .busy-indicator').show();
                        let busy_init_ts = Date.now();

                        let overwrite = false;
                        let file_to_upload = new File([event.data.content], path.basename(target_path));
                        let item_with_same_name_already_exists = true;
                        while ( item_with_same_name_already_exists ) {
                            // overwrite?
                            if ( overwrite )
                            {
                                item_with_same_name_already_exists = false;
                            }
                            // upload
                            try {
                                const res = await puter.fs.write(
                                    target_path,
                                    file_to_upload,
                                    {
                                        dedupeName: false,
                                        overwrite: overwrite,
                                    },
                                );

                                let file_signature = await puter.fs.sign(app_uid, { uid: res.uid, action: 'write' });
                                file_signature = file_signature.items;

                                item_with_same_name_already_exists = false;
                                window.opener.postMessage({
                                    msg: 'fileSaved',
                                    original_msg_id: msg_id,
                                    filename: res.name,
                                    saved_file: {
                                        name: file_signature.fsentry_name,
                                        readURL: file_signature.read_url,
                                        writeURL: file_signature.write_url,
                                        metadataURL: file_signature.metadata_url,
                                        type: file_signature.type,
                                        uid: file_signature.uid,
                                        path: window.privacy_aware_path(res.path),
                                    },
                                }, '*');

                                window.close();
                                window.open('', '_self').close();
                            }
                            catch ( err ) {
                                // item with same name exists
                                if ( err.code === 'item_with_same_name_exists' ) {
                                    const alert_resp = await UIAlert({
                                        message: `<strong>${html_encode(err.entry_name)}</strong> already exists.`,
                                        buttons: [
                                            {
                                                label: i18n('replace'),
                                                value: 'replace',
                                                type: 'primary',
                                            },
                                            {
                                                label: i18n('cancel'),
                                                value: 'cancel',
                                            },
                                        ],
                                        parent_uuid: $(el_filedialog_window).attr('data-element_uuid'),
                                    });
                                    if ( alert_resp === 'replace' ) {
                                        overwrite = true;
                                    } else if ( alert_resp === 'cancel' ) {
                                        // enable parent window
                                        $(el_filedialog_window).find('.window-disable-mask, .busy-indicator').hide();
                                        return;
                                    }
                                }
                                else {
                                    console.log(err);
                                    // show error
                                    await UIAlert({
                                        message: err.message ?? 'Upload failed.',
                                        parent_uuid: $(el_filedialog_window).attr('data-element_uuid'),
                                    });
                                    // enable parent window
                                    $(el_filedialog_window).find('.window-disable-mask, .busy-indicator').hide();
                                    return;
                                }
                            }
                        }

                        // done
                        let busy_duration = (Date.now() - busy_init_ts);
                        if ( busy_duration >= window.busy_indicator_hide_delay ) {
                            $(el_filedialog_window).close();
                        } else {
                            setTimeout(() => {
                                // close this dialog
                                $(el_filedialog_window).close();
                            }, Math.abs(window.busy_indicator_hide_delay - busy_duration));
                        }
                    },
                });
            });
        }
    }

    // -------------------------------------------------------------------------------------
    // Action: Request Permission — show the permission dialog and report the user's
    // decision back to the opener (popup flow) or the parent frame (iframe embed).
    // Runs post-auth so signed-out users go through sign-in/signup first.
    // -------------------------------------------------------------------------------------
    if ( action === 'request-permission' ) {
        // Repeated `permission=` params: one prompt can cover several scopes.
        // Capped because this URL is supplied by whoever opened the popup, and an
        // unbounded list would put an unreadable consent prompt in front of the
        // user. Over the cap we drop the request rather than truncate it, since a
        // silently shortened list would grant less than the dialog described.
        const MAX_REQUESTED_PERMISSIONS = 16;
        const requested_permissions = window.url_query_params
            .getAll('permission')
            .filter(Boolean);
        const permissions = requested_permissions.length <= MAX_REQUESTED_PERMISSIONS
            ? requested_permissions
            : [];
        const msg_id = window.url_query_params.get('msg_id');
        // Browser-attested only: `openerOrigin` is the referrer, or the opener's
        // own reply to the `requestOrigin` handshake. There is deliberately no
        // query-string fallback — the origin is the requester's identity, naming
        // who the dialog attributes the request to and picking the app the grant
        // is written against, so a link must not get to state it. That is the
        // same rule that keeps `app_uid` out of this URL, and the SDK never sends
        // an origin either. Without one there is nothing to prompt about and the
        // denial below is reported as usual.
        const origin = window.openerOrigin;

        // Whatever happens, the requester must get an answer and the popup
        // must close — otherwise the popup wedges open with the caller's
        // promise pending until the user closes it by hand.
        let granted = false;
        try {
            // Prompting is pointless when the app row a grant needs was never
            // bootstrapped — "Allow" could only fail. Report the denial.
            if ( token_exchange_failed ) {
                throw new Error('token exchange failed; not prompting');
            }
            // The requesting app is identified by its origin, and only the
            // server turns that origin into a grant target. No uid is sent
            // from here: a uid from the query string is chosen by whoever
            // opened this page, and even a uid resolved through
            // `getAppUIDFromOrigin` is unsafe to forward, because an origin
            // with no app row of its own resolves to a *synthetic*
            // `app-<uuidv5(origin)>`. The grant endpoint resolves `app_uid`
            // as uid-or-name, so forwarding that synthetic uid would hand
            // the grant to whoever registered an app under that literal
            // name. Passing the origin instead makes the server resolve the
            // same origin the dialog displayed, and reject it outright
            // unless it names an app that really exists.
            granted = await UIPermissionDialog({
                // See IPC.js: both forms, so a single scope still works with a
                // dialog that only understands the scalar.
                permissions,
                permission: permissions.length === 1 ? permissions[0] : undefined,
                origin: origin,
            });
        } catch (e) {
            console.error('request-permission action failed', e);
        }

        // `postMessage` throws a SyntaxError on a targetOrigin that isn't a
        // parseable URL, and `origin` is caller-supplied — an unparseable one
        // would take out the answer *and* the close below.
        let target_origin = '*';
        try {
            target_origin = origin ? new URL(origin).origin : '*';
        } catch (e) {
            console.error('request-permission: unusable origin', origin);
        }
        const messageTarget = window.embedded_in_popup ? window.opener : window.parent;
        try {
            messageTarget?.postMessage({
                msg: 'permissionGranted',
                granted: granted === true,
                original_msg_id: msg_id,
            }, target_origin);
        } catch (e) {
            console.error('request-permission: could not answer the requester', e);
        }

        // The popup exists only to host this dialog; close it once answered.
        if ( window.embedded_in_popup ) {
            window.close();
            window.open('', '_self').close();
        }
    }

    // -------------------------------------------------------------------------------------
    // Action: Send Feedback — show the app-feedback dialog for the site that opened this
    // popup and report whether feedback was sent back to the opener. Runs post-auth so
    // signed-out users go through sign-in/signup first.
    // -------------------------------------------------------------------------------------
    if ( action === 'send-feedback' ) {
        const msg_id = window.url_query_params.get('msg_id');
        // Browser-attested only, same rule as request-permission above: the
        // origin names the app the feedback is recorded against (the server
        // resolves origin → app), so a link must not get to state it. The
        // dialog itself refuses when the resolved app hasn't opted in.
        const origin = window.openerOrigin;

        // Whatever happens, the requester must get an answer and the popup
        // must close — otherwise it wedges open with the caller's promise
        // pending until the user closes it by hand.
        let sent = false;
        try {
            if ( ! origin ) {
                throw new Error('no opener origin; not prompting');
            }
            sent = await UIWindowAppFeedback({
                origin,
                source: 'web',
            });
        } catch (e) {
            console.error('send-feedback action failed', e);
        }

        // `postMessage` throws a SyntaxError on a targetOrigin that isn't a
        // parseable URL — an unparseable one would take out the answer *and*
        // the close below.
        let target_origin = '*';
        try {
            target_origin = origin ? new URL(origin).origin : '*';
        } catch (e) {
            console.error('send-feedback: unusable origin', origin);
        }
        const messageTarget = window.embedded_in_popup ? window.opener : window.parent;
        try {
            messageTarget?.postMessage({
                msg: 'feedbackDialogClosed',
                sent: sent === true,
                original_msg_id: msg_id,
            }, target_origin);
        } catch (e) {
            console.error('send-feedback: could not answer the requester', e);
        }

        // The popup exists only to host this dialog; close it once answered.
        if ( window.embedded_in_popup ) {
            window.close();
            window.open('', '_self').close();
        }
    }
};

const launch_services = async function (options) {
    // === Services Data Structures ===
    const services_l_ = [];
    const services_m_ = {};
    globalThis.services = {
        get: (name) => services_m_[name],
        emit: (id, args) => {
            for (const [_, instance] of services_l_) {
                instance.__on(id, args ?? []);
            }
        },
    };
    const register = (name, instance) => {
        services_l_.push([name, instance]);
        services_m_[name] = instance;
    };

    globalThis.def(UIComponentWindow, 'ui.UIComponentWindow');

    // === Hooks for Service Scripts from Backend ===
    const service_script_deferred = { services: [], on_ready: [] };
    const service_script_api = {
        register: (...a) => service_script_deferred.services.push(a),
        on_ready: (fn) => service_script_deferred.on_ready.push(fn),
        // Some files can't be imported by service scripts,
        // so this hack makes that possible.
        def: globalThis.def,
        use: globalThis.use,
        // use: name => ({ UIWindow, UIComponentWindow })[name],
    };
    globalThis.service_script_api_promise.resolve(service_script_api);

    // === Builtin Services ===
    register('ipc', new IPCService());
    register('exec', new ExecService());
    register('debug', new DebugService());
    register('broadcast', new BroadcastService());
    register('theme', new ThemeService());
    register('process', new ProcessService());
    register('locale', new LocaleService());
    register('anti-csrf', new AntiCSRFService());
    register('__launch-on-init', new LaunchOnInitService());

    // === Service-Script Services ===
    for (const [name, script] of service_script_deferred.services) {
        register(name, script);
    }

    for (const [_, instance] of services_l_) {
        await instance.construct({
            gui_params: options,
        });
    }

    for (const [_, instance] of services_l_) {
        await instance.init({
            services: globalThis.services,
        });
    }

    // === Service-Script Ready ===
    for (const fn of service_script_deferred.on_ready) {
        await fn();
    }

    // Set init process status
    {
        const svc_process = globalThis.services.get('process');
        svc_process.get_init().chstatus(PROCESS_RUNNING);
    }
};

// This code snippet addresses the issue flagged by Lighthouse regarding the use of
// passive event listeners to enhance scrolling performance. It provides custom
// implementations for touchstart, touchmove, wheel, and mousewheel events in jQuery.
// By setting the 'passive' option appropriately, it ensures that default browser
// behavior is prevented when necessary, thereby improving page scroll performance.
// More info: https://stackoverflow.com/a/62177358
if (jQuery) {
    jQuery.event.special.touchstart = {
        setup: function (_, ns, handle) {
            this.addEventListener('touchstart', handle, {
                passive: !ns.includes('noPreventDefault'),
            });
        },
    };
    jQuery.event.special.touchmove = {
        setup: function (_, ns, handle) {
            this.addEventListener('touchmove', handle, {
                passive: !ns.includes('noPreventDefault'),
            });
        },
    };
    jQuery.event.special.wheel = {
        setup: function (_, ns, handle) {
            this.addEventListener('wheel', handle, { passive: true });
        },
    };
    jQuery.event.special.mousewheel = {
        setup: function (_, ns, handle) {
            this.addEventListener('mousewheel', handle, { passive: true });
        },
    };
}

// are we in dashboard mode?
// The dashboard is the default interface at the root path; `/dashboard` is kept as an
// alias, and `/desktop` loads the desktop instead. Direct app landings (`/app/<name>`)
// open in the dashboard too: the app comes up maximized in-page with the dashboard
// route slotted underneath (see postAuthActions), so Back minimizes to the dashboard.
// To land the same app on the desktop instead, prefix the path:
// `/desktop/app/<name>` doesn't match the dashboard paths below, so it falls
// through to the desktop.
// URLs that carry a desktop-only flow keep booting the desktop: auth popups
// (`?embedded_in_popup=`), app deep links (`?app=`), direct downloads (`?download=`),
// fullpage mode (`?puter.fullpage=`), and iframe embeds. App metadata like
// fullpage_on_landing does NOT opt a landing out of the dashboard; it only affects
// boots that still go through the desktop flow.
{
    const pathname = window.location.pathname;
    const search_params = new URLSearchParams(window.location.search);
    if (['true', '1'].includes(search_params.get('embedded_in_popup'))) {
        window.embedded_in_popup = true;
    }
    // note: iframe detection is inlined because globals.js (window.is_embedded) loads after this module
    const in_iframe = window.location !== window.parent.location;
    const needs_desktop_at_root =
        window.embedded_in_popup ||
        in_iframe ||
        search_params.has('puter.fullpage') ||
        search_params.has('app') ||
        search_params.has('download');
    const is_dashboard_alias =
        pathname === '/dashboard' || pathname === '/dashboard/';
    const is_app_landing = /^\/app\/[^/]+\/?$/.test(pathname);
    if (is_dashboard_alias || ((pathname === '/' || is_app_landing) && !needs_desktop_at_root)) {
        window.is_dashboard_mode = true;
        window.dashboard_initial_route = parseDashboardRoute();
    }
}

/**
 * Parses the dashboard URL hash into a route object.
 * Apps is the default tab (root URL / no hash); Home is reached via #home.
 * Hash format: #files/username/Documents or #home or #usage or #account etc.
 * @returns {{ tab: string, path: string|null }} Route object with tab name and optional file path
 */
function parseDashboardRoute() {
    // decodeURIComponent throws URIError on a malformed percent-sequence (e.g.
    // `#100%`). This runs at module load, so an unguarded throw blanks the whole
    // GUI — fall back to the raw hash instead.
    const rawHash = window.location.hash.slice(1); // Remove '#'
    let hash;
    try {
        hash = decodeURIComponent(rawHash);
    } catch {
        hash = rawHash;
    }
    if (!hash) return { tab: 'apps', path: null };

    const parts = hash.split('/').filter(Boolean); // ['files', 'username', 'Documents']
    const tab = parts[0]; // 'files', 'usage', 'account', 'security'

    if (tab === 'files' && parts.length > 1) {
        const filePath = `/${parts.slice(1).join('/')}`; // /username/Documents
        return { tab: 'files', path: filePath };
    }
    return { tab: tab || 'apps', path: null };
}

// Make parseDashboardRoute available globally for hashchange handler
window.parseDashboardRoute = parseDashboardRoute;

/**
 * Display text for an auth error redirect (`?auth_error=1&message=<code>`).
 * The backend sends a fixed set of codes — never free text — plus, for a
 * blocked signup, a `request_code` the user can quote to support. Codes map
 * to translated messages here; anything unrecognized (including text crafted
 * directly into the URL) gets the generic message rather than being shown.
 */
function authErrorDisplayMessage() {
    const code = window.url_query_params.get('message');
    const requestCode = window.url_query_params.get('request_code');
    if (code === 'signup_blocked') {
        const contact = requestCode
            ? i18n('contact_support_with_code', { id: requestCode }, false)
            : i18n('contact_support', [], false);
        return `${i18n('signup_blocked_message', [], false)} ${contact}`;
    }
    if (code === 'account_suspended') {
        return i18n('account_suspended_message', [], false);
    }
    return i18n('auth_error_generic', [], false);
}

/**
 * Shows a Turnstile challenge modal for first-time temp user creation
 * @param {Object} options - Configuration options
 * @param {Function} options.onSuccess - Callback when challenge is completed successfully
 * @param {Function} options.onError - Callback when challenge fails
 */
window.showTurnstileChallenge = function (options) {
    return new Promise((resolve) => {
        const modalId = 'turnstile-challenge-modal';
        const siteKey = window.gui_params?.turnstileSiteKey;

        if (!siteKey) {
            options.onError('Turnstile site key not configured');
            return resolve();
        }

        // message
        let message = 'Setting up your account...';
        if (window.embedded_in_popup) {
            message =
                'Setting up your <a href="https://puter.com" target="_blank">Puter.com</a> account...';
        }
        // Create modal HTML
        let modalHtml = `
            <div id="${modalId}" class="captcha-modal">
                <div class="modal-content">
                    <div class="modal-header" style="margin-bottom: 20px;">
                        <img src="${window.icons['logo-white.svg']}" class="captcha-logo">
                        <h2 class="captcha-title">Welcome to Puter!</h2>
                    </div>

                    <div class="captcha-container">
                        <div id="captcha-widget-${modalId}" data-sitekey="${siteKey}"></div>
                    </div>

                    <div class="loading-state">
                        <div class="loading-state-icon"></div>
                        ${message}
                    </div>

                    <div class="error-message"></div>
                </div>
            </div>
        `;

        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = document.getElementById(modalId);
        const errorMessage = modal.querySelector('.error-message');
        const loadingState = modal.querySelector('.loading-state');
        const turnstileContainer = modal.querySelector('.captcha-container');

        // Initialize Turnstile widget
        const initTurnstile = () => {
            if (!window.turnstile) {
                setTimeout(initTurnstile, 100);
                return;
            }

            try {
                window.turnstile.render(`#captcha-widget-${modalId}`, {
                    sitekey: siteKey,
                    callback: function (token) {
                        window.turnstile_success_ts = Date.now();

                        // Show loading state
                        $(turnstileContainer).hide();
                        $(loadingState).show();

                        // Call success callback
                        options.onSuccess(token);

                        // resolve the promise
                        resolve();
                    },
                    'expired-callback': function () {
                        showError('Verification expired. Please try again.');
                    },
                    'error-callback': function () {
                        showError(
                            'Verification failed. Please refresh the page and try again.',
                        );
                        options.onError('Turnstile verification failed');
                    },
                });
            } catch (error) {
                console.error('Failed to initialize Turnstile:', error);
                showError(
                    'Failed to load security verification. Please refresh the page.',
                );
                options.onError(error);
            }
        };

        const showError = (message) => {
            errorMessage.textContent = message;
            errorMessage.style.display = 'block';
        };

        // Start initialization
        initTurnstile();

        // Prevent modal from closing by clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                // Don't close - force users to complete verification
                turnstileContainer.style.transform = 'scale(1.05)';
                setTimeout(() => {
                    if (turnstileContainer) {
                        turnstileContainer.style.transform = 'scale(1)';
                    }
                }, 200);
            }
        });

        // Add transition styles
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.3s ease';

        // Fade in
        requestAnimationFrame(() => {
            modal.style.opacity = '1';
        });
    });
};

window.initgui = async function (options) {
    const url = new URL(window.location).href;
    window.url = url;
    // Route segments with a leading `/desktop` dropped, so the route checks
    // downstream (app landings, actions) never have to know about the prefix:
    // `/desktop/app/<name>` opens the app on the desktop the same way
    // `/app/<name>` opens it in the dashboard.
    const url_paths = parse_url_paths(window.location.pathname);
    window.url_paths = url_paths;

    // GET query params provided
    window.url_query_params = new URLSearchParams(window.location.search);

    // Install device signal helpers; collection is lazy. The fingerprint is
    // on by default (gui_params.thumbmarkEnabled = false kills it); the Prelude
    // dispatch id needs gui_params.preludeSdkKey.
    init_device_signals();

    let picked_a_user_for_sdk_login = false;

    // update SDK if auth_token is different from the one in the SDK
    if (window.auth_token && puter.authToken !== window.auth_token) {
        puter.setAuthToken(window.auth_token);
    }
    // Point the SDK at this deployment's own API. Anywhere but a Puter served
    // off the developer's own machine, that is the only origin we'll use — see
    // resolveAPIOrigin for why, and for the dev flow that is the exception.
    if (window.api_origin) {
        const api_origin = resolveAPIOrigin({
            configuredOrigin: window.api_origin,
            guiOrigin: window.location.origin,
            urlOrigin: window.url_query_params.get('api_origin'),
            storedOrigin: localStorage.getItem('api_origin'),
        });
        if (api_origin === window.api_origin) {
            localStorage.removeItem('api_origin');
        } else {
            // Sticks for the rest of the session: only the boot that carried
            // the parameter has it in the URL.
            localStorage.setItem('api_origin', api_origin);
            window.api_origin = api_origin;
        }
        if (puter.APIOrigin !== api_origin) puter.setAPIOrigin(api_origin);
    }

    // Print the version to the console
    puter.os
        .version()
        .then((res) => {
            const deployed_date = new Date(res.deploy_timestamp);
            console.log(
                `Your Puter information:\n• Version: ${res.version}\n• Server: ${res.location}\n• Deployed: ${deployed_date}`,
            );
        })
        .catch((error) => {
            console.error('Failed to fetch server info:', error);
        });

    // Checks the type of device the user is on (phone, tablet, or desktop).
    // Depending on the device type, it sets a class attribute on the body tag
    // to style or script the page differently for each device type.

    if (isMobile.phone) {
        $('body').attr('class', 'device-phone');
    } else if (isMobile.tablet) {
        // This is our new, smarter check for tablets
        if (
            window.matchMedia &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(hover: hover)').matches
        ) {
            // The user has a mouse/trackpad, so give them the desktop UI
            $('body').attr('class', 'device-desktop');
        } else {
            // The user is on a touch-only tablet, so give them the mobile UI
            $('body').attr('class', 'device-tablet');
        }
    } else {
        $('body').attr('class', 'device-desktop');
    }

    // Appends a meta tag to the head of the document specifying the character encoding to be UTF-8.
    // This ensures that special characters and symbols display correctly across various platforms and browsers.
    $('head').append('<meta charset="utf-8">');

    // Appends a viewport meta tag to the head of the document, ensuring optimal display on mobile devices.
    // This tag sets the width of the viewport to the device width, and locks the zoom level to 1 (prevents user scaling).
    $('head').append(
        '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
    );

    // will hold the result of the whoami API call
    let whoami;

    //--------------------------------------------------------------------------------------
    // Extract 'action' from URL
    //--------------------------------------------------------------------------------------
    let action;
    if (
        window.url_paths[0]?.toLocaleLowerCase() === 'action' &&
        window.url_paths[1]
    ) {
        action = window.url_paths[1].toLowerCase();
    } else if (window.url_query_params.has('action')) {
        action = window.url_query_params.get('action').toLowerCase();
    }
    // Published for the windows that open mid-flow and have to know what this
    // page is for — the login/signup windows consult it before offering a
    // federated sign-in hop that would navigate the popup away and lose the
    // action. See util/popupAuth.js.
    window.gui_action = action;

    //--------------------------------------------------------------------------------------
    // Determine if we are in full-page mode
    // i.e. https://puter.com/app/<app_name>/?puter.fullpage=true
    //--------------------------------------------------------------------------------------
    if (
        window.url_query_params.has('puter.fullpage') &&
        (window.url_query_params.get('puter.fullpage') === 'false' ||
            window.url_query_params.get('puter.fullpage') === '0')
    ) {
        window.is_fullpage_mode = false;
    } else if (
        window.url_query_params.has('puter.fullpage') &&
        (window.url_query_params.get('puter.fullpage') === 'true' ||
            window.url_query_params.get('puter.fullpage') === '1')
    ) {
        // In fullpage mode, we want to hide the taskbar for better UX
        window.taskbar_height = 0;

        // Puter is in fullpage mode.
        window.is_fullpage_mode = true;
    } else if (window.is_dashboard_mode) {
        window.is_fullpage_mode = true;
    }

    // Launch services before any UI is rendered
    await launch_services(options);

    // If no token in storage but we have a session cookie (e.g. after OIDC redirect), fetch GUI token
    try {
        const r = await fetch(`${window.gui_origin}/get-gui-token`, {
            credentials: 'include',
        });
        if (r.ok) {
            const { token } = await r.json();
            window.auth_token = token;
            // Write the current key; drop any value under the retired one.
            localStorage.setItem(
                window.AUTH_TOKEN_KEY_V2 || 'auth_token_v2',
                token,
            );
            try {
                localStorage.removeItem(
                    window.AUTH_TOKEN_KEY_RETIRED || 'auth_token',
                );
            } catch (e) {
                /* ignore */
            }
            if (typeof puter !== 'undefined')
                puter.setAuthToken(token, window.api_origin);
            const tokenChanged = token !== window.auth_token;
            if (tokenChanged) {
                // This will update the list of logged in users and set the current one
                try {
                    const whoami = await puter.os.user({
                        query: 'icon_size=64',
                    });
                    if (whoami) await window.update_auth_data(token, whoami);
                } catch (e) {
                    console.error(
                        'get-gui-token follow-up whoami/update_auth_data',
                        e,
                    );
                }
            }
        }
    } catch (e) {
        console.error('get-gui-token', e);
    }

    //--------------------------------------------------------------------------------------
    // Is attempt_temp_user_creation?
    // i.e. https://puter.com/?attempt_temp_user_creation=true
    //--------------------------------------------------------------------------------------
    if (
        window.url_query_params.has('attempt_temp_user_creation') &&
        (window.url_query_params.get('attempt_temp_user_creation') === 'true' ||
            window.url_query_params.get('attempt_temp_user_creation') === '1')
    ) {
        window.attempt_temp_user_creation = true;
    }

    //--------------------------------------------------------------------------------------
    // Is GUI embedded in a popup?
    // i.e. https://puter.com/?embedded_in_popup=true
    // (the flag itself is parsed once at module level, alongside the dashboard-mode check)
    //--------------------------------------------------------------------------------------
    if (window.embedded_in_popup) {
        $('body').addClass('embedded-in-popup');

        // Determine the origin of the opener. This is the one assignment that
        // matters: the token exchange, `checkUserSiteRelationship`,
        // `getAppUIDFromOrigin` and both `postMessage` targets all read
        // `window.openerOrigin`, so every one of them is only as trustworthy
        // as this line.
        //
        // An OIDC redirect drops `document.referrer` — it returns the popup
        // with the *provider* as referrer — so the opener's origin has to
        // survive the hop. It does, inside the signed `state`, but the backend
        // used to flatten it into a bare `opener_origin` parameter: a URL
        // built from a verified state is byte-identical to one anybody can
        // type, and the popup believed both. Now the return leg carries a
        // signed proof, redeemed here for the value the server actually
        // attested. Everything else falls back to browser-attested sources.
        window.oidcPopupReturn = await verifyOidcPopupReturn(
            window.url_query_params.get('opener_state'),
            window.url_query_params.get('msg_id'),
        );
        window.openerOrigin =
            window.oidcPopupReturn?.opener_origin || document.referrer;
        if (!window.openerOrigin) {
            try {
                window.openerOrigin = await requestOpenerOrigin();
            } catch (e) {
                throw new Error('No referrer found');
            }
        }

        // this is the referrer in terms of user acquisition
        window.referrerStr = window.openerOrigin;

        // Tell a request-permission opener that this popup can reach it. Sent
        // here, before any sign-in gate, because the SDK reads its absence as
        // "the opener link was severed by COOP" — where a close means the
        // prompt is still live in a window that cannot answer, and the decision
        // has to be read back from the server rather than reported as a denial.
        // A gate that delayed this would make abandoning sign-in look severed.
        // Carries no token: see util/popupAuth.js for what a permission popup
        // may hand its opener.
        if (action === 'request-permission') {
            try {
                window.opener?.postMessage(
                    {
                        msg: 'permissionPromptReady',
                        original_msg_id:
                            window.url_query_params.get('msg_id'),
                    },
                    new URL(window.openerOrigin).origin,
                );
            } catch (e) {
                // An unparseable opener origin, or an opener that went away.
                // The requester falls back to reading the decision from the
                // server, so this must not take the popup down with it.
                console.error(
                    'request-permission: could not announce the popup',
                    e,
                );
            }
        }

        if (
            action === 'sign-in' &&
            !window.is_auth() &&
            !(window.attempt_temp_user_creation && window.first_visit_ever)
        ) {
            // show signup window
            if (
                await UIWindowSignup({
                    reload_on_success: false,
                    send_confirmation_code: true,
                    show_close_button: false,
                    window_options: {
                        has_head: false,
                        cover_page: true,
                    },
                })
            ) {
                // Completing signup in a sign-in popup is the user asking to
                // be signed in to the opener.
                window.popup_signin_consent = true;
                await window.getUserAppToken(window.openerOrigin);
            }
        } else if (
            // An action-less popup is a sign-in popup — `postAuthActions`
            // already treats it as one when it decides to close the window,
            // and it ends in the same token hand-off. It has to reach the
            // same account picker too: leaving it out meant the one popup
            // shape that shows the user nothing was also the one that minted
            // a token for the opener without being asked.
            (action === 'sign-in' || !action) &&
            window.is_auth() &&
            !(window.attempt_temp_user_creation && window.first_visit_ever)
        ) {
            // Ensure current user is in logged_in_users (e.g. after OIDC redirect we have token but no user in list)
            try {
                const whoami_popup = await puter.os.user({
                    query: 'icon_size=64',
                });
                await window.update_auth_data(
                    whoami_popup.token || window.auth_token,
                    whoami_popup,
                );
            } catch (e) {
                // session/auth errors will be handled further ahead;
                // let's log the error for now in case a change in state occurred.
                console.error("error in 'sign-in' flow", e);
            }

            // An OIDC login that just completed may skip the account picker —
            // the user chose their account at the provider moments ago. That
            // comes from the same signed proof as the opener's origin, rather
            // than the `oidc_login` query parameter it used to be read from:
            // as a bare parameter anyone could write it, and it suppresses the
            // one prompt standing between a link and a token.
            if (window.oidcPopupReturn?.oidc_login) {
                picked_a_user_for_sdk_login = true;
                await window.getUserAppToken(window.openerOrigin);
            } else {
                // Show session list so user can pick which account to use
                picked_a_user_for_sdk_login = await UIWindowSessionList({
                    reload_on_success: false,
                    draggable_body: false,
                    has_head: false,
                    cover_page: true,
                });

                if (picked_a_user_for_sdk_login) {
                    await window.getUserAppToken(window.openerOrigin);
                }
            }
            // Picking an account here *is* the consent to sign the opener in.
            // `postAuthActions` runs later and unconditionally, so it needs to
            // know whether that decision was ever made — dismissing the picker
            // has to mean the opener gets nothing, not just that the early
            // token exchange was skipped.
            window.popup_signin_consent = !!picked_a_user_for_sdk_login;
        }
    }

    //--------------------------------------------------------------------------------------
    // Display an error if the query parameters have an error
    //--------------------------------------------------------------------------------------
    if (window.url_query_params.has('error')) {
        // TODO: i18n
        await UIAlert({
            message: window.url_query_params.get('message'),
        });
    }

    //--------------------------------------------------------------------------------------
    // Inform the user if they chose "signup" but were logged into an existing account
    //--------------------------------------------------------------------------------------
    if (
        window.url_query_params.get('oidc_switched') === 'login' &&
        window.is_auth()
    ) {
        await UIAlert({
            message: i18n('oidc_switched_to_login_message'),
        });
        const params = new URLSearchParams(window.location.search);
        params.delete('oidc_switched');
        const cleanSearch = params.toString();
        const cleanUrl = cleanSearch
            ? `${window.location.pathname}?${cleanSearch}`
            : window.location.pathname || '/';
        window.history.replaceState(null, document.title, cleanUrl);
    }

    //--------------------------------------------------------------------------------------
    // Early check for fullpage mode from app metadata
    // If the user navigated to /app/<app_name> and the app has fullpage_on_landing,
    // set fullpage mode now so we can skip loading the desktop background and items.
    // Dashboard mode never reaches the fetch (it sets is_fullpage_mode itself): app
    // landings open in the dashboard regardless of fullpage_on_landing — the flag only
    // matters for the boots that still go through the desktop flow (embeds, popups).
    //--------------------------------------------------------------------------------------
    if (
        !window.is_fullpage_mode &&
        window.url_paths[0]?.toLocaleLowerCase() === 'app' &&
        window.url_paths[1]
    ) {
        try {
            const app_info = await puter.apps.get(window.url_paths[1], {
                icon_size: 64,
            });
            if (app_info?.metadata?.fullpage_on_landing) {
                window.is_fullpage_mode = true;
                window.taskbar_height = 0;
                window.app_launched_from_url = app_info;
            }
        } catch (e) {
            // App metadata fetch failed; will retry later in UIDesktop
        }
    }

    //--------------------------------------------------------------------------------------
    // Desktop background (early)
    // Set before action=login/signup so OIDC error redirects show the background behind the form.
    // -------------------------------------------------------------------------------------
    if (!window.is_fullpage_mode && !window.embedded_in_popup) {
        window.refresh_desktop_background();
    }

    //--------------------------------------------------------------------------------------
    // Action: Password recovery
    //--------------------------------------------------------------------------------------
    if (action === 'set-new-password') {
        let user = window.url_query_params.get('user');
        let token = window.url_query_params.get('token');

        await UIWindowNewPassword({
            user: user,
            token: token,
        });
    }
    //--------------------------------------------------------------------------------------
    // Action: Change Username
    //--------------------------------------------------------------------------------------
    else if (action === 'change-username') {
        await UIWindowChangeUsername();
    }
    //--------------------------------------------------------------------------------------
    // Action: Login
    //--------------------------------------------------------------------------------------
    else if (action === 'login') {
        const opts = window.url_query_params.has('auth_error')
            ? { authError: authErrorDisplayMessage() }
            : {};
        if (!window.is_auth()) {
            opts.window_options = { cover_page: true, has_head: false };
        }
        await UIWindowLogin(Object.keys(opts).length ? opts : undefined);
    }
    //--------------------------------------------------------------------------------------
    // Action: Password recovery
    //--------------------------------------------------------------------------------------
    else if (action === 'password-recovery') {
        await UIWindowRecoverPassword({
            window_options: {
                cover_page: true,
                has_head: false,
            },
        });
    }
    //--------------------------------------------------------------------------------------
    // Action: Signup
    //--------------------------------------------------------------------------------------
    else if (action === 'signup') {
        const opts = window.url_query_params.has('auth_error')
            ? { authError: authErrorDisplayMessage() }
            : {};
        if (!window.is_auth()) {
            opts.window_options = { cover_page: true, has_head: false };
        }
        opts.send_confirmation_code = true;
        await UIWindowSignup(Object.keys(opts).length ? opts : undefined);
    }
    // Which URL parameter (if any) is carrying a token to sign in with —
    // `auth_token`, or `token` when returning from a remote backend's AuthMe.
    const url_token_param = urlTokenParam(
        window.url_query_params,
        shouldUseRemoteAuthme(window.gui_origin, window.location.origin),
    );

    // -------------------------------------------------------------------------------------
    // If in embedded in a popup, it is important to check whether the opener app has a relationship with the user
    // if yes, we need to get the user app token and send it to the opener
    // if not, we need to ask the user for confirmation before proceeding BUT only if the action is a file-picker action
    // -------------------------------------------------------------------------------------
    if (window.embedded_in_popup && window.openerOrigin) {
        let response = await window.checkUserSiteRelationship(
            window.openerOrigin,
        );
        window.userAppToken = response.token;

        if (
            !picked_a_user_for_sdk_login &&
            window.logged_in_users.length > 1 &&
            (!window.userAppToken ||
                window.url_query_params.get('request_auth'))
        ) {
            picked_a_user_for_sdk_login = await UIWindowSessionList({
                reload_on_success: false,
                draggable_body: false,
                has_head: false,
                cover_page: true,
            });
            if (picked_a_user_for_sdk_login) {
                window.popup_signin_consent = true;
            }
        }

        // An opener the user has already signed in to before does not need to
        // be re-approved on every visit — that grant is what
        // `checkUserSiteRelationship` reports. This is also what keeps the
        // file-picker and permission popups, which never show an account
        // picker, from being blocked by the gate in `postAuthActions`.
        if (window.userAppToken) {
            window.popup_signin_consent = true;
        }
    }
    // -------------------------------------------------------------------------------------
    // A token provided in the URL, use it to log in. `auth_token` normally;
    // `token` as well when a locally served GUI is returning from the remote
    // backend's AuthMe flow, which is the name AuthMe hands back.
    // -------------------------------------------------------------------------------------
    else if (url_token_param) {
        let query_param_auth_token =
            window.url_query_params.get(url_token_param);

        const previous_auth_token = window.auth_token;

        // The token is resolved against our own API origin — deliberately not
        // one named by the same URL that carried the token, which would leave
        // the identity we're about to render up to whoever wrote the link.
        puter.setAuthToken(query_param_auth_token);

        try {
            whoami = await puter.os.user({ query: 'icon_size=64' });
        } catch (e) {
            if (e.status === 401) {
                window.logout();
                return;
            }
        }

        // Confirm the identity before adopting a token that came from the
        // URL. Every other path into `update_auth_data` is an account the
        // user picked in the UI, so those don't ask.
        if (whoami && (!window.user || window.user.uuid !== whoami.uuid)) {
            const proceed = await UIAlert({
                type: 'confirm',
                // `false` — UIAlert encodes the message itself.
                message: i18n(
                    'confirm_continue_as',
                    { username: whoami.username },
                    false,
                ),
                buttons: [
                    { label: i18n('continue'), value: true, type: 'primary' },
                    { label: i18n('cancel'), value: false, type: 'secondary' },
                ],
            });
            if (!proceed) {
                // Back to whatever session was already here; normal boot
                // picks up below.
                puter.setAuthToken(previous_auth_token);
                whoami = null;
            }
        }

        if (whoami) {
            // Verification gates run in order: email → phone (SMS) → card,
            // matching the server-side order in assertVerifiedAccount.
            if (whoami.requires_email_confirmation) {
                let is_verified;
                do {
                    is_verified = await UIWindowEmailConfirmationRequired({
                        show_close_button: false,
                        stay_on_top: true,
                        has_head: false,
                        window_options: {
                            is_draggable: false,
                        },
                    });
                } while (!is_verified);
            }
            // is phone verification required? (hard gate for low-rep signups)
            if (whoami.requires_phone_verification) {
                let is_verified;
                do {
                    is_verified = await UIWindowPhoneVerificationRequired({
                        show_close_button: false,
                        stay_on_top: true,
                        has_head: false,
                        window_options: {
                            is_draggable: false,
                        },
                    });
                } while (!is_verified);
            }
            // Card verification is the last gate: only show it once the email and
            // phone (SMS) gates are cleared, since those show up first.
            if (whoami.requires_card_verification) {
                let is_verified;
                do {
                    is_verified = await UIWindowCardVerificationRequired({
                        show_close_button: false,
                        stay_on_top: true,
                        has_head: false,
                        window_options: {
                            is_draggable: false,
                        },
                    });
                } while (!is_verified);
            }
            // if user is logging in using an auth token that means it's not their first ever visit to Puter.com
            // it might be their first visit to Puter on this specific device but it's not their first time ever visiting Puter.
            window.first_visit_ever = false;
            // show login progress window
            UIWindowLoginInProgress({ user_info: whoami });
            // update auth data
            await window.update_auth_data(query_param_auth_token, whoami);
            // The token landed and `whoami` accepted it — let a later sign-out
            // in this tab hand off to AuthMe again (see the remote-backend
            // branch below).
            try {
                sessionStorage.removeItem('puter.authme_redirect_attempted');
            } catch (e) { /* sessionStorage unavailable */ }
        }
        // remove the token from URL, keeping the current path (e.g. `/` or
        // `/desktop`) and hash (dashboard tab links like /#usage).
        //
        // `replaceState`, not `pushState`: pushing leaves the token-bearing URL
        // as the previous history entry, so Back returns to a URL containing a
        // live credential (and it stays in session restore). Replacing drops it
        // from this tab's history instead of merely navigating away from it.
        window.history.replaceState(
            null,
            document.title,
            window.location.pathname + window.location.hash,
        );
    }

    /**
     * Logout without showing confirmation or "Save Account" action,
     * and without authenticating with the server.
     */
    const bad_session_logout = async () => {
        try {
            // TODO: i18n
            await UIAlert({
                message: 'Your session is invalid. You will be logged out.',
            });
            // clear local storage
            localStorage.clear();
            // reload the page
            window.location.reload();
        } catch (e) {
            // TODO: i18n
            await UIAlert({
                message:
                    'Session is invalid and logout failed; ' +
                    'please clear local storage manually.',
            });
        }
    };

    /**
     * Event handler for a custom 'logout' event attached to the document.
     * This function handles the process of logging out, including user confirmation,
     * communication with the backend, and subsequent UI updates. It takes special
     * precautions if the user is identified as using a temporary account.
     *
     * @listens Document#event:logout
     * @async
     * @param {Event} event - The JQuery event object associated with the logout event.
     * @returns {Promise<void>} - This function does not return anything meaningful, but it performs an asynchronous operation.
     */
    $(document).on('logout', async function (event) {
        // is temp user?
        if (window.user && window.user.is_temp && !window.user.deleted) {
            const alert_resp = await UIAlert({
                message:
                    '<strong>Save account before logging out!</strong><p>You are using a temporary account and logging out will erase all your data.</p>',
                buttons: [
                    {
                        label: i18n('save_account'),
                        value: 'save_account',
                        type: 'primary',
                    },
                    {
                        label: i18n('log_out'),
                        value: 'log_out',
                        type: 'danger',
                    },
                    {
                        label: i18n('cancel'),
                    },
                ],
            });
            if (alert_resp === 'save_account') {
                let saved = await UIWindowSaveAccount({
                    send_confirmation_code: false,
                    default_username: window.user.username,
                });
                if (saved) {
                    window.logout();
                }
            } else if (alert_resp === 'log_out') {
                window.logout();
            } else {
                return;
            }
        }

        // logout
        try {
            const resp = await fetch(`${window.gui_origin}/get-anticsrf-token`);
            const { token } = await resp.json();
            await $.ajax({
                url: `${window.gui_origin}/logout`,
                type: 'POST',
                async: true,
                contentType: 'application/json',
                headers: {
                    Authorization: `Bearer ${window.auth_token}`,
                },
                data: JSON.stringify({ anti_csrf: token }),
                statusCode: {
                    401: function () {},
                },
            });
        } catch (e) {
            // Ignored
        }

        // remove this user from the array of logged_in_users
        for (let i = 0; i < window.logged_in_users.length; i++) {
            if (window.logged_in_users[i].uuid === window.user.uuid) {
                window.logged_in_users.splice(i, 1);
                break;
            }
        }

        // update logged_in_users in local storage
        localStorage.setItem(
            'logged_in_users',
            JSON.stringify(window.logged_in_users),
        );

        // delete this user from local storage
        window.user = null;
        localStorage.removeItem('user');
        window.auth_token = null;
        // `window.logout()` above already cleared the current key; this drops
        // any value left under the retired one.
        localStorage.removeItem(window.AUTH_TOKEN_KEY_RETIRED || 'auth_token');

        // close all windows
        $('.window').close();
        // close all ctxmenus
        $('.context-menu').remove();
        // remove desktop
        $('.desktop').remove();
        // remove taskbar
        $('.taskbar').remove();
        // disable native browser exit confirmation
        window.onbeforeunload = null;
        // go back to the interface the user was in: dashboard users to the root
        // dashboard, desktop users to /desktop
        window.location.replace(window.is_dashboard_mode ? '/' : '/desktop');
    });

    const verification_gate_windows = {
        phone_verification_required: UIWindowPhoneVerificationRequired,
        email_confirmation_required: UIWindowEmailConfirmationRequired,
        card_verification_required: UIWindowCardVerificationRequired,
    };
    let verification_gate_open = false;
    $(document).ajaxError(async function (event, jqxhr) {
        if (jqxhr?.status !== 403 || verification_gate_open) {
            return;
        }
        let body = jqxhr.responseJSON;
        if (!body && jqxhr.responseText) {
            try {
                body = JSON.parse(jqxhr.responseText);
            } catch (e) {
                body = null;
            }
        }
        const UIWindowVerificationGate = verification_gate_windows[body?.code];
        if (!UIWindowVerificationGate) {
            return;
        }
        verification_gate_open = true;
        try {
            const is_verified = await UIWindowVerificationGate({
                show_close_button: false,
                stay_on_top: true,
                has_head: false,
                logout_in_footer: true,
                window_options: {
                    is_draggable: false,
                },
            });
            if (is_verified) {
                await window.refresh_user_data(window.auth_token);
            }
        } catch (e) {
            console.error('verification gate dialog failed:', e);
        } finally {
            verification_gate_open = false;
        }
    });

    // -------------------------------------------------------------------------------------
    // Authed
    // -------------------------------------------------------------------------------------
    if (window.is_auth()) {
        // try to get user data using /whoami, only if that data is missing
        if (!whoami) {
            try {
                whoami = await puter.os.user({ query: 'icon_size=64' });
            } catch (e) {
                if (e.status === 401) {
                    bad_session_logout();
                    return;
                }
            }
        }
        // update local user data
        if (whoami) {
            // Verification gates run in order: email → phone (SMS) → card,
            // matching the server-side order in assertVerifiedAccount.
            if (whoami.requires_email_confirmation) {
                let is_verified;
                do {
                    is_verified = await UIWindowEmailConfirmationRequired({
                        show_close_button: false,
                        stay_on_top: true,
                        has_head: false,
                        logout_in_footer: true,
                        window_options: {
                            is_draggable: false,
                            cover_page: window.is_embedded,
                        },
                    });
                } while (!is_verified);
            }
            // is phone verification required? (hard gate for low-rep signups)
            if (whoami.requires_phone_verification) {
                let is_verified;
                do {
                    is_verified = await UIWindowPhoneVerificationRequired({
                        show_close_button: false,
                        stay_on_top: true,
                        has_head: false,
                        logout_in_footer: true,
                        window_options: {
                            is_draggable: false,
                            cover_page: window.is_embedded,
                        },
                    });
                } while (!is_verified);
            }
            // Card verification is the last gate: only show it once the email and
            // phone (SMS) gates are cleared, since those show up first.
            if (whoami.requires_card_verification) {
                let is_verified;
                do {
                    is_verified = await UIWindowCardVerificationRequired({
                        show_close_button: false,
                        stay_on_top: true,
                        has_head: false,
                        logout_in_footer: true,
                        window_options: {
                            is_draggable: false,
                            cover_page: window.is_embedded,
                        },
                    });
                } while (!is_verified);
            }
            await window.update_auth_data(
                whoami.token || window.auth_token,
                whoami,
            );

            await postAuthActions(action);
            // ----------------------------------------------------------
            // Get user's sites
            // ----------------------------------------------------------
            window.update_sites_cache();
        }
    }
    // -------------------------------------------------------------------------------------
    // Desktop Background
    // If we're in fullpage/emebedded/Auth Popup mode, we don't want to load the custom background
    // because it's not visible anyway and it's a waste of bandwidth
    // -------------------------------------------------------------------------------------
    if (!window.is_fullpage_mode && !window.embedded_in_popup) {
        window.refresh_desktop_background();
    }
    // -------------------------------------------------------------------------------------
    // Un-authed but not first visit -> try to log in/sign up
    // -------------------------------------------------------------------------------------
    if (
        !window.is_auth() &&
        (!window.first_visit_ever || window.disable_temp_users)
    ) {
        // `npm start --server=<remote>` serves this GUI locally while pointing
        // `gui_origin` at a remote Puter. There is nothing here to log into:
        // `/login` accepts only its own origin, because it answers with a full
        // session token and reflected CORS would otherwise let any page read
        // one. So hand off to the remote's AuthMe flow — the password is typed
        // on the real origin, and we come back with a token in the URL.
        if (shouldUseRemoteAuthme(window.gui_origin, window.location.origin)) {
            // One attempt per tab. A token that comes back but fails `whoami`
            // would otherwise bounce us straight back out again forever.
            const ATTEMPTED_KEY = 'puter.authme_redirect_attempted';
            let attempted = false;
            try {
                attempted = sessionStorage.getItem(ATTEMPTED_KEY) === '1';
                sessionStorage.setItem(ATTEMPTED_KEY, '1');
            } catch (e) {
                // sessionStorage unavailable — fall through and redirect once.
            }
            if (!attempted) {
                window.location.href = authmeRequestUrl(
                    window.gui_origin,
                    window.location.origin + window.location.pathname,
                    { fullToken: true },
                ).href;
                return;
            }
            // Second pass in this tab: something came back but didn't
            // authenticate us. Clear the flag before reporting, so a reload
            // gets one fresh attempt instead of being stuck on this alert
            // forever — the guard exists to stop an *automatic* loop, and an
            // automatic return only happens when a token was handed back.
            try {
                sessionStorage.removeItem(ATTEMPTED_KEY);
            } catch (e) { /* sessionStorage unavailable */ }
            await UIAlert({
                message: i18n('remote_backend_signin_failed', {
                    origin: window.gui_origin,
                }),
            });
            return;
        }

        const needs_action = action === 'authme' || action === 'copyauth';
        const reload_on_success = needs_action;
        if (window.logged_in_users.length > 0) {
            // dashboard mode skips the wallpaper (fullpage), but the session list
            // has no cover page — restore the wallpaper so it isn't on a blank page
            if (window.is_dashboard_mode) {
                window.refresh_desktop_background();
            }
            await UIWindowSessionList({
                redirect_url: needs_action ? window.location.href : undefined,
            });
        } else {
            const resp = await fetch(`${window.gui_origin}/whoarewe`);
            const whoarewe = await resp.json();
            await UIWindowLogin({
                reload_on_success: !window.embedded_in_popup,
                send_confirmation_code: true,
                show_signup_button: !whoarewe.disable_user_signup,
                redirect_url: needs_action ? window.location.href : undefined,
                window_options: {
                    cover_page: true,
                    has_head: false,
                },
            });
        }
        if (!reload_on_success && window.is_auth()) {
            window.__login_completed = true;
        }
    }

    // -------------------------------------------------------------------------------------
    // Un-authed and first visit ever -> create temp user with Turnstile challenge
    // -------------------------------------------------------------------------------------
    else if (
        !window.is_auth() &&
        window.first_visit_ever &&
        !window.disable_temp_users &&
        action !== 'login' &&
        action !== 'signup'
    ) {
        let referrer;
        try {
            referrer = new URL(window.location.href).pathname;
        } catch (e) {
            console.log(e);
        }

        referrer = window.openerOrigin ?? referrer;

        // a global object that will be used to store the user's referrer
        window.referrerStr = referrer;

        // in case there is also a referrer query param, add it to the referrer URL
        if (window.url_query_params.has('ref')) {
            if (!referrer) {
                referrer = '/';
            }
            referrer += `?ref=${html_encode(window.url_query_params.get('ref'))}`;
        }

        let headers = {};
        if (window.custom_headers) {
            headers = window.custom_headers;
        }

        // Function to create temp user after captcha completion
        const createTempUser = async (turnstileToken) => {
            // if this is a popup, show a spinner
            let spinner_init_ts = Date.now();
            const requestData = {
                referrer: referrer,
                is_temp: true,
            };

            // Add Turnstile token if available
            if (turnstileToken) {
                requestData['cf-turnstile-response'] = turnstileToken;
            }

            // Device signal for abuse prevention; omitted when unavailable
            try {
                const fingerprint = await window.getDeviceFingerprint?.();
                if (fingerprint) {
                    requestData.fingerprint = fingerprint;
                }
            } catch (e) {
                // signup must never block or fail because of device signals
            }

            $.ajax({
                url: `${window.gui_origin}/signup`,
                type: 'POST',
                async: true,
                headers: headers,
                contentType: 'application/json',
                data: JSON.stringify(requestData),
                success: async function (data) {
                    /*eslint-disable*/
                    const turnstile_duration =
                        Date.now() - window.turnstile_success_ts;
                    if (turnstile_duration < 2000) {
                        // Sleep until 2 seconds have passed
                        await window.sleep(2000 - turnstile_duration);
                    }

                    const $captchaModal = $('.captcha-modal');
                    if ($captchaModal.length > 0)
                        await new Promise(async (resolve) => {
                            // The callback operand for fadeOut could be called
                            // more than once if there are multiple `.captcha-modal`
                            // elements, but only the first call to `resolve()` will
                            // have any effect.
                            $captchaModal.fadeOut(200, function () {
                                $(this).remove();
                                resolve();
                            });

                            // Just in case anything fails, also resolve after 500ms
                            await window.sleep(500);
                            resolve();
                        });

                    await window.update_auth_data(data.token, data.user);

                    // if this is a popup, hide the spinner, make sure it was visible for at least 2 seconds
                    if (window.embedded_in_popup)
                        await new Promise(async (resolve) => {
                            let spinner_duration = Date.now() - spinner_init_ts;

                            (async () => {
                                let closing = false;
                                try {
                                    if (runsUserAppTokenExchange(action)) {
                                        let msg_id =
                                            window.url_query_params.get('msg_id');
                                        let data = await window.getUserAppToken(
                                            new URL(window.openerOrigin).origin,
                                        );
                                        // A network failure here returns null and
                                        // an HTTP failure returns the parsed error
                                        // body, neither of which carries a token;
                                        // the reads below would fault or hand the
                                        // opener an `undefined` token.
                                        if (!data?.token) {
                                            throw new Error(
                                                'user-app token exchange returned no token',
                                            );
                                        }
                                        // This is an implicit app and the app_uid is sent back from the server
                                        // we cache it here so that we can use it later
                                        window.host_app_uid = data.app_uid;
                                        // send token to parent
                                        if (deliversTokenToOpener(action)) {
                                            window.opener?.postMessage(
                                                {
                                                    msg: 'puter.token',
                                                    success: true,
                                                    msg_id: msg_id,
                                                    token: data.token,
                                                    username: window.user.username,
                                                    app_uid: data.app_uid,
                                                },
                                                window.openerOrigin,
                                            );
                                        }
                                    }
                                    // close popup
                                    if (!action || action === 'sign-in') {
                                        closing = true;
                                        window.close();
                                        window.open('', '_self').close();
                                    }
                                } catch (err) {
                                    console.error(
                                        'popup token exchange failed',
                                        err,
                                    );
                                } finally {
                                    // Actions that keep the popup open still
                                    // have work to do after this wait, and the
                                    // sleep below only ends it when the spinner
                                    // was up for under 2s — so this has to run
                                    // on the failure paths too, or the popup
                                    // wedges on the spinner forever.
                                    if (!closing) {
                                        resolve();
                                    }
                                }
                            })();
                            if (spinner_duration < 2000) {
                                await window.sleep(2000 - spinner_duration);
                                resolve();
                            }
                        });
                    /*eslint-enable*/

                    document.dispatchEvent(
                        new Event('login', { bubbles: true }),
                    );
                },
                error: async (err) => {
                    let err_obj = null;
                    try {
                        err_obj = JSON.parse(err.responseText);
                    } catch (e) {
                        err_obj = e;
                    }
                    if (err_obj.code === 'must_login_or_signup') {
                        // hide Turnstile challenge
                        $('.captcha-modal').hide();

                        await UIWindowSignup({
                            reload_on_success: !window.embedded_in_popup,
                            send_confirmation_code: true,
                            window_options: {
                                has_head: false,
                                cover_page: true,
                            },
                        });

                        // Popup-only: it posts to `window.opener` and closes the
                        // window. On a normal page `window.openerOrigin` is
                        // undefined and `new URL(undefined)` would throw into
                        // nothing.
                        if (window.embedded_in_popup)
                            (async () => {
                                try {
                                    if (runsUserAppTokenExchange(action)) {
                                        let msg_id =
                                            window.url_query_params.get('msg_id');
                                        let data = await window.getUserAppToken(
                                            new URL(window.openerOrigin).origin,
                                        );
                                        if (!data?.token) {
                                            throw new Error(
                                                'user-app token exchange returned no token',
                                            );
                                        }
                                        // This is an implicit app and the app_uid is sent back from the server
                                        // we cache it here so that we can use it later
                                        window.host_app_uid = data.app_uid;
                                        // send token to parent
                                        if (deliversTokenToOpener(action)) {
                                            window.opener?.postMessage(
                                                {
                                                    msg: 'puter.token',
                                                    success: true,
                                                    msg_id: msg_id,
                                                    token: data.token,
                                                    username: window.user.username,
                                                    app_uid: data.app_uid,
                                                },
                                                window.openerOrigin,
                                            );
                                        }
                                    }
                                } catch (err) {
                                    console.error(
                                        'popup token exchange failed after manual signup',
                                        err,
                                    );
                                }
                                // close popup
                                if (!action || action === 'sign-in') {
                                    window.close();
                                    window.open('', '_self').close();
                                    return;
                                }
                                // Every other action is handled by
                                // `postAuthActions`, which only runs off the
                                // `login` event on this path — without it the
                                // popup sits blank and the requester is never
                                // answered.
                                document.dispatchEvent(
                                    new Event('login', { bubbles: true }),
                                );
                            })();
                    } else if (err_obj.code === 'signup_blocked') {
                        // Hide any captcha modal
                        $('.captcha-modal').hide();

                        const overlay = document.createElement('div');
                        overlay.classList.add('signup-blocked-overlay');
                        const blockedMsg = err_obj.message || 'Signup blocked';
                        overlay.innerHTML = `
                            <div class="signup-blocked-content">
                                <img src="${window.icons['logo.svg'] || window.icons['logo-white.svg'] || ''}" style="width:64px;margin-bottom:24px;" />
                                <p>${html_encode(blockedMsg)}</p>
                                <p>If you already have an account, try <a href="/action/login">logging in</a>. Otherwise, contact <a href="mailto:support@puter.com">support@puter.com</a> for assistance.</p>
                            </div>
                        `;
                        document.body.appendChild(overlay);
                    } else {
                        UIAlert({
                            message:
                                err_obj.message ??
                                'There was an error creating your account. Please try again.',
                        });
                    }
                },
                complete: function () {},
            });
        };

        // Check if Turnstile is enabled and show challenge
        if (window.gui_params?.turnstileSiteKey) {
            window.showTurnstileChallenge({
                onSuccess: createTempUser,
                onError: (error) => {
                    console.error('Turnstile verification failed:', error);
                    UIAlert({
                        message:
                            'Security verification failed. Please refresh the page and try again.',
                    });
                },
            });
        } else {
            // No Turnstile configured, proceed without challenge
            createTempUser();
        }
    }

    // if there is at least one window open (only non-Explorer windows), ask user for confirmation when navigating away from puter
    if (window.feature_flags.prompt_user_when_navigation_away_from_puter) {
        window.onbeforeunload = function () {
            if ($('.window:not(.window[data-app="explorer"])').length > 0) {
                return true;
            }
        };
    }

    // -------------------------------------------------------------------------------------
    // `login` event handler
    // --------------------------------------------------------------------------------------
    $(document).on('login', async (e) => {
        // Reaching this in a popup means the user just entered credentials in
        // a window the opener asked for — that is the consent `postAuthActions`
        // looks for. The account-picker gate upstream never runs on this path:
        // it only applies to a popup that was already signed in at boot.
        if (window.embedded_in_popup) {
            window.popup_signin_consent = true;
        }
        // close all windows
        $('.window').close();

        // -------------------------------------------------------------------------------------
        // Early check for fullpage mode from app metadata (after login)
        // -------------------------------------------------------------------------------------
        if (
            !window.is_fullpage_mode &&
            window.url_paths[0]?.toLocaleLowerCase() === 'app' &&
            window.url_paths[1]
        ) {
            try {
                const app_info = await puter.apps.get(window.url_paths[1], {
                    icon_size: 64,
                });
                if (app_info?.metadata?.fullpage_on_landing) {
                    window.is_fullpage_mode = true;
                    window.taskbar_height = 0;
                    window.app_launched_from_url = app_info;
                }
            } catch (e) {
                // App metadata fetch failed; will retry later in UIDesktop
            }
        }

        await postAuthActions(action);
    });

    if (window.__login_completed) {
        document.dispatchEvent(new Event('login', { bubbles: true }));
        window.__login_completed = false;
    }

    $('.popover, .context-menu').on('remove', function () {
        $('.window-active .window-app-iframe').css('pointer-events', 'all');
    });

    // If the document is clicked/tapped somewhere
    $(document).bind('mousedown touchstart', function (e) {
        // update last touch coordinates
        update_last_touch_coordinates(e);

        // dismiss touchstart on regular devices
        if (e.type === 'touchstart' && !isMobile.phone && !isMobile.tablet) {
            return;
        }

        // If .item-container clicked, unselect all its item children
        if (
            $(e.target).hasClass('item-container') &&
            !e.ctrlKey &&
            !e.metaKey
        ) {
            $(e.target).children('.item-selected').removeClass('item-selected');
            window.update_explorer_footer_selected_items_count(e.target);
        }

        // If the clicked element is not a context menu, remove all context menus
        if ($(e.target).parents('.context-menu').length === 0) {
            $('.context-menu').fadeOut(200, function () {
                $(this).remove();
            });
        }

        // click on anything will close all popovers, but there are some exceptions
        if (
            !$(e.target).hasClass('start-app') &&
            !$(e.target).hasClass('launch-search') &&
            !$(e.target).hasClass('launch-search-clear') &&
            $(e.target).closest('.start-app').length === 0 &&
            !isMobile.phone &&
            !isMobile.tablet &&
            !$(e.target).hasClass('popover') &&
            $(e.target).parents('.popover').length === 0
        ) {
            $('.popover').fadeOut(200, function () {
                $('.popover').remove();
            });
        }

        // Close all tooltips
        $('.ui-tooltip').remove();

        // rename items whose names were being edited
        if (!$(e.target).hasClass('item-name-editor')) {
            // blurring an Item Name Editor will automatically trigger renaming the item
            $('.item-name-editor-active').blur();
        }

        // update active_item_container
        if ($(e.target).hasClass('item-container')) {
            window.active_item_container = e.target;
        } else {
            let ic = $(e.target).closest('.item-container');
            if (ic.length > 0) {
                window.active_item_container = ic.get(0);
            } else {
                let pp = $(e.target).find('.item-container');
                if (pp.length > 0) {
                    window.active_item_container = pp.get(0);
                }
            }
        }

        //active element
        window.active_element = e.target;
    });

    // update mouse position coordinates
    $(document).mousemove(function (event) {
        update_mouse_position(event.clientX, event.clientY);
    });

    //--------------------------------------------------------
    // Window Activation
    //--------------------------------------------------------
    $(document).on('mousedown', function (e) {
        // if taskbar or any parts of it is clicked, drop the event
        if (
            $(e.target).hasClass('taskbar') ||
            $(e.target).closest('.taskbar').length > 0
        ) {
            return;
        }
        // if toolbar or any parts of it is clicked, drop the event
        if (
            $(e.target).hasClass('toolbar') ||
            $(e.target).closest('.toolbar').length > 0
        ) {
            return;
        }

        // if close or minimize button clicked, drop the event
        if (
            document
                .elementFromPoint(e.clientX, e.clientY)
                .closest('.window-close-btn, .window-minimize-btn')
        ) {
            return;
        }

        // if mouse is clicked on a window, activate it
        if (window.mouseover_window !== undefined) {
            // if popover clicked on, don't activate window. This is because if an app
            // is using the popover API to show a popover, the popover will be closed if the window is activated
            if (
                $(e.target).hasClass('popover') ||
                $(e.target).parents('.popover').length > 0
            ) {
                return;
            }
            $(window.mouseover_window).focusWindow(e);
        }
    });

    // if an element has the .long-hover class, fire a long-hover event after 600ms
    $(document).on('mouseenter', '.long-hover', function () {
        let el = this;
        el.long_hover_timeout = setTimeout(() => {
            $(el).trigger('long-hover');
        }, 600);
    });

    // if an element has the .long-hover class, cancel the long-hover event if the mouse leaves
    $(document).on('mouseleave', '.long-hover', function () {
        clearTimeout(this.long_hover_timeout);
    });

    document.addEventListener('visibilitychange', (event) => {
        if (document.visibilityState !== 'visible') {
            window.doc_title_before_blur = document.title;
            if (Object.keys(window.active_uploads).length > 0) {
                update_title_based_on_uploads();
            }
        } else if (window.active_uploads) {
            document.title = window.doc_title_before_blur ?? 'Puter';
        }
    });
};

function requestOpenerOrigin() {
    return new Promise((resolve, reject) => {
        if (!window.opener) {
            reject(new Error('No window.opener available'));
            return;
        }

        // Function to handle the message event
        const handleMessage = (event) => {
            // Check if the message is the expected response
            if (event.data.msg === 'originResponse') {
                // Clean up by removing the event listener
                window.removeEventListener('message', handleMessage);
                resolve(event.origin);
            }
        };

        // Set up the listener for the response
        window.addEventListener('message', handleMessage, false);

        // Send the request to the opener
        window.opener.postMessage({ msg: 'requestOrigin' }, '*');

        // Optional: Reject the promise if no response is received within a timeout
        setTimeout(() => {
            window.removeEventListener('message', handleMessage);
            reject(new Error('Response timed out'));
        }, 5000); // Timeout after 5 seconds
    });
}

$(document).on('click', '.generic-close-window-button', function (e) {
    $(this).closest('.window').close();
});

$(document).on('click', function (e) {
    if (
        !$(e.target).hasClass('window-search') &&
        $(e.target).closest('.window-search').length === 0 &&
        !$(e.target).is('.toolbar-btn.search-btn')
    ) {
        $('.window-search').close();
    }
});

// Re-calculate desktop height and width on window resize and re-position the login and signup windows
$(window).on('resize', function () {
    // If host env is popup, don't continue because the popup window has its own resize requirements.
    if (window.embedded_in_popup) {
        return;
    }

    const ratio = window.desktop_width / window.innerWidth;

    window.desktop_height =
        window.innerHeight - window.toolbar_height - window.taskbar_height;
    window.desktop_width = window.innerWidth;

    // Re-center the login window
    const top = $('.window-login').position()?.top;
    const width = $('.window-login').width();
    $('.window-login').css({
        left: (window.desktop_width - width) / 2,
        top: top / ratio,
    });

    // Re-center the create account window
    const top2 = $('.window-signup').position()?.top;
    const width2 = $('.window-signup').width();
    $('.window-signup').css({
        left: (window.desktop_width - width2) / 2,
        top: top2 / ratio,
    });
});

$(document).on('contextmenu', '.disable-context-menu', function (e) {
    if ($(e.target).hasClass('disable-context-menu')) {
        e.preventDefault();
        return false;
    }
});

// util/desktop.js
window.privacy_aware_path = privacy_aware_path_factory({ window });

$(window).on('system-logout-event', function () {
    // Clear cookie
    document.cookie = 'puter=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    // Redirect to clean URL without any query parameters
    const cleanUrl = window.location.origin + window.location.pathname;
    window.location.replace(cleanUrl);
});
