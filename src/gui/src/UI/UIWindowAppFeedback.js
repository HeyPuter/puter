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

import UIWindow from './UIWindow.js';

// Keep in sync with AppFeedbackService.MESSAGE_MAX_LENGTH on the backend.
const MESSAGE_MAX_LENGTH = 4000;
const SUCCESS_AUTOCLOSE_MS = 1600;

/**
 * "Send feedback to this app's developer" dialog, behind
 * `puter.ui.showFeedbackDialog()`. Not to be confused with UIWindowFeedback,
 * which is Puter's own Contact Us form.
 *
 * The target is named by exactly one of `options.app` (app uid or name — the
 * desktop IPC path knows which app asked) or `options.origin` (the popup
 * path's browser-attested opener origin). The dialog pre-flights the target
 * against `GET /app-feedback/target` — feedback is opt-in per app, and the
 * server is the authority on the app's canonical title — then submits to
 * `POST /app-feedback`.
 *
 * @param {{
 *     app?: string,
 *     origin?: string,
 *     source?: 'app' | 'web',
 *     window_options?: object,
 * }} options
 * @returns {Promise<boolean>} true iff feedback was submitted successfully.
 *   Resolves false on cancel/close/unavailable — never rejects, so IPC and
 *   popup callers can always report an answer.
 */
