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

// Turning two-factor authentication on, as a dashboard dialog card that
// steps through: confirm identity, scan the QR code, save the recovery
// codes, enter a code from the authenticator, done.

import postUserProtected from '../../helpers/postUserProtected.js';
import UIQRCode from '../UIQRCode.js';
import { isTouchPrimaryDevice } from './ContextMenu/ContextMenu.js';
import mountDashboardOverlay from './dashboardOverlay.js';
import { ICONS, SVG } from './UIDashboardDialog.js';
import { bindPasswordReveal, formFieldHtml } from './UIDashboardFormDialog.js';

const TFA_ICONS = {
    check: SVG('<path d="M20 6L9 17l-5-5"/>'),
    copy: SVG('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    print: SVG('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
    shield: SVG('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'),
};

const SCREEN = { identity: 0, scan: 1, codes: 2, verify: 3, done: 4 };
const CODE_LENGTH = 6;
const COPIED_RESET_MS = 2000;
// How long a refused code stays on screen before the boxes clear for a retry.
const WRONG_CODE_RESET_MS = 1200;

const t = (key) => i18n(key, [], false);

/** The TOTP secret of an `otpauth://` URL, for typing in by hand. */
const extractSecret = (url) => {
    try {
        return new URL(url).searchParams.get('secret') || '';
    } catch {
        return '';
    }
};

/**
 * @param {object} [opts]
 * @param {jQuery} [opts.$container] Where the overlay mounts; defaults to body.
 * @param {HTMLElement} [opts.returnFocusTo] Where focus goes on close.
 * @returns {Promise<boolean>} Whether 2FA was enabled before the dialog closed.
 */
export default function UIDashboard2FASetupDialog ({ $container, returnFocusTo } = {}) {
    const id = `dashboard-tfa-${window.uuidv4?.() ?? Date.now()}`;
    const oidc_only = !! window.user?.oidc_only;

    const step = (n, label, dot = n) => '<div class="tfa-progress-step">'
        + `<div class="tfa-progress-dot" data-step="${n}">${dot}</div>`
        + `<span class="tfa-progress-label">${label}</span>`
        + '</div>';
    const line = '<div class="tfa-progress-line"><div class="tfa-progress-line-fill"></div></div>';
    const action = (screen, label, extra = '') =>
        `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-primary tfa-action" data-screen="${screen}"${extra}>${label}</button>`;

    let h = `<div class="dashboard-dialog dashboard-tfa-dialog" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="${id}-title">`;
    h += '<div class="dashboard-dialog-header">';
    h += `<span class="dashboard-dialog-title" id="${id}-title">${i18n('two_factor')}</span>`;
    h += `<button type="button" class="dashboard-dialog-close" aria-label="${i18n('close')}" title="${i18n('close')}">${ICONS.close}</button>`;
    h += '</div>';
    h += '<div class="dashboard-dialog-body">';
    h += '<div class="dashboard-dialog-content tfa-setup">';

    // Shown once identity is confirmed.
    h += '<div class="tfa-progress" hidden>';
    h += step(SCREEN.scan, i18n('setup2fa_step_scan')) + line;
    h += step(SCREEN.codes, i18n('setup2fa_step_backup')) + line;
    h += step(SCREEN.verify, i18n('setup2fa_step_verify')) + line;
    h += step(SCREEN.done, i18n('done'), TFA_ICONS.check);
    h += '</div>';

    h += `<div class="tfa-screen" data-screen="${SCREEN.identity}">`;
    h += `<p class="tfa-instruction">${i18n(oidc_only ? 'revalidate_flow_notice' : 'setup2fa_password_instructions')}</p>`;
    if ( ! oidc_only ) {
        h += formFieldHtml({ name: 'password', type: 'password', label: i18n('password'), attrs: { autocomplete: 'current-password' } }, id);
    }
    h += '<div class="dashboard-form-status tfa-identity-status" role="status" aria-live="polite"></div>';
    h += '</div>';

    h += `<div class="tfa-screen" data-screen="${SCREEN.scan}" hidden>`;
    h += `<p class="tfa-instruction">${t('setup2fa_1_instructions')}</p>`;
    h += '<div class="tfa-qr-area"></div>';
    h += '<div class="tfa-secret-row" hidden>';
    h += '<span class="tfa-secret-key enable-user-select"></span>';
    h += `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-quiet dashboard-icon-btn tfa-copy-secret" title="${i18n('setup2fa_copy_secret')}" aria-label="${i18n('setup2fa_copy_secret')}">${TFA_ICONS.copy}</button>`;
    h += '</div>';
    h += '</div>';

    h += `<div class="tfa-screen" data-screen="${SCREEN.codes}" hidden>`;
    h += `<p class="tfa-instruction">${t('setup2fa_4_instructions')}</p>`;
    h += '<div class="tfa-codes-card">';
    h += '<div class="tfa-codes-grid enable-user-select"></div>';
    h += '<div class="tfa-codes-actions">';
    h += `<button type="button" class="tfa-copy-codes">${TFA_ICONS.copy} <span>${i18n('copy')}</span></button>`;
    h += `<button type="button" class="tfa-print-codes">${TFA_ICONS.print} <span>${i18n('print')}</span></button>`;
    h += '</div>';
    h += '</div>';
    h += '<iframe class="tfa-print-frame" width="0" height="0" frameborder="0" src="about:blank" hidden></iframe>';
    h += '<div class="tfa-confirmations">';
    for ( const [key, label] of [['saved', 'setup2fa_5_confirmation_1'], ['ready', 'setup2fa_5_confirmation_2']] ) {
        h += '<div class="tfa-confirm-item">';
        h += `<input type="checkbox" id="${id}-${key}">`;
        h += `<label for="${id}-${key}">${i18n(label)}</label>`;
        h += '</div>';
    }
    h += '</div>';
    h += '</div>';

    h += `<div class="tfa-screen" data-screen="${SCREEN.verify}" hidden>`;
    h += `<p class="tfa-instruction" id="${id}-verify">${i18n('setup2fa_3_step_heading')}</p>`;
    h += `<div class="login-2fa-code-inputs" role="group" aria-labelledby="${id}-verify">`;
    for ( let i = 0; i < CODE_LENGTH; i++ ) {
        h += `<input type="text" class="dashboard-dialog-input" inputmode="numeric" maxlength="1" autocomplete="off" data-idx="${i}" aria-label="${i + 1}">`;
    }
    h += '</div>';
    h += '<div class="dashboard-form-status tfa-code-status" role="status" aria-live="polite"></div>';
    h += '</div>';

    h += `<div class="tfa-screen" data-screen="${SCREEN.done}" hidden>`;
    h += `<div class="tfa-success-icon">${TFA_ICONS.shield}</div>`;
    h += `<div class="tfa-success-title">${i18n('two_factor_enabled')}</div>`;
    h += `<p class="tfa-success-text">${i18n('setup2fa_success_text')}</p>`;
    h += '</div>';

    h += '</div></div>';
    h += '<div class="dashboard-dialog-footer">';
    h += action(SCREEN.identity, i18n('continue'));
    h += action(SCREEN.scan, i18n('continue'), ' hidden');
    h += action(SCREEN.codes, i18n('continue'), ' hidden disabled');
    h += action(SCREEN.done, i18n('done'), ' hidden');
    h += '</div></div>';

    return new Promise((resolve) => {
        let screen = SCREEN.identity;
        let setup_succeeded = false;
        let is_confirming = false;
        let is_verifying = false;
        let setup_data = null;
        let secret = '';

        // The secret and the recovery codes are shown once, so a stray click
        // outside the card doesn't close them; while a request is out, only
        // the ✕ does. However it closes, 2FA is on once the server said so.
        const { $dialog, close, isClosed } = mountDashboardOverlay({
            html: h,
            $container,
            returnFocusTo,
            canDismiss: (via) => via === 'close' || ! (
                is_confirming || is_verifying
                || (via === 'backdrop' && screen > SCREEN.identity && screen < SCREEN.done)
            ),
            onDismiss: () => resolve(setup_succeeded),
        });
        const el_dialog = $dialog.get(0);
        const $password = $dialog.find('.dashboard-form-input[name="password"]');
        const $identity_status = $dialog.find('.tfa-identity-status');
        const $code_status = $dialog.find('.tfa-code-status');
        const $inputs = $dialog.find('.login-2fa-code-inputs input');
        const $action = (n) => $dialog.find(`.tfa-action[data-screen="${n}"]`);

        const setStatus = ($status, text, kind = 'error') => {
            $status.text(text ?? '')
                .toggleClass('dashboard-form-status-error', !! text && kind === 'error')
                .toggleClass('dashboard-form-status-info', !! text && kind === 'info');
        };

        // A keyboard popping up mid-animation on a phone hides half the sheet.
        (isTouchPrimaryDevice() || ! $password.length ? $dialog : $password).get(0)?.focus({ preventScroll: true });
        bindPasswordReveal($dialog);

        const goToScreen = (n) => {
            screen = n;
            $dialog.find('.tfa-screen').each(function () {
                this.hidden = Number(this.dataset.screen) !== n;
            });
            $dialog.find('.tfa-action').each(function () {
                this.hidden = Number(this.dataset.screen) !== n;
            });
            // The verify step submits by itself once the code is typed.
            $dialog.find('.dashboard-dialog-footer').prop('hidden', n === SCREEN.verify);
            $dialog.find('.tfa-progress').prop('hidden', n === SCREEN.identity);

            $dialog.find('.tfa-progress-step').each(function () {
                const $dot = $(this).find('.tfa-progress-dot');
                const at = Number($dot.attr('data-step'));
                $dot.toggleClass('done', at < n).toggleClass('active', at === n);
                $(this).find('.tfa-progress-label').toggleClass('active', at <= n);
            });
            $dialog.find('.tfa-progress-line-fill').each(function (index) {
                $(this).css('width', index < n - 1 ? '100%' : '0%');
            });

            const body = $dialog.find('.dashboard-dialog-body').get(0);
            if ( body ) body.scrollTop = 0;
            // The button that was pressed is hidden now; move on to the step's own.
            const $next = n === SCREEN.verify ? $inputs.first() : $action(n).not(':disabled');
            ($next.get(0) ?? el_dialog).focus({ preventScroll: true });
        };

        const showSetup = (data) => {
            setup_data = data;
            secret = extractSecret(data.url);
            if ( secret ) {
                $dialog.find('.tfa-secret-key').text(secret);
                $dialog.find('.tfa-secret-row').prop('hidden', false);
            }
            $dialog.find('.tfa-codes-grid').html(data.codes.map((code, i) =>
                `<div class="tfa-code-item"><span class="tfa-code-item-idx">${i + 1}.</span>${html_encode(code)}</div>`).join(''));
            // Drawn large and scaled down, so enlarging it stays sharp.
            UIQRCode({
                value: data.url,
                size: 400,
                enlarge_option: false,
                appendTo: $dialog.find('.tfa-qr-area').get(0),
            });
            goToScreen(SCREEN.scan);
        };

        // Setup hands out the secret, so like disabling 2FA it needs the
        // password, or a sign-in with the linked provider.
        const confirmIdentity = async () => {
            if ( is_confirming ) return;
            setStatus($identity_status, '');
            const password = oidc_only ? undefined : String($password.val() ?? '');
            if ( ! oidc_only && ! password ) {
                setStatus($identity_status, t('all_fields_required'));
                $password.attr('aria-invalid', 'true').get(0)?.focus({ preventScroll: true });
                return;
            }

            is_confirming = true;
            $action(SCREEN.identity).prop('disabled', true);
            try {
                const result = await postUserProtected('setup-2fa', {}, {
                    password,
                    onRevalidate: () => setStatus($identity_status, t('revalidate_sign_in_popup'), 'info'),
                });
                if ( isClosed() ) return;
                if ( ! result.ok ) {
                    setStatus($identity_status, result.message || t('something_went_wrong'));
                    if ( result.data.code === 'password_mismatch' ) $password.attr('aria-invalid', 'true');
                    return;
                }
                showSetup(result.data);
            } catch {
                // The request never got an answer (offline).
                if ( ! isClosed() ) setStatus($identity_status, t('something_went_wrong'));
            } finally {
                is_confirming = false;
                $action(SCREEN.identity).prop('disabled', false);
                if ( ! isClosed() && screen === SCREEN.identity && ! el_dialog.contains(document.activeElement) ) {
                    ($password.get(0) ?? el_dialog).focus({ preventScroll: true });
                }
            }
        };

        $action(SCREEN.identity).on('click', confirmIdentity);
        $password.on('keydown', function (e) {
            if ( e.key !== 'Enter' ) return;
            e.preventDefault();
            confirmIdentity();
        });
        $password.on('input', function () {
            $(this).removeAttr('aria-invalid');
        });
        $action(SCREEN.scan).on('click', () => goToScreen(SCREEN.codes));
        $action(SCREEN.codes).on('click', () => goToScreen(SCREEN.verify));
        $action(SCREEN.done).on('click', () => {
            close();
            resolve(true);
        });

        $dialog.on('click', '.tfa-qr-area img', function () {
            $dialog.find('.tfa-qr-area').toggleClass('tfa-qr-large');
        });

        // The code is asked for on the last step, right before it's used, so
        // it can't expire while the recovery codes are being saved. A network
        // failure is a refusal like any other, so the boxes come back.
        const enable2FA = async (code) => {
            is_verifying = true;
            $inputs.prop('disabled', true);
            setStatus($code_status, t('setup2fa_enabling'), 'info');

            let ok = false;
            let data = {};
            try {
                const res = await fetch(`${window.api_origin}/auth/configure-2fa/enable`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${puter.authToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ code }),
                });
                ok = res.ok;
                data = await res.json().catch(() => ({}));
            } catch { /* handled as a refusal below */ }

            is_verifying = false;
            if ( ok ) {
                setup_succeeded = true;
                if ( ! isClosed() ) {
                    setStatus($code_status, '');
                    goToScreen(SCREEN.done);
                }
                return;
            }
            if ( isClosed() ) return;
            $inputs.addClass('login-2fa-wrong').prop('disabled', false);
            setStatus($code_status, data.code === 'code_mismatch'
                ? t('confirm_code_generic_incorrect')
                : (data.message || t('something_went_wrong')));
            setTimeout(() => {
                $inputs.val('').removeClass('login-2fa-wrong');
                if ( ! isClosed() && screen === SCREEN.verify ) $inputs.first().get(0)?.focus({ preventScroll: true });
            }, WRONG_CODE_RESET_MS);
        };

        const typedCode = () => $inputs.map(function () {
            return $(this).val();
        }).get().join('');

        $inputs.on('input', function () {
            const idx = Number($(this).attr('data-idx'));
            const digits = String($(this).val()).replace(/\D/g, '');
            $(this).val(digits.slice(0, 1)).removeClass('login-2fa-wrong');
            if ( ! is_verifying ) setStatus($code_status, '');
            if ( digits && idx < CODE_LENGTH - 1 ) $inputs.eq(idx + 1).focus();
            const code = typedCode();
            if ( code.length === CODE_LENGTH && ! is_verifying ) enable2FA(code);
        });

        // A box holds one digit, so typing into a filled one has to replace it.
        $inputs.on('focus', function () {
            this.select();
        });

        $inputs.on('keydown', function (e) {
            const idx = Number($(this).attr('data-idx'));
            if ( e.key === 'Backspace' && ! $(this).val() && idx > 0 ) {
                $inputs.eq(idx - 1).focus().val('');
            }
            if ( e.key === 'ArrowLeft' && idx > 0 ) {
                e.preventDefault();
                $inputs.eq(idx - 1).focus();
            }
            if ( e.key === 'ArrowRight' && idx < CODE_LENGTH - 1 ) {
                e.preventDefault();
                $inputs.eq(idx + 1).focus();
            }
        });

        $inputs.on('paste', function (e) {
            e.preventDefault();
            const pasted = (e.originalEvent.clipboardData || window.clipboardData)
                .getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
            if ( ! pasted ) return;
            $inputs.each(function (i) {
                $(this).val(pasted[i] || '');
            });
            $inputs.eq(pasted.length - 1).focus();
            if ( pasted.length === CODE_LENGTH && ! is_verifying ) enable2FA(pasted);
        });

        // An insecure origin has no navigator.clipboard; the text stays selectable.
        const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

        $dialog.find('.tfa-copy-secret').on('click', function () {
            copy(secret);
            const $btn = $(this).html(TFA_ICONS.check);
            setTimeout(() => $btn.html(TFA_ICONS.copy), COPIED_RESET_MS);
        });

        $dialog.find('.tfa-copy-codes').on('click', function () {
            copy(setup_data.codes.join('\n'));
            const $btn = $(this).addClass('copied');
            $btn.find('span').text(t('copied'));
            setTimeout(() => {
                $btn.removeClass('copied').find('span').text(t('copy'));
            }, COPIED_RESET_MS);
        });

        $dialog.find('.tfa-print-codes').on('click', function () {
            const grid_html = $dialog.find('.tfa-codes-grid').get(0).outerHTML;
            const print_window = $dialog.find('.tfa-print-frame').get(0).contentWindow;
            const style = '<style>body{font-family:monospace;padding:20px} .tfa-codes-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px} .tfa-code-item{padding:8px;font-size:14px;display:flex;gap:8px} .tfa-code-item-idx{color:#999}</style>';
            print_window.document.body.innerHTML = `${style}<h2>${i18n('setup2fa_recovery_codes')}</h2>${grid_html}`;
            print_window.focus();
            print_window.print();
        });

        const $confirmations = $dialog.find('.tfa-confirmations input[type="checkbox"]');
        $confirmations.on('change', function () {
            $action(SCREEN.codes).prop('disabled', ! $confirmations.toArray().every(el => el.checked));
        });
    });
}
