import UIWindowShare from '../UIWindowShare.js';
import UIWindowPublishWebsite from '../UIWindowPublishWebsite.js';
import UIWindowItemProperties from '../UIWindowItemProperties.js';
import UIWindowSaveAccount from '../UIWindowSaveAccount.js';
import UIWindowEmailConfirmationRequired from '../UIWindowEmailConfirmationRequired.js';
import UIAlert from '../UIAlert.js'
import path from "../../lib/path.js"
import launch_app from "../../helpers/launch_app.js"
import open_item from "../../helpers/open_item.js"

export const add_common_select_menu_items = (menu_items, {
    $selected_items,
    is_shared_with_me,
}) => {
    const are_trashed = $selected_items.attr('data-path').startsWith(window.trash_path + '/');
    const plural = $selected_items.length > 1;

    if(!are_trashed && window.feature_flags.create_shortcut){
        menu_items.push({
            html: is_shared_with_me
                ? i18n('create_desktop_shortcut' + (plural ? '_s' : ''))
                : i18n('create_shortcut' + (plural ? '_s' : '')),
            onClick: async function(){
                $selected_items.each(function() {
                    let base_dir = path.dirname($(this).attr('data-path'));
                    // Trash on Desktop is a special case
                    if($(this).attr('data-path') && $(this).closest('.item-container').attr('data-path') === window.desktop_path){
                        base_dir = window.desktop_path;
                    }
                    if ( is_shared_with_me ) base_dir = window.desktop_path;
                    // create shortcut
                    window.create_shortcut(
                        path.basename($(this).attr('data-path')), 
                        $(this).attr('data-is_dir') === '1', 
                        base_dir, 
                        $(this).closest('.item-container'), 
                        $(this).attr('data-shortcut_to') === '' ? $(this).attr('data-uid') : $(this).attr('data-shortcut_to'),
                        $(this).attr('data-shortcut_to_path') === '' ? $(this).attr('data-path') : $(this).attr('data-shortcut_to_path'),
                    );
                })
            }
        });
    }
};

export const add_multiple_select_menu_items = (menu_items, {
    $selected_items,
    el_item,
    is_shared_with_me,
}) => {
    const are_trashed = $selected_items.attr('data-path').startsWith(window.trash_path + '/');
    // -------------------------------------------
    // Restore
    // -------------------------------------------
    if(are_trashed){
        menu_items.push({
            html: i18n('restore'),
            onClick: function(){
                $selected_items.each(function() {
                    const ell = this;
                    let metadata = $(ell).attr('data-metadata') === '' ? {} : JSON.parse($(ell).attr('data-metadata'))
                    window.move_items([ell], path.dirname(metadata.original_path));
                })
            }
        });
        // -------------------------------------------
        // -
        // -------------------------------------------
        menu_items.push('-');
    }
    if(!are_trashed){
        menu_items.push({
            html: i18n('Share With…'),
            onClick: async function(){
                if(window.user.is_temp && 
                    !await UIWindowSaveAccount({
                        send_confirmation_code: true,
                        message: 'Please create an account to proceed.',
                        window_options: {
                            backdrop: true,
                            close_on_backdrop_click: false,
                        }                                
                    }))
                    return;
                else if(!window.user.email_confirmed && !await UIWindowEmailConfirmationRequired())
                    return;

                let items = [];
                $selected_items.each(function() {
                    const ell = this;
                    items.push({uid: $(ell).attr('data-uid'), path: $(ell).attr('data-path'), icon: $(ell).find('.item-icon img').attr('src'), name: $(ell).attr('data-name')});
                })
                UIWindowShare(items);
            }
        })
        // -------------------------------------------
        // -
        // -------------------------------------------
        menu_items.push({ is_divider: true });

        // -------------------------------------------
        // Donwload
        // -------------------------------------------
        menu_items.push({
            html: i18n('download'),
            onClick: async function(){
                let items = [];
                for (let index = 0; index < $selected_items.length; index++) {
                    items.push($selected_items[index]);
                }

                window.zipItems(items, path.dirname($(el_item).attr('data-path')), true);
            }
        });
        // -------------------------------------------
        // Zip
        // -------------------------------------------
        menu_items.push({
            html: i18n('zip'),
            onClick: async function(){
                let items = [];
                for (let index = 0; index < $selected_items.length; index++) {
                    items.push($selected_items[index]);
                }

                window.zipItems(items, path.dirname($(el_item).attr('data-path')), false);
            }
        });
        // -------------------------------------------
        // -
        // -------------------------------------------
        menu_items.push('-');
    }
    // -------------------------------------------
    // Cut
    // -------------------------------------------
    menu_items.push({
        html: i18n('cut'),
        onClick: function(){
            window.clipboard_op= 'move';
            window.clipboard = [];
            $selected_items.each(function() {
                const ell = this;
                window.clipboard.push($(ell).attr('data-path'));
            })
        }
    });
    // -------------------------------------------
    // Copy
    // -------------------------------------------
    if(!are_trashed){
        menu_items.push({
            html: i18n('copy'),
            onClick: function(){
                window.clipboard_op= 'copy';
                window.clipboard = [];
                $selected_items.each(function() {
                    const ell = this;
                    window.clipboard.push({path: $(ell).attr('data-path')});
                })
            }
        });
    }
    // -------------------------------------------
    // -
    // -------------------------------------------
    menu_items.push('-');
    // -------------------------------------------
    // Delete Permanently
    // -------------------------------------------
    if(are_trashed){
        menu_items.push({
            html: i18n('delete_permanently'),
            onClick: async function(){
                const alert_resp = await UIAlert({
                    message: i18n('confirm_delete_multiple_items'),
                    buttons:[
                        {
                            label: i18n('delete'),
                            type: 'primary',
                        },
                        {
                            label: i18n('cancel')
                        },
                    ]
                })
                if((alert_resp) === 'Delete'){
                    for (let index = 0; index < $selected_items.length; index++) {
                        const element = $selected_items[index];
                        await window.delete_item(element);
                    }
                    const trash = await puter.fs.stat(window.trash_path);

                    // update other clients
                    if(window.socket){
                        window.socket.emit('trash.is_empty', {is_empty: trash.is_empty});
                    }

                    if(trash.is_empty){
                        $(`.item[data-path="${html_encode(window.trash_path)}" i], .item[data-shortcut_to_path="${window.trash_path}" i]`).find('.item-icon > img').attr('src', window.icons['trash.svg']);
                        $(`.window[data-path="${html_encode(window.trash_path)}"]`).find('.window-head-icon').attr('src', window.icons['trash.svg']);
                    }            
                }
            }
        });
    }
    // -------------------------------------------
    // Delete
    // -------------------------------------------
    if(!are_trashed){
        menu_items.push({
            html: i18n('delete'),
            onClick: async function(){
                window.move_items($selected_items, window.trash_path);
            }
        });
    }
};

