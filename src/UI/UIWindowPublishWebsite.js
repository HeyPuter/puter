/**
 * Copyright (C) 2024 Puter Technologies Inc.
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

import UIWindow from './UIWindow.js'
import UIWindowMyWebsites from './UIWindowMyWebsites.js'

async function UIWindowPublishWebsite(target_dir_uid, target_dir_name, target_dir_path){
    let h = '';
    h += `<div class="window-publishWebsite-content" style="padding: 20px; border-bottom: 1px solid #ced7e1;">`;
        // success
        h += `<div class="window-publishWebsite-success">`;
            h += `<img src="${html_encode(window.icons['c-check.svg'])}" style="width:80px; height:80px; display: block; margin:10px auto;">`;
            h += `<p style="text-align:center;">${i18n('dir_published_as_website', `<strong>${html_encode(target_dir_name)}</strong>`, false)}<p>`;
            h += `<p style="text-align:center;"><a class="publishWebsite-published-link" target="_blank"></a><img class="publishWebsite-published-link-icon" src="${html_encode(window.icons['launch.svg'])}"></p>`;
            h += `<button class="button button-normal button-block button-primary publish-window-ok-btn" style="margin-top:20px;">OK</button>`;
        h+= `</div>`;
        // form
        h += `<form class="window-publishWebsite-form">`;
            // error msg
            h += `<div class="publish-website-error-msg"></div>`;
            // subdomain
            h += `<div style="overflow: hidden;">`;
                h += `<label style="margin-bottom: 10px;">${i18n('pick_name_for_website')}</label>`;
                h += `<div style="font-family: monospace;">https://<input class="publish-website-subdomain" style="width:235px;" type="text" autocomplete="subdomain" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false"/>.${html_encode(window.hosting_domain)}</div>`;
            h += `</div>`;
            // uid
            h += `<input class="publishWebsiteTargetDirUID" type="hidden" value="${html_encode(target_dir_uid)}"/>`;
            // Publish
            h += `<button class="publish-btn button button-action button-block button-normal">${i18n('publish')}</button>`
        h += `</form>`;
    h += `</div>`;

    const el_window = await UIWindow({
        title: 'Publish Website',
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: true,
        selectable_body: false,
        draggable_body: false,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: true,
        allow_user_select: true,
        width: 450,
        dominant: true,
        onAppend: function(this_window){
            $(this_window).find(`.publish-website-subdomain`).val(window.generate_identifier());
            $(this_window).find(`.publish-website-subdomain`).get(0).focus({preventScroll:true});
        },
        window_class: 'window-publishWebsite',
        window_css:{
            height: 'initial'
        },
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
        }    
    })

    $(el_window).find('.publish-btn').on('click', function(e){
        // todo do some basic validation client-side

        //Subdomain
        let subdomain = $(el_window).find('.publish-website-subdomain').val();
    
        // disable 'Publish' button
        $(el_window).find('.publish-btn').prop('disabled', true);

        puter.hosting.create(
            subdomain, 
            target_dir_path).then((res)=>{
                let url = 'https://' + subdomain + '.' + window.hosting_domain + '/';
                $(el_window).find('.window-publishWebsite-form').hide(100, function(){
                    $(el_window).find('.publishWebsite-published-link').attr('href', url);
                    $(el_window).find('.publishWebsite-published-link').text(url);
                    $(el_window).find('.window-publishWebsite-success').show(100)
                    $(`.item[data-uid="${target_dir_uid}"] .item-has-website-badge`).show();
                });

                // find all items whose path starts with target_dir_path
                $(`.item[data-path^="${target_dir_path}"]`).each(function(){
                    // show the link badge
                    $(this).find('.item-has-website-url-badge').show();
                    // update item's website_url attribute
                    $(this).attr('data-website_url', url + $(this).attr('data-path').substring(target_dir_path.length));
                })

                window.update_sites_cache();
            }).catch((err)=>{
                err = err.error;
                $(el_window).find('.publish-website-error-msg').html(
                    err.message + (
                        err.code === 'subdomain_limit_reached' ? 
                            ' <span class="manage-your-websites-link">Manage Your Subdomains</span>' : ''
                    )
                );
                $(el_window).find('.publish-website-error-msg').fadeIn();
                // re-enable 'Publish' button
                $(el_window).find('.publish-btn').prop('disabled', false);
            })
    })

    $(el_window).find('.publish-window-ok-btn').on('click', function(){
        $(el_window).close();
    })
}

$(document).on('click', '.manage-your-websites-link', async function(e){
    UIWindowMyWebsites();
})


export default UIWindowPublishWebsite