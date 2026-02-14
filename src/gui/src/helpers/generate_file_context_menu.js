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

import UIAlert from '../UI/UIAlert.js';
import UIWindowShare from '../UI/UIWindowShare.js';
import UIWindowPublishWebsite from '../UI/UIWindowPublishWebsite.js';
import UIWindowItemProperties from '../UI/UIWindowItemProperties.js';
import UIWindowSaveAccount from '../UI/UIWindowSaveAccount.js';
import UIWindowEmailConfirmationRequired from '../UI/UIWindowEmailConfirmationRequired.js';
import UIWindowPublishWorker from '../UI/UIWindowPublishWorker.js';
import open_item from './open_item.js';
import launch_app from './launch_app.js';
import path from '../lib/path.js';
import mime from '../lib/mime.js';

const AI_APP_NAME = 'ai';

/**
 * Parses item metadata for AI payload
 * @param {string} metadata - JSON string of metadata
 * @returns {Object|undefined} Parsed metadata or undefined
 */
const parseItemMetadataForAI = (metadata) => {
    if ( ! metadata ) {
        return undefined;
    }
    try {
        return JSON.parse(metadata);
    } catch ( error ) {
        console.warn('Failed to parse item metadata for AI payload.', error);
        return undefined;
    }
};

/**
 * Builds AI payload from item elements
 * @param {jQuery} $elements - jQuery collection of elements
 * @returns {Array} Array of item data for AI
 */
const buildAIPayloadFromItems = ($elements) => {
    return $elements.get().map((element) => {
        const $element = $(element);
        return {
            uid: $element.attr('data-uid'),
            path: $element.attr('data-path'),
            name: $element.attr('data-name'),
            is_dir: $element.attr('data-is_dir') === '1',
            is_shortcut: $element.attr('data-is_shortcut') === '1',
            shortcut_to: $element.attr('data-shortcut_to') || undefined,
            shortcut_to_path: $element.attr('data-shortcut_to_path') || undefined,
            size: $element.attr('data-size') || undefined,
            type: $element.attr('data-type') || undefined,
            modified: $element.attr('data-modified') || undefined,
            metadata: parseItemMetadataForAI($element.attr('data-metadata')),
        };
    });
};

/**
 * Ensures AI app iframe is available
 * @returns {Promise<HTMLIFrameElement|null>} AI app iframe or null
 */
const ensureAIAppIframe = async () => {
    let $aiWindow = $(`.window[data-app="${AI_APP_NAME}"]`);
    if ( $aiWindow.length === 0 ) {
        try {
            await launch_app({ name: AI_APP_NAME });
        } catch ( error ) {
            console.error('Failed to launch AI app.', error);
            return null;
        }
        $aiWindow = $(`.window[data-app="${AI_APP_NAME}"]`);
    }

    if ( $aiWindow.length === 0 ) {
        return null;
    }

    $aiWindow.makeWindowVisible();
    const iframe = $aiWindow.find('.window-app-iframe').get(0);
    return iframe ?? null;
};

/**
 * Sends selection to AI app
 * @param {jQuery} $elements - jQuery collection of elements
 */
const sendSelectionToAIApp = async ($elements) => {
    const items = buildAIPayloadFromItems($elements);
    if ( items.length === 0 ) {
        return;
    }

    const aiIframe = await ensureAIAppIframe();
    if ( !aiIframe || !aiIframe.contentWindow ) {
        await UIAlert({
            message: i18n('ai_app_unavailable'),
        });
        return;
    }

    aiIframe.contentWindow.postMessage({
        msg: 'ai:openFsEntries',
        items,
        source: 'desktop-context-menu',
    }, '*');
};

/**
 * Generates context menu items for file/folder operations
 *
 * @param {Object} options - Configuration options
 * @param {HTMLElement} options.element - The DOM element representing the file/folder
 * @param {Object} options.fsentry - File system entry data (uid, path, name, is_dir, etc.)
 * @param {boolean} options.is_trash - Whether this is the trash folder
 * @param {boolean} options.is_trashed - Whether item is in trash
 * @param {Array} options.suggested_apps - Optional pre-loaded suggested apps
 * @param {string} options.associated_app_name - Optional associated app
 * @param {Function} options.onOpen - Optional custom open handler (used by Dashboard)
 * @returns {Promise<Array>} Array of context menu items
 */
