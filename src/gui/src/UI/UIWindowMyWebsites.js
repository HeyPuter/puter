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

import UIWindow from './UIWindow.js';
import UIContextMenu from './UIContextMenu.js';
import UIAlert from './UIAlert.js';

async function UIWindowMyWebsites (options) {
    let h = '';
    h += '<div>';
    h += '</div>';

    const el_window = await UIWindow({
        title: 'My Websites',
        app: 'my-websites',
        single_instance: true,
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
        width: 400,
        dominant: false,
        body_css: {
            padding: '10px',
            width: 'initial',
            'background-color': 'rgba(231, 238, 245)',
            'backdrop-filter': 'blur(3px)',
            'padding-bottom': 0,
            'height': '351px',
            'box-sizing': 'border-box',
        },
    });

    // /sites
    let init_ts = Date.now();
    let loading = setTimeout(function () {
        $(el_window).find('.window-body').html(`<p style="text-align: center;
        margin-top: 40px;
        margin-bottom: 50px;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        color: #596c7c;">${i18n('loading')}...</p>`);
    }, 1000);

    puter.hosting.list().then(function (sites) {
        setTimeout(function () {
            // clear loading
            clearTimeout(loading);
            // user has sites
            if ( sites.length > 0 ) {
                let h = '';
                for ( let i = 0; i < sites.length; i++ ) {
                    h += `<div class="mywebsites-card" data-uuid="${sites[i].uid}">`;
                    h += `<a class="mywebsites-address-link" href="https://${sites[i].subdomain}.puter.site" target="_blank">${sites[i].subdomain}.puter.site</a>`;
                    h += `<img class="mywebsites-site-setting" data-site-uuid="${sites[i].uid}" src="${html_encode(window.icons['cog.svg'])}">`;
                    // there is a directory associated with this site
                    if ( sites[i].root_dir ) {
                        h += `<p class="mywebsites-dir-path" data-path="${html_encode(sites[i].root_dir.path)}" data-name="${html_encode(sites[i].root_dir.name)}" data-uuid="${sites[i].root_dir.id}">`;
                        h += `<img src="${html_encode(window.icons['folder.svg'])}">`;
                        h += `${html_encode(sites[i].root_dir.path)}`;
                        h += '</p>';
                        h += '<p style="margin-bottom:0; margin-top: 20px; font-size: 13px;">';
                        h += `<span class="mywebsites-dis-dir" data-dir-uuid="${html_encode(sites[i].root_dir.id)}" data-site-subdomain="${html_encode(sites[i].subdomain)}" data-site-uuid="${html_encode(sites[i].uid)}">`;
                        h += `<img style="width: 16px; margin-bottom: -2px; margin-right: 4px;" src="${html_encode(window.icons['plug.svg'])}">${i18n('disassociate_dir')}</span>`;
                        h += '</p>';
                    }
                    h += `<p class="mywebsites-no-dir-notice" data-site-uuid="${html_encode(sites[i].uid)}" style="${sites[i].root_dir ? 'display:none;' : 'display:block;'}">${i18n('no_dir_associated_with_site')}</p>`;
                    h += '</div>';
                }
                $(el_window).find('.window-body').html(h);
            }
            // has no sites
            else {
                $(el_window).find('.window-body').html(`<p style="text-align: center;
                margin-top: 40px;
                margin-bottom: 50px;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                color: #596c7c;">${i18n('no_websites_published')}</p>`);
            }
        }, Date.now() - init_ts < 1000 ? 0 : 2000);
    });
}

$(document).on('click', '.mywebsites-dir-path', function (e) {
    e = e.target;
    UIWindow({
        path: $(e).attr('data-path'),
        title: $(e).attr('data-name'),
        icon: window.icons['folder.svg'],
        uid: $(e).attr('data-uuid'),
        is_dir: true,
        app: 'explorer',
    });
});

$(document).on('click', '.mywebsites-site-setting', function (e) {
    const pos = e.target.getBoundingClientRect();
    UIContextMenu({
        parent_element: e.target,
        position: { top: pos.top + 25, left: pos.left - 193 },
        items: [
            //--------------------------------------------------
            // Release Address
            //--------------------------------------------------
            {
                html: 'Release Address',
                onClick: async function () {
                    const alert_resp = await UIAlert({
                        message: i18n('release_address_confirmation'),
                        buttons: [
                            {
                                label: i18n('yes_release_it'),
                                value: 'yes',
                                type: 'primary',
                            },
                            {
                                label: i18n('cancel'),
                            },
                        ],
                    });
                    if ( alert_resp !== 'yes' ) {
                        return;
                    }

                    $.ajax({
                        url: `${window.api_origin }/delete-site`,
                        type: 'POST',
                        data: JSON.stringify({
                            site_uuid: $(e.target).attr('data-site-uuid'),
                        }),
                        async: false,
                        contentType: 'application/json',
                        headers: {
                            'Authorization': `Bearer ${window.auth_token}`,
                        },
                        statusCode: {
                            401: function () {
                                window.logout();
                            },
                        },
                        success: function () {
                            $(`.mywebsites-card[data-uuid="${$(e.target).attr('data-site-uuid')}"]`).fadeOut();
                        },
                    });
                },
            },
        ],
    });
});

$(document).on('click', '.mywebsites-dis-dir', function (e) {
    puter.hosting.delete(
                    // dir
                    $(e.target).attr('data-dir-uuid'),
                    // hostname
                    $(e.target).attr('data-site-subdomain'),
                    // success
                    function () {
                        $(`.mywebsites-no-dir-notice[data-site-uuid="${$(e.target).attr('data-site-uuid')}"]`).show();
                        $(`.mywebsites-dir-path[data-uuid="${$(e.target).attr('data-dir-uuid')}"]`).remove();
                        // remove the website badge from all instances of the dir
                        $(`.item[data-uid="${$(e.target).attr('data-dir-uuid')}"]`).find('.item-has-website-badge').fadeOut(300);
                        $(e.target).hide();
                    });
});
export default UIWindowMyWebsites;