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

// The second factor of a login: a code from the user's authenticator app,
// or one of their recovery codes. Verifies the challenge the first factor
// (a password, or an identity provider) was answered with.

import { SVG } from '../Dashboard/UIDashboardDialog.js';
import openAuthFlow, { keepCurrentSession, setAuthStatus } from './authFlow.js';

const CODE_LENGTH = 6;
const RECOVERY_CODE_LENGTH = 8;
// How long a wrong code stays on screen before the boxes clear for another try.
const WRONG_CODE_MS = 1200;

const SHIELD_ICON = SVG('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>');

/**
 * Sends a code for the challenge. Both routes are `guiOriginOnly` and carry
 * no `subdomain`, so they go to the root origin: on `api_origin` the
 * subdomain gate skips them and Express 404s.
 *
 * @param {'otp'|'recovery-code'} route
 * @param {string} token The first factor's challenge.
 * @param {string} code
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: string }>}
 *   `error` is an i18n key.
 */
export const verifySecondFactor = async (route, token, code) => {
    try {
        const resp = await fetch(`${window.gui_origin}/login/${route}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, code }),
        });
        if ( resp.status === 429 ) return { ok: false, error: 'confirm_code_generic_too_many_requests' };
        const data = await resp.json();
        if ( ! data?.proceed ) return { ok: false, error: 'confirm_code_generic_incorrect' };
        return { ok: true, data };
    } catch {
        return { ok: false, error: 'something_went_wrong' };
    }
};

/**
 * A screen's head: the shield, a title and what to do.
 *
 * @param {string} title i18n key.
 * @param {string} instructions i18n key.
 * @returns {string}
 */
const headHtml = (title, instructions) => '<div class="auth-head">'
    + `<div class="auth-badge" aria-hidden="true">${SHIELD_ICON}</div>`
    + `<h1 class="auth-title">${i18n(title)}</h1>`
    + `<p class="auth-subtitle">${i18n(instructions)}</p>`
    + '</div>';

/**
 * Shows the recovery code screen over the code screen; Back returns to it.
 *
 * @param {import('./authFlow.js').AuthFlow} flow
 * @param {string} token
 * @param {(data: object) => void} onVerified
 */
const pushRecoveryScreen = (flow, token, onVerified) => {
    let h = '<div class="dashboard-dialog-body auth-body">';
    h += headHtml('login2fa_recovery_title', 'login2fa_recovery_instructions');
    h += '<form class="auth-form login-2fa-recovery-form" novalidate>';
    h += '<div class="dashboard-form-status" role="status" aria-live="polite"></div>';
    h += `<input type="text" class="dashboard-dialog-input login-2fa-recovery-input" maxlength="${RECOVERY_CODE_LENGTH}"`;
    h += ` placeholder="${html_encode(i18n('login2fa_recovery_placeholder', [], false))}" aria-label="${i18n('login2fa_recovery_title')}"`;
    h += ' autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false">';
    h += '</form>';
    h += '</div>';

    const $screen = flow.push({ name: 'recovery-code', html: h });
    const $input = $screen.find('.login-2fa-recovery-input');
    let verifying = false;

    const verify = async () => {
        // Codes are 8-char base32; a pasted one usually carries the newline
        // it was copied with.
        const value = String($input.val() ?? '').trim().toUpperCase();
        if ( value.length !== RECOVERY_CODE_LENGTH || verifying ) return;
        verifying = true;
        flow.setBusy(true);
        setAuthStatus($screen, i18n('verifying', [], false), { kind: 'info' });
        const result = await verifySecondFactor('recovery-code', token, value);
        verifying = false;
        if ( flow.isClosed() ) {
            if ( result.ok ) keepCurrentSession();
            return;
        }
        if ( result.ok ) {
            onVerified(result.data);
            return;
        }
        flow.setBusy(false);
        setAuthStatus($screen, i18n(result.error, [], false), { field: '.login-2fa-recovery-input' });
        $input.get(0)?.select();
    };

    $input.on('input', verify);
    $screen.find('form').on('submit', (e) => {
        e.preventDefault();
        verify();
    });
};

/**
 * Shows the code screen in `flow`. Back leaves it unanswered.
 *
 * @param {import('./authFlow.js').AuthFlow} flow
 * @param {string} token The first factor's challenge.
 * @param {{ onBack?: () => void }} [opts] `onBack` makes Back available when
 *   this is the flow's first screen.
 * @returns {Promise<object | null>} What the server answered a verified code
 *   with (the session's token and user, and where to go); null when the user
 *   went back or the flow closed.
 */
export function pushTwoFactorScreen (flow, token, { onBack } = {}) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (value) => {
            if ( done ) return;
            done = true;
            resolve(value);
        };

        let h = '<div class="dashboard-dialog-body auth-body">';
        h += headHtml('login2fa_otp_title', 'login2fa_otp_instructions');
        h += '<form class="auth-form login-2fa-form" novalidate>';
        h += '<div class="dashboard-form-status" role="status" aria-live="polite"></div>';
        h += `<div class="login-2fa-code-inputs" role="group" aria-label="${i18n('login2fa_otp_title')}">`;
        for ( let i = 0; i < CODE_LENGTH; i++ ) {
            // The first box takes a whole code from autofill or a paste.
            h += `<input type="text" class="dashboard-dialog-input" inputmode="numeric" pattern="[0-9]*" data-idx="${i}"`;
            h += ` aria-label="${i + 1}" autocomplete="${i === 0 ? 'one-time-code' : 'off'}">`;
        }
        h += '</div>';
        h += `<div class="auth-link-row"><button type="button" class="auth-link login-2fa-to-recovery">${i18n('login2fa_use_recovery_code')}</button></div>`;
        h += '</form>';
        h += '</div>';

        const $screen = flow.push({
            name: 'two-factor',
            html: h,
            onBack: onBack ?? undefined,
            onLeave: () => finish(null),
        });
        const $inputs = $screen.find('.login-2fa-code-inputs input');
        let verifying = false;

        const code = () => $inputs.map(function () {
            return $(this).val();
        }).get().join('');

        const verified = (data) => finish(data);

        const verify = async (value) => {
            if ( verifying || value.length !== CODE_LENGTH ) return;
            verifying = true;
            flow.setBusy(true);
            $inputs.prop('disabled', true);
            setAuthStatus($screen, i18n('verifying', [], false), { kind: 'info' });
            const result = await verifySecondFactor('otp', token, value);
            verifying = false;
            // Dismissed while the code was out: stay signed in as before.
            if ( flow.isClosed() ) {
                if ( result.ok ) keepCurrentSession();
                return;
            }
            if ( result.ok ) {
                verified(result.data);
                return;
            }
            flow.setBusy(false);
            $inputs.prop('disabled', false);
            setAuthStatus($screen, i18n(result.error, [], false));
            $inputs.addClass('login-2fa-wrong').attr('aria-invalid', 'true');
            setTimeout(() => {
                if ( verifying ) return;
                $inputs.val('').removeClass('login-2fa-wrong').removeAttr('aria-invalid');
                if ( ! $screen.prop('hidden') ) $inputs.first().trigger('focus');
            }, WRONG_CODE_MS);
        };

        /** Spreads digits over the boxes from `start`, and verifies a full code. */
        const fill = (digits, start) => {
            for ( let i = 0; i < digits.length && start + i < CODE_LENGTH; i++ ) {
                $inputs.eq(start + i).val(digits[i]);
            }
            const next = Math.min(start + digits.length, CODE_LENGTH - 1);
            $inputs.eq(next).trigger('focus');
            verify(code());
        };

        $inputs.on('input', function () {
            const idx = Number($(this).attr('data-idx'));
            const digits = String($(this).val() ?? '').replace(/\D/g, '');
            $inputs.removeClass('login-2fa-wrong').removeAttr('aria-invalid');
            if ( ! digits ) {
                $(this).val('');
                return;
            }
            // One digit typed, or a whole code autofilled into this box.
            $(this).val(digits[0]);
            if ( digits.length > 1 ) {
                fill(digits.slice(1), idx + 1);
                return;
            }
            if ( idx < CODE_LENGTH - 1 ) $inputs.eq(idx + 1).trigger('focus');
            verify(code());
        });

        $inputs.on('keydown', function (e) {
            const idx = Number($(this).attr('data-idx'));
            if ( e.key === 'Backspace' && ! $(this).val() && idx > 0 ) {
                e.preventDefault();
                $inputs.eq(idx - 1).val('').trigger('focus');
            } else if ( e.key === 'ArrowLeft' && idx > 0 ) {
                e.preventDefault();
                $inputs.eq(idx - 1).trigger('focus');
            } else if ( e.key === 'ArrowRight' && idx < CODE_LENGTH - 1 ) {
                e.preventDefault();
                $inputs.eq(idx + 1).trigger('focus');
            }
        });

        $inputs.on('focus', function () {
            this.select();
        });

        $inputs.on('paste', function (e) {
            e.preventDefault();
            const clipboard = e.originalEvent?.clipboardData ?? window.clipboardData;
            const pasted = String(clipboard?.getData('text') ?? '').replace(/\D/g, '').slice(0, CODE_LENGTH);
            if ( ! pasted ) return;
            $inputs.val('');
            fill(pasted, 0);
        });

        $screen.find('form').on('submit', (e) => {
            e.preventDefault();
            verify(code());
        });

        $screen.find('.login-2fa-to-recovery').on('click', () => {
            if ( flow.isBusy() ) return;
            $inputs.val('').removeClass('login-2fa-wrong').removeAttr('aria-invalid');
            setAuthStatus($screen, '');
            pushRecoveryScreen(flow, token, verified);
        });
    });
}

/**
 * Asks for the second factor of a login on a page of its own (an identity
 * provider's login that came back needing one). The card stays up, busy,
 * once the code is verified: the caller is expected to navigate.
 *
 * @param {string} token The first factor's challenge.
 * @returns {Promise<object | null>} The server's answer to a verified code;
 *   null when the user chose to go back to the login.
 */
export default function UIAuth2FA (token) {
    const flow = openAuthFlow({ page: true });
    const answer = pushTwoFactorScreen(flow, token, {
        onBack: () => flow.settle(null),
    });
    answer.then((data) => {
        if ( data ) flow.setBusy(true);
        flow.settle(data);
    });
    return flow.result;
}
