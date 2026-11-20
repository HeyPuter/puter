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

import path from '../lib/path.js';

import UIItem from './UIItem.js';
import UIAlert from './UIAlert.js';
import UIWindow from './UIWindow.js';

import { atPath, retargetNavHistory, retargetPaths, underPath } from '../helpers/pathElements.js';
import truncate_filename from '../helpers/truncateFilename.js';
import UINotification from './UINotification.js';
import launch_app from '../helpers/launchApp.js';
import { urlFileLaunchOptions } from '../helpers/confirmUrlFileAccess.js';
import item_icon from '../helpers/itemIcon.js';
import resolve_shared_item from '../helpers/resolveSharedItem.js';
import {
    answerNotificationReceipts,
    applyToastMark,
    createNotificationFeed,
    createReplayLog,
    listUndismissed,
    missedAfterReconnect,
    notificationSocketAcks,
} from '../helpers/notificationFeed.js';
import { getNotification, markNotificationAcknowledged } from '../helpers/notificationApi.js';
import {
    elementsWithData,
    handleNotificationTap,
    openAppForTap,
    setPushTapHandler,
    storedTapHandler,
} from '../helpers/notificationTap.js';
import { closeLocalBanner, startPushWorker } from '../helpers/pushWorker.js';
import { syncBrowserPush } from '../helpers/pushSync.js';
import { get_app_by_uid } from '../helpers/getAppByUid.js';
import { httpsIconFor, notificationTarget, senderNameFor } from './Dashboard/notificationCenter.js';
import apply_item_added_to_containers from '../helpers/applyItemAddedToContainers.js';
import parse_item_metadata from '../helpers/parseItemMetadata.js';
import { resolve_default_app } from '../helpers/defaultApp.js';

async function UIDesktop () {
    // start a transaction if we're not in embedded or fullpage mode
    let transaction;
    if ( !window.is_embedded && !window.is_fullpage_mode ) {
        transaction = new window.Transaction('desktop-is-ready');
        transaction.start();
    }

    let h = '';

    // connect socket.
    window.socket = io(`${window.gui_origin }/`, {
        auth: {
            auth_token: window.auth_token,
            acks: notificationSocketAcks(),
        },
        transports: ['websocket', 'polling'],
        withCredentials: true,
    });
    answerNotificationReceipts(window.socket);

    window.socket.on('error', (error) => {
        console.error('GUI Socket Error:', error);
    });

    // Pick up reauth_required signals delivered via the socket.io
    // handshake. SocketService emits `Error { data: { code:
    // 'reauth_required', reason, auth_id } }` for legacy/revoked/expired
    // tokens. Without this branch the disconnect would look like a
    // silent network failure to the user.
    window.socket.on('connect_error', (err) => {
        const signal = err?.data;
        if ( signal?.code === 'reauth_required' ) {
            window.handleReauthRequired({
                reason: signal.reason,
                auth_id: signal.auth_id,
            });
        } else {
            console.error('GUI Socket connect_error:', err);
        }
    });

    window.socket.on('connect', function () {
        // console.log('GUI Socket: Connected', window.socket.id);
        window.socket.emit('puter_is_actually_open');
    });

    window.socket.on('reconnect', function () {
        console.log('GUI Socket: Reconnected', window.socket.id);
    });

    window.socket.on('disconnect', () => {
        console.log('GUI Socket: Disconnected');
    });

    window.socket.on('reconnect', (attempt) => {
        console.log('GUI Socket: Reconnection', attempt);
    });

    window.socket.on('reconnect_attempt', (attempt) => {
        console.log('GUI Socket: Reconnection Attemps', attempt);
    });

    window.socket.on('reconnect_error', (error) => {
        console.log('GUI Socket: Reconnection Error', error);
    });

    window.socket.on('reconnect_failed', () => {
        console.log('GUI Socket: Reconnection Failed');
    });

    window.socket.on('error', (error) => {
        console.error('GUI Socket Error:', error);
    });

    window.socket.on('upload.progress', (msg) => {
        if ( window.progress_tracker[msg.operation_id] ) {
            window.progress_tracker[msg.operation_id].cloud_uploaded += msg.loaded_diff;
            if ( window.progress_tracker[msg.operation_id][msg.item_upload_id] ) {
                window.progress_tracker[msg.operation_id][msg.item_upload_id].cloud_uploaded = msg.loaded;
            }
        }
    });

    window.socket.on('download.progress', (msg) => {
        if ( window.progress_tracker[msg.operation_id] ) {
            if ( window.progress_tracker[msg.operation_id][msg.item_upload_id] ) {
                window.progress_tracker[msg.operation_id][msg.item_upload_id].downloaded = msg.loaded;
                window.progress_tracker[msg.operation_id][msg.item_upload_id].total = msg.total;
            }
        }
    });

    window.socket.on('trash.is_empty', async (msg) => {
        window.update_trash_icons(msg.is_empty);
        // empty trash windows if needed
        if ( msg.is_empty )
        {
            // only the rows: the container also holds its empty, error and loading states
            $(`.window[data-path="${html_encode(window.trash_path)}" i]`).each(function () {
                $(this).find('.item-container .item').removeItems();
                window.update_explorer_footer_item_count(this);
                window.update_explorer_footer_selected_items_count(this);
            });
        }
    });

    /**
     * Clicking a share notification opens the item, or Shared if grouped.
     * Shares the notification center's predicate so a toast and a list entry
     * never disagree about where a click goes.
     */
    const share_notification_click = (notification) => {
        const target = notificationTarget(notification);
        if ( target === null ) return undefined;
        if ( target.kind === 'shared-item' ) {
            return () => {
                open_shared_item(target.path);
            };
        }
        // Grouped: open where they all landed rather than picking one.
        return () => {
            UIWindow({
                path: window.shared_path,
                title: i18n('shared'),
                icon: window.icons['sidebar-folder-shared.svg'],
                is_dir: true,
                app: 'explorer',
            });
        };
    };

    // The desktop has no notification list, so other types only clear.
    const tap_surface = {
        share: (notification) => share_notification_click(notification)?.(),
        openApp: (route) => openAppForTap(route, { getApp: get_app_by_uid, launch: launch_app }),
    };
    const tap_notification = (tap) => handleNotificationTap(tap, tap_surface);

    const toasts_for = (uid) => $(elementsWithData($('.notification').get(), 'uid', uid));

    setPushTapHandler(storedTapHandler({
        fetchRow: getNotification,
        surface: tap_surface,
        found: (uid) => {
            toasts_for(uid).remove();
            update_tab_notif_count_badge();
            void markNotificationAcknowledged(uid).catch((err) => {
                console.warn('Could not acknowledge notification:', err);
            });
        },
    }));
    startPushWorker().then(() => syncBrowserPush());

    /**
     * Raise one notification, whichever path it arrived on. `replay` names
     * what the feed already claimed as shown while catching up, so the same
     * row isn't marked twice.
     */
    const show_notification = ({ uid, notification, app_uid }, { replay = false } = {}) => {
        // A notification can be re-sent under its own uid when what it says has
        // grown — several people sharing with you is one notification that
        // counts them. Refresh the one on screen rather than stacking a copy.
        const $showing = toasts_for(uid);
        if ( $showing.length ) {
            $showing.find('.notification-title').text(notification.title);
            $showing.find('.notification-text').text(notification.text ?? '');
            return;
        }

        UINotification({
            sender: senderNameFor(notification),
            title: notification.title,
            text: notification.text,
            icon: window.icons[notification.icon] ?? httpsIconFor(notification) ?? undefined,
            value: notification,
            uid,
            click: () => void tap_notification({ uid, notification, appUid: app_uid }),
            close: () => applyToastMark('dismissed', uid, {
                eventsPath: notification_feed.isActive(),
            }),
        });

        if ( ! replay ) {
            void applyToastMark('shown', uid, { eventsPath: notification_feed.isActive() });
        }
    };

    /**
     * Notifications over the events surface, where the server says it has
     * them. It renders through the same path the socket wire does, and the
     * listeners below stand down only while it is up.
     */
    const replayLog = createReplayLog();
    const notification_feed = createNotificationFeed({
        deliver: (items, { replay }) => {
            for ( const item of replayLog.admit(items, { replay }) ) show_notification(item, { replay });
        },
    });
    void notification_feed.start();

    // A replayed notification with no text of its own shows its title twice.
    const showReplayed = ({ uid, notification }) => show_notification({
        uid,
        notification: { ...notification, text: notification.text ?? notification.title },
    }, { replay: true });

    // A frozen or sleeping tab reconnects on resume; raise what it missed.
    const knownAtLoad = listUndismissed()
        .then((rows) => new Set(rows.map((row) => row.uid)))
        .catch(() => null);
    window.socket.io?.on('reconnect', () => {
        void Promise.all([knownAtLoad, listUndismissed()])
            .then(([known, rows]) => {
                if ( ! known ) return;
                for ( const item of missedAfterReconnect(rows, { known, log: replayLog }) ) showReplayed(item);
            })
            .catch((err) => console.warn('Could not catch up on notifications:', err));
    });

    /**
     * This event is triggered if a user receives a notification during
     * an active session.
     */
    window.socket.on('notif.message', async ({ uid, notification }) => {
        if ( notification_feed.isActive() ) return;
        for ( const item of replayLog.admit([{ uid, notification }]) ) show_notification(item);
    });

    /**
     * This event is triggered at the beginning of the session, after a websocket
     * connection is established, because the backend informs the frontend of all
     * unread notifications.
     *
     * It is not necessary to query unreads separately. If this stops working,
     * then this event should be fixed rather than querying unreads separately.
     * Each reconnect brings one, whichever path is live; this page raises what it missed.
     */
    window.socket.on('notif.unreads', async ({ unreads }) => {
        for ( const item of replayLog.admit(unreads, { replay: true }) ) showReplayed(item);
    });

    // Acknowledgements also arrive when the notification feed is inactive.
    window.socket.on('notif.ack', ({ uid }) => {
        void closeLocalBanner(uid);
        replayLog.dismissed(uid);
        toasts_for(uid).remove();
        update_tab_notif_count_badge();
    });

    // Removed from the notification history: its toast goes too.
    window.socket.on('notif.removed', ({ uid }) => {
        toasts_for(uid).remove();
        update_tab_notif_count_badge();
    });

    window.socket.on('item.removed', async (item) => {
        // don't update if this is the original client that initiated the action
        if ( item.original_client_socket_id === window.socket.id )
        {
            return;
        }

        // don't remove items if this was a descendants_only operation
        if ( item.descendants_only )
        {
            return;
        }

        // remove all UIItems at the removed path
        atPath('.item', item.path).fadeOut(150, function () {
            const $parent_window = $(this).closest('.window');
            $(this).removeItems();
            window.update_explorer_footer_item_count($parent_window);
            window.update_explorer_footer_selected_items_count($parent_window);
        });
        // close the windows showing the removed folder or anything inside it,
        // whether or not its own row is displayed anywhere
        // todo this has to be case-insensitive
        atPath('.window[data-app="explorer"]', item.path).add(underPath('.window', item.path)).close();
    });

    window.socket.on('item.updated', async (item) => {
        // Don't update if this is the original client that initiated the action
        if ( item.original_client_socket_id === window.socket.id )
        {
            return;
        }

        // Update matching items
        // set new item name
        $(`.item[data-uid='${html_encode(item.uid)}'] .item-name`).html(html_encode(truncate_filename(item.name)));

        // Set new icon
        const new_icon = (item.is_dir ? window.icons['folder.svg'] : (await item_icon(item)).image);
        $(`.item[data-uid='${item.uid}']`).find('.item-icon-thumb').attr('src', new_icon);
        $(`.item[data-uid='${item.uid}']`).find('.item-icon-icon').attr('src', new_icon);

        // Set new data-name. Attributes and form values are stored raw
        // (.attr()/.val() don't parse HTML), as rename_file writes them.
        $(`.item[data-uid='${item.uid}']`).attr('data-name', item.name);
        $(`.window-${item.uid}`).attr('data-name', item.name);

        // Set new title attribute
        $(`.item[data-uid='${item.uid}']`).attr('title', item.name);
        $(`.window-${item.uid}`).attr('title', item.name);

        // Set new value for item-name-editor
        $(`.item[data-uid='${item.uid}'] .item-name-editor`).val(item.name);
        $(`.item[data-uid='${item.uid}'] .item-name`).attr('title', item.name);

        // An overwrite arrives as an update, with a new size and date
        if ( item.size !== undefined && item.modified !== undefined ) {
            const $updated_items = $(`.item[data-uid='${item.uid}']`);
            $updated_items.attr({ 'data-size': item.size ?? '', 'data-modified': item.modified ?? '' });
            $updated_items.find('.item-attr--size > span').text(item.size ? window.byte_format(item.size) : '-');
            $updated_items.find('.item-attr--modified > span').text(item.modified === 0 ? '-' : timeago.format(item.modified * 1000));
        }

        // Set new data-path
        const new_path = item.path;
        $(`.item[data-uid='${item.uid}']`).attr('data-path', new_path);
        $(`.window-${item.uid}`).attr('data-path', new_path);

        retargetPaths(item.old_path, new_path, item.name);

        // Update all exact-matching windows
        $(`.window-${item.uid}`).each(function () {
            window.update_window_path(this, new_path);
        });
        // Set new name for matching open windows
        $(`.window-${item.uid} .window-head-title`).text(item.name);

        // Re-sort all matching item containers
        $(`.item[data-uid='${item.uid}']`).parent('.item-container').each(function () {
            window.sort_items(this, $(this).closest('.item-container').attr('data-sort_by'), $(this).closest('.item-container').attr('data-sort_order'));
        });
    });

    window.socket.on('item.moved', async (resp) => {
        let fsentry = resp;
        // Notify all apps that are watching this item
        window.sendItemChangeEventToWatchingApps(fsentry.uid, {
            event: 'moved',
            uid: fsentry.uid,
            name: fsentry.name,
        });

        // don't update if this is the original client that initiated the action
        if ( resp.original_client_socket_id === window.socket.id )
        {
            return;
        }

        let dest_path = path.dirname(fsentry.path);
        // A JSON string on the wire; trash/restore reads its fields.
        const metadata = parse_item_metadata(fsentry.metadata);

        // update all shortcut_to_path
        atPath('.item', resp.old_path, 'data-shortcut_to_path').attr('data-shortcut_to_path', fsentry.path);

        // remove all items with matching uids
        $(`.item[data-uid='${fsentry.uid}']`).fadeOut(150, function () {
            // find all parent windows that contain this item
            let parent_windows = $(`.item[data-uid='${fsentry.uid}']`).closest('.window');
            // remove this item
            $(this).removeItems();
            // update parent windows' item counts
            $(parent_windows).each(function (index) {
                window.update_explorer_footer_item_count(this);
                window.update_explorer_footer_selected_items_count(this);
            });
        });

        // if trashing, close windows of trashed items and its descendants
        if ( dest_path === window.trash_path ) {
            atPath('.window', resp.old_path).close();
            // todo this has to be case-insensitive
            underPath('.window', resp.old_path).close();
        }

        // update all paths of its and its descendants' open windows
        else {
            // todo this has to be case-insensitive
            underPath('.window', resp.old_path).add(atPath('.window', resp.old_path)).each(function () {
                window.update_window_path(this, fsentry.path + $(this).attr('data-path').slice(resp.old_path.length));
            });
            retargetNavHistory(resp.old_path, fsentry.path);
        }

        if ( dest_path === window.trash_path ) {
            // if trashing dir...
            if ( fsentry.is_dir ) {
                // remove the website badge from all instances of the dir
                $(`.item[data-uid="${fsentry.uid}"]`).find('.item-has-website-badge').fadeOut(300);

                // remove File Rrequest Token
                // todo, some client-side check to see if this dir has an FR associated with it before sending a whole ajax req
            }
        }
        // if replacing an existing item, remove the old item that was just replaced
        if ( fsentry.overwritten_uid !== undefined )
        {
            $(`.item[data-uid=${fsentry.overwritten_uid}]`).removeItems();
        }

        // Trashing renames the entry to its uid; the real name is in metadata.
        fsentry.name = metadata.original_name ?? fsentry.name;

        const moved_item_icon = await item_icon(fsentry);
        const $dest_containers = atPath('.item-container', dest_path);
        // the tab that made this move renders the row itself, in either order
        $dest_containers.find(`.item[data-uid='${fsentry.uid}']`).removeItems();

        // create new item on matching containers
        UIItem({
            appendTo: $dest_containers,
            immutable: fsentry.immutable || fsentry.writable === false,
            uid: fsentry.uid,
            path: fsentry.path,
            icon: moved_item_icon,
            name: fsentry.name,
            is_dir: fsentry.is_dir,
            size: fsentry.size,
            type: fsentry.type,
            modified: fsentry.modified,
            is_selected: false,
            is_shortcut: fsentry.is_shortcut,
            shortcut_to: fsentry.shortcut_to,
            shortcut_to_path: fsentry.shortcut_to_path,
            // has_website: $(el_item).attr('data-has_website') === '1',
            // Raw, as every other renderer stores it; re-encoding breaks restore.
            metadata: fsentry.metadata ?? '',
        });

        if ( fsentry.parent_dirs_created && fsentry.parent_dirs_created.length > 0 ) {
            // this operation may have created some missing directories,
            // see if any of the directories in the path of this file is new AND
            // if these new path have any open parents that need to be updated

            fsentry.parent_dirs_created.forEach(async dir => {
                let item_container = atPath('.item-container', path.dirname(dir.path));
                if ( item_container.length > 0 && atPath('.item', dir.path).length === 0 ) {
                    UIItem({
                        appendTo: item_container,
                        immutable: false,
                        uid: dir.uid,
                        path: dir.path,
                        icon: await item_icon(dir),
                        name: dir.name,
                        size: dir.size,
                        type: dir.type,
                        modified: dir.modified,
                        is_dir: true,
                        is_selected: false,
                        has_website: false,
                    });
                }
                window.sort_items(item_container, $(item_container).attr('data-sort_by'), $(item_container).attr('data-sort_order'));
            });
        }
        //sort each container
        atPath('.item-container', dest_path).each(function () {
            window.sort_items(this, $(this).attr('data-sort_by'), $(this).attr('data-sort_order'));
        });
    });

    window.socket.on('user.email_confirmed', (msg) => {
        // don't update if this is the original client that initiated the action
        if ( msg.original_client_socket_id === window.socket.id )
        {
            return;
        }

        window.refresh_user_data(window.auth_token);
    });

    window.socket.on('user.phone_verified', (msg) => {
        // don't update if this is the original client that initiated the action
        if ( msg.original_client_socket_id === window.socket.id )
        {
            return;
        }

        window.refresh_user_data(window.auth_token);
    });

    window.socket.on('user.card_verified', (msg) => {
        // don't update if this is the original client that initiated the action
        if ( msg.original_client_socket_id === window.socket.id )
        {
            return;
        }

        window.refresh_user_data(window.auth_token);
    });

    window.socket.on('user.email_changed', (msg) => {
        // don't update if this is the original client that initiated the action
        if ( msg.original_client_socket_id === window.socket.id )
        {
            return;
        }

        window.refresh_user_data(window.auth_token);
    });

    window.socket.on('item.renamed', async (item) => {
        // Notify all apps that are watching this item
        window.sendItemChangeEventToWatchingApps(item.uid, {
            event: 'rename',
            uid: item.uid,
            // path: item.path,
            new_name: item.name,
            // old_path: item.old_path,
        });

        // Don't update if this is the original client that initiated the action
        if ( item.original_client_socket_id === window.socket.id )
        {
            return;
        }

        // Update matching items
        // Set new item name
        $(`.item[data-uid='${html_encode(item.uid)}'] .item-name`).html(html_encode(truncate_filename(item.name)));

        // Set new icon
        const new_icon = (item.is_dir ? window.icons['folder.svg'] : (await item_icon(item)).image);
        $(`.item[data-uid='${item.uid}']`).find('.item-icon-icon').attr('src', new_icon);

        // Set new data-name. Attributes and form values are stored raw
        // (.attr()/.val() don't parse HTML), as rename_file writes them.
        $(`.item[data-uid='${item.uid}']`).attr('data-name', item.name);
        $(`.window-${item.uid}`).attr('data-name', item.name);

        // Set new title attribute
        $(`.item[data-uid='${item.uid}']`).attr('title', item.name);
        $(`.window-${item.uid}`).attr('title', item.name);

        // Set new value for item-name-editor
        $(`.item[data-uid='${item.uid}'] .item-name-editor`).val(item.name);
        $(`.item[data-uid='${item.uid}'] .item-name`).attr('title', item.name);

        // Set new data-path
        const new_path = item.path;
        $(`.item[data-uid='${item.uid}']`).attr('data-path', new_path);
        $(`.window-${item.uid}`).attr('data-path', new_path);

        retargetPaths(item.old_path, new_path, item.name);

        // Update all exact-matching windows
        $(`.window-${item.uid}`).each(function () {
            window.update_window_path(this, new_path);
        });
        // Set new name for matching open windows
        $(`.window-${item.uid} .window-head-title`).text(item.name);

        // Re-sort all matching item containers
        $(`.item[data-uid='${item.uid}']`).parent('.item-container').each(function () {
            window.sort_items(this, $(this).closest('.item-container').attr('data-sort_by'), $(this).closest('.item-container').attr('data-sort_order'));
        });
    });

    window.socket.on('item.added', async (item) => {
        // if item is empty, don't proceed
        if ( !item || Object.keys(item).length === 0 )
        {
            return;
        }

        // Notify all apps that are watching this item
        window.sendItemChangeEventToWatchingApps(item.uid, {
            event: 'write',
            uid: item.uid,
            // path: item.path,
            new_size: item.size,
            modified: item.modified,
            // old_path: item.old_path,
        });

        // Don't update if this is the original client that initiated the action
        if ( item.original_client_socket_id === window.socket.id )
        {
            return;
        }

        await apply_item_added_to_containers(item);
    });

    // Hidden file dialog
    h += `<form name="upload-form" id="upload-form" style="display:hidden;">
            <input type="hidden" name="name" id="upload-filename" value="">
            <input type="hidden" name="path" id="upload-target-path" value="">
            <input type="file" name="file" id="upload-file-dialog" style="display: none;" multiple="multiple">
        </form>`;

    h += '<div class="window-container"></div>';

    // The surface windows open on. It holds no items.
    h += '<div class="desktop disable-user-select"></div>';

    // Get window sidebar width
    puter.kv.get('window_sidebar_width').catch(() => null).then(async (val) => {
        let value = parseInt(val);
        // if value is a valid number
        if ( !isNaN(value) && value > 0 ) {
            window.window_sidebar_width = value;
        }
    });

    // load window sidebar items from KV
    puter.kv.get('sidebar_items').then(async (val) => {
        // UIWindow parses this and reads `item.path` while building every
        // explorer window, so a malformed value is dropped for the defaults.
        let items = null;
        try {
            items = JSON.parse(val);
        } catch { /* keep the defaults */ }
        if ( Array.isArray(items) && items.every(item => typeof item?.path === 'string') ) {
            window.sidebar_items = val;
        }
    // Catch on the chain rather than the read, so a failure leaves whatever is
    // already there instead of overwriting it with a fallback.
    }).catch(err => console.warn('Could not load sidebar_items:', err));

    // Remove `?ref=...` from navbar URL, keeping the current path
    if ( window.url_query_params.has('ref') ) {
        window.history.pushState(null, document.title, window.location.pathname);
    }

    await window.load_user_preferences();

    // Append to <body>
    $('body').append(h);

    const el_desktop = document.querySelector('.desktop');

    window.active_element = el_desktop;

    // The desktop has no menu of its own, and the browser's doesn't belong here.
    $(el_desktop).on('contextmenu', function (event) {
        if ( event.target === el_desktop ) event.preventDefault();
    });

    if ( !window.is_embedded && !window.is_fullpage_mode ) {
        transaction.end();

        // warm the home directory listing for the first Explorer window
        puter.fs.readdir({ path: window.home_path, consistency: 'strong' });
    }

    // notification container
    $('body').append(`<div class="notification-container"><div class="notifications-close-all">${i18n('close_all')}</div></div>`);

    // track: checkpoint
    //-----------------------------
    // GUI is ready to launch apps!
    //-----------------------------
    window.dispatchEvent(new CustomEvent('desktop:ready'));
    globalThis.services.emit('gui:ready');

    //--------------------------------------------------------------------------------------
    // Determine if an app was launched from URL
    // i.e. https://puter.com/app/<app_name>
    //--------------------------------------------------------------------------------------
    if ( window.url_paths[0]?.toLocaleLowerCase() === 'app' && window.url_paths[1] ) {
        // If app metadata was already fetched early (for fullpage detection), reuse it
        if ( !window.app_launched_from_url?.name ) {
            window.app_launched_from_url = window.url_paths[1];
            // get app metadata
            try {
                window.app_launched_from_url = await puter.apps.get(window.url_paths[1], { icon_size: 64 });
                window.is_fullpage_mode = window.app_launched_from_url.metadata?.fullpage_on_landing ?? window.is_fullpage_mode ?? false;
            } catch (e) {
                console.error('UIDesktop app path launch error', e);
            }
        }

        // get query params, any param that doesn't start with 'puter.' will be passed to the app
        window.app_query_params = {};
        for ( let [key, value] of window.url_query_params ) {
            if ( ! key.startsWith('puter.') )
            {
                window.app_query_params[key] = value;
            }
        }
    }
    // ---------------------------------------------
    // load from direct app URLs: /app/app-name
    // ---------------------------------------------
    if ( window.app_launched_from_url ) {
        if ( ! window.url_query_params.has('c') ) {
            let posargs = undefined;
            if ( window.app_query_params && window.app_query_params.posargs ) {
                posargs = JSON.parse(window.app_query_params.posargs);
            }
            // `?file=<path or uid>` opens that file with the app, the same as
            // double-clicking it would — but the link picked both, so the user
            // is asked before the app is given the file.
            launch_app({
                app: window.app_launched_from_url.name,
                app_obj: window.app_launched_from_url,
                readURL: window.url_query_params.get('readURL'),
                maximized: window.url_query_params.get('maximized'),
                params: window.app_query_params ?? [],
                ...urlFileLaunchOptions(window.url_query_params.get('file')),
                ...(posargs ? {
                    args: {
                        command_line: { args: posargs },
                    },
                } : {}),
                is_fullpage: window.is_fullpage_mode,
                window_options: {
                    stay_on_top: false,
                },
            });
        }
    }

    $(el_desktop).on('mousedown touchstart', { passive: true }, function (e) {
        // dimiss touchstart on regular devices
        if ( e.type === 'taphold' && !isMobile.phone && !isMobile.tablet )
        {
            return;
        }

        $('.window-app-iframe').css('pointer-events', 'none');
        $('.window').find('.item-selected').addClass('item-blurred');
        // Keyboard shortcuts act on the active container, and a click here leaves every window's.
        window.active_item_container = null;
    });

    $(el_desktop).on('click', function () {
        // blur all windows
        $('.window-active').removeClass('window-active');
    });

    /**
     * Open a path as double-clicking would: the associated app for a file, an
     * explorer window for a directory.
     *
     * TODO: DRY with open_item, which is coupled to a UIItem element and can't
     *       operate on a path alone.
     */
    async function open_path_target (item_path, stat) {
        if ( ! stat.is_dir ) {
            if ( stat.associated_app ) {
                launch_app({ name: stat.associated_app.name });
                return;
            }

            const default_app = await resolve_default_app({ uid: stat.uid, path: item_path });
            if ( default_app ) {
                launch_app({
                    name: default_app.name,
                    app_obj: default_app,
                    file_path: item_path,
                });
                return;
            }

            const open_item_meta = await $.ajax({
                url: `${window.api_origin }/open_item`,
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    path: item_path,
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
            const suggested_apps = open_item_meta?.suggested_apps ?? await window.suggest_apps_for_fsentry({
                path: item_path,
            });

            // Note: I'm not adding unzipping logic here. We'll wait until
            //       we've refactored open_item so that Puter can have a
            //       properly-reusable open function.
            if ( suggested_apps.length !== 0 ) {
                launch_app({
                    name: suggested_apps[0].name,
                    token: open_item_meta.token,
                    file_path: item_path,
                    app_obj: suggested_apps[0],
                    window_title: path.basename(item_path),
                    file_signature: open_item_meta.signature,
                    custom_path: window.location.pathname,
                });
                return;
            }

            await UIAlert({
                message: 'Cannot find an app to open this file; ' +
                    'opening directory instead.',
            });
            item_path = item_path.split('/').slice(0, -1).join('/');
        }

        UIWindow({
            path: item_path,
            title: path.basename(item_path),
            icon: await item_icon({ is_dir: true, path: item_path }),
            is_dir: true,
            app: 'explorer',
        });
    }

    /** Open an item somebody shared, addressed as `/<owner>/<uuid>/<name>`. */
    async function open_shared_item (shared_path) {
        const stat = await resolve_shared_item(puter.fs, shared_path);
        if ( ! stat ) {
            UIAlert({
                message: i18n('error_user_or_path_not_found'),
                type: 'error',
            });
            return false;
        }

        // `stat` returns the path this viewer may use, which is the one to open.
        await open_path_target(stat.path ?? shared_path, stat);
        return true;
    }
}

window.enter_fullpage_mode = (el_window) => {
    $(el_window).find('.window-head').hide();
    $('body').addClass('fullpage-mode');
    $(el_window).css({
        width: '100%',
        height: '100%',
        top: 0,
        left: 0,
        'border-radius': 0,
    });
};

window.exit_fullpage_mode = (el_window) => {
    $('body').removeClass('fullpage-mode');
    $(el_window).removeAttr('data-is_fullpage');
    if ( el_window ) {
        window.reset_window_size_and_position(el_window);
        $(el_window).find('.window-head').show();
    }
};

window.reset_window_size_and_position = (el_window) => {
    $(el_window).css({
        width: 680,
        height: 380,
        'border-radius': window.window_border_radius,
        top: 'calc(50% - 190px)',
        left: 'calc(50% - 340px)',
    });
};

export default UIDesktop;
