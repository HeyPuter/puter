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

import {
    ATTACHMENT_ACCEPT_ATTRIBUTE,
    MAX_ATTACHMENTS,
    MAX_ATTACHMENT_BYTES,
    MAX_TOTAL_ATTACHMENT_BYTES,
    base64FromDataUrl,
    checkAttachment,
} from '../helpers/contact_attachments.js';
import UIWindow from './UIWindow.js';

const MB = 1024 * 1024;

// The limits each message spells out, so the numbers in the copy can't drift
// from the ones being enforced.
const ERROR_VALUES = {
    contact_us_attachment_too_many: [MAX_ATTACHMENTS],
    contact_us_attachment_too_large: [MAX_ATTACHMENT_BYTES / MB],
    contact_us_attachment_total_too_large: [MAX_TOTAL_ATTACHMENT_BYTES / MB],
};

/**
 * Puter's own Contact Us form — feedback, comments and bug reports, delivered
 * to support. Not to be confused with UIWindowAppFeedback, which sends feedback
 * to a third-party app's developer.
 *
 * Bug reports are the reason this form takes attachments: the ones worth
 * reporting are often the ones that need a screenshot or a recording to be
 * legible at all. Files are staged in memory, read as base64 on submit, and
 * posted alongside the message. The client-side checks in
 * helpers/contact_attachments.js are there to fail fast on an obviously
 * oversized file; the server re-derives type, size and file name from the bytes
 * and is what actually enforces the limits.
 */
