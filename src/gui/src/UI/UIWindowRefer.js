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
import UIPopover from './UIPopover.js';
import socialLink from '../helpers/socialLink.js';

async function UIWindowRefer (options) {
    let h = '';
    const url = `${window.gui_origin}/?r=${window.user.referral_code}`;

    h += '<div>';
    h += '<div class="qr-code-window-close-btn generic-close-window-button disable-user-select"> &times; </div>';
    h += `<img src="${window.icons['present.svg']}" style="width: 70px; margin: 20px auto 20px; display: block; margin-bottom: 20px;">`;
    h += `<p class="refer-friend-c2a">${i18n('refer_friends_c2a')}</p>`;
    h += `<label style="font-weight: bold;">${i18n('invite_link')}</label>`;
    h += '<input type="text" style="margin-bottom:10px;" class="downloadable-link" readonly />';
    h += `<button class="button button-primary copy-downloadable-link" style="white-space:nowrap; text-align:center;">${i18n('copy_link')}</button>`;
    h += `<img class="share-copy-link-on-social" src="${window.icons['share-outline.svg']}">`;
    h += '</div>';

    const el_window = await UIWindow({
        title: i18n('window_title_refer_friend'),
        window_class: 'window-refer-friend',
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: false,
        selectable_body: false,
        draggable_body: true,
        allow_context_menu: false,
        is_draggable: true,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: true,
        allow_user_select: true,
        width: 500,
        dominant: true,
        window_css: {
            height: 'initial',
        },
        body_css: {
            width: 'initial',
            'max-height': 'calc(100vh - 200px)',
            'background-color': 'rgb(241 246 251)',
            'backdrop-filter': 'blur(3px)',
            'padding': '10px 20px 20px 20px',
            'height': 'initial',
        },
    });

    $(el_window).find('.window-body .downloadable-link').val(url);

    $(el_window).find('.window-body .share-copy-link-on-social').on('click', function (e) {
        const social_links = socialLink({ url: url, title: i18n('refer_friends_social_media_c2a'), description: i18n('refer_friends_social_media_c2a') });

        let social_links_html = '';
        social_links_html += '<div style="padding: 10px;">';
        social_links_html += `<p style="margin: 0; text-align: center; margin-bottom: 6px; color: #484a57; font-weight: bold; font-size: 14px;">${i18n('share_to')}</p>`;
        social_links_html += `<a class="copy-link-social-btn" target="_blank" href="${social_links.twitter}" style=""><svg viewBox="0 0 24 24" aria-hidden="true" style="opacity: 0.7;"><g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></g></svg></a>`;
        social_links_html += `<a class="copy-link-social-btn" target="_blank" href="${social_links.whatsapp}" style=""><img src="${window.icons['logo-whatsapp.svg']}"></a>`;
        social_links_html += `<a class="copy-link-social-btn" target="_blank" href="${social_links.facebook}" style=""><img src="${window.icons['logo-facebook.svg']}"></a>`;
        social_links_html += `<a class="copy-link-social-btn" target="_blank" href="${social_links.linkedin}" style=""><img src="${window.icons['logo-linkedin.svg']}"></a>`;
        social_links_html += `<a class="copy-link-social-btn" target="_blank" href="${social_links.reddit}" style=""><img src="${window.icons['logo-reddit.svg']}"></a>`;
        social_links_html += `<a class="copy-link-social-btn" target="_blank" href="${social_links['telegram.me']}" style=""><img src="${window.icons['logo-telegram.svg']}"></a>`;
        social_links_html += '</div>';

        UIPopover({
            content: social_links_html,
            snapToElement: this,
            parent_element: this,
            // width: 300,
            height: 100,
            position: 'bottom',
        });
    });

    $(el_window).find('.window-body .copy-downloadable-link').on('click', async function (e) {
        var copy_btn = this;
        if ( navigator.clipboard ) {
            // Get link text
            const selected_text = $(el_window).find('.window-body .downloadable-link').val();
            // copy selected text to clipboard
            await navigator.clipboard.writeText(selected_text);
        }
        else {
            // Get the text field
            $(el_window).find('.window-body .downloadable-link').select();
            // Copy the text inside the text field
            document.execCommand('copy');
        }

        $(this).html(i18n('link_copied'));
        setTimeout(function () {
            $(copy_btn).html(i18n('copy_link'));
        }, 1000);
    });
}

export default UIWindowRefer;