async function UIWindowAppFeedback (options) {
    options = options ?? {};

    return new Promise((resolve) => {
        let settled = false;
        let sending = false;
        let el_window;
        const settle = (sent) => {
            if ( settled ) return;
            settled = true;
            resolve(sent === true);
        };

        // The setup below is async; a synchronous executor with this backstop
        // guarantees the promise settles even if UIWindow (or anything else
        // before the on_close handler is wired) throws — the IPC caller
        // awaits this promise and must always get an answer.
        (async () => {
            const authToken = puter.authToken ?? window.auth_token;
            const target_params = options.app
                ? { app: options.app }
                : { origin: options.origin };

            let h = '';
            h += '<div class="app-feedback-dialog" style="padding: 20px;">';
            // loading pane
            h += `<div class="app-feedback-loading" style="text-align:center; padding: 30px 10px; color: #5a6b7b;">${i18n('loading')}…</div>`;
            // unavailable / error pane
            h += '<div class="app-feedback-unavailable" style="display:none;">';
            h += '<p class="app-feedback-unavailable-message" style="text-align:center; padding: 10px; margin-top: 5px;"></p>';
            h += `<button class="button button-block app-feedback-close-btn" style="margin-bottom: 5px;">${i18n('close')}</button>`;
            h += '</div>';
            // form pane
            h += '<div class="app-feedback-form" style="display:none;">';
            h += '<div style="margin-bottom: 15px;">';
            h += '<div class="app-feedback-target-title" style="font-size: 16px; font-weight: 500; word-break: break-word;"></div>';
            // The unique, format-restricted app name is shown under the free-form
            // title so one app can't pose as another by copying its title.
            h += '<div class="app-feedback-target-name" style="font-size: 12px; color: #7a8a9a; word-break: break-all;"></div>';
            h += '</div>';
            h += `<p style="margin-top: 0; font-size: 14px; -webkit-font-smoothing: antialiased;">${i18n('app_feedback_c2a')}</p>`;
            h += `<textarea class="app-feedback-message" maxlength="${MESSAGE_MAX_LENGTH}" placeholder="${html_encode(i18n('app_feedback_placeholder'))}" style="width:100%; height: 150px; padding: 10px; box-sizing: border-box; resize: vertical;"></textarea>`;
            h += `<div class="app-feedback-counter" style="text-align: right; font-size: 11px; color: #7a8a9a; margin-top: 2px;">0 / ${MESSAGE_MAX_LENGTH}</div>`;
            h += `<p style="font-size: 12px; color: #7a8a9a; margin: 10px 0;">${i18n('app_feedback_privacy_note')}</p>`;
            h += `<p class="app-feedback-error" role="alert" style="display:none; color: #b0355a; font-size: 13px; margin: 10px 0;"></p>`;
            h += '<div style="overflow: hidden; margin-top: 10px;">';
            h += `<button class="button button-primary app-feedback-send-btn" style="float: right;" disabled>${i18n('send')}</button>`;
            h += `<button class="button button-default app-feedback-cancel-btn" style="float: right; margin-right: 10px;">${i18n('cancel')}</button>`;
            h += '</div>';
            h += '</div>';
            // success pane
            h += '<div class="app-feedback-success" style="display:none;">';
            h += `<img src="${html_encode(window.icons['c-check.svg'])}" style="width:50px; height:50px; display: block; margin:10px auto;">`;
            h += `<p style="text-align:center; margin-bottom:10px; color: #005300; padding: 10px;">${i18n('app_feedback_sent')}</p>`;
            h += '</div>';
            h += '</div>';

            el_window = await UIWindow({
                title: i18n('app_feedback_title'),
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
                on_close: () => {
                    $(document).off(`keydown.app-feedback-${win_id}`);
                    settle(false);
                },
                window_class: 'window-app-feedback',
                body_css: {
                    width: 'initial',
                    height: '100%',
                    'background-color': 'rgb(245 247 249)',
                    'backdrop-filter': 'blur(3px)',
                },
            });
            const win_id = $(el_window).attr('data-id');

            const showPane = (pane) => {
                $(el_window).find('.app-feedback-loading, .app-feedback-unavailable, .app-feedback-form, .app-feedback-success').hide();
                $(el_window).find(`.app-feedback-${pane}`).show();
            };
            const showUnavailable = (messageKey) => {
                $(el_window).find('.app-feedback-unavailable-message').text(i18n(messageKey));
                showPane('unavailable');
            };

            // Escape closes unless a submit is in flight. The global Escape
            // handler in keyboard.js skips windows while a textarea has focus,
            // so the dialog needs its own (namespaced, removed in on_close).
            $(document).on(`keydown.app-feedback-${win_id}`, (e) => {
                if ( e.key !== 'Escape' || sending ) return;
                if ( ! $(el_window).hasClass('window-active') ) return;
                $(el_window).close();
            });

            $(el_window).find('.app-feedback-close-btn, .app-feedback-cancel-btn').on('click', () => {
                $(el_window).close();
            });

            $(el_window).find('.app-feedback-message').on('input', function () {
                $(el_window).find('.app-feedback-counter').text(`${this.value.length} / ${MESSAGE_MAX_LENGTH}`);
                $(el_window).find('.app-feedback-send-btn').prop('disabled', sending || this.value.trim() === '');
            });

            // -- Pre-flight: is this app accepting feedback, and what is it
            // called? The server is the authority — a title passed by the caller
            // could impersonate another app.
            try {
                const res = await fetch(`${window.api_origin}/app-feedback/target?${new URLSearchParams(target_params)}`, {
                    headers: { 'Authorization': `Bearer ${authToken}` },
                });
                if ( ! res.ok ) throw new Error(`target check responded ${res.status}`);
                const target = await res.json();
                if ( ! target.enabled ) {
                    showUnavailable('app_feedback_not_available');
                    return;
                }
                $(el_window).find('.app-feedback-target-title').text(target.app?.title ?? '');
                $(el_window).find('.app-feedback-target-name').text(target.app?.name ?? '');
                showPane('form');
                $(el_window).find('.app-feedback-message').get(0)?.focus({ preventScroll: true });
            } catch ( e ) {
                console.error('app-feedback: target check failed', e);
                showUnavailable('app_feedback_error');
                return;
            }

            const send = async () => {
                const $btn = $(el_window).find('.app-feedback-send-btn');
                const message = String($(el_window).find('.app-feedback-message').val() || '').trim();
                if ( ! message || sending ) return;
                sending = true;
                $btn.prop('disabled', true);
                $(el_window).find('.app-feedback-error').hide();
                try {
                    const res = await fetch(`${window.api_origin}/app-feedback`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`,
                        },
                        body: JSON.stringify({
                            ...target_params,
                            message,
                            context: options.source,
                        }),
                    });
                    if ( ! res.ok ) {
                        let code;
                        try {
                            code = (await res.json())?.code;
                        } catch ( _e ) {
                            // Non-JSON error body; fall through to the generic message.
                        }
                        if ( code === 'feedback_not_enabled' ) {
                            showUnavailable('app_feedback_not_available');
                            return;
                        }
                        const key = res.status === 429 ? 'app_feedback_rate_limited' : 'app_feedback_error';
                        $(el_window).find('.app-feedback-error').text(i18n(key)).show();
                        return;
                    }
                    showPane('success');
                    settle(true);
                    setTimeout(() => $(el_window).close(), SUCCESS_AUTOCLOSE_MS);
                } catch ( e ) {
                    // Shown inside the form so the message survives for a retry.
                    console.error('app-feedback: submit failed', e);
                    $(el_window).find('.app-feedback-error').text(i18n('app_feedback_error')).show();
                } finally {
                    sending = false;
                    $(el_window).find('.app-feedback-send-btn').prop('disabled',
                        settled || String($(el_window).find('.app-feedback-message').val() || '').trim() === '');
                }
            };

            $(el_window).find('.app-feedback-send-btn').on('click', send);
            // Enter alone belongs to the textarea (feedback may need paragraphs).
            $(el_window).find('.app-feedback-message').on('keydown', (e) => {
                if ( e.key === 'Enter' && (e.metaKey || e.ctrlKey) ) {
                    e.preventDefault();
                    send();
                }
            });
        })().catch((e) => {
            console.error('app-feedback: dialog failed to open', e);
            try { $(el_window).close(); } catch ( _e ) {}
            settle(false);
        });
    });
}

export default UIWindowAppFeedback;
