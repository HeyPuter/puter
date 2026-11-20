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

// The dashboard's Contact Us form: a dashboard form dialog with screenshots
// and screen recordings attached by picking, dropping or pasting them. The
// desktop keeps UIWindowFeedback.

import {
    ATTACHMENT_ACCEPT_ATTRIBUTE,
    MAX_ATTACHMENTS,
    MAX_ATTACHMENT_BYTES,
    MAX_TOTAL_ATTACHMENT_BYTES,
    checkAttachment,
} from '../../helpers/contact_attachments.js';
import { isTouchPrimaryDevice } from './ContextMenu/ContextMenu.js';
import { ICONS, SVG } from './UIDashboardDialog.js';
import UIDashboardFormDialog from './UIDashboardFormDialog.js';

const MB = 1024 * 1024;

// Keep in sync with SystemController on the backend.
const MESSAGE_MAX_LENGTH = 100_000;

// Numbers interpolated into each error message, taken from the enforced limits.
const ERROR_VALUES = {
    contact_us_attachment_too_many: [MAX_ATTACHMENTS],
    contact_us_attachment_too_large: [MAX_ATTACHMENT_BYTES / MB],
    contact_us_attachment_total_too_large: [MAX_TOTAL_ATTACHMENT_BYTES / MB],
};

const CONTACT_ICONS = {
    attach: SVG('<path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>'),
    video: SVG('<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3.5v11L16 14"/>'),
};

const t = (key, values = []) => i18n(key, values, false);

/**
 * Whether a drag carries files, rather than text or a link from the page.
 *
 * @param {DragEvent} e
 * @returns {boolean}
 */
const dragHasFiles = (e) => Array.from(e.originalEvent?.dataTransfer?.types ?? []).includes('Files');

/**
 * @param {File} file
 * @returns {string}
 */
const attachmentHtml = (file) => {
    const name = html_encode(file.name);
    // The preview's URL is let go once it has drawn; the <img> keeps the pixels.
    const thumb = file.type.startsWith('image/')
        ? `<img src="${html_encode(URL.createObjectURL(file))}" alt="" draggable="false">`
        : CONTACT_ICONS.video;
    const remove = html_encode(t('contact_us_attachment_remove_named', [file.name]));
    return '<li class="dashboard-contact-file">'
        + `<span class="dashboard-contact-file-thumb" aria-hidden="true">${thumb}</span>`
        + '<span class="dashboard-contact-file-text">'
        + `<span class="dashboard-contact-file-name" title="${name}">${name}</span>`
        + `<span class="dashboard-contact-file-size">${html_encode(window.byte_format(file.size))}</span>`
        + '</span>'
        + `<button type="button" class="dashboard-contact-file-remove" aria-label="${remove}" title="${i18n('contact_us_attachment_remove')}">${ICONS.close}</button>`
        + '</li>';
};

/**
 * Opens the Contact Us form; the message goes to support, with any
 * attachments as multipart form data. The checks here only fail fast: the
 * server enforces the limits.
 *
 * @param {object} [opts]
 * @param {jQuery} [opts.$container] Where the overlay mounts.
 * @param {HTMLElement} [opts.returnFocusTo] Where focus goes on close.
 * @returns {import('./UIDashboardFormDialog.js').FormDialog}
 */
