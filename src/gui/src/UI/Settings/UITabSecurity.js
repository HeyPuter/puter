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
import UIWindow2FASetup from '../UIWindow2FASetup.js';
import UIWindowDisable2FA from './UIWindowDisable2FA.js';
import UIWindowWebAuthnSetup from '../UIWindowWebAuthnSetup.js';
import UIWindowChangePassword from '../UIWindowChangePassword.js';
import UIAlert from '../UIAlert.js';

const CARD_STYLE = 'border:1px solid #cccccc8f; border-radius:4px; background:#f7f7f7a1; margin-bottom:20px; padding:10px 15px;';

export default {
    id: 'security',
    title_i18n_key: 'security',
    icon: 'shield.svg',
    html: () => {
        let h = `<h1>${i18n('security')}</h1>`;
        let user = window.user;

        // change password button
        if ( ! user.is_temp ) {
            h += '<div class="settings-card">';
            h += `<strong>${i18n('password')}</strong>`;
            h += '<div style="flex-grow:1;">';
            h += `<button class="button password-action-btn" style="float:right;">${i18n('change_password')}</button>`;
            h += '</div>';
            h += '</div>';
        }

        // session manager
        h += '<div class="settings-card">';
        h += `<strong>${i18n('sessions')}</strong>`;
        h += '<div style="flex-grow:1;">';
        h += `<button class="button manage-sessions" style="float:right;">${i18n('manage_sessions')}</button>`;
        h += '</div>';
        h += '</div>';

        // configure 2FA (OTP)
        if ( !user.is_temp && user.email_confirmed ) {
            h += `<div class="settings-card settings-card-security ${user.otp ? 'settings-card-success' : 'settings-card-warning'}">`;
            h += '<div style="display:flex; align-items:center; width:100%;">';
            h += '<div>';
            h += `<strong style="display:block;">${i18n('two_factor')}</strong>`;
            h += `<span class="user-otp-state" style="display:block; margin-top:5px;">${
                i18n(user.otp ? 'two_factor_enabled' : 'two_factor_disabled')
            }</span>`;
            h += '</div>';
            h += '<div style="flex-grow:1;">';
            h += `<span class="enable-2fa-wrapper" style="float:right;${user.otp ? 'display:none;' : 'display:inline-block;'}">`;
            h += `<button class="button enable-2fa">${i18n('enable_2fa')}</button>`;
            h += '</span>';
            h += `<button class="button disable-2fa" style="float:right;${user.otp ? '' : 'display:none;'}">${i18n('disable_2fa')}</button>`;
            h += '</div>';
            h += '</div>';
            h += '</div>';
        }

        // Passkeys & Security Keys (WebAuthn)
        if ( !user.is_temp && window.PublicKeyCredential ) {
            // Custom card: same look as settings-card but column layout, no overflow:hidden
            h += `<div style="${CARD_STYLE}">`;
            // Header row: title left, button right — same as Password/Sessions cards
            h += '<div style="display:flex; align-items:center;">';
            h += `<strong>${i18n('webauthn_section_title')}</strong>`;
            h += '<div style="flex-grow:1;">';
            h += `<button class="button add-webauthn-key" style="float:right;">${i18n('webauthn_add_key')}</button>`;
            h += '</div>';
            h += '</div>';
            // Content area below header (text when empty, rows when populated)
            h += `<div class="webauthn-credentials-list" style="margin-top:8px; font-size:13px; color:#888;">${i18n('loading')}</div>`;
            h += '</div>';
        }

        // Passwordless login toggle — hidden initially, shown by render_credentials() once
        // we know at least one passkey is registered (avoids depending on window.user.webauthn_enabled)
        if ( !user.is_temp && window.PublicKeyCredential ) {
            h += `<div class="passwordless-card" style="${CARD_STYLE} display:none;">`;
            h += '<div style="display:flex; align-items:center;">';
            h += '<div>';
            h += `<strong style="display:block;">${i18n('passwordless_login_title')}</strong>`;
            h += '<span class="passwordless-state" style="display:block; margin-top:4px; font-size:13px; color:#888;"></span>';
            h += '</div>';
            h += '<div style="flex-grow:1;">';
            h += `<button class="button remove-password-btn" style="float:right; display:none;">${i18n('passwordless_remove_password')}</button>`;
            h += `<span class="passwordless-active-badge" style="float:right; padding:6px 10px; color:#27ae60; font-weight:600; display:none;">${i18n('passwordless_login_active')}</span>`;
            h += '</div>';
            h += '</div>';
            // Inline confirm row — shown when user clicks "Remove Password" (avoids UIAlert/.close() issues)
            h += '<div class="passwordless-confirm-row" style="display:none; margin-top:10px; padding:8px 10px; background:#fff3cd; border-radius:6px; border:1px solid #ffc107;">';
            h += `<span style="font-size:12px; color:#856404;">${i18n('passwordless_confirm_message')}</span>`;
            h += '<div style="margin-top:8px;">';
            h += `<button class="button button-small button-danger confirm-remove-password-btn">${i18n('confirm')}</button>`;
            h += `<button class="button button-small cancel-remove-password-btn" style="margin-left:6px;">${i18n('cancel')}</button>`;
            h += '</div>';
            h += '</div>';
            // Inline status message — shows success or error without a modal
            h += '<p class="passwordless-status-msg" style="margin:8px 0 0; font-size:12px; display:none;"></p>';
            h += `<p class="passwordless-warning" style="margin:8px 0 0 0; font-size:12px; color:#e67e22; display:none;">${i18n('passwordless_warning')}</p>`;
            h += '</div>';
        }

        return h;
    },
    init: ($el_window) => {
        let is_passwordless_mode = false;

        // Fast custom tooltip — native title has ~1s delay and doesn't work on disabled elements.
        // Elements use data-tooltip="text"; the wrapper span receives hover even when the inner
        // button is disabled.
        const $tip = $('<div style="position:fixed;background:#1a1a1a;color:#fff;font-size:11px;line-height:1.4;padding:5px 8px;border-radius:5px;pointer-events:none;display:none;z-index:99999;max-width:220px;white-space:normal;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.3);"></div>').appendTo('body');
        $el_window
            .on('mouseenter', '[data-tooltip]', function () {
                const text = $(this).attr('data-tooltip');
                if ( ! text ) return;
                $tip.text(text).show();
                const r = this.getBoundingClientRect();
                const tw = $tip.outerWidth(), th = $tip.outerHeight();
                let top = r.top - th - 6;
                let left = Math.max(4, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 4));
                if ( top < 4 ) top = r.bottom + 6;
                $tip.css({ top, left });
            })
            .on('mouseleave', '[data-tooltip]', () => $tip.hide());
        $el_window.on('remove', () => $tip.remove());

        // OTP 2FA (unchanged)
        $el_window.find('.enable-2fa').on('click', async function () {
            const { promise } = await UIWindow2FASetup();
            const tfa_was_enabled = await promise;
            if ( tfa_was_enabled ) {
                $el_window.find('.enable-2fa-wrapper').hide();
                $el_window.find('.disable-2fa').show();
                $el_window.find('.user-otp-state').text(i18n('two_factor_enabled'));
                $el_window.find('.settings-card-security').removeClass('settings-card-warning').addClass('settings-card-success');
            }
        });

        $el_window.find('.disable-2fa').on('click', async function () {
            const { promise } = await UIWindowDisable2FA();
            const tfa_was_disabled = await promise;
            if ( tfa_was_disabled ) {
                $el_window.find('.enable-2fa-wrapper').show();
                $el_window.find('.disable-2fa').hide();
                $el_window.find('.user-otp-state').text(i18n('two_factor_disabled'));
                $el_window.find('.settings-card-security').removeClass('settings-card-success').addClass('settings-card-warning');
            }
        });

        // WebAuthn: render credentials list
        const render_credentials = async () => {
            const $list = $el_window.find('.webauthn-credentials-list');
            if ( ! $list.length ) return;

            $list.css({ display: 'block', 'font-size': '13px', color: '#888', 'margin-top': '8px' })
                .html(i18n('loading'));

            try {
                const resp = await fetch(`${window.api_origin}/auth/webauthn/credentials`, {
                    headers: { Authorization: `Bearer ${puter.authToken}` },
                });
                const data = await resp.json();
                const creds = data.credentials || [];

                // Always sync the authoritative password_required value from the API
                const is_passwordless = Number(data.password_required) === 0;
                is_passwordless_mode = is_passwordless;
                $el_window.find('.password-action-btn')
                    .text(i18n(is_passwordless ? 'add_password' : 'change_password'));

                if ( creds.length === 0 ) {
                    $list.css({ display: 'block', 'font-size': '13px', color: '#888', 'margin-top': '8px' })
                        .html(i18n('webauthn_no_keys'));
                    $el_window.find('.passwordless-card').hide();
                    return;
                }

                // At least one passkey exists — reveal the passwordless card with correct state
                $el_window.find('.passwordless-card').show();
                $el_window.find('.passwordless-state')
                    .text(i18n(is_passwordless ? 'passwordless_login_enabled' : 'passwordless_login_disabled'));
                $el_window.find('.remove-password-btn').toggle(!is_passwordless);
                $el_window.find('.passwordless-active-badge').toggle(is_passwordless);
                $el_window.find('.passwordless-warning').toggle(!is_passwordless);
                // Always reset the inline confirm row and status message on re-render
                $el_window.find('.passwordless-confirm-row').hide();
                $el_window.find('.confirm-remove-password-btn').prop('disabled', false).text(i18n('confirm'));
                $el_window.find('.passwordless-status-msg').hide().text('');

                // Disable the Enable 2FA button while passwordless login is active
                $el_window.find('.enable-2fa').prop('disabled', is_passwordless);
                $el_window.find('.enable-2fa-wrapper')
                    .attr('data-tooltip', is_passwordless ? i18n('two_factor_disabled_passwordless') : null)
                    .css('cursor', is_passwordless ? 'not-allowed' : '');

                // Show credential rows
                $list.css({ display: 'flex',
                    'flex-direction': 'column',
                    gap: '8px',
                    'font-size': '',
                    color: '',
                    'margin-top': '12px' })
                    .html('');

                creds.forEach(cred => {
                    const type_label = cred.backed_up
                        ? i18n('webauthn_type_passkey')
                        : i18n('webauthn_type_security_key');
                    const last_used = cred.last_used_at
                        ? new Date(cred.last_used_at).toLocaleDateString()
                        : i18n('webauthn_never_used');
                    const display_name = $('<span>').text(cred.name || i18n('webauthn_unnamed_key')).html();

                    const $row = $(`
                        <div style="display:flex; align-items:center; padding:8px 10px; background:#fff; border-radius:6px; border:1px solid #e0e0e0;">
                            <div style="flex-grow:1; min-width:0;">
                                <strong style="display:block;">${display_name}</strong>
                                <span style="font-size:12px; color:#888;">${type_label} · ${i18n('webauthn_last_used')}: ${last_used}</span>
                            </div>
                            <button class="button button-small rename-key" style="margin-right:6px; flex-shrink:0;">${i18n('rename')}</button>
                            <span class="delete-key-wrapper" style="flex-shrink:0; display:inline-block;">
                                <button class="button button-small button-danger delete-key">${i18n('delete')}</button>
                            </span>
                        </div>
                    `);

                    if ( is_passwordless ) {
                        $row.find('.delete-key').prop('disabled', true);
                        $row.find('.delete-key-wrapper')
                            .attr('data-tooltip', i18n('webauthn_delete_disabled_passwordless'))
                            .css('cursor', 'not-allowed');
                    }

                    $row.find('.rename-key').on('click', async function () {
                        const new_name = prompt(i18n('webauthn_rename_prompt'), cred.name || '');
                        if ( !new_name || !new_name.trim() ) return;
                        await fetch(`${window.api_origin}/auth/webauthn/credentials/${cred.id}/rename`, {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${puter.authToken}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ name: new_name.trim() }),
                        });
                        await render_credentials();
                    });

                    $row.find('.delete-key').on('click', async function () {
                        if ( ! confirm(i18n('webauthn_delete_confirm')) ) return;
                        const resp = await fetch(`${window.api_origin}/auth/webauthn/credentials/${cred.id}`, {
                            method: 'DELETE',
                            headers: { Authorization: `Bearer ${puter.authToken}` },
                        });
                        if ( ! resp.ok ) {
                            let message = i18n('something_went_wrong');
                            try {
                                const data = await resp.json();
                                message = data.error || message;
                            } catch {
                                // Keep generic error message fallback.
                            }
                            await UIAlert({
                                message,
                                parent_uuid: $el_window.attr('data-element_uuid'),
                            });
                            return;
                        }
                        await render_credentials();
                    });

                    $list.append($row);
                });
            } catch (e) {
                $list.css({ display: 'block', 'font-size': '13px', color: '#e74c3c', 'margin-top': '8px' })
                    .html(i18n('something_went_wrong'));
                $el_window.find('.passwordless-card').hide();
            }
        };

        $el_window.find('.password-action-btn').on('click', function () {
            UIWindowChangePassword({
                mode: is_passwordless_mode ? 'add' : 'change',
                on_success: async () => {
                    await render_credentials();
                },
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                },
            });
        });

        $el_window.find('.add-webauthn-key').on('click', async function () {
            const registered = await UIWindowWebAuthnSetup();
            if ( registered ) await render_credentials();
        });

        render_credentials();

        // Passwordless login: show inline confirm row (avoids UIAlert/.close() reliability issues)
        $el_window.find('.remove-password-btn').on('click', function () {
            $el_window.find('.remove-password-btn').hide();
            $el_window.find('.passwordless-warning').hide();
            $el_window.find('.passwordless-status-msg').hide().text('');
            $el_window.find('.passwordless-confirm-row').show();
        });

        $el_window.find('.cancel-remove-password-btn').on('click', function () {
            $el_window.find('.passwordless-confirm-row').hide();
            $el_window.find('.remove-password-btn').show();
            $el_window.find('.passwordless-warning').show();
        });

        $el_window.find('.confirm-remove-password-btn').on('click', async function () {
            const $btn = $(this);
            $btn.prop('disabled', true).text('Removing…');

            const showStatus = (msg, color) => {
                $el_window.find('.passwordless-status-msg')
                    .text(msg).css('color', color).show();
            };

            try {
                const resp = await fetch(`${window.api_origin}/auth/webauthn/remove-password`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${puter.authToken}` },
                });
                const data = await resp.json();

                if ( ! resp.ok ) {
                    $btn.prop('disabled', false).text(i18n('confirm'));
                    $el_window.find('.passwordless-confirm-row').hide();
                    $el_window.find('.remove-password-btn').show();
                    $el_window.find('.passwordless-warning').show();
                    showStatus(data.error || i18n('something_went_wrong'), '#e74c3c');
                    return;
                }

                // Re-read state from backend and update UI (hides confirm row, resets button)
                await render_credentials();

                if ( Number(data.password_required) === 0 ) {
                    showStatus(i18n('passwordless_login_enabled'), '#27ae60');
                    setTimeout(() => $el_window.find('.passwordless-status-msg').fadeOut(400), 3000);

                    // 2FA was disabled server-side alongside password removal; reflect in UI
                    if ( data.otp_disabled ) {
                        $el_window.find('.disable-2fa').hide();
                        $el_window.find('.enable-2fa-wrapper').show();
                        $el_window.find('.user-otp-state').text(i18n('two_factor_disabled'));
                        $el_window.find('.settings-card-security')
                            .removeClass('settings-card-success')
                            .addClass('settings-card-warning');
                        // render_credentials() already disables the enable-2fa button
                        // for passwordless mode, so no extra call needed here
                    }
                } else {
                    showStatus('Password removal did not persist on the server. Please try again.', '#e74c3c');
                }
            } catch (e) {
                $btn.prop('disabled', false).text(i18n('confirm'));
                $el_window.find('.passwordless-confirm-row').hide();
                $el_window.find('.remove-password-btn').show();
                $el_window.find('.passwordless-warning').show();
                showStatus(e?.message || i18n('something_went_wrong'), '#e74c3c');
            }
        });
    },
};
