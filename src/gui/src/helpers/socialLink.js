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

/**
 * Generates sharing URLs for various social media platforms and services based on the provided arguments.
 *
 * @global
 * @function
 * @param {Object} args - Configuration object for generating share URLs.
 * @param {string} [args.url] - The URL to share.
 * @param {string} [args.title] - The title or headline of the content to share.
 * @param {string} [args.image] - Image URL associated with the content.
 * @param {string} [args.desc] - A description of the content.
 * @param {string} [args.appid] - App ID for certain platforms that require it.
 * @param {string} [args.redirecturl] - Redirect URL for certain platforms.
 * @param {string} [args.via] - Attribution source, e.g., a Twitter username.
 * @param {string} [args.hashtags] - Comma-separated list of hashtags without '#'.
 * @param {string} [args.provider] - Content provider.
 * @param {string} [args.language] - Content's language.
 * @param {string} [args.userid] - User ID for certain platforms.
 * @param {string} [args.category] - Content's category.
 * @param {string} [args.phonenumber] - Phone number for platforms like SMS or Telegram.
 * @param {string} [args.emailaddress] - Email address to share content to.
 * @param {string} [args.ccemailaddress] - CC email address for sharing content.
 * @param {string} [args.bccemailaddress] - BCC email address for sharing content.
 * @returns {Object} - An object containing key-value pairs where keys are platform names and values are constructed sharing URLs.
 * 
 * @example
 * const shareConfig = {
 *     url: 'https://example.com',
 *     title: 'Check this out!',
 *     desc: 'This is an amazing article on example.com',
 *     via: 'exampleUser'
 * };
 * const shareLinks = window.socialLink(shareConfig);
 * console.log(shareLinks.twitter);  // Outputs the constructed Twitter share link
 */

import fixedEncodeURIComponent from './fixedEncodeURIComponent.js';

const socialLink = (args)=>{
    const validargs = [
        'url',
        'title',
        'image',
        'desc',
        'appid',
        'redirecturl',
        'via',
        'hashtags',
        'provider',
        'language',
        'userid',
        'category',
        'phonenumber',
        'emailaddress',
        'cemailaddress',
        'bccemailaddress',
    ];
    
    for(var i = 0; i < validargs.length; i++) {
        const validarg = validargs[i];
        if(!args[validarg]) {
            args[validarg] = '';
        }
    }
    
    const url = fixedEncodeURIComponent(args.url);
    const title = fixedEncodeURIComponent(args.title);
    const image = fixedEncodeURIComponent(args.image);
    const desc = fixedEncodeURIComponent(args.desc);
    const via = fixedEncodeURIComponent(args.via);
    const hash_tags = fixedEncodeURIComponent(args.hashtags);
    const language = fixedEncodeURIComponent(args.language);
    const user_id = fixedEncodeURIComponent(args.userid);
    const category = fixedEncodeURIComponent(args.category);
    const phone_number = fixedEncodeURIComponent(args.phonenumber);
    const email_address = fixedEncodeURIComponent(args.emailaddress);
    const cc_email_address = fixedEncodeURIComponent(args.ccemailaddress);
    const bcc_email_address = fixedEncodeURIComponent(args.bccemailaddress);
    
    var text = title;
    
    if(desc) {
        text += '%20%3A%20';	// This is just this, " : "
        text += desc;
    }
    
    return {
        'add.this':'http://www.addthis.com/bookmark.php?url=' + url,
        'blogger':'https://www.blogger.com/blog-this.g?u=' + url + '&n=' + title + '&t=' + desc,
        'buffer':'https://buffer.com/add?text=' + text + '&url=' + url,
        'diaspora':'https://share.diasporafoundation.org/?title=' + title + '&url=' + url,
        'douban':'http://www.douban.com/recommend/?url=' + url + '&title=' + text,
        'email':'mailto:' + email_address + '?subject=' + title + '&body=' + desc,
        'evernote':'https://www.evernote.com/clip.action?url=' + url + '&title=' + text,
        'getpocket':'https://getpocket.com/edit?url=' + url,
        'facebook':'http://www.facebook.com/sharer.php?u=' + url,
        'flattr':'https://flattr.com/submit/auto?user_id=' + user_id + '&url=' + url + '&title=' + title + '&description=' + text + '&language=' + language + '&tags=' + hash_tags + '&hidden=HIDDEN&category=' + category,
        'flipboard':'https://share.flipboard.com/bookmarklet/popout?v=2&title=' + text + '&url=' + url, 
        'gmail':'https://mail.google.com/mail/?view=cm&to=' + email_address + '&su=' + title + '&body=' + url + '&bcc=' + bcc_email_address + '&cc=' + cc_email_address,
        'google.bookmarks':'https://www.google.com/bookmarks/mark?op=edit&bkmk=' + url + '&title=' + title + '&annotation=' + text + '&labels=' + hash_tags + '',
        'instapaper':'http://www.instapaper.com/edit?url=' + url + '&title=' + title + '&description=' + desc,
        'line.me':'https://lineit.line.me/share/ui?url=' + url + '&text=' + text,
        'linkedin':'https://www.linkedin.com/sharing/share-offsite/?url=' + url,
        'livejournal':'http://www.livejournal.com/update.bml?subject=' + text + '&event=' + url,
        'hacker.news':'https://news.ycombinator.com/submitlink?u=' + url + '&t=' + title,
        'ok.ru':'https://connect.ok.ru/dk?st.cmd=WidgetSharePreview&st.shareUrl=' + url,
        'pinterest':'http://pinterest.com/pin/create/button/?url=' + url ,
        'qzone':'http://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=' + url,
        'reddit':'https://reddit.com/submit?url=' + url + '&title=' + title,
        'renren':'http://widget.renren.com/dialog/share?resourceUrl=' + url + '&srcUrl=' + url + '&title=' + text + '&description=' + desc,
        'skype':'https://web.skype.com/share?url=' + url + '&text=' + text,
        'sms':'sms:' + phone_number + '?body=' + text,
        'surfingbird.ru':'http://surfingbird.ru/share?url=' + url + '&description=' + desc + '&screenshot=' + image + '&title=' + title,
        'telegram.me':'https://t.me/share/url?url=' + url + '&text=' + text + '&to=' + phone_number,
        'threema':'threema://compose?text=' + text + '&id=' + user_id,
        'tumblr':'https://www.tumblr.com/widgets/share/tool?canonicalUrl=' + url + '&title=' + title + '&caption=' + desc + '&tags=' + hash_tags,
        'twitter':'https://twitter.com/intent/tweet?url=' + url + '&text=' + text + '&via=' + via + '&hashtags=' + hash_tags,
        'vk':'http://vk.com/share.php?url=' + url + '&title=' + title + '&comment=' + desc,
        'weibo':'http://service.weibo.com/share/share.php?url=' + url + '&appkey=&title=' + title + '&pic=&ralateUid=',
        'whatsapp':'https://api.whatsapp.com/send?text=' + text + '%20' + url,
        'xing':'https://www.xing.com/spi/shares/new?url=' + url,
        'yahoo':'http://compose.mail.yahoo.com/?to=' + email_address + '&subject=' + title + '&body=' + text,
    };
}

export default socialLink;