export default function UIDashboardContactDialog ({ $container, returnFocusTo } = {}) {
    /** @type {File[]} */
    const attachments = [];
    let sending = false;
    // Once sent, the form is gone and a drop or paste has nothing to join.
    let sent = false;

    const dialog = UIDashboardFormDialog({
        $container,
        returnFocusTo,
        title: t('contact_us'),
        intro: `<p>${i18n('feedback_c2a')}</p>`,
        submitLabel: t('send'),
        fields: [{
            name: 'message',
            type: 'textarea',
            label: i18n('contact_us_message'),
            placeholder: i18n('contact_us_message_placeholder'),
            attrs: { rows: 6, maxlength: MESSAGE_MAX_LENGTH },
        }],
        async onSubmit () {
            const { message } = dialog.values();
            if ( ! message.trim() ) {
                dialog.setStatus(t('contact_us_message_required'), { field: 'message' });
                return;
            }

            setSending(true);
            try {
                const body = new FormData();
                body.append('message', message);
                for ( const file of attachments ) body.append('attachments', file, file.name);

                // No Content-Type: the browser sets it with the boundary.
                const resp = await fetch(`${window.api_origin}/contactUs`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${window.auth_token}` },
                    body,
                });
                if ( ! resp.ok ) {
                    dialog.setStatus(t(resp.status === 429 ? 'contact_us_rate_limited' : 'contact_us_error'));
                    return;
                }
                sent = true;
                dialog.finish({ message: t('feedback_sent_confirmation') });
            } catch ( err ) {
                console.error('contact-us: submit failed', err);
                dialog.setStatus(t('contact_us_error'));
            } finally {
                setSending(false);
            }
        },
    });

    const { $dialog } = dialog;
    const $overlay = $dialog.parent();
    const hint_id = `${$dialog.attr('aria-labelledby')}-attach-hint`;

    let h = '<div class="dashboard-contact-attachments">';
    h += `<input type="file" class="dashboard-contact-file-input" accept="${html_encode(ATTACHMENT_ACCEPT_ATTRIBUTE)}" multiple hidden tabindex="-1">`;
    h += `<button type="button" class="dashboard-contact-dropzone" aria-describedby="${hint_id}">`;
    h += `<span class="dashboard-contact-dropzone-icon" aria-hidden="true">${CONTACT_ICONS.attach}</span>`;
    h += '<span class="dashboard-contact-dropzone-text">';
    h += `<span class="dashboard-contact-dropzone-label">${i18n(isTouchPrimaryDevice() ? 'contact_us_attach' : 'contact_us_attach_or_drop')}</span>`;
    h += `<span class="dashboard-contact-dropzone-drop" aria-hidden="true">${i18n('contact_us_drop_to_attach')}</span>`;
    h += `<span class="dashboard-contact-dropzone-hint" id="${hint_id}">${i18n('contact_us_attach_hint', [MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES / MB])}</span>`;
    h += '</span>';
    h += '</button>';
    h += `<ul class="dashboard-contact-files" aria-label="${i18n('contact_us_attachments')}" hidden></ul>`;
    h += '</div>';
    $dialog.addClass('dashboard-contact-dialog')
        .find('.dashboard-form-field[data-field="message"]').after(h);

    const $dropzone = $dialog.find('.dashboard-contact-dropzone');
    const $fileInput = $dialog.find('.dashboard-contact-file-input');
    const $list = $dialog.find('.dashboard-contact-files');

    const syncControls = () => {
        $list.prop('hidden', attachments.length === 0);
        // Nothing left to add once the count cap is reached.
        $dropzone.prop('disabled', sending || attachments.length >= MAX_ATTACHMENTS);
        $list.find('.dashboard-contact-file-remove').prop('disabled', sending);
    };

    function setSending (value) {
        sending = value;
        $dialog.toggleClass('dashboard-contact-sending', value);
        syncControls();
    }

    /** @param {File[]} files */
    const addFiles = (files) => {
        if ( sending || sent || ! files.length ) return;
        let rejection = null;
        for ( const file of files ) {
            const verdict = checkAttachment(file, attachments);
            if ( ! verdict.ok ) {
                // Report the first rejection but keep the files that fit.
                rejection = rejection ?? verdict.error;
                continue;
            }
            attachments.push(file);
            const $item = $(attachmentHtml(file));
            $item.find('img').one('load error', function () {
                URL.revokeObjectURL(this.src);
            });
            $list.append($item);
        }
        dialog.setStatus(rejection ? t(rejection, ERROR_VALUES[rejection] ?? []) : '');
        syncControls();
    };

    $dropzone.on('click', () => $fileInput.trigger('click'));
    $fileInput.on('change', function () {
        addFiles(Array.from(this.files ?? []));
        // Reset so re-picking the same file fires `change` again.
        this.value = '';
    });

    $list.on('click', '.dashboard-contact-file-remove', function () {
        if ( sending ) return;
        const $item = $(this).closest('.dashboard-contact-file');
        const index = $list.children().index($item);
        attachments.splice(index, 1);
        // Focus stays in the list rather than falling back to the page.
        const $next = $item.next().length ? $item.next() : $item.prev();
        $item.remove();
        dialog.setStatus('');
        syncControls();
        ($next.length ? $next.find('.dashboard-contact-file-remove') : $dropzone).get(0)?.focus({ preventScroll: true });
    });

    // The whole overlay takes the drop, and keeps it from the window under it.
    let drag_depth = 0;
    const endDrag = () => {
        drag_depth = 0;
        $dialog.removeClass('dashboard-contact-dragging');
    };
    $overlay.on('dragenter', (e) => {
        if ( ! dragHasFiles(e) ) return;
        e.preventDefault();
        e.stopPropagation();
        drag_depth++;
        if ( ! sending && ! sent ) $dialog.addClass('dashboard-contact-dragging');
    });
    $overlay.on('dragover', (e) => {
        if ( ! dragHasFiles(e) ) return;
        e.preventDefault();
        e.stopPropagation();
        e.originalEvent.dataTransfer.dropEffect = sending || sent ? 'none' : 'copy';
    });
    $overlay.on('dragleave', (e) => {
        // Matched to the dragenters counted, whatever this one says it carries.
        if ( drag_depth === 0 ) return;
        e.stopPropagation();
        if ( --drag_depth <= 0 ) endDrag();
    });
    $overlay.on('drop', (e) => {
        if ( ! dragHasFiles(e) ) return;
        e.preventDefault();
        e.stopPropagation();
        endDrag();
        addFiles(Array.from(e.originalEvent.dataTransfer.files ?? []));
    });

    // A screenshot pasted into the message is attached to it.
    $dialog.on('paste', '.dashboard-form-input[name="message"]', (e) => {
        const clipboard = e.originalEvent?.clipboardData;
        const files = Array.from(clipboard?.files ?? []);
        if ( ! files.length ) return;
        // Some apps put the image's name or markup alongside it; that text still pastes.
        if ( ! clipboard.getData('text/plain') ) e.preventDefault();
        addFiles(files);
    });

    // Enter alone is a new line in the message; with Cmd or Ctrl, it sends.
    $dialog.on('keydown', '.dashboard-form-input[name="message"]', (e) => {
        if ( e.key !== 'Enter' || ! (e.metaKey || e.ctrlKey) ) return;
        e.preventDefault();
        $dialog.trigger('submit');
    });

    syncControls();
    return dialog;
}