const generate_file_context_menu = async function (options) {
    options = options || {};

    const el_item = options.element;
    const fsentry = options.fsentry || {};
    const is_trash = options.is_trash ?? false;
    const is_trashed = options.is_trashed ?? false;
    const is_worker = options.is_worker ?? false;
    const onOpen = options.onOpen;

    const is_shared_with_me = (fsentry.path !== `/${window.user.username}` && !fsentry.path.startsWith(`/${window.user.username}/`));

    let menu_items = [];

    // -------------------------------------------
    // Open
    // -------------------------------------------
    if ( ! is_trashed ) {
        menu_items.push({
            html: i18n('open'),
            onClick: () => {
                if ( onOpen ) {
                    onOpen(el_item, fsentry);
                } else {
                    open_item({ item: el_item });
                }
            },
        });

        // -------------------------------------------
        // Separator
        // -------------------------------------------
        if ( options.associated_app_name || is_trash ) {
            menu_items.push('-');
        }
    }

    // -------------------------------------------
    // Open With
    // -------------------------------------------
    if ( !is_trashed && !is_trash && (options.associated_app_name === null || options.associated_app_name === undefined) ) {
        const openWithItems = await generateOpenWithItems(el_item, fsentry, options.suggested_apps);
        menu_items.push({
            html: i18n('open_with'),
            items: openWithItems,
        });

        menu_items.push('-');
    }

    // -------------------------------------------
    // Open in New Window
    // (only if the item is on a window)
    // -------------------------------------------
    if ( $(el_item).closest('.window-body').length > 0 && fsentry.is_dir ) {
        menu_items.push({
            html: i18n('open_in_new_window'),
            onClick: function () {
                if ( fsentry.is_dir ) {
                    open_item({ item: el_item, new_window: true });
                }
            },
        });

        // -------------------------------------------
        // Separator
        // -------------------------------------------
        if ( !is_trash && !is_trashed && fsentry.is_dir ) {
            menu_items.push('-');
        }
    }

    // -------------------------------------------
    // Share With…
    // -------------------------------------------
    if ( !is_trashed && !is_trash ) {
        menu_items.push({
            html: i18n('Share With…'),
            onClick: async function () {
                if ( window.user.is_temp &&
                    !await UIWindowSaveAccount({
                        send_confirmation_code: true,
                        message: 'Please create an account to proceed.',
                        window_options: {
                            backdrop: true,
                            close_on_backdrop_click: false,
                        },
                    }) ) {
                    return;
                }
                else if ( !window.user.email_confirmed && !await UIWindowEmailConfirmationRequired() ) {
                    return;
                }

                const icon = $(el_item).find('.icon img').attr('src') || $(el_item).find('img').attr('src');
                UIWindowShare([{
                    uid: $(el_item).attr('data-uid'),
                    path: $(el_item).attr('data-path'),
                    name: $(el_item).attr('data-name'),
                    icon: icon,
                }]);
            },
        });

        // -------------------------------------------
        // Open in AI
        // -------------------------------------------
        menu_items.push({
            html: i18n('open_in_ai'),
            onClick: async function () {
                await sendSelectionToAIApp($(el_item));
            },
        });
    }

    // -------------------------------------------
    // Publish As Website
    // -------------------------------------------
    if ( !is_trashed && !is_trash && fsentry.is_dir ) {
        menu_items.push({
            html: i18n('publish_as_website'),
            disabled: !fsentry.is_dir || fsentry.has_website,
            onClick: async function () {
                if ( window.require_email_verification_to_publish_website ) {
                    if ( window.user.is_temp &&
                        !await UIWindowSaveAccount({
                            send_confirmation_code: true,
                            message: 'Please create an account to proceed.',
                            window_options: {
                                backdrop: true,
                                close_on_backdrop_click: false,
                            },
                        }) ) {
                        return;
                    }
                    else if ( !window.user.email_confirmed && !await UIWindowEmailConfirmationRequired() ) {
                        return;
                    }
                }
                UIWindowPublishWebsite(fsentry.uid, $(el_item).attr('data-name'), $(el_item).attr('data-path'));
            },
        });
    }

    // -------------------------------------------
    // Publish as Worker
    // -------------------------------------------
    if ( !is_trashed && !is_trash && !fsentry.is_dir && $(el_item).attr('data-name').toLowerCase().endsWith('.js') ) {
        menu_items.push({
            html: i18n('publish_as_serverless_worker'),
            disabled: is_worker,
            onClick: async function () {
                if ( window.user.is_temp &&
                    !await UIWindowSaveAccount({
                        send_confirmation_code: true,
                        message: 'Please create an account to proceed.',
                        window_options: {
                            backdrop: true,
                            close_on_backdrop_click: false,
                        },
                    }) ) {
                    return;
                }
                else if ( !window.user.email_confirmed && !await UIWindowEmailConfirmationRequired() ) {
                    return;
                }

                UIWindowPublishWorker(fsentry.uid, $(el_item).attr('data-name'), $(el_item).attr('data-path'));
            },
        });
    }

    // -------------------------------------------
    // Deploy As App
    // -------------------------------------------
    if ( !is_trashed && !is_trash && fsentry.is_dir ) {
        menu_items.push({
            html: i18n('deploy_as_app'),
            disabled: !fsentry.is_dir,
            onClick: async function () {
                launch_app({
                    name: 'dev-center',
                    file_path: $(el_item).attr('data-path'),
                    file_uid: $(el_item).attr('data-uid'),
                    params: {
                        source_path: fsentry.path,
                    },
                });
            },
        });

        menu_items.push('-');
    }

    // -------------------------------------------
    // Empty Trash
    // -------------------------------------------
    if ( is_trash ) {
        menu_items.push({
            html: i18n('empty_trash'),
            onClick: async function () {
                window.empty_trash();
            },
        });
    }

    // -------------------------------------------
    // Download
    // -------------------------------------------
    if ( !is_trash && !is_trashed && (options.associated_app_name === null || options.associated_app_name === undefined) ) {
        menu_items.push({
            html: i18n('download'),
            disabled: fsentry.is_dir && !window.feature_flags.download_directory,
            onClick: async function () {
                if ( fsentry.is_dir ) {
                    window.zipItems(el_item, path.dirname($(el_item).attr('data-path')), true);
                }
                else {
                    window.trigger_download([fsentry.path]);
                }
            },
        });
    }

    // -------------------------------------------
    // Set as Wallpaper
    // -------------------------------------------
    const mime_type = mime.getType($(el_item).attr('data-name')) ?? 'application/octet-stream';
    if ( !window.dashboard_object && !is_trashed && !is_trash && !fsentry.is_dir && mime_type.startsWith('image/') ) {
        menu_items.push({
            html: i18n('set_as_background'),
            onClick: async function () {
                const read_url = await puter.fs.sign(undefined, { uid: $(el_item).attr('data-uid'), action: 'read' });
                window.set_desktop_background({
                    url: read_url.items.read_url,
                    fit: window.desktop_bg_fit,
                });
                try {
                    $.ajax({
                        url: `${window.api_origin}/set-desktop-bg`,
                        type: 'POST',
                        data: JSON.stringify({
                            url: window.desktop_bg_url,
                            color: window.desktop_bg_color,
                            fit: window.desktop_bg_fit,
                        }),
                        async: true,
                        contentType: 'application/json',
                        headers: {
                            'Authorization': `Bearer ${window.auth_token}`,
                        },
                        statusCode: {
                            401: function () {
                                window.logout();
                            },
                        },
                    });
                } catch ( err ) {
                    // Ignore
                }
            },
        });
    }

    // -------------------------------------------
    // Zip
    // -------------------------------------------
    if ( !is_trash && !is_trashed && !$(el_item).attr('data-path').endsWith('.zip') ) {
        menu_items.push({
            html: i18n('zip'),
            onClick: function () {
                window.zipItems(el_item, path.dirname($(el_item).attr('data-path')), false);
            },
        });
    }

    // -------------------------------------------
    // Unzip
    // -------------------------------------------
    if ( !is_trash && !is_trashed && $(el_item).attr('data-path').endsWith('.zip') ) {
        menu_items.push({
            html: i18n('unzip'),
            onClick: async function () {
                let filePath = $(el_item).attr('data-path');
                window.unzipItem(filePath);
            },
        });
    }

    // -------------------------------------------
    // Tar
    // -------------------------------------------
    if ( !is_trash && !is_trashed && !$(el_item).attr('data-path').endsWith('.tar') ) {
        menu_items.push({
            html: i18n('tar'),
            onClick: function () {
                window.tarItems(el_item, path.dirname($(el_item).attr('data-path')), false);
            },
        });
    }

    // -------------------------------------------
    // Untar
    // -------------------------------------------
    if ( !is_trash && !is_trashed && $(el_item).attr('data-path').endsWith('.tar') ) {
        menu_items.push({
            html: i18n('untar'),
            onClick: async function () {
                let filePath = $(el_item).attr('data-path');
                window.untarItem(filePath);
            },
        });
    }

    // -------------------------------------------
    // Restore
    // -------------------------------------------
    if ( is_trashed ) {
        menu_items.push({
            html: i18n('restore'),
            onClick: async function () {
                await options.onRestore(el_item);
            },
        });
    }

    // -------------------------------------------
    // Separator
    // -------------------------------------------
    if ( !is_trash && (options.associated_app_name === null || options.associated_app_name === undefined) ) {
        menu_items.push('-');
    }

    // -------------------------------------------
    // Cut
    // -------------------------------------------
    if ( $(el_item).attr('data-immutable') === '0' && !is_shared_with_me ) {
        menu_items.push({
            html: i18n('cut'),
            onClick: function () {
                window.clipboard_op = 'move';
                window.clipboard = [fsentry.path];
            },
        });
    }

    // -------------------------------------------
    // Copy
    // -------------------------------------------
    if ( !is_trashed && !is_trash ) {
        menu_items.push({
            html: i18n('copy'),
            onClick: function () {
                window.clipboard_op = 'copy';
                window.clipboard = [{ path: fsentry.path }];
            },
        });
    }

    // -------------------------------------------
    // Paste Into Folder
    // -------------------------------------------
    if ( $(el_item).attr('data-is_dir') === '1' && !is_trashed && !is_trash ) {
        menu_items.push({
            html: i18n('paste_into_folder'),
            disabled: window.clipboard.length > 0 ? false : true,
            onClick: function () {
                if ( window.clipboard_op === 'copy' ) {
                    window.copy_clipboard_items($(el_item).attr('data-path'), null);
                }
                else if ( window.clipboard_op === 'move' ) {
                    window.move_clipboard_items(null, $(el_item).attr('data-path'));
                }
            },
        });
    }

    // -------------------------------------------
    // Separator
    // -------------------------------------------
    if ( $(el_item).attr('data-immutable') === '0' && !is_trash ) {
        menu_items.push('-');
    }

    // -------------------------------------------
    // Create Shortcut
    // -------------------------------------------
    if ( !is_trashed && window.feature_flags.create_shortcut ) {
        menu_items.push({
            html: is_shared_with_me ? i18n('create_desktop_shortcut') : i18n('create_shortcut'),
            onClick: async function () {
                let base_dir = path.dirname($(el_item).attr('data-path'));
                // Trash on Desktop is a special case
                if ( $(el_item).attr('data-path') && $(el_item).closest('.item-container').attr('data-path') === window.desktop_path ) {
                    base_dir = window.desktop_path;
                }

                if ( is_shared_with_me ) base_dir = window.desktop_path;

                window.create_shortcut(path.basename($(el_item).attr('data-path')),
                                fsentry.is_dir,
                                base_dir,
                                null, // appendTo - will be determined by create_shortcut
                                fsentry.shortcut_to === '' ? fsentry.uid : fsentry.shortcut_to,
                                fsentry.shortcut_to_path === '' ? fsentry.path : fsentry.shortcut_to_path);
            },
        });
    }

    // -------------------------------------------
    // Delete
    // -------------------------------------------
    if ( $(el_item).attr('data-immutable') === '0' && !is_trashed && !is_shared_with_me ) {
        menu_items.push({
            html: i18n('delete'),
            onClick: async function () {
                await window.move_items([el_item], window.trash_path);
            },
        });
    }

    // -------------------------------------------
    // Delete Permanently
    // -------------------------------------------
    if ( is_trashed ) {
        menu_items.push({
            html: i18n('delete_permanently'),
            onClick: async function () {
                const alert_resp = await UIAlert({
                    message: i18n('confirm_delete_single_item'),
                    buttons: [
                        {
                            label: i18n('delete'),
                            type: 'primary',
                        },
                        {
                            label: i18n('cancel'),
                        },
                    ],
                });

                if ( (alert_resp) === 'Delete' ) {
                    await window.delete_item(el_item);
                    // check if trash is empty
                    const trash = await puter.fs.stat({ path: window.trash_path, consistency: 'eventual' });
                    // update other clients
                    if ( window.socket ) {
                        window.socket.emit('trash.is_empty', { is_empty: trash.is_empty });
                    }
                    // update this client
                    if ( trash.is_empty ) {
                        $(`.item[data-path="${window.trash_path}" i], .item[data-shortcut_to_path="${window.trash_path}" i]`).find('.item-icon > img').attr('src', window.icons['trash.svg']);
                        $(`.window[data-path="${window.trash_path}"]`).find('.window-head-icon').attr('src', window.icons['trash.svg']);
                    }
                }
            },
        });
    }

    // -------------------------------------------
    // Rename
    // -------------------------------------------
    if ( $(el_item).attr('data-immutable') === '0' && !is_trashed && !is_trash ) {
        menu_items.push({
            html: i18n('rename'),
            onClick: function () {
                window.activate_item_name_editor(el_item);
            },
        });
    }

    // -------------------------------------------
    // Separator
    // -------------------------------------------
    menu_items.push('-');

    // -------------------------------------------
    // Properties
    // -------------------------------------------
    menu_items.push({
        html: i18n('properties'),
        onClick: function () {
            let window_height = 500;
            let window_width = 450;

            let left = $(el_item).position().left + $(el_item).width();
            left = left > (window.innerWidth - window_width) ? (window.innerWidth - window_width) : left;

            let top = $(el_item).position().top + $(el_item).height();
            top = top > (window.innerHeight - (window_height + window.taskbar_height + window.toolbar_height)) ? (window.innerHeight - (window_height + window.taskbar_height + window.toolbar_height)) : top;

            UIWindowItemProperties($(el_item).attr('data-name'),
                            $(el_item).attr('data-path'),
                            $(el_item).attr('data-uid'),
                            left,
                            top,
                            window_width,
                            window_height);
        },
    });

    return menu_items;
};

