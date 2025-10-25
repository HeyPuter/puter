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
import Placeholder from '../util/Placeholder.js';
import CodeEntryView from './Components/CodeEntryView.js';
import QRCodeView from './Components/QRCode.js';
import RecoveryCodesView from './Components/RecoveryCodesView.js';

const UIWindow2FASetup = async function UIWindow2FASetup() {
    return new Promise(async (resolve) => {
        let current_step = 1;
        let qr_data = null;

        const place_qr = Placeholder();
        const place_code_entry = Placeholder();
        const place_recovery_codes = Placeholder();

        const qr_component = new QRCodeView({
            value: '',
            size: 200,
            enlarge_option: true,
        });

        const code_entry_component = new CodeEntryView({
            async [`property.value`](value, { component }) {
                if (!await check_code(value)) {
                    component.set('error', i18n('code_invalid'));
                    component.set('is_checking_code', false);
                    return;
                }
                component.set('is_checking_code', false);
                go_to_step(4);
            }
        });

        const recovery_codes_component = new RecoveryCodesView({
            values: [],
        });

        const h = `
            <div class="setup-2fa-container">
                <!-- Step Indicator -->
                <div class="step-indicator">
                    <div class="step-dot active" data-step="1">
                        <span class="step-number">1</span>
                    </div>
                    <div class="step-line"></div>
                    <div class="step-dot" data-step="2">
                        <span class="step-number">2</span>
                    </div>
                    <div class="step-line"></div>
                    <div class="step-dot" data-step="3">
                        <span class="step-number">3</span>
                    </div>
                    <div class="step-line"></div>
                    <div class="step-dot" data-step="4">
                        <span class="step-number">4</span>
                    </div>
                </div>

                <!-- Step 1: Introduction -->
                <div class="step-content" data-step="1">
                    <h2 class="step-title">${i18n('setup2fa_intro_title')}</h2>
                    <p class="step-description">${i18n('setup2fa_intro_description')}</p>

                    <div class="info-box">
                        <div class="info-box-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V11H13V17ZM13 9H11V7H13V9Z" fill="#088ef0"/>
                            </svg>
                        </div>
                        <div>
                            <h3 class="info-box-title">${i18n('setup2fa_intro_what_youll_need')}</h3>
                            <p class="info-box-text">${i18n('setup2fa_intro_requirements')}</p>
                        </div>
                    </div>

                    <div class="steps-overview">
                        <h3 class="steps-overview-title">${i18n('setup2fa_intro_steps_title')}</h3>
                        <ol class="steps-list">
                            <li>${i18n('setup2fa_intro_step_1')}</li>
                            <li>${i18n('setup2fa_intro_step_2')}</li>
                            <li>${i18n('setup2fa_intro_step_3')}</li>
                        </ol>
                    </div>
                </div>

                <!-- Step 2: Scan QR Code -->
                <div class="step-content" data-step="2" style="display: none;">
                    <h2 class="step-title">${i18n('setup2fa_scan_title')}</h2>
                    <p class="step-description">${i18n('setup2fa_scan_description')}</p>

                    <div class="qr-container">
                        ${place_qr.html}
                    </div>

                    <div class="manual-setup">
                        <p class="manual-setup-label">${i18n('setup2fa_manual_setup')}</p>
                        <div class="manual-setup-key-wrapper">
                            <code class="manual-setup-key" id="manual-key"></code>
                            <button class="button button-small copy-key-btn">${i18n('copy')}</button>
                        </div>
                    </div>
                </div>

                <!-- Step 3: Verify Setup -->
                <div class="step-content" data-step="3" style="display: none;">
                    <h2 class="step-title">${i18n('setup2fa_verify_title')}</h2>
                    <p class="step-description">${i18n('setup2fa_verify_description')}</p>

                    <div class="form-field">
                        <div class="code-entry-container">
                            ${place_code_entry.html}
                        </div>
                    </div>
                </div>

                <!-- Step 4: Save Recovery Codes -->
                <div class="step-content" data-step="4" style="display: none;">
                    <h2 class="step-title">${i18n('setup2fa_recovery_title')}</h2>

                    <div class="warning-box">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM11 15H9V13H11V15ZM11 11H9V5H11V11Z" fill="#f59e0b"/>
                        </svg>
                        <p>${i18n('setup2fa_recovery_warning')}</p>
                    </div>

                    <div class="recovery-codes-container">
                        ${place_recovery_codes.html}
                    </div>

                    <div class="confirmation-checkbox">
                        <input type="checkbox" id="codes-saved-checkbox" />
                        <label for="codes-saved-checkbox">${i18n('setup2fa_codes_saved_confirmation')}</label>
                    </div>
                </div>

                <!-- Navigation Buttons -->
                <div class="step-navigation">
                    <button class="button button-default btn-back" style="display: none;">
                        <span>← ${i18n('back')}</span>
                    </button>
                    <button class="button button-primary btn-continue">
                        <span>${i18n('continue')}</span>
                    </button>
                    <button class="button button-primary btn-verify" style="display: none;">
                        <span>${i18n('verify_code')}</span>
                    </button>
                    <button class="button button-primary btn-finish" style="display: none;" disabled>
                        <span>${i18n('finish')}</span>
                    </button>
                </div>
            </div>
        `;

        const el_window = await UIWindow({
            title: i18n('setup_2fa'),
            app: '2fa-setup',
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
            allow_user_select: true,
            width: 550,
            height: 'auto',
            dominant: true,
            show_in_taskbar: false,
            window_class: 'window-2fa-setup',
            body_css: {
                width: 'initial',
                height: '100%',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            },
            onAppend: function(this_window) {
                initialize_2fa_setup(this_window);
            },
        });

        async function initialize_2fa_setup(window_el) {
            qr_component.attach(place_qr);
            code_entry_component.attach(place_code_entry);
            recovery_codes_component.attach(place_recovery_codes);

            // Sync verify button state with code entry submit button
            const syncVerifyButton = () => {
                const isDisabled = $(window_el).find('.code-confirm-btn').prop('disabled');
                $(window_el).find('.btn-verify').prop('disabled', isDisabled);
            };

            // Watch for changes to the submit button state
            const observer = new MutationObserver(syncVerifyButton);
            const submitBtn = $(window_el).find('.code-confirm-btn').get(0);
            if (submitBtn) {
                observer.observe(submitBtn, { attributes: true, attributeFilter: ['disabled'] });
            }

            // Also sync on input changes
            $(window_el).on('input', '.digit-input', syncVerifyButton);

            $(window_el).find('.btn-continue').on('click', async function() {
                if (current_step === 1) {
                    if (!qr_data) {
                        try {
                            $(this).addClass('loading').prop('disabled', true);

                            const resp = await fetch(`${window.api_origin}/auth/configure-2fa/setup`, {
                                method: 'POST',
                                headers: {
                                    Authorization: `Bearer ${puter.authToken}`,
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({}),
                            });

                            qr_data = await resp.json();

                            qr_component.set('value', qr_data.url);
                            recovery_codes_component.set('values', qr_data.codes);

                            const secret = new URL(qr_data.url).searchParams.get('secret');
                            $(window_el).find('#manual-key').text(secret);

                            $(this).removeClass('loading').prop('disabled', false);
                        } catch (error) {
                            console.error('Error setting up 2FA:', error);
                            $(this).removeClass('loading').prop('disabled', false);
                            return;
                        }
                    }
                    go_to_step(2);
                } else if (current_step === 2) {
                    go_to_step(3);
                    setTimeout(() => {
                        code_entry_component.focus();
                    }, 100);
                }
            });

            $(window_el).find('.copy-key-btn').on('click', function() {
                const secret = $(window_el).find('#manual-key').text();
                navigator.clipboard.writeText(secret);
                $(this).text(i18n('copied'));
                setTimeout(() => {
                    $(this).text(i18n('copy'));
                }, 2000);
            });

            $(window_el).find('.btn-back').on('click', function() {
                if (current_step === 2) {
                    go_to_step(1);
                } else if (current_step === 3) {
                    go_to_step(2);
                } else if (current_step === 4) {
                    go_to_step(3);
                }
            });

            $(window_el).find('#codes-saved-checkbox').on('change', function() {
                $(window_el).find('.btn-finish').prop('disabled', !this.checked);
            });

            $(window_el).find('.btn-verify').on('click', function() {
                const $verifyBtn = $(this);
                // Trigger the code entry component's submit button
                $(window_el).find('.code-confirm-btn').click();

                // Update verify button to show loading state
                $verifyBtn.addClass('loading').prop('disabled', true);

                // Watch for code entry component to finish checking
                const checkInterval = setInterval(() => {
                    if (!code_entry_component.get('is_checking_code')) {
                        $verifyBtn.removeClass('loading');
                        clearInterval(checkInterval);
                    }
                }, 100);
            });

            $(window_el).find('.btn-finish').on('click', async function() {
                $(this).addClass('loading').prop('disabled', true);

                const success = await enable_2fa();

                if (success) {
                    $(el_window).close();
                    resolve(true);
                } else {
                    $(this).removeClass('loading').prop('disabled', false);
                }
            });
        }

        function go_to_step(step) {
            const $container = $(el_window).find('.setup-2fa-container');

            $container.find('.step-content').hide();
            $container.find(`.step-content[data-step="${step}"]`).show();

            $container.find('.step-dot').removeClass('active');
            for (let i = 1; i <= step; i++) {
                $container.find(`.step-dot[data-step="${i}"]`).addClass('active');
            }

            if (step === 1) {
                $container.find('.btn-back').hide();
                $container.find('.btn-continue').show().find('span').text(i18n('continue'));
                $container.find('.btn-verify').hide();
                $container.find('.btn-finish').hide();
            } else if (step === 2) {
                $container.find('.btn-back').show();
                $container.find('.btn-continue').show().find('span').text(i18n('continue'));
                $container.find('.btn-verify').hide();
                $container.find('.btn-finish').hide();
            } else if (step === 3) {
                $container.find('.btn-back').show();
                $container.find('.btn-continue').hide();
                $container.find('.btn-verify').show().prop('disabled', true);
                $container.find('.btn-finish').hide();
            } else if (step === 4) {
                $container.find('.btn-back').show();
                $container.find('.btn-continue').hide();
                $container.find('.btn-verify').hide();
                $container.find('.btn-finish').show();
            }

            current_step = step;
        }

        async function check_code(code) {
            const resp = await fetch(`${window.api_origin}/auth/configure-2fa/test`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${puter.authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ code }),
            });

            const data = await resp.json();
            return data.ok;
        }

        async function enable_2fa() {
            const resp = await fetch(`${window.api_origin}/auth/configure-2fa/enable`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${puter.authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            const data = await resp.json();
            return data.ok;
        }

        $(el_window).on('before_close', function() {
            if (current_step < 4) {
                resolve(false);
            }
        });
    });
};

export default UIWindow2FASetup;
