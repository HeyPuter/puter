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

import item_icon from '../../helpers/item_icon.js';

const { html_encode } = window;

const closeIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

/**
 * Adds a labelled row to the general-properties list, but only when the value
 * is present — mirrors the original properties window, which hid empty fields.
 *
 * @param {jQuery} $list - The <dl> the row is appended to
 * @param {string} labelHtml - Field label (already safe/encoded)
 * @param {string} valueHtml - Pre-encoded HTML for the value cell
 */
function addRow ($list, labelHtml, valueHtml) {
    if ( valueHtml === undefined || valueHtml === null || valueHtml === '' ) return;
    $list.append(`
        <div class="item-props-row">
            <dt class="item-props-label">${labelHtml}</dt>
            <dd class="item-props-value">${valueHtml}</dd>
        </div>
    `);
}

/**
 * A responsive, from-scratch item-properties modal for the Dashboard's Files
 * tab. Unlike UIWindowItemProperties (which spawns a desktop UIWindow), this
 * renders a self-contained overlay that behaves as a centered card on desktop
 * and a bottom sheet on mobile, styled with the dashboard's design tokens.
 *
 * @param {Object} opts
 * @param {string} opts.name - Display name of the item
 * @param {string} opts.path - Full path of the item
 * @param {string} opts.uid - UID of the item
 * @param {jQuery} [opts.$container] - Element to append the overlay to (defaults to <body>)
 * @returns {{ close: () => void }}
 */
export default function UIItemPropertiesModal ({ name, path: item_path, uid, $container }) {
    const $root = $container && $container.length ? $container : $('body');

    const $overlay = $(`
        <div class="item-props-overlay">
            <div class="item-props-modal" role="dialog" aria-modal="true" aria-label="${html_encode(name)} ${i18n('properties')}">
                <div class="item-props-header">
                    <div class="item-props-title">
                        <span class="item-props-title-icon"></span>
                        <div class="item-props-title-text">
                            <span class="item-props-title-name enable-user-select">${html_encode(name)}</span>
                            <span class="item-props-title-sub">${i18n('properties')}</span>
                        </div>
                    </div>
                    <button class="item-props-close" aria-label="${i18n('close')}" title="${i18n('close')}">${closeIcon}</button>
                </div>
                <div class="item-props-tabs">
                    <button class="item-props-tab item-props-tab-active" data-tab="general">${i18n('general')}</button>
                    <button class="item-props-tab item-props-tab-versions" data-tab="versions">${i18n('versions')}</button>
                </div>
                <div class="item-props-body enable-user-select">
                    <div class="item-props-panel item-props-panel-active" data-tab="general">
                        <dl class="item-props-list"></dl>
                    </div>
                    <div class="item-props-panel" data-tab="versions">
                        <div class="item-props-versions"></div>
                    </div>
                </div>
            </div>
        </div>
    `);

    $root.append($overlay);

    // Reveal after paint so the CSS transition (fade + scale/slide) runs.
    requestAnimationFrame(() => $overlay.addClass('item-props-show'));

    let closed = false;
    const close = () => {
        if ( closed ) return;
        closed = true;
        $overlay.removeClass('item-props-show');
        $(document).off('keydown.item-props');
        setTimeout(() => $overlay.remove(), 200);
    };

    // -- Dismissal wiring --
    $overlay.on('click', '.item-props-close', close);
    $overlay.on('click', function (e) {
        if ( e.target === $overlay[0] ) close();
    });
    $(document).on('keydown.item-props', function (e) {
        if ( e.key === 'Escape' ) close();
    });

    // -- Tab switching --
    $overlay.on('click', '.item-props-tab', function () {
        const tab = $(this).attr('data-tab');
        $overlay.find('.item-props-tab').removeClass('item-props-tab-active');
        $(this).addClass('item-props-tab-active');
        $overlay.find('.item-props-panel').removeClass('item-props-panel-active');
        $overlay.find(`.item-props-panel[data-tab="${tab}"]`).addClass('item-props-panel-active');
    });

    const $list = $overlay.find('.item-props-list');
    const $versions = $overlay.find('.item-props-versions');

    puter.fs.stat({
        uid,
        returnSubdomains: true,
        returnPermissions: true,
        returnVersions: true,
        returnSize: true,
        consistency: 'eventual',
        success: async (fsentry) => {
            if ( closed ) return;

            // Icon
            try {
                const icon = await item_icon(fsentry);
                if ( icon?.image ) {
                    $overlay.find('.item-props-title-icon')
                        .html(`<img src="${html_encode(icon.image)}" alt="">`);
                }
            } catch { /* icon is best-effort */ }

            // Directories have no version history — drop the tab entirely.
            if ( fsentry.is_dir ) {
                $overlay.find('.item-props-tab-versions').remove();
            }

            addRow($list, i18n('name'), html_encode(fsentry.name));
            addRow($list, i18n('path'), html_encode(item_path));

            if ( fsentry.metadata ) {
                try {
                    const metadata = JSON.parse(fsentry.metadata);
                    if ( metadata.original_name ) {
                        addRow($list, i18n('original_name'), html_encode(metadata.original_name));
                    }
                    if ( metadata.original_path ) {
                        addRow($list, i18n('original_path'), html_encode(metadata.original_path));
                    }
                } catch { /* metadata is not always valid JSON */ }
            }

            if ( fsentry.shortcut_to && fsentry.shortcut_to_path ) {
                addRow($list, i18n('shortcut_to'), html_encode(fsentry.shortcut_to_path));
            }

            addRow($list, 'UID', html_encode(fsentry.id));
            addRow($list, i18n('type'),
                fsentry.is_dir ? 'Directory' : (fsentry.type ? html_encode(fsentry.type) : '-'));
            addRow($list, i18n('size'),
                (fsentry.size === null || fsentry.size === undefined) ? '-' : html_encode(window.byte_format(fsentry.size)));
            addRow($list, i18n('modified'),
                fsentry.modified === 0 ? '-' : html_encode(timeago.format(fsentry.modified * 1000)));
            addRow($list, i18n('created'),
                fsentry.created === 0 ? '-' : html_encode(timeago.format(fsentry.created * 1000)));

            // Worker (published .js files)
            if ( fsentry.path?.endsWith('.js') && fsentry.workers?.length > 0 ) {
                const worker_url = fsentry.workers[0].address;
                addRow($list, i18n('worker'),
                    `<a target="_blank" rel="noopener" href="${html_encode(worker_url)}">${html_encode(worker_url)}</a>`);
            }

            // Associated websites (with disassociate action)
            if ( fsentry.subdomains && fsentry.subdomains.length > 0 ) {
                const websitesHtml = fsentry.subdomains.map(subdomain => `
                    <p class="item-props-website-entry" data-uuid="${html_encode(subdomain.uuid)}">
                        <a target="_blank" rel="noopener" href="${html_encode(subdomain.address)}">${html_encode(subdomain.address)}</a>
                        <span class="item-props-disassociate" data-uuid="${html_encode(subdomain.uuid)}" data-subdomain="${html_encode(window.extractSubdomain(subdomain.address))}">disassociate</span>
                    </p>
                `).join('');
                addRow($list, i18n('associated_websites'), websitesHtml);
            }

            // Versions
            if ( ! fsentry.is_dir ) {
                if ( fsentry.versions && fsentry.versions.length > 0 ) {
                    fsentry.versions.slice().reverse().forEach(version => {
                        $versions.append(`
                            <div class="item-props-version-entry">
                                <span class="item-props-version-meta">${html_encode(version.user ? version.user.username : '')} &bull; ${html_encode(timeago.format(version.timestamp * 1000))}</span>
                                <span class="item-props-version-id">${html_encode(version.id)}</span>
                            </div>
                        `);
                    });
                } else {
                    $versions.html(`<div class="item-props-empty">-</div>`);
                }
            }

            // Disassociate handler
            $overlay.on('click', '.item-props-disassociate', function () {
                const $link = $(this);
                puter.hosting.update($link.attr('data-subdomain'), null).then(() => {
                    $overlay.find(`.item-props-website-entry[data-uuid="${$link.attr('data-uuid')}"]`).remove();
                    // Remove the website badge from every row for this item.
                    $(`.item[data-uid="${uid}"]`).find('.item-has-website-badge').fadeOut(200);
                });
            });
        },
        error: () => {
            if ( closed ) return;
            $list.html(`<div class="item-props-empty">${i18n('error_unknown_cause')}</div>`);
        },
    });

    return { close };
}
