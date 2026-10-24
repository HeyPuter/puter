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

import item_icon from '../../helpers/itemIcon.js';
import UIAlert from '../UIAlert.js';
import { isOverlayOnTop } from './dashboardOverlay.js';
import { formatRelativeTime } from '../../i18n/formatTime.js';

const { html_encode } = window;

// Gives each open dialog its own document keydown namespace, so closing one
// doesn't unbind another's Escape.
let modal_seq = 0;

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
 * @param {string} [opts.uid] - UID of the item; looked up from the path when omitted
 * @param {jQuery} [opts.$container] - Element to append the overlay to (defaults to <body>)
 * @returns {{ close: () => void }}
 */
export default function UIItemPropertiesModal ({ name, path: item_path, uid, $container }) {
    const $root = $container && $container.length ? $container : $('body');
    const el_previous_focus = document.activeElement;
    const keydown_ns = `keydown.item-props-${++modal_seq}`;

    const $overlay = $(`
        <div class="item-props-overlay">
            <div class="item-props-modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="${html_encode(name)} ${i18n('properties')}">
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
                <div class="item-props-tabs" role="tablist">
                    <button class="item-props-tab item-props-tab-active" role="tab" aria-selected="true" data-tab="general">${i18n('general')}</button>
                    <button class="item-props-tab item-props-tab-versions" role="tab" aria-selected="false" data-tab="versions">${i18n('versions')}</button>
                </div>
                <div class="item-props-body enable-user-select">
                    <div class="item-props-panel item-props-panel-active" role="tabpanel" data-tab="general">
                        <dl class="item-props-list" aria-busy="true"><div class="item-props-empty">${i18n('loading')}</div></dl>
                    </div>
                    <div class="item-props-panel" role="tabpanel" data-tab="versions">
                        <div class="item-props-versions"></div>
                    </div>
                </div>
            </div>
        </div>
    `);

    $root.append($overlay);

    const el_modal = $overlay.find('.item-props-modal').get(0);

    // Reveal after paint so the CSS transition (fade + scale/slide) runs.
    requestAnimationFrame(() => {
        $overlay.addClass('item-props-show');
        el_modal.focus({ preventScroll: true });
    });

    let closed = false;
    const close = () => {
        if ( closed ) return;
        closed = true;
        $overlay.removeClass('item-props-show');
        $(document).off(keydown_ns);
        setTimeout(() => $overlay.remove(), 200);
        if ( el_previous_focus && document.body.contains(el_previous_focus) ) {
            el_previous_focus.focus({ preventScroll: true });
        }
    };

    // -- Dismissal wiring --
    $overlay.on('click', '.item-props-close', close);
    // Backdrop close goes by where the press started: a text selection dragged
    // out of the card registers its click on the overlay.
    let backdrop_pressed = false;
    $overlay.on('mousedown', function (e) {
        backdrop_pressed = e.target === $overlay[0];
    });
    $overlay.on('click', function (e) {
        if ( e.target === $overlay[0] && backdrop_pressed ) close();
    });
    $(document).on(keydown_ns, function (e) {
        if ( e.key === 'Escape' && isOverlayOnTop($overlay[0]) ) close();
    });

    // Keep Tab cycling inside the dialog while it's up.
    $overlay.on('keydown', function (e) {
        if ( e.key !== 'Tab' ) return;
        const focusables = $overlay.find('button, a[href]').filter(':visible:not(:disabled)');
        if ( ! focusables.length ) return;
        const first = focusables.get(0);
        const last = focusables.get(focusables.length - 1);
        if ( focusables.index(document.activeElement) === -1 ) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
        } else if ( e.shiftKey && document.activeElement === first ) {
            e.preventDefault();
            last.focus();
        } else if ( ! e.shiftKey && document.activeElement === last ) {
            e.preventDefault();
            first.focus();
        }
    });

    // -- Tab switching --
    const show_tab = (tab) => {
        $overlay.find('.item-props-tab').each(function () {
            const active = $(this).attr('data-tab') === tab;
            $(this).toggleClass('item-props-tab-active', active).attr('aria-selected', active ? 'true' : 'false');
        });
        $overlay.find('.item-props-panel').removeClass('item-props-panel-active');
        $overlay.find(`.item-props-panel[data-tab="${tab}"]`).addClass('item-props-panel-active');
    };
    $overlay.on('click', '.item-props-tab', function () {
        show_tab($(this).attr('data-tab'));
    });

    const $list = $overlay.find('.item-props-list');
    const $versions = $overlay.find('.item-props-versions');

    // The folder-background menu knows only the path it was opened on, so
    // address the entry by uid when we have one and fall back to the path.
    let item_uid = uid;

    puter.fs.stat({
        ...(uid ? { uid } : { path: item_path }),
        returnSubdomains: true,
        returnPermissions: true,
        returnVersions: true,
        returnSize: true,
        consistency: 'eventual',
        success: async (fsentry) => {
            if ( closed ) return;

            item_uid = item_uid ?? fsentry.uid ?? fsentry.id;

            // Icon
            try {
                const icon = await item_icon(fsentry);
                if ( icon?.image ) {
                    $overlay.find('.item-props-title-icon')
                        .html(`<img src="${html_encode(icon.image)}" alt="">`);
                }
            } catch { /* icon is best-effort */ }

            // Directories have no version history — drop the tab entirely,
            // leaving General showing even if Versions was picked meanwhile.
            if ( fsentry.is_dir ) {
                $overlay.find('.item-props-tab-versions').remove();
                show_tab('general');
            }

            $list.empty().attr('aria-busy', 'false');
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
                fsentry.is_dir ? i18n('directory') : (fsentry.type ? html_encode(fsentry.type) : '-'));
            addRow($list, i18n('size'),
                (fsentry.size === null || fsentry.size === undefined) ? '-' : html_encode(window.byte_format(fsentry.size)));
            addRow($list, i18n('modified'),
                fsentry.modified === 0 ? '-' : html_encode(formatRelativeTime(fsentry.modified * 1000, Date.now(), window.locale)));
            addRow($list, i18n('created'),
                fsentry.created === 0 ? '-' : html_encode(formatRelativeTime(fsentry.created * 1000, Date.now(), window.locale)));

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
                        <button type="button" class="item-props-disassociate" data-uuid="${html_encode(subdomain.uuid)}" data-subdomain="${html_encode(window.extractSubdomain(subdomain.address))}">${i18n('disassociate')}</button>
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
                                <span class="item-props-version-meta">${html_encode(version.user ? version.user.username : '')} &bull; ${html_encode(formatRelativeTime(version.timestamp * 1000, Date.now(), window.locale))}</span>
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
                if ( $link.prop('disabled') ) return;
                $link.prop('disabled', true);
                puter.hosting.update($link.attr('data-subdomain'), null).then(() => {
                    const $entry = $link.closest('.item-props-website-entry');
                    const $row = $entry.closest('.item-props-row');
                    $entry.remove();
                    // The focused button just left the DOM; keep focus in the dialog.
                    el_modal.focus({ preventScroll: true });
                    if ( $row.find('.item-props-website-entry').length > 0 ) return;
                    $row.remove();
                    // The item serves no website any more: drop its badge from every row.
                    $('.item').filter(function () {
                        return $(this).attr('data-uid') === item_uid;
                    }).attr('data-has_website', '0').find('.item-has-website-badge').fadeOut(200);
                }).catch((err) => {
                    $link.prop('disabled', false);
                    UIAlert(err?.message || i18n('error_unknown_cause', [], false));
                });
            });
        },
        error: () => {
            if ( closed ) return;
            // Still marked busy, the list's error would go unannounced.
            const failed = `<div class="item-props-empty">${i18n('error_unknown_cause')}</div>`;
            $list.attr('aria-busy', 'false').html(failed);
            $versions.html(failed);
        },
    })
        // The error callback renders the failure; the promise rejects with it too.
        .catch(() => {});

    return { close };
}