async function UIWindowFeedback (options) {
    return new Promise(async (resolve) => {
        options = options ?? {};

        // Staged files, in the order they were added. Kept out of the DOM so
        // the list survives re-rendering the chips.
        let attachments = [];
        let sending = false;

        let h = '';
        h += '<div style="padding: 20px; margin-top: 0;">';
        // success
        h += '<div class="feedback-sent-success">';
        h += `<img src="${html_encode(window.icons['c-check.svg'])}" style="width:50px; height:50px; display: block; margin:10px auto;">`;
        h += `<p style="text-align:center; margin-bottom:10px; color: #005300; padding: 10px;">${i18n('feedback_sent_confirmation')}</p>`;
        h += '</div>';
        // form
        h += '<div class="feedback-form">';
        h += `<p style="margin-top:0; font-size: 15px; -webkit-font-smoothing: antialiased;">${i18n('feedback_c2a')}</p>`;
        h += '<textarea class="feedback-message" style="width:100%; height: 200px; padding: 10px; box-sizing: border-box;"></textarea>';
        // attachments
        h += '<div class="feedback-attachments">';
        h += `<input type="file" class="feedback-attach-input" accept="${html_encode(ATTACHMENT_ACCEPT_ATTRIBUTE)}" multiple style="display:none;">`;
        h += `<button type="button" class="button button-small feedback-attach-btn">${i18n('contact_us_attach')}</button>`;
        h += `<span class="feedback-attach-hint">${i18n('contact_us_attach_hint', [MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES / MB])}</span>`;
        h += '<ul class="feedback-attachment-list"></ul>';
        h += '</div>';
        h += '<p class="feedback-error" role="alert" style="display:none;"></p>';
        h += `<button class="button button-primary send-feedback-btn" style="float: right; margin-bottom: 15px; margin-top: 10px;">${i18n('send')}</button>`;
        h += '</div>';
        h += '</div>';

        const el_window = await UIWindow({
            title: i18n('contact_us'),
            app: 'feedback',
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
            allow_native_ctxmenu: false,
            allow_user_select: false,
            width: 380,
            height: 'auto',
            dominant: true,
            show_in_taskbar: false,
            ...options.window_options,
            onAppend: function (this_window) {
                $(this_window).find('.feedback-message').get(0).focus({ preventScroll: true });
            },
            window_class: 'window-feedback',
            body_css: {
                width: 'initial',
                height: '100%',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            },
        });

        const $error = $(el_window).find('.feedback-error');
        // `.html()` rather than `.text()`: i18n() html-encodes what it returns,
        // so text() would render the entities literally.
        const showError = (key) => $error.html(i18n(key, ERROR_VALUES[key] ?? [])).show();
        const clearError = () => $error.hide().empty();

        // -- Attachments -------------------------------------------------

        const renderAttachments = () => {
            const $list = $(el_window).find('.feedback-attachment-list').empty();
            attachments.forEach((file, index) => {
                const remove_label = i18n('contact_us_attachment_remove');
                const $item = $(
                    '<li class="feedback-attachment">' +
                        `<span class="feedback-attachment-name" title="${html_encode(file.name)}">${html_encode(file.name)}</span>` +
                        `<span class="feedback-attachment-size">${html_encode(window.byte_format(file.size))}</span>` +
                        `<button type="button" class="feedback-attachment-remove" aria-label="${remove_label}" title="${remove_label}">&times;</button>` +
                    '</li>',
                );
                $item.find('.feedback-attachment-remove').on('click', () => {
                    if ( sending ) return;
                    attachments.splice(index, 1);
                    clearError();
                    renderAttachments();
                });
                $list.append($item);
            });
            // Nothing left to add once the count cap is reached.
            $(el_window).find('.feedback-attach-btn')
                .prop('disabled', sending || attachments.length >= MAX_ATTACHMENTS);
        };

        const addFiles = (files) => {
            if ( sending ) return;
            let rejection = null;
            for ( const file of files ) {
                const verdict = checkAttachment(file, attachments);
                if ( ! verdict.ok ) {
                    // Report the first thing that went wrong, but keep taking
                    // the files that do fit — dropping a folder of mixed
                    // content shouldn't discard the usable screenshots.
                    rejection = rejection ?? verdict.error;
                    continue;
                }
                attachments.push(file);
            }
            if ( rejection ) showError(rejection);
            else clearError();
            renderAttachments();
        };

        const $fileInput = $(el_window).find('.feedback-attach-input');
        $(el_window).find('.feedback-attach-btn').on('click', () => $fileInput.trigger('click'));
        $fileInput.on('change', function () {
            addFiles(Array.from(this.files ?? []));
            // Reset so re-picking the same file fires `change` again.
            this.value = '';
        });

        // Drag and drop onto the form. UIWindow's own dragster handler sits on
        // the window body — an ancestor — and only uploads to the filesystem
        // for `is_dir` windows, so a drop caught here reaches this form first
        // and goes no further.
        const $form = $(el_window).find('.feedback-form');
        $form.on('dragover dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if ( ! sending ) $form.addClass('feedback-form-dragover');
        });
        $form.on('dragleave dragend', () => $form.removeClass('feedback-form-dragover'));
        $form.on('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            $form.removeClass('feedback-form-dragover');
            addFiles(Array.from(e.originalEvent?.dataTransfer?.files ?? []));
        });

        /**
         * Read one staged file into the `{ name, data }` shape the endpoint
         * takes. Rejects rather than sending a half-read file — a bug report
         * missing the screenshot it refers to is worse than one that says so.
         */
        const readAttachment = (file) => new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => {
                const data = base64FromDataUrl(reader.result);
                if ( ! data ) return rej(new Error(`unreadable attachment: ${file.name}`));
                res({ name: file.name, data });
            };
            reader.onerror = () => rej(reader.error ?? new Error('attachment read failed'));
            reader.readAsDataURL(file);
        });

        // -- Submit --------------------------------------------------------

        const setSending = (value) => {
            sending = value;
            $(el_window).find('.send-feedback-btn').prop('disabled', value);
            $(el_window).find('.feedback-attachment-remove').prop('disabled', value);
            renderAttachments();
        };

        $(el_window).find('.send-feedback-btn').on('click', async function () {
            if ( sending ) return;
            const message = $(el_window).find('.feedback-message').val();
            if ( ! message || ! message.trim() ) {
                showError('contact_us_message_required');
                return;
            }

            clearError();
            setSending(true);
            try {
                const payload = { message };
                if ( attachments.length ) {
                    payload.attachments = await Promise.all(attachments.map(readAttachment));
                }

                const resp = await fetch(`${window.api_origin}/contactUs`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${window.auth_token}`,
                    },
                    body: JSON.stringify(payload),
                });
                if ( ! resp.ok ) {
                    showError(resp.status === 429 ? 'contact_us_rate_limited' : 'contact_us_error');
                    return;
                }
                $(el_window).find('.feedback-form').hide();
                $(el_window).find('.feedback-sent-success').show(100);
            } catch ( e ) {
                console.error('contact-us: submit failed', e);
                showError('contact_us_error');
            } finally {
                setSending(false);
            }
        });

        renderAttachments();
        resolve(el_window);
    });
}

export default UIWindowFeedback;
