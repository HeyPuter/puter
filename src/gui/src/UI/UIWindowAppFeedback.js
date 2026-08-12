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

// Keep in sync with AppFeedbackService.MESSAGE_MAX_LENGTH on the backend.
const MESSAGE_MAX_LENGTH = 4000;
const SUCCESS_AUTOCLOSE_MS = 1600;

let feedback_modal_seq = 0;

/**
 * "Send feedback to this app's developer" modal, behind
 * `puter.ui.showFeedbackDialog()`. Not to be confused with UIWindowFeedback,
 * which is Puter's own Contact Us form.
 *
 * Deliberately NOT a UIWindow: it's a from-scratch, theme-aware overlay in
 * the same spirit as the dashboard modals (uninstall, add-app), so it renders
 * consistently in every context it's opened from — the desktop (app IPC), the
 * dashboard app-drawer, and the standalone puter.com popup.
 *
 * The target is named by exactly one of `options.app` (app uid or name — the
 * desktop/drawer paths know which app asked) or `options.origin` (the popup
 * path's browser-attested opener origin). The modal pre-flights the target
 * against `GET /app-feedback/target` — feedback is opt-in per app, and the
 * server is the authority on the app's canonical title — then submits to
 * `POST /app-feedback`.
 *
 * @param {{ app?: string, origin?: string, source?: 'app' | 'web' }} options
 * @returns {Promise<boolean>} true iff feedback was submitted successfully.
 *   Resolves false on cancel/close/unavailable — never rejects, so IPC and
 *   popup callers can always report an answer.
 */
