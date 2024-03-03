/*
Copyright (C) 2024  Puter Technologies Inc.

This file is part of Puter.com.

Puter.com is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/


import UIWindow from './UIWindow.js'

// todo do this using uid rather than item_path, since item_path is way mroe expensive on the DB
async function UIWindowItemProperties(item_name, item_path, item_uid, left, top, width, height){
    let h = '';
    h += `<div class="item-props-tabview" style="display: flex; flex-direction: column; height: 100%;">`;
        // tabs
        h += `<div class="item-props-tab">`;
            h += `<div class="item-props-tab-btn antialiased disable-user-select item-props-tab-selected" data-tab="general">General</div>`;
            h += `<div class="item-props-tab-btn antialiased disable-user-select item-props-tab-btn-versions" data-tab="versions">Versions</div>`;
        h += `</div>`;

        h+= `<div class="item-props-tab-content item-props-tab-content-selected" data-tab="general" style="border-top-left-radius:0;">`;
            h += `<table class="item-props-tbl">`;
                h += `<tr><td class="item-prop-label">Name</td><td class="item-prop-val item-prop-val-name"></td></tr>`;
                h += `<tr><td class="item-prop-label">Path</td><td class="item-prop-val item-prop-val-path"></td></tr>`;
                h += `<tr class="item-prop-original-name"><td class="item-prop-label">Original Name</td><td class="item-prop-val item-prop-val-original-name"></td></tr>`;
                h += `<tr class="item-prop-original-path"><td class="item-prop-label">Original Path</td><td class="item-prop-val item-prop-val-original-path"></td></tr>`;
                h += `<tr><td class="item-prop-label">Shortcut to</td><td class="item-prop-val item-prop-val-shortcut-to"></td></tr>`;
                h += `<tr><td class="item-prop-label">UID</td><td class="item-prop-val item-prop-val-uid"></td></tr>`;
                h += `<tr><td class="item-prop-label">Type</td><td class="item-prop-val item-prop-val-type"></td></tr>`;
                h += `<tr><td class="item-prop-label">Size</td><td class="item-prop-val item-prop-val-size"></td></tr>`;
                h += `<tr><td class="item-prop-label">Modified</td><td class="item-prop-val item-prop-val-modified"></td></tr>`;
                h += `<tr><td class="item-prop-label">Created</td><td class="item-prop-val item-prop-val-created"></td></tr>`;
                h += `<tr><td class="item-prop-label">Versions</td><td class="item-prop-val item-prop-val-versions"></td></tr>`;
                h += `<tr><td class="item-prop-label">Associated Websites</td><td class="item-prop-val item-prop-val-websites">`;
                h += `</td></tr>`;
                h += `<tr><td class="item-prop-label">Access Granted To</td><td class="item-prop-val item-prop-val-permissions"></td></tr>`;
            h += `</table>`;
        h += `</div>`;

        h += `<div class="item-props-tab-content" data-tab="versions" style="padding: 20px;">`
            h += `<div class="item-props-version-list">`;
            h += `</div>`;
        h += `</div>`;
    h += `</div>`;

    const el_window = await UIWindow({
        title: `${item_name} properties`,
        app: item_uid+'-account',
        single_instance: true,
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        draggable_body: false,
        has_head: true,
        selectable_body: false,
        draggable_body: false,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: true,
        allow_user_select: true,
        left: left,
        top: top,
        width: width,
        height: height,
        onAppend: function(el_window){
        },
        width: 450,
        window_class: 'window-item-properties',
        window_css:{
            // height: 'initial',
        },
        body_css: {
            padding: '10px',
            width: 'initial',
            height: 'calc(100% - 50px)',
            'background-color': 'rgb(241 242 246)',
            'backdrop-filter': 'blur(3px)',
            'content-box': 'content-box',
        }    
    })

    // item props tab click handler
    $(el_window).find('.item-props-tab-btn').click(function(e){
        // unselect all tabs
        $(el_window).find('.item-props-tab-btn').removeClass('item-props-tab-selected');
        // select this tab
        $(this).addClass('item-props-tab-selected');
        // unselect all tab contents
        $(el_window).find('.item-props-tab-content').removeClass('item-props-tab-content-selected');
        // select this tab content
        $(el_window).find(`.item-props-tab-content[data-tab="${$(this).attr('data-tab')}"]`).addClass('item-props-tab-content-selected');
    })


    // /stat
    puter.fs.stat({ 
        uid: item_uid,
        returnSubdomains: true,
        returnPermissions: true,
        returnVersions: true,
        returnSize: true,
        success: function (fsentry){
            // hide versions tab if item is a directory
            if(fsentry.is_dir){
                $(el_window).find('[data-tab="versions"]').hide();
            }
            // name
            $(el_window).find('.item-prop-val-name').html(fsentry.name);
            // path
            $(el_window).find('.item-prop-val-path').html(item_path);
            // original name & path
            if(fsentry.metadata){
                try{
                    let metadata = JSON.parse(fsentry.metadata);
                    if(metadata.original_name){
                        $(el_window).find('.item-prop-val-original-name').html(metadata.original_name);
                        $(el_window).find('.item-prop-original-name').show();
                    }
                    if(metadata.original_path){
                        $(el_window).find('.item-prop-val-original-path').html(metadata.original_path);
                        $(el_window).find('.item-prop-original-path').show();
                    }
                }catch(e){}
            }

            // shortcut to
            if(fsentry.shortcut_to && fsentry.shortcut_to_path){
                $(el_window).find('.item-prop-val-shortcut-to').html(fsentry.shortcut_to_path);
            }
            // uid
            $(el_window).find('.item-prop-val-uid').html(fsentry.id);
            // type
            $(el_window).find('.item-prop-val-type').html(fsentry.is_dir ? 'Directory' : (fsentry.type === null ? '-' : fsentry.type));
            // size
            $(el_window).find('.item-prop-val-size').html(fsentry.size === null || fsentry.size === undefined  ? '-' : byte_format(fsentry.size));
            // modified
            $(el_window).find('.item-prop-val-modified').html(fsentry.modified === 0 ? '-' : timeago.format(fsentry.modified*1000));
            // created
            $(el_window).find('.item-prop-val-created').html(fsentry.created === 0 ? '-' : timeago.format(fsentry.created*1000));
            // subdomains
            if(fsentry.subdomains && fsentry.subdomains.length > 0 ){
                fsentry.subdomains.forEach(subdomain => {
                    $(el_window).find('.item-prop-val-websites').append(`<p class="item-prop-website-entry" data-uuid="${subdomain.uuid}" style="margin-bottom:5px; margin-top:5px;"><a target="_blank" href="${subdomain.address}">${subdomain.address}</a> (<span class="disassociate-website-link" data-uuid="${subdomain.uuid}" data-subdomain="${extractSubdomain(subdomain.address)}">disassociate</span>)</p>`);
                });
            }
            else{
                $(el_window).find('.item-prop-val-websites').append('-');
            }
            // versions
            if(fsentry.versions && fsentry.versions.length > 0 ){
                fsentry.versions.reverse().forEach(version => {
                    $(el_window).find('.item-props-version-list')
                        .append(`<div class="item-prop-version-entry">${version.user? version.user.username : ''} &bull; ${timeago.format(version.timestamp*1000)}<p style="font-size:10px;">${version.id}</p></div>`);
                });
            }
            else{
                $(el_window).find('.item-props-version-list').append('-');
            }

            // owner
            $(el_window).find('.item-prop-val-permissions').append(`<p class="item-prop-perm-entry" style="margin-bottom:5px; margin-top:5px;">${(fsentry.owner.email === undefined || fsentry.owner.email === null) ? fsentry.owner.username : fsentry.owner.email} (owner)</p>`);

            // other users with access
            if(fsentry.permissions && fsentry.permissions.length > 0 ){
                fsentry.permissions.forEach(perm => {
                    let h = ``;
                    // username/email
                    h += `<p class="item-prop-perm-entry" data-perm-uid="${perm.uid}" style="margin-bottom:5px; margin-top:5px;">${perm.email ?? perm.username} `;
                    // remove
                    h += `(<span class="remove-permission-link" data-perm-uid="${perm.uid}">remove</span>)`;
                    $(el_window).find('.item-prop-val-permissions').append(h);
                });
            }
            else{
                $(el_window).find('.item-prop-val-permissions').append('-');
            }

            $(el_window).find(`.disassociate-website-link`).on('click', function(e){
                puter.hosting.update(
                    $(e.target).attr('data-subdomain'), 
                    null).then(()=>{ 
                        $(el_window).find(`.item-prop-website-entry[data-uuid="${$(e.target).attr('data-uuid')}"]`).remove();
                        if($(el_window).find(`.item-prop-website-entry`).length === 0){
                            $(el_window).find(`.item-prop-val-websites`).html('-');
                            // remove the website badge from all instances of the dir
                            $(`.item[data-uid="${item_uid}"]`).find('.item-has-website-badge').fadeOut(200);
                        }
                    }
                )
            })
            
            $(el_window).find('.remove-permission-link').on('click', function(e){
                const el_remove_perm_link= this;
                const perm_uid = $(el_remove_perm_link).attr('data-perm-uid');
                $.ajax({
                    url: api_origin + "/remove-perm",
                    type: 'POST',
                    async: true,
                    contentType: "application/json",
                    data: JSON.stringify({
                        uid: perm_uid,
                    }),
                    headers: {
                        "Authorization": "Bearer "+auth_token
                    },
                    statusCode: {
                        401: function () {
                            logout();
                        },
                    },        
                    success: async function (res){
                        $(el_window).find(`.item-prop-perm-entry[data-perm-uid="${perm_uid}"]`).remove();
                        
                        if($(el_window).find(`.item-prop-perm-entry`).length === 0){
                            $(el_window).find(`.item-prop-val-permissions`).html('-');
                            // todo is it better to combine the following two queriesinto one css selector?
                            $(`.item[data-uid="${item_uid}"]`).find(`.item-is-shared`).fadeOut(200);
                            // todo optim do this only if item is a directory
                            // todo this has to be case-insensitive but the `i` selector doesn't work on ^=
                            $(`.item[data-path^="${item_path}/"]`).find(`.item-is-shared`).fadeOut(200);
                        }
                    },
                    complete: function(){
                    }
                })
            })
        }
    })
}

export default UIWindowItemProperties