/**
 * Generates "Open With" menu items for a file
 *
 * @param {HTMLElement} el_item - The DOM element representing the file
 * @param {Object} fsentry - File system entry data
 * @param {Array} suggested_apps - Optional pre-loaded suggested apps
 * @returns {Promise<Array>} Array of menu items for "Open With" submenu
 */
async function generateOpenWithItems (el_item, fsentry, suggested_apps) {
    let items = [];

    // Try to find suitable apps if not provided
    if ( !suggested_apps || suggested_apps.length === 0 ) {
        const suitable_apps = await window.suggest_apps_for_fsentry({
            uid: fsentry.uid,
            path: fsentry.path,
        });
        if ( suitable_apps && suitable_apps.length > 0 ) {
            suggested_apps = suitable_apps;
        }
    }

    if ( suggested_apps && suggested_apps.length > 0 ) {
        for ( let index = 0; index < suggested_apps.length; index++ ) {
            const suggested_app = suggested_apps[index];
            if ( ! suggested_app ) {
                console.warn('suggested_app is null', suggested_apps, index);
                continue;
            }
            items.push({
                html: suggested_app.title,
                icon: `<img src="${html_encode(suggested_app.icon ?? window.icons['app.svg'])}" style="width:16px; height: 16px; margin-bottom: -4px;">`,
                onClick: async function () {
                    var extension = path.extname($(el_item).attr('data-path')).toLowerCase();
                    if (
                        window.user_preferences[`default_apps${extension}`] !== suggested_app.name
                        &&
                        (
                            (!window.user_preferences[`default_apps${extension}`] && index > 0)
                            ||
                            (window.user_preferences[`default_apps${extension}`])
                        )
                    ) {
                        const alert_resp = await UIAlert({
                            message: `${i18n('change_always_open_with')} ${html_encode(suggested_app.title)}?`,
                            body_icon: suggested_app.icon,
                            buttons: [
                                {
                                    label: i18n('yes'),
                                    type: 'primary',
                                    value: 'yes',
                                },
                                {
                                    label: i18n('no'),
                                },
                            ],
                        });
                        if ( (alert_resp) === 'yes' ) {
                            window.user_preferences[`default_apps${extension}`] = suggested_app.name;
                            window.mutate_user_preferences(window.user_preferences);
                        }
                    }
                    launch_app({
                        name: suggested_app.name,
                        file_path: $(el_item).attr('data-path'),
                        window_title: $(el_item).attr('data-name'),
                        file_uid: $(el_item).attr('data-uid'),
                    });
                },
            });
        }
    } else {
        items.push({
            html: i18n('no_suitable_apps_found'),
            disabled: true,
        });
    }

    return items;
}

export default generate_file_context_menu;