async function UIWindowAppFeedback (options) {
    options = options ?? {};

    return new Promise((resolve) => {
        const modal_id = `app-feedback-${++feedback_modal_seq}`;
        let settled = false;
        let sending = false;
        let closed = false;

        const authToken = puter.authToken ?? window.auth_token;
        const target_params = options.app
            ? { app: options.app }
            : { origin: options.origin };

        // Mirror what AppFeedbackService actually shares: the username
        // always, the sender's email only when it exists and is verified
        // (unverified addresses get no Reply-To, so the developer cannot
        // respond). The note must not promise either more or less.
        const shares_email = Boolean(window.user?.email && window.user?.email_confirmed);
        const privacy_note_key = shares_email
            ? 'app_feedback_privacy_note'
            : 'app_feedback_privacy_note_no_email';

        const titleId = `${modal_id}-title`;
        const h = `
            <div class="app-feedback-overlay" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
                <div class="app-feedback-modal" tabindex="-1">
                    <div class="app-feedback-head">
                        <h2 class="app-feedback-title" id="${titleId}">${i18n('app_feedback_title')}</h2>
                        <button type="button" class="app-feedback-x" aria-label="${html_encode(i18n('close'))}" title="${html_encode(i18n('close'))}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
                        </button>
                    </div>
                    <div class="app-feedback-body">
                        <div class="app-feedback-loading">${i18n('loading')}…</div>

                        <div class="app-feedback-unavailable" style="display:none;">
                            <p class="app-feedback-unavailable-message"></p>
                            <div class="app-feedback-actions">
                                <button type="button" class="app-feedback-btn app-feedback-btn-primary app-feedback-close-btn">${i18n('close')}</button>
                            </div>
                        </div>

                        <div class="app-feedback-form" style="display:none;">
                            <div class="app-feedback-target">
                                <div class="app-feedback-target-title"></div>
                                <div class="app-feedback-target-name"></div>
                            </div>
                            <p class="app-feedback-c2a">${i18n('app_feedback_c2a')}</p>
                            <textarea class="app-feedback-message" maxlength="${MESSAGE_MAX_LENGTH}" placeholder="${html_encode(i18n('app_feedback_placeholder'))}"></textarea>
                            <div class="app-feedback-counter">0 / ${MESSAGE_MAX_LENGTH}</div>
                            <p class="app-feedback-note">${i18n(privacy_note_key)}</p>
                            <p class="app-feedback-error" role="alert" style="display:none;"></p>
                            <div class="app-feedback-actions">
                                <button type="button" class="app-feedback-btn app-feedback-cancel-btn">${i18n('cancel')}</button>
                                <button type="button" class="app-feedback-btn app-feedback-btn-primary app-feedback-send-btn" disabled>${i18n('send')}</button>
                            </div>
                        </div>

                        <div class="app-feedback-success" style="display:none;">
                            <div class="app-feedback-success-check" aria-hidden="true">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                            </div>
                            <p class="app-feedback-success-text">${i18n('app_feedback_sent')}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const $overlay = $(h);
        $('body').append($overlay);
        // Kick the entrance transition on the next frame.
        requestAnimationFrame(() => $overlay.addClass('app-feedback-open'));

        const settle = (sent) => {
            if ( settled ) return;
            settled = true;
            resolve(sent === true);
        };
        const close = () => {
            if ( closed ) return;
            closed = true;
            $(document).off(`keydown.${modal_id}`);
            $overlay.removeClass('app-feedback-open');
            // Let the exit transition play, then remove.
            setTimeout(() => $overlay.remove(), 160);
            settle(false); // no-op if already settled true on success
        };

        const showPane = (pane) => {
            $overlay.find('.app-feedback-loading, .app-feedback-unavailable, .app-feedback-form, .app-feedback-success').hide();
            $overlay.find(`.app-feedback-${pane}`).show();
        };
        const showUnavailable = (messageKey) => {
            $overlay.find('.app-feedback-unavailable-message').text(i18n(messageKey));
            showPane('unavailable');
        };

        // Escape closes (unless a submit is in flight); backdrop click closes.
        $(document).on(`keydown.${modal_id}`, (e) => {
            if ( e.key === 'Escape' && ! sending ) close();
        });
        $overlay.on('mousedown', (e) => {
            // A press anywhere in the overlay must not reach initgui's global
            // mousedown -> focusWindow path: mouseover_window is computed
            // geometrically (blind to this overlay), so focusWindow would
            // focus the app window's iframe underneath — stealing keyboard
            // focus from the textarea and forwarding the click into the app.
            // This handler runs before the document-level one, and undefined
            // is the only value its guard skips.
            window.mouseover_window = undefined;
            if ( e.target === $overlay.get(0) && ! sending ) close();
        });
        // Same in-flight gate as Escape/backdrop: closing while the POST is
        // pending would settle false for a submission that still lands
        // server-side — the developer gets the email while the app is told
        // nothing was sent.
        $overlay.find('.app-feedback-x, .app-feedback-close-btn, .app-feedback-cancel-btn').on('click', () => {
            if ( ! sending ) close();
        });

        $overlay.find('.app-feedback-message').on('input', function () {
            $overlay.find('.app-feedback-counter').text(`${this.value.length} / ${MESSAGE_MAX_LENGTH}`);
            $overlay.find('.app-feedback-send-btn').prop('disabled', sending || this.value.trim() === '');
        });

        const send = async () => {
            const $btn = $overlay.find('.app-feedback-send-btn');
            const message = String($overlay.find('.app-feedback-message').val() || '').trim();
            if ( ! message || sending ) return;
            sending = true;
            $btn.prop('disabled', true);
            $overlay.find('.app-feedback-x, .app-feedback-cancel-btn').prop('disabled', true);
            $overlay.find('.app-feedback-error').hide();
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
                    $overlay.find('.app-feedback-error').text(i18n(key)).show();
                    return;
                }
                settle(true);
                showPane('success');
                setTimeout(close, SUCCESS_AUTOCLOSE_MS);
            } catch ( e ) {
                // Shown inside the form so the message survives for a retry.
                console.error('app-feedback: submit failed', e);
                $overlay.find('.app-feedback-error').text(i18n('app_feedback_error')).show();
            } finally {
                sending = false;
                $overlay.find('.app-feedback-x, .app-feedback-cancel-btn').prop('disabled', false);
                $overlay.find('.app-feedback-send-btn').prop('disabled',
                    settled || String($overlay.find('.app-feedback-message').val() || '').trim() === '');
            }
        };

        $overlay.find('.app-feedback-send-btn').on('click', send);
        // Enter alone belongs to the textarea (feedback may need paragraphs).
        $overlay.find('.app-feedback-message').on('keydown', (e) => {
            if ( e.key === 'Enter' && (e.metaKey || e.ctrlKey) ) {
                e.preventDefault();
                send();
            }
        });

        // -- Pre-flight: is this app accepting feedback, and what is it
        // called? The server is the authority — a title passed by the caller
        // could impersonate another app.
        (async () => {
            try {
                const res = await fetch(`${window.api_origin}/app-feedback/target?${new URLSearchParams(target_params)}`, {
                    headers: { 'Authorization': `Bearer ${authToken}` },
                });
                if ( ! res.ok ) throw new Error(`target check responded ${res.status}`);
                const target = await res.json();
                if ( closed ) return;
                if ( ! target.enabled ) {
                    showUnavailable('app_feedback_not_available');
                    return;
                }
                $overlay.find('.app-feedback-target-title').text(target.app?.title ?? '');
                $overlay.find('.app-feedback-target-name').text(target.app?.name ?? '');
                showPane('form');
                $overlay.find('.app-feedback-message').get(0)?.focus({ preventScroll: true });
            } catch ( e ) {
                console.error('app-feedback: target check failed', e);
                if ( ! closed ) showUnavailable('app_feedback_error');
            }
        })();
    });
}

export default UIWindowAppFeedback;