export const add_single_select_menu_items = async (menu_items, {
    options,
    el_item,
    is_trashed,
    is_shared_with_me,
    el_item_icon,
}) => {
    const is_trash = $(el_item).attr('data-path') === window.trash_path || $(el_item).attr('data-shortcut_to_path') === window.trash_path;
    // -------------------------------------------
    // Open
    // -------------------------------------------
    if(!is_trashed){
        menu_items.push({
            html: i18n('open'),
            onClick: function(){
                open_item({item: el_item});
            }
        });

        // -------------------------------------------
        // -
        // -------------------------------------------
        if(options.associated_app_name || is_trash)
            menu_items.push('-');
    }
    // -------------------------------------------
    // Open With
    // -------------------------------------------
    if(!is_trashed && !is_trash  && (options.associated_app_name === null || options.associated_app_name === undefined)){
        let items = [];
        if(!options.suggested_apps || options.suggested_apps.length === 0){
            // try to find suitable apps
            const suitable_apps = await window.suggest_apps_for_fsentry({
                uid: options.uid,
                path: options.path,
            });
            if(suitable_apps && suitable_apps.length > 0){
                options.suggested_apps = suitable_apps;
            }
        }

        if(options.suggested_apps && options.suggested_apps.length > 0){
            for (let index = 0; index < options.suggested_apps.length; index++) {
                const suggested_app = options.suggested_apps[index];
                if ( ! suggested_app ) {
                    console.warn(`suggested_app is null`, options.suggested_apps, index);
                    continue;
                }
                items.push({
                    html: suggested_app.title,
                    icon: `<img src="${html_encode(suggested_app.icon ?? window.icons['app.svg'])}" style="width:16px; height: 16px; margin-bottom: -4px;">`,
                    onClick: async function(){
                        var extension = path.extname($(el_item).attr('data-path')).toLowerCase();
                        if(
                            window.user_preferences[`default_apps${extension}`] !== suggested_app.name
                            && 
                            (
                                (!window.user_preferences[`default_apps${extension}`] && index > 0)
                                || 
                                (window.user_preferences[`default_apps${extension}`])
                            )
                        ){
                            const alert_resp = await UIAlert({
                                message: `${i18n('change_always_open_with')} ` + html_encode(suggested_app.title) + '?',
                                body_icon: suggested_app.icon,
                                buttons:[
                                    {
                                        label: i18n('yes'),
                                        type: 'primary',
                                        value: 'yes'
                                    },
                                    {
                                        label: i18n('no')
                                    },
                                ]
                            })
                            if((alert_resp) === 'yes'){
                                window.user_preferences['default_apps' + extension] = suggested_app.name;
                                window.mutate_user_preferences(window.user_preferences);
                            }
                        }
                        launch_app({
                            name: suggested_app.name,
                            file_path: $(el_item).attr('data-path'),
                            window_title: $(el_item).attr('data-name'),
                            file_uid: $(el_item).attr('data-uid'),
                        });
                    }
                })
            }
        }else{                    
            items.push({
                html: 'No suitable apps found',
                disabled: true,
            });
        }
        // add all suitable apps
        menu_items.push({
            html: i18n('open_with'),
            items: items,
        });

        // -------------------------------------------
        // -- separator --
        // -------------------------------------------
        menu_items.push('-');
    }

    // -------------------------------------------
    // Open in New Window
    // (only if the item is on a window)
    // -------------------------------------------
    if($(el_item).closest('.window-body').length > 0 && options.is_dir){
        menu_items.push({
            html: i18n('open_in_new_window'),
            onClick: function(){
                if(options.is_dir){
                    open_item({item: el_item, new_window: true})
                }
            }
        });
        // -------------------------------------------
        // -- separator --
        // -------------------------------------------
        if(!is_trash && !is_trashed && options.is_dir)
            menu_items.push('-');
    }
    // -------------------------------------------
    // Share With…
    // -------------------------------------------
    if(!is_trashed && !is_trash){
        menu_items.push({
            html: i18n('Share With…'),
            onClick: async function(){
                if(window.user.is_temp && 
                    !await UIWindowSaveAccount({
                        send_confirmation_code: true,
                        message: 'Please create an account to proceed.',
                        window_options: {
                            backdrop: true,
                            close_on_backdrop_click: false,
                        }                                
                    }))
                    return;
                else if(!window.user.email_confirmed && !await UIWindowEmailConfirmationRequired())
                    return;

                UIWindowShare([{uid: $(el_item).attr('data-uid'), path: $(el_item).attr('data-path'), name: $(el_item).attr('data-name'), icon: $(el_item_icon).find('img').attr('src')}]);
            }
        });
    }

    // -------------------------------------------
    // Publish As Website
    // -------------------------------------------
    if(!is_trashed && !is_trash && options.is_dir){
        menu_items.push({
            html: i18n('publish_as_website'),
            disabled: !options.is_dir,
            onClick: async function () {
                if(window.require_email_verification_to_publish_website){
                    if(window.user.is_temp && 
                        !await UIWindowSaveAccount({
                            send_confirmation_code: true,
                            message: 'Please create an account to proceed.',
                            window_options: {
                                backdrop: true,
                                close_on_backdrop_click: false,
                            }                                
                        }))
                        return;
                    else if(!window.user.email_confirmed && !await UIWindowEmailConfirmationRequired())
                        return;
                }
                UIWindowPublishWebsite(options.uid, $(el_item).attr('data-name'), $(el_item).attr('data-path'));
            }
        });

    }
    // -------------------------------------------
    // Deploy As App
    // -------------------------------------------
    if(!is_trashed && !is_trash && options.is_dir){
        menu_items.push({
            html: i18n('deploy_as_app'),
            disabled: !options.is_dir,
            onClick: async function () {
                launch_app({
                    name: 'dev-center',
                    file_path: $(el_item).attr('data-path'),
                    file_uid: $(el_item).attr('data-uid'),
                    params: {
                        source_path: options.path,
                    }
                })
            }
        });

        menu_items.push('-');
    }

    // -------------------------------------------
    // Empty Trash
    // -------------------------------------------
    if(is_trash){
        menu_items.push({
            html: i18n('empty_trash'),
            onClick: async function(){
                window.empty_trash();
            }
        });
    }
    // -------------------------------------------
    // Download
    // -------------------------------------------
    if(!is_trash && !is_trashed && (options.associated_app_name === null || options.associated_app_name === undefined)){
        menu_items.push({
            html: i18n('download'),
            disabled: options.is_dir && !window.feature_flags.download_directory,
            onClick: async function(){
                if(options.is_dir)
                    window.zipItems(el_item, path.dirname($(el_item).attr('data-path')), true);
                else
                    window.trigger_download([options.path]);
            }
        });                
    }
    // -------------------------------------------
    // Zip
    // -------------------------------------------
    if(!is_trash && !is_trashed && !$(el_item).attr('data-path').endsWith('.zip')){
        menu_items.push({
            html: i18n('zip'),
            onClick: function(){
                window.zipItems(el_item, path.dirname($(el_item).attr('data-path')), false);
            }
        })
    }
    // -------------------------------------------
    // Unzip
    // -------------------------------------------
    if(!is_trash && !is_trashed && $(el_item).attr('data-path').endsWith('.zip')){
        menu_items.push({
            html: i18n('unzip'),
            onClick: async function(){
                let filePath = $(el_item).attr('data-path');
                window.unzipItem(filePath)
            }
        })
    }
    // -------------------------------------------
    // Restore
    // -------------------------------------------
    if(is_trashed){
        menu_items.push({
            html: i18n('restore'),
            onClick: async function(){
                let metadata = $(el_item).attr('data-metadata') === '' ? {} : JSON.parse($(el_item).attr('data-metadata'))
                window.move_items([el_item], path.dirname(metadata.original_path));
            }
        });
    }
    // -------------------------------------------
    // -
    // -------------------------------------------
    if(!is_trash && (options.associated_app_name === null || options.associated_app_name === undefined))
        menu_items.push('-');
    // -------------------------------------------
    // Cut
    // -------------------------------------------
    if($(el_item).attr('data-immutable') === '0' && !is_shared_with_me){
        menu_items.push({
            html: i18n('cut'),
            onClick: function(){
                window.clipboard_op= 'move';
                window.clipboard= [options.path];
            }
        });
    }
    // -------------------------------------------
    // Copy
    // -------------------------------------------
    if(!is_trashed && !is_trash){
        menu_items.push({
            html: i18n('copy'),
            onClick: function(){
                window.clipboard_op= 'copy';
                window.clipboard= [{path: options.path}];
            }
        });
    }
    // -------------------------------------------
    // Paste Into Folder
    // -------------------------------------------
    if($(el_item).attr('data-is_dir') === '1' && !is_trashed && !is_trash){
        menu_items.push({
            html: i18n('paste_into_folder'),
            disabled: window.clipboard.length > 0 ? false : true,
            onClick: function(){
                if(window.clipboard_op === 'copy')
                    window.copy_clipboard_items($(el_item).attr('data-path'), null);
                else if(window.clipboard_op === 'move')
                    window.move_clipboard_items(null, $(el_item).attr('data-path'))
            }
        })
    }
    // -------------------------------------------
    // -
    // -------------------------------------------
    if($(el_item).attr('data-immutable') === '0' && !is_trash){
        menu_items.push('-')
    }
    // -------------------------------------------
    // Delete
    // -------------------------------------------
    if($(el_item).attr('data-immutable') === '0' && !is_trashed && !is_shared_with_me){
        menu_items.push({
            html: i18n('delete'),
            onClick: async function(){
                window.move_items([el_item], window.trash_path);
            }
        });
    }
    // -------------------------------------------
    // Delete Permanently
    // -------------------------------------------
    if(is_trashed){
        menu_items.push({
            html: i18n('delete_permanently'),
            onClick: async function(){
                const alert_resp = await UIAlert({
                    message: i18n('confirm_delete_single_item'),
                    buttons:[
                        {
                            label: i18n('delete'),
                            type: 'primary',
                        },
                        {
                            label: i18n('cancel')
                        },
                    ]
                })

                if((alert_resp) === 'Delete'){
                    await window.delete_item(el_item);
                    // check if trash is empty
                    const trash = await puter.fs.stat(window.trash_path);
                    // update other clients
                    if(window.socket){
                        window.socket.emit('trash.is_empty', {is_empty: trash.is_empty});
                    }
                    // update this client
                    if(trash.is_empty){
                        $(`.item[data-path="${html_encode(window.trash_path)}" i], .item[data-shortcut_to_path="${html_encode(window.trash_path)}" i]`).find('.item-icon > img').attr('src', window.icons['trash.svg']);
                        $(`.window[data-path="${window.trash_path}"]`).find('.window-head-icon').attr('src', window.icons['trash.svg']);
                    }            
                }
            }
        });
    }
    // -------------------------------------------
    // Rename
    // -------------------------------------------
    if($(el_item).attr('data-immutable') === '0' && !is_trashed && !is_trash){
        menu_items.push({
            html: i18n('rename'),
            onClick: function(){
                window.activate_item_name_editor(el_item)
            }
        });
    }
    // -------------------------------------------
    // -
    // -------------------------------------------
    menu_items.push('-');
    // -------------------------------------------
    // Properties
    // -------------------------------------------
    menu_items.push({
        html: i18n('properties'),
        onClick: function(){
            let window_height = 500;
            let window_width = 450;

            let left = $(el_item).position().left + $(el_item).width();
            left = left > (window.innerWidth - window_width)? (window.innerWidth - window_width) : left;

            let top = $(el_item).position().top + $(el_item).height();
            top = top > (window.innerHeight - (window_height + window.taskbar_height + window.toolbar_height))? (window.innerHeight - (window_height + window.taskbar_height + window.toolbar_height)) : top;

            UIWindowItemProperties(
                $(el_item).attr('data-name'), 
                $(el_item).attr('data-path'), 
                $(el_item).attr('data-uid'),
                left,
                top,
                window_width,
                window_height,
            );
        }
    });
};