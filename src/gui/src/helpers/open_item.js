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

import UIWindow from '../UI/UIWindow.js';
import UIAlert from '../UI/UIAlert.js';
import i18n from '../i18n/i18n.js';
import launch_app from './launch_app.js';
import path from '../lib/path.js';
import item_icon from './item_icon.js';
import { is_window_on_screen, user_facing_windows } from './window_visibility.js';

// Files whose app launch is still in flight, by file uid. Between the click
// and the window's creation there is nothing in the DOM to restore, so a
// re-click during that stretch would mint a duplicate instance — mark the
// launch and swallow re-clicks instead (same idea as TabApps._launchingApps).
// Entries carry a timestamp so a launch that dies without settling (an
// unexpected throw before launch_app is reached) can't swallow clicks forever.
const launching_file_uids = new Map();
const LAUNCH_GUARD_TTL = 15000;
const file_launch_in_flight = (uid) => {
    const ts = launching_file_uids.get(uid);
    if ( ! ts ) return false;
    if ( Date.now() - ts > LAUNCH_GUARD_TTL ) {
        launching_file_uids.delete(uid);
        return false;
    }
    return true;
};

const open_item = async function (options) {
    let el_item = options.item;
    const $el_parent_window = $(el_item).closest('.window');
    const parent_win_id = $($el_parent_window).attr('data-id');
    const is_dir = $(el_item).attr('data-is_dir') === '1' ? true : false;
    const uid = $(el_item).attr('data-shortcut_to') === '' ? $(el_item).attr('data-uid') : $(el_item).attr('data-shortcut_to');
    const item_path = $(el_item).attr('data-shortcut_to_path') === '' ? $(el_item).attr('data-path') : $(el_item).attr('data-shortcut_to_path');
    const is_shortcut = $(el_item).attr('data-is_shortcut') === '1';
    const shortcut_to_path = $(el_item).attr('data-shortcut_to_path');
    const associated_app_name = $(el_item).attr('data-associated_app_name');
    const file_uid = $(el_item).attr('data-uid');
    // Normalized identity of the file being opened (shortcuts resolve to
    // their target) — matched against the data-file_uid that launch_app
    // stamps on app windows.
    const target_file_uid = (!is_dir && uid) ? String(uid).toLowerCase() : null;

    //----------------------------------------------------------------
    // Is this an app shortcut?
    //----------------------------------------------------------------
    const app_name = $(el_item).attr('data-app');
    if ( app_name ) {
        launch_app({ name: app_name });
        return;
    }

    //----------------------------------------------------------------
    // Is this an .app file?
    //----------------------------------------------------------------
    if ( item_path && item_path.toLowerCase().endsWith('.app') ) {
        try {
            const content = await puter.fs.read({ path: item_path });
            const text = typeof content === 'string' ? content : await content.text();
            const data = JSON.parse(text);
            if ( data.app ) {
                launch_app({ name: data.app });
                return;
            }
        } catch (e) {
            console.error('Error reading .app file:', e);
        }
    }

    //----------------------------------------------------------------
    // Is this a shortcut whose source is perma-deleted?
    //----------------------------------------------------------------
    if ( is_shortcut && shortcut_to_path === '' ) {
        UIAlert('This shortcut can\'t be opened because its source has been deleted.');
    }
    //----------------------------------------------------------------
    // Is this a shortcut whose source is trashed?
    //----------------------------------------------------------------
    else if ( is_shortcut && shortcut_to_path.startsWith(`${window.trash_path }/`) ) {
        UIAlert('This shortcut can\'t be opened because its source has been deleted.');
    }
    //----------------------------------------------------------------
    // Is this a .weblink file?
    //----------------------------------------------------------------
    else if ( $(el_item).attr('data-name').toLowerCase().endsWith('.weblink') ) {
        try {
            // First check localStorage using the file's UID
            let url = null;
            if ( file_uid ) {
                url = localStorage.getItem(`weblink_${ file_uid}`);
            }

            // Try to read the file content directly using the file's path
            if ( ! url ) {
                try {
                    const content = await puter.fs.read({
                        path: item_path,
                    });

                    // Handle different content types
                    if ( content instanceof Blob ) {
                        // If content is a Blob, convert it to text
                        const text = await content.text();

                        // Try to parse the text as JSON
                        try {
                            const jsonData = JSON.parse(text);
                            if ( jsonData.url ) {
                                url = jsonData.url;
                            }
                        } catch (e) {
                            console.error('Error parsing Blob content as JSON:', e);
                            // Not valid JSON, try using the content directly
                            if ( text && (text.startsWith('http://') || text.startsWith('https://')) ) {
                                url = text;
                                console.log('Using Blob content as URL (direct):', url);
                            }
                        }
                    } else if ( typeof content === 'string' ) {
                        // If content is a string, try to parse it as JSON
                        try {
                            const jsonData = JSON.parse(content);
                            if ( jsonData.url ) {
                                url = jsonData.url;
                            }
                        } catch (e) {
                            console.error('Error parsing string content as JSON:', e);
                            // Not valid JSON, try using the content directly
                            if ( content && (content.startsWith('http://') || content.startsWith('https://')) ) {
                                url = content;
                                console.log('Using string content as URL (direct):', url);
                            }
                        }
                    } else {
                        console.error('Unexpected content type:', typeof content);
                    }
                } catch (e) {
                    console.error('Error reading file using path:', e);
                }
            }

            // If we have a valid URL, open it
            if ( url && (url.startsWith('http://') || url.startsWith('https://')) ) {
                window.open(url, '_blank', 'noopener,noreferrer');
            } else {
                // Show a more detailed error message
                UIAlert(`Could not determine the URL for this web shortcut.
                
Technical details:
- File name: ${$(el_item).attr('data-name')}
- File path: ${item_path}
- File UID: ${file_uid}

Please try recreating the link.`);
            }
        } catch ( error ) {
            console.error('Error opening web shortcut:', error);
            UIAlert(`Error opening web shortcut: ${ error.message}`);
        }
    }
    //----------------------------------------------------------------
    // Is this a trashed file?
    //----------------------------------------------------------------
    else if ( item_path.startsWith(`${window.trash_path }/`) ) {
        UIAlert('This item can\'t be opened because it\'s in the trash. To use this item, first drag it out of the Trash.');
    }
    //----------------------------------------------------------------
    // Is this a file (no dir) on a SaveFileDialog?
    //----------------------------------------------------------------
    else if ( $el_parent_window.attr('data-is_saveFileDialog') === 'true' && !is_dir ) {
        $el_parent_window.find('.savefiledialog-filename').val($(el_item).attr('data-name'));
        $el_parent_window.find('.savefiledialog-save-btn').trigger('click');
    }
    //----------------------------------------------------------------
    // Is this a file (no dir) on an OpenFileDialog?
    //----------------------------------------------------------------
    else if ( $el_parent_window.attr('data-is_openFileDialog') === 'true' && !is_dir ) {
        $el_parent_window.find('.window-disable-mask, .busy-indicator').show();
        let busy_init_ts = Date.now();
        try {
            let filedialog_parent_uid = $el_parent_window.attr('data-parent_uuid');
            let $filedialog_parent_app_window = $(`.window[data-element_uuid="${filedialog_parent_uid}"]`);
            let parent_window_app_uid = $filedialog_parent_app_window.attr('data-app_uuid');
            const initiating_app_uuid = $el_parent_window.attr('data-initiating_app_uuid');

            let res = await puter.fs.sign(window.host_app_uid ?? parent_window_app_uid, { uid: uid, action: 'write' });
            res = res.items;
            // todo split is buggy because there might be a slash in the filename
            res.path = window.privacy_aware_path(item_path);
            const parent_uuid = $el_parent_window.attr('data-parent_uuid');
            const return_to_parent_window = $el_parent_window.attr('data-return_to_parent_window') === 'true';
            if ( return_to_parent_window ) {
                window.opener.postMessage({
                    msg: 'fileOpenPicked',
                    original_msg_id: $el_parent_window.attr('data-iframe_msg_uid'),
                    items: Array.isArray(res) ? [...res] : [res],
                    // LEGACY SUPPORT, remove this in the future when Polotno uses the new SDK
                    // this is literally put in here to support Polotno's legacy code
                    ...(!Array.isArray(res) && res),
                }, '*');

                window.close();
            }
            else if ( parent_uuid ) {
                // send event to iframe
                const target_iframe = $(`.window[data-element_uuid="${parent_uuid}"]`).find('.window-app-iframe').get(0);
                if ( target_iframe ) {
                    let retobj = {
                        msg: 'fileOpenPicked',
                        original_msg_id: $el_parent_window.attr('data-iframe_msg_uid'),
                        items: Array.isArray(res) ? [...res] : [res],
                        // LEGACY SUPPORT, remove this in the future when Polotno uses the new SDK
                        // this is literally put in here to support Polotno's legacy code
                        ...(!Array.isArray(res) && res),
                    };
                    target_iframe.contentWindow.postMessage(retobj, '*');
                }

                // focus iframe
                $(target_iframe).get(0)?.focus({ preventScroll: true });

                // send file_opened event
                const file_opened_event = new CustomEvent('file_opened', { detail: res });

                // dispatch event to parent window
                $(`.window[data-element_uuid="${parent_uuid}"]`).get(0)?.dispatchEvent(file_opened_event);
            }
        } catch (e) {
            console.log(e);
        }
        // done
        let busy_duration = (Date.now() - busy_init_ts);
        if ( busy_duration >= window.busy_indicator_hide_delay ) {
            $el_parent_window.close();
        } else {
            setTimeout(() => {
                // close this dialog
                $el_parent_window.close();
            }, Math.abs(window.busy_indicator_hide_delay - busy_duration));
        }
    }
    //----------------------------------------------------------------
    // Dashboard: is this file already open in an app window? In
    // dashboard mode there is no taskbar — the file's row is where a
    // user goes looking for a window they minimized — so restore that
    // window (edits intact) instead of minting a second instance.
    //----------------------------------------------------------------
    // The user's own windows only: a file opened in an instance another app
    // launched in the background is not a window the row can switch to, so the
    // click launches the file the normal way instead of surfacing that one.
    else if ( window.is_dashboard_mode && !associated_app_name && target_file_uid
        && (user_facing_windows($(`.window[data-file_uid="${html_encode(target_file_uid)}"]`)).length
            || file_launch_in_flight(target_file_uid)) ) {
        const $win = $(user_facing_windows($(`.window[data-file_uid="${html_encode(target_file_uid)}"]`))).last();
        // No window yet means the first click's launch is still in
        // flight — swallow the re-click instead of duplicating it.
        if ( $win.length ) {
            if ( is_window_on_screen($win.get(0)) ) {
                $win.focusWindow();
            } else {
                $win.showWindow();
            }
        }
    }
    //----------------------------------------------------------------
    // Does the user have a preference for this file type?
    //----------------------------------------------------------------
    else if ( !associated_app_name && !is_dir && window.user_preferences[`default_apps${path.extname(item_path).toLowerCase()}`] ) {
        const launch_promise = launch_app({
            name: window.user_preferences[`default_apps${path.extname(item_path).toLowerCase()}`],
            file_path: item_path,
            window_title: path.basename(item_path),
            maximized: options.maximized ?? window.is_dashboard_mode,
            file_uid: file_uid,
        });
        if ( target_file_uid ) {
            launching_file_uids.set(target_file_uid, Date.now());
            launch_promise.finally(() => launching_file_uids.delete(target_file_uid));
        }
    }
    //----------------------------------------------------------------
    // Is there an app associated with this item?
    //----------------------------------------------------------------
    else if ( associated_app_name !== '' ) {
        launch_app({
            name: associated_app_name,
            maximized: options.maximized ?? window.is_dashboard_mode,
        });
    }
    //----------------------------------------------------------------
    // Dir with no open windows: create a new window
    //----------------------------------------------------------------
    else if ( is_dir && ($el_parent_window.length === 0 || options.new_window) ) {
        UIWindow({
            path: item_path,
            title: path.basename(item_path),
            icon: await item_icon({ is_dir: true, path: item_path }),
            uid: $(el_item).attr('data-uid'),
            is_dir: is_dir,
            app: 'explorer',
            top: options.maximized ? 0 : undefined,
            left: options.maximized ? 0 : undefined,
            height: options.maximized ? `calc(100% - ${window.taskbar_height + window.toolbar_height + 1}px)` : undefined,
            width: options.maximized ? '100%' : undefined,
        });
    }
    //----------------------------------------------------------------
    // Dir with an open window: change the path of the open window
    //----------------------------------------------------------------
    else if ( $el_parent_window.length > 0 && is_dir ) {
        window.window_nav_history[parent_win_id] = window.window_nav_history[parent_win_id].slice(0, window.window_nav_history_current_position[parent_win_id] + 1);
        window.window_nav_history[parent_win_id].push(item_path);
        window.window_nav_history_current_position[parent_win_id]++;

        window.update_window_path($el_parent_window, item_path);
    }
    //----------------------------------------------------------------
    // all other cases: try to open using an app
    //----------------------------------------------------------------
    else {
        const fspath = item_path.toLowerCase();
        const fsuid = uid.toLowerCase();
        let open_item_meta;

        // The stretch from here to the launch is where a re-click would
        // find no window to restore yet — mark the file as launching so
        // the dashboard reuse branch above swallows re-clicks meanwhile.
        if ( target_file_uid ) launching_file_uids.set(target_file_uid, Date.now());

        // get all info needed to open an item
        try {
            open_item_meta = await $.ajax({
                url: `${window.api_origin }/open_item`,
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    uid: fsuid ?? undefined,
                    path: fspath ?? undefined,
                }),
                headers: {
                    'Authorization': `Bearer ${window.auth_token}`,
                },
                statusCode: {
                    401: function (xhr) {
                        window.handle401(xhr);
                    },
                },
            });
        } catch ( err ) {
            // Ignored
        }

        // get a list of suggested apps for this file type.
        let suggested_apps = open_item_meta?.suggested_apps ?? await window.suggest_apps_for_fsentry({ uid: fsuid, path: fspath });

        //---------------------------------------------
        // No suitable apps, ask if user would like to
        // download
        //---------------------------------------------
        if ( suggested_apps.length === 0 ) {
            // Not launching after all — lift the in-flight guard.
            if ( target_file_uid ) launching_file_uids.delete(target_file_uid);
            //---------------------------------------------
            // If .zip file, unzip it
            //---------------------------------------------
            if ( path.extname(item_path) === '.zip' ) {
                window.unzipItem(item_path);
                return;
            }
            //---------------------------------------------
            // If .tar file, untar it
            //---------------------------------------------
            if ( path.extname(item_path) === '.tar' ) {
                window.untarItem(item_path);
                return;
            }
            const alert_resp = await UIAlert('Found no suitable apps to open this file with. Would you like to download it instead?',
                            [
                                {
                                    label: i18n('download_file'),
                                    value: 'download_file',
                                    type: 'primary',

                                },
                                {
                                    label: i18n('cancel'),
                                },
                            ]);
            if ( alert_resp === 'download_file' ) {
                window.trigger_download([item_path]);
            }
            return;
        }
        //---------------------------------------------
        // First suggested app is default app to open this item
        //---------------------------------------------
        else {
            const launch_promise = launch_app({
                name: suggested_apps[0].name,
                token: open_item_meta.token,
                file_path: item_path,
                app_obj: suggested_apps[0],
                window_title: path.basename(item_path),
                file_uid: fsuid,
                maximized: options.maximized ?? window.is_dashboard_mode,
                file_signature: open_item_meta.signature,
            });
            if ( target_file_uid ) launch_promise.finally(() => launching_file_uids.delete(target_file_uid));
        }
    }
};

export default open_item;