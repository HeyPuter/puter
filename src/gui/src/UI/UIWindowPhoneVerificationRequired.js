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

import UIWindow from './UIWindow.js';
import { get_country_list } from '../helpers/country_codes.js';
import {
    format_phone_as_you_type,
    inspect_phone,
    phone_example_for,
    detect_country_from_input,
} from '../helpers/phone.js';

// SMS phone verification dialog. Two steps in one window:
//   1. Enter a phone number → POST /send-confirm-phone (Prelude sends an SMS).
//   2. Enter the 6-digit code → POST /confirm-phone (Prelude validates it).
// The 6-digit code UX mirrors UIWindowEmailConfirmationRequired.js. Used as a
// hard gate for low-reputation signups, so by default it has no close button.
//
// The number field combines a searchable country-code picker with the national
// number. Everything the user types is normalized to E.164 with libphonenumber
// before it's sent, so country selection and on-screen formatting are purely a
// convenience — they can never change which number actually reaches the server.

// Friendly, non-accusatory messages for the abuse `reason` codes the backend
// forwards on a refused send. The backend never interprets these (the abuse
// policy lives in a private extension); the wording is presented here. Unknown
// reasons fall back to the server's own message.
const SEND_REASON_MESSAGES = {
    phone_already_used:
        'This phone number has already been used to verify the maximum number of accounts. Please use a different number, or email support@puter.com for help.',
    phone_verify_limit:
        'This phone number cannot be used to verify this account. Please use a different number, or email support@puter.com for help.',
    phone_send_limit:
        'This phone number has received too many verification codes recently. Please try again later, or use a different number.',
    phone_verify_attempts_exhausted:
        "You've used all of your phone verification attempts. Email support@puter.com for assistance.",
    device_unverifiable:
        "We couldn't verify your device. Please email support@puter.com for assistance.",
};

// Seconds the "Re-send code" link stays disabled after a send.
const RESEND_COOLDOWN_SECONDS = 30;

function UIWindowPhoneVerificationRequired(options) {
    return new Promise(async (resolve) => {
        options = options ?? {};
        options.window_options = options.window_options ?? {};
        let final_code = '';
        let is_checking_code = false;
        let is_sending = false;
        // Resolve the returned promise at most once. Success resolves(true);
        // a user-initiated close resolves(false). Idempotent so the close hook
        // can fire after a success without clobbering the result.
        let settled = false;
        const settle = (val) => {
            if (settled) return;
            settled = true;
            resolve(val);
        };
        // Logout is handled by a global 'logout' event, not by resolving this
        // gate. Setting this before closing keeps the close hook from
        // resolving(false) — which would make the caller's do/while reopen the
        // dialog instead of letting the logout transition take over.
        let logging_out = false;
        // Touch devices: skip auto-focusing the country search (which would pop
        // the on-screen keyboard over the inline list); larger tap targets and
        // tap-to-select carry the interaction instead. Users can still tap the
        // search field to filter, at which point the keyboard is expected.
        const isTouch = (() => {
            try {
                return !!(
                    window.matchMedia &&
                    window.matchMedia('(pointer: coarse)').matches
                );
            } catch (_) {
                return false;
            }
        })();

        // Localized UI strings. i18n() falls back to English and then to the
        // raw key, so missing translations degrade gracefully rather than break.
        const T = {
            title: i18n('phone_verify_title'),
            subtitle: i18n('phone_verify_subtitle'),
            country_label: i18n('phone_country_label'),
            number_label: i18n('phone_number_label'),
            send_code: i18n('phone_send_code'),
            verify_btn: i18n('phone_verify_btn'),
            resend_code: i18n('phone_resend_code'),
            change_number: i18n('phone_change_number'),
            enter_valid: i18n('phone_enter_valid'),
            invalid_code: i18n('phone_invalid_code'),
            could_not_send: i18n('phone_could_not_send'),
            could_not_verify: i18n('phone_could_not_verify'),
            search_countries: i18n('phone_search_countries'),
            no_matches: i18n('phone_no_matches'),
            select_country: i18n('phone_select_country'),
            code_sent_to: i18n('phone_code_sent_to'),
            code_sent_whatsapp: i18n('phone_code_sent_whatsapp'),
            suggested: i18n('phone_suggested'),
            all_countries: i18n('phone_all_countries'),
        };

        const spinner =
            '<svg style="width:20px; margin-top: 5px;" xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24"><title>circle anim</title><g fill="#fff" class="nc-icon-wrapper"><g class="nc-loop-circle-24-icon-f"><path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#eee" opacity=".4"></path><path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path></g><style>.nc-loop-circle-24-icon-f{--animation-duration:0.5s;transform-origin:12px 12px;animation:nc-loop-circle-anim var(--animation-duration) infinite linear}@keyframes nc-loop-circle-anim{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></g></svg>';
        const send_btn_txt = T.send_code;
        const verify_btn_txt = T.verify_btn;

        const phoneIcon =
            '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';

        // Authoritative country list (libphonenumber + localized names).
        const countries = get_country_list(window.locale);
        const countryByIso = {};
        for (const c of countries) countryByIso[c.iso] = c;

        // Best-effort starting country: last-used (this browser), else the
        // browser locale's region, else US, else whatever's first.
        const detectDefaultIso = () => {
            try {
                const stored = localStorage.getItem('phone_verif_last_country');
                if (stored && countryByIso[stored]) return stored;
            } catch (_) {}
            try {
                const langs = navigator.languages?.length
                    ? navigator.languages
                    : [navigator.language];
                for (const l of langs) {
                    const region = (l || '').split('-')[1];
                    if (region && countryByIso[region.toUpperCase()]) {
                        return region.toUpperCase();
                    }
                }
            } catch (_) {}
            return countryByIso['US'] ? 'US' : countries[0]?.iso;
        };
        let currentIso = detectDefaultIso();
        let currentDial = (countryByIso[currentIso] || {}).dial || '';

        // A short "Suggested" group pinned to the top: the chosen country
        // (last-used or locale-detected) plus a few common ones, deduped. This
        // keeps the typical pick one click away despite the ~245-item list.
        const POPULAR_ISOS = ['US', 'GB', 'CA', 'AU', 'IN', 'DE', 'FR'];
        const suggestedIsos = [];
        const pushSuggested = (iso) => {
            if (iso && countryByIso[iso] && !suggestedIsos.includes(iso)) {
                suggestedIsos.push(iso);
            }
        };
        pushSuggested(currentIso); // already prefers last-used, then locale
        POPULAR_ISOS.forEach(pushSuggested);
        const suggested = suggestedIsos.slice(0, 6).map((iso) => countryByIso[iso]);

        // Render one <li> option. `data-search` is a pre-lowercased haystack
        // (name + dial with/without "+" + iso) so filtering is a substring test.
        // `data-group` lets the filter hide the Suggested copies while searching.
        const renderOption = (c, idPrefix, group) => {
            const search =
                `${c.name} ${c.dial} ${c.dial.replace('+', '')} ${c.iso}`.toLowerCase();
            return (
                `<li class="phone-country-option" role="option" id="${idPrefix}${c.iso}" data-iso="${c.iso}" data-group="${group}" data-dial="${html_encode(c.dial)}" data-search="${html_encode(search)}">` +
                `<span class="cc-flag">${c.flag}</span>` +
                `<span class="cc-name">${html_encode(c.name)}</span>` +
                `<span class="cc-dial">${html_encode(c.dial)}</span>` +
                `<span class="cc-check" aria-hidden="true">✓</span>` +
                `</li>`
            );
        };

        let countryOptions = '';
        if (suggested.length) {
            countryOptions += `<li class="cc-group-label" aria-hidden="true">${T.suggested}</li>`;
            countryOptions += suggested
                .map((c) => renderOption(c, 'cc-sug-', 'suggested'))
                .join('');
            countryOptions += `<li class="cc-group-label" aria-hidden="true">${T.all_countries}</li>`;
        }
        countryOptions += countries
            .map((c) => renderOption(c, 'cc-opt-', 'all'))
            .join('');

        let h = '';
        // Scoped styling for this dialog.
        h += `<style>
            .window-confirm-phone-using-code .phone-icon-badge {
                width: 56px; height: 56px; border-radius: 50%;
                background: #e8f1fe; display: flex; align-items: center;
                justify-content: center; margin: 4px auto 16px;
            }
            .window-confirm-phone-using-code .phone-title {
                text-align: center; font-weight: 600; font-size: 21px;
                margin: 0 0 8px;
            }
            .window-confirm-phone-using-code .phone-subtitle {
                text-align: center; color: #6b7c8c; font-size: 14px;
                line-height: 1.5; margin: 0 0 22px; padding: 0 8px;
            }
            .window-confirm-phone-using-code .phone-field-label {
                display: block; font-size: 12px; font-weight: 600;
                text-transform: uppercase; letter-spacing: .04em;
                color: #8a99a8; margin: 0 0 6px;
            }
            .window-confirm-phone-using-code .phone-input {
                width: 100%; box-sizing: border-box; padding: 12px 14px;
                font-size: 16px; color: #2c3e50;
                border: 1.5px solid #d4dde6; border-radius: 9px;
                outline: none; transition: border-color .15s, box-shadow .15s;
                background: #fff;
            }
            .window-confirm-phone-using-code .phone-input::placeholder { color: #aebac6; }
            /* Field combines the country picker (left) with the national number. */
            .window-confirm-phone-using-code .phone-input-group {
                display: flex; align-items: stretch;
                border: 1.5px solid #d4dde6; border-radius: 9px;
                background: #fff; overflow: hidden;
                transition: border-color .15s, box-shadow .15s;
            }
            .window-confirm-phone-using-code .phone-input-group.focused {
                border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15);
            }
            .window-confirm-phone-using-code .phone-input-group .phone-input {
                border: none; border-radius: 0; flex: 1; min-width: 0;
            }
            .window-confirm-phone-using-code .phone-input-group .phone-input:focus {
                border: none; box-shadow: none;
            }
            .window-confirm-phone-using-code .phone-country-btn {
                display: flex; align-items: center; gap: 6px;
                padding: 0 11px; background: #f3f7fb; border: none;
                border-right: 1.5px solid #d4dde6; cursor: pointer;
                font-size: 16px; color: #2c3e50; white-space: nowrap;
            }
            .window-confirm-phone-using-code .phone-country-btn:hover { background: #eaf1f9; }
            .window-confirm-phone-using-code .phone-country-btn:focus-visible {
                outline: 2px solid #3b82f6; outline-offset: -2px;
            }
            .window-confirm-phone-using-code .phone-country-btn .cc-flag { font-size: 18px; line-height: 1; }
            .window-confirm-phone-using-code .phone-country-btn-dial { font-size: 15px; }
            .window-confirm-phone-using-code .phone-country-btn-caret { color: #8a99a8; font-size: 11px; }
            .window-confirm-phone-using-code .phone-valid-check {
                display: flex; align-items: center; padding: 0 12px;
                color: #16a34a; font-weight: 700; opacity: 0; transition: opacity .15s;
            }
            .window-confirm-phone-using-code .phone-input-group.valid .phone-valid-check { opacity: 1; }
            /* Inline-expanding country list (not an overlay — avoids clipping by
               the scrollable window body). */
            .window-confirm-phone-using-code .phone-country-panel {
                margin-top: 8px; border: 1.5px solid #d4dde6; border-radius: 9px;
                background: #fff; overflow: hidden;
            }
            .window-confirm-phone-using-code .phone-country-panel[hidden],
            .window-confirm-phone-using-code .phone-country-empty[hidden] { display: none; }
            .window-confirm-phone-using-code .phone-country-search {
                width: 100%; box-sizing: border-box; padding: 11px 12px;
                font-size: 16px; color: #2c3e50; border: none;
                border-bottom: 1px solid #e9eef3; outline: none; background: #fff;
            }
            /* Override the global input[type=text]:focus rule (style.css), which
               swaps in a 2px border + 7px padding on focus and makes this field
               jump. Keep border/padding identical to the unfocused state — the
               open panel already signals that the search is active. */
            .window-confirm-phone-using-code .phone-country-search:focus {
                border: none; border-bottom: 1px solid #e9eef3;
                padding: 11px 12px; outline: none; box-shadow: none;
            }
            .window-confirm-phone-using-code .phone-country-list {
                list-style: none; margin: 0; padding: 4px; max-height: 216px; overflow-y: auto;
            }
            .window-confirm-phone-using-code .phone-country-option {
                display: flex; align-items: center; gap: 10px;
                padding: 9px 10px; border-radius: 7px; cursor: pointer;
                font-size: 14px; color: #2c3e50;
            }
            .window-confirm-phone-using-code .phone-country-option .cc-flag {
                font-size: 18px; width: 22px; text-align: center; flex: none;
            }
            .window-confirm-phone-using-code .phone-country-option .cc-name {
                flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .window-confirm-phone-using-code .phone-country-option .cc-dial {
                color: #8a99a8; flex: none; font-variant-numeric: tabular-nums;
            }
            .window-confirm-phone-using-code .phone-country-option .cc-check {
                flex: none; width: 14px; text-align: center; color: #3b82f6;
                font-weight: 700; opacity: 0;
            }
            .window-confirm-phone-using-code .phone-country-option.selected .cc-check { opacity: 1; }
            .window-confirm-phone-using-code .phone-country-option.selected .cc-name { font-weight: 600; }
            /* Only on real hover devices, so the highlight doesn't stick after a tap. */
            @media (hover: hover) {
                .window-confirm-phone-using-code .phone-country-option:hover { background: #eef4fe; }
            }
            .window-confirm-phone-using-code .phone-country-option.active { background: #eaf2fe; }
            .window-confirm-phone-using-code .cc-group-label {
                list-style: none; padding: 10px 10px 4px; font-size: 11px;
                font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
                color: #a7b4c2;
            }
            .window-confirm-phone-using-code .phone-country-empty {
                padding: 16px; text-align: center; color: #8a99a8; font-size: 13px;
            }
            .window-confirm-phone-using-code .phone-send-btn,
            .window-confirm-phone-using-code .phone-verify-btn {
                margin-top: 18px; height: 42px; font-size: 15px; font-weight: 500;
            }
            .window-confirm-phone-using-code .phone-footer {
                text-align: center; font-size: 13px; margin-top: 18px;
                padding-top: 16px; border-top: 1px solid #e9eef3; color: #8a99a8;
            }
            .window-confirm-phone-using-code .phone-footer a {
                color: #3b82f6; cursor: pointer; text-decoration: none;
            }
            .window-confirm-phone-using-code .phone-footer a:hover { text-decoration: underline; }
            .window-confirm-phone-using-code .phone-footer a.disabled {
                color: #b7c2cd; cursor: default; text-decoration: none; pointer-events: none;
            }
            .window-confirm-phone-using-code .error {
                color: #c0392b; font-size: 13px; text-align: center; margin-bottom: 10px;
            }
            /* Touch devices: meet the ~44px minimum tap target for list rows
               and the search field; keep the input >=16px to avoid iOS focus-zoom. */
            @media (pointer: coarse) {
                .window-confirm-phone-using-code .phone-country-option {
                    min-height: 44px; font-size: 16px;
                }
                .window-confirm-phone-using-code .phone-country-search { min-height: 44px; }
            }
            @media (prefers-reduced-motion: reduce) {
                .window-confirm-phone-using-code * { transition: none !important; }
            }
        </style>`;
        if (options.show_close_button !== false) {
            h +=
                '<div class="qr-code-window-close-btn generic-close-window-button"> &times; </div>';
        }
        h +=
            '<div style="-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: #3e5362; max-width: 330px; margin: 0 auto;">';
        h += `<div class="phone-icon-badge">${phoneIcon}</div>`;
        h += `<h3 class="phone-title">${T.title}</h3>`;

        // -- Step 1: phone number --
        h += '<form class="phone-step phone-step-1">';
        h += `<p class="phone-subtitle">${T.subtitle}</p>`;
        // Offer a friendly human fallback so verification is never a dead end —
        // worded as help, not as an accusation.
        h += `<p style="text-align:center; font-size:12px; line-height:1.4; color:#8a99a8; margin:-12px auto 18px; max-width:320px;">Need help? Email <a href="mailto:support@puter.com" style="color:#3b82f6; text-decoration:none;">support@puter.com</a> and we'll assist creating your account.</p>`;
        h += '<div class="error" role="alert" aria-live="assertive"></div>';
        h += `<label class="phone-field-label" id="phone-number-label" for="phone-verif-input">${T.number_label}</label>`;
        h += '<div class="phone-input-group">';
        h += `<button type="button" class="phone-country-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="${T.select_country}">`;
        h += '<span class="cc-flag phone-country-btn-flag"></span>';
        h += '<span class="phone-country-btn-dial"></span>';
        h += '<span class="phone-country-btn-caret" aria-hidden="true">▾</span>';
        h += '</button>';
        h +=
            '<input id="phone-verif-input" class="phone-input" type="tel" inputmode="tel" autocomplete="tel-national" />';
        h += '<span class="phone-valid-check" aria-hidden="true">✓</span>';
        h += '</div>';
        h += '<div class="phone-country-panel" hidden>';
        h += `<input type="text" class="phone-country-search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${T.search_countries}" aria-label="${T.search_countries}" role="combobox" aria-expanded="true" aria-controls="phone-country-listbox" />`;
        h += `<ul class="phone-country-list" id="phone-country-listbox" role="listbox" aria-label="${T.country_label}">${countryOptions}</ul>`;
        h += `<div class="phone-country-empty" hidden>${T.no_matches}</div>`;
        h += '</div>';
        h += `<button type="submit" class="button button-block button-primary phone-send-btn">${send_btn_txt}</button>`;
        if (options.logout_in_footer) {
            h += `<div class="phone-footer"><a class="phone-log-out">${i18n('log_out')}</a></div>`;
        }
        h += '</form>';

        // -- Step 2: 6-digit code (hidden until a code is sent) --
        h += '<form class="phone-step phone-step-2" style="display:none;">';
        // The prefix is swapped per send: WhatsApp wording when the backend
        // reports the code went out over WhatsApp, SMS wording otherwise.
        h += `<p class="phone-subtitle"><span class="phone-code-sent-msg">${T.code_sent_to}</span> <strong style="font-weight: 600; color:#3e5362;" class="phone-target"></strong></p>`;
        h += '<div class="error" role="alert" aria-live="assertive"></div>';
        h += `  <fieldset name="number-code" style="border: none; padding:0;" data-number-code-form>
                <input class="digit-input" type="number" min='0' max='9' inputmode="numeric" autocomplete="one-time-code" name='number-code-0' data-number-code-input='0' required />
                <input class="digit-input" type="number" min='0' max='9' inputmode="numeric" name='number-code-1' data-number-code-input='1' required />
                <input class="digit-input" type="number" min='0' max='9' inputmode="numeric" name='number-code-2' data-number-code-input='2' required />
                <span class="email-confirm-code-hyphen">-</span>
                <input class="digit-input" type="number" min='0' max='9' inputmode="numeric" name='number-code-3' data-number-code-input='3' required />
                <input class="digit-input" type="number" min='0' max='9' inputmode="numeric" name='number-code-4' data-number-code-input='4' required />
                <input class="digit-input" type="number" min='0' max='9' inputmode="numeric" name='number-code-5' data-number-code-input='5' required />
              </fieldset>`;
        h += `<button type="submit" class="button button-block button-primary phone-verify-btn" disabled>${verify_btn_txt}</button>`;
        h += '<div class="phone-footer">';
        h += `<a class="phone-resend-code">${T.resend_code}</a> &nbsp;&bull;&nbsp; <a class="phone-change-number">${T.change_number}</a>`;
        if (options.logout_in_footer) {
            h += ' &nbsp;&bull;&nbsp; ';
            h += `<a class="phone-log-out">${i18n('log_out')}</a>`;
        }
        h += '</div>';
        h += '</form>';
        h += '</div>';

        const el_window = await UIWindow({
            title: null,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: false,
            selectable_body: false,
            draggable_body: true,
            allow_context_menu: false,
            is_draggable: options.is_draggable ?? true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: options.stay_on_top ?? false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            backdrop: true,
            close_on_backdrop_click: false,
            width: 390,
            dominant: true,
            ...options.window_options,
            // Teardown that must run on EVERY close path (close button, parent
            // cascade, programmatic .close()), not just the buttons we wire
            // below — otherwise the resend setInterval keeps firing on a
            // detached node. Also settles the promise for the closable variant.
            on_close: () => {
                cleanup();
                if (!logging_out) settle(false);
            },
            onAppend: function (el_window) {
                const $inp = $(el_window).find('.phone-input').first();
                $inp.focus();
                $inp.closest('.phone-input-group').addClass('focused');
            },
            window_class: 'window-confirm-phone-using-code',
            window_css: {
                height: 'initial',
            },
            body_css: {
                padding: '30px',
                width: 'initial',
                height: 'initial',
                'background-color': 'rgb(247 251 255)',
                'backdrop-filter': 'blur(3px)',
            },
        });

        const showError = (msg) => {
            $(el_window).find('.phone-step:visible .error').html(html_encode(msg)).fadeIn();
        };
        const clearError = () => {
            $(el_window).find('.error').hide();
        };

        // 6-digit code DOM refs (used by paste/WebOTP and the per-digit logic).
        const numberCodeForm = el_window.querySelector('[data-number-code-form]');
        const numberCodeInputs = [
            ...numberCodeForm.querySelectorAll('[data-number-code-input]'),
        ];

        // -- teardown: clear timers / listeners that outlive a single render --
        let resendTimer = null;
        let otpAbort = null;
        const onDocMouseDown = (e) => {
            // Self-heal: if the window is gone, detach and stop.
            if (!document.body.contains(el_window)) {
                document.removeEventListener('mousedown', onDocMouseDown, true);
                return;
            }
            if (!comboOpen) return;
            const grp = el_window.querySelector('.phone-input-group');
            const pnl = el_window.querySelector('.phone-country-panel');
            if ((grp && grp.contains(e.target)) || (pnl && pnl.contains(e.target))) return;
            closeCombo();
        };
        const cleanup = () => {
            try { if (resendTimer) { clearInterval(resendTimer); resendTimer = null; } } catch (_) {}
            try { otpAbort?.abort(); } catch (_) {}
            try { document.removeEventListener('mousedown', onDocMouseDown, true); } catch (_) {}
        };

        // ---------- Country picker (searchable, inline-expanding) ----------
        let comboOpen = false;
        const $panel = () => $(el_window).find('.phone-country-panel');
        const searchEl = () => el_window.querySelector('.phone-country-search');
        const allOptions = () => [
            ...el_window.querySelectorAll('.phone-country-option'),
        ];
        const visibleOptions = () =>
            allOptions().filter((o) => o.style.display !== 'none');

        const updateValidityHint = () => {
            const inp = el_window.querySelector('#phone-verif-input');
            const { is_valid } = inspect_phone(inp ? inp.value : '', currentIso);
            $(el_window).find('.phone-input-group').toggleClass('valid', is_valid);
        };

        const setCountry = (iso) => {
            const c = countryByIso[iso];
            if (!c) return;
            currentIso = c.iso;
            currentDial = c.dial;
            const $btn = $(el_window).find('.phone-country-btn');
            $btn.find('.phone-country-btn-flag').text(c.flag || '');
            $btn.find('.phone-country-btn-dial').text(c.dial);
            $btn.attr('aria-label', `${T.select_country}: ${c.name} ${c.dial}`);
            const inp = el_window.querySelector('#phone-verif-input');
            if (inp) inp.setAttribute('placeholder', phone_example_for(c.iso) || '');
            // Mark the currently-selected country (both its Suggested and
            // All-countries copies) so the check stays visible as the keyboard
            // cursor / hover moves elsewhere.
            allOptions().forEach((o) =>
                o.classList.toggle('selected', o.dataset.iso === c.iso),
            );
            try { localStorage.setItem('phone_verif_last_country', c.iso); } catch (_) {}
            updateValidityHint();
        };

        const reformatNationalValue = () => {
            const inp = el_window.querySelector('#phone-verif-input');
            if (!inp) return;
            inp.value = format_phone_as_you_type(inp.value, currentIso);
            updateValidityHint();
        };

        const setActiveOption = (el) => {
            allOptions().forEach((o) => o.classList.remove('active'));
            const s = searchEl();
            if (el) {
                el.classList.add('active');
                if (s) s.setAttribute('aria-activedescendant', el.id);
                el.scrollIntoView({ block: 'nearest' });
            } else if (s) {
                s.removeAttribute('aria-activedescendant');
            }
        };

        const filterOptions = (q) => {
            const query = (q || '').trim().toLowerCase();
            const labels = [...el_window.querySelectorAll('.cc-group-label')];
            let anyVisible = false;
            if (query) {
                // Searching: drop the Suggested group + its labels so results
                // aren't shown twice, then substring-filter the full list.
                labels.forEach((l) => (l.style.display = 'none'));
                for (const o of allOptions()) {
                    if (o.dataset.group === 'suggested') {
                        o.style.display = 'none';
                        continue;
                    }
                    const match = o.dataset.search.indexOf(query) !== -1;
                    o.style.display = match ? '' : 'none';
                    if (match) anyVisible = true;
                }
            } else {
                labels.forEach((l) => (l.style.display = ''));
                for (const o of allOptions()) o.style.display = '';
                anyVisible = true;
            }
            $(el_window).find('.phone-country-empty').prop('hidden', anyVisible);
            setActiveOption(visibleOptions()[0] || null);
        };

        const openCombo = () => {
            if (comboOpen) return;
            comboOpen = true;
            $panel().prop('hidden', false);
            $(el_window).find('.phone-country-btn').attr('aria-expanded', 'true');
            const s = searchEl();
            if (s) s.value = '';
            filterOptions('');
            // Open at the top so the pinned Suggested group is what users see
            // first, then highlight the selected country (its Suggested copy).
            const list = el_window.querySelector('.phone-country-list');
            if (list) list.scrollTop = 0;
            const sel = el_window.querySelector(
                `.phone-country-option[data-iso="${currentIso}"]`,
            );
            if (sel) setActiveOption(sel);
            if (s && !isTouch) s.focus();
        };

        const closeCombo = () => {
            if (!comboOpen) return;
            comboOpen = false;
            $panel().prop('hidden', true);
            $(el_window).find('.phone-country-btn').attr('aria-expanded', 'false');
        };

        const toggleCombo = () => (comboOpen ? closeCombo() : openCombo());

        const selectOption = (el) => {
            if (!el) return;
            setCountry(el.dataset.iso);
            reformatNationalValue();
            closeCombo();
            const inp = el_window.querySelector('#phone-verif-input');
            if (inp) inp.focus();
        };

        // National-number input: live formatting with caret preservation, plus
        // auto-detecting the country when the user types a "+..." number.
        const handleNationalInput = () => {
            const inp = el_window.querySelector('#phone-verif-input');
            if (!inp) return;
            const before = inp.value;
            const caret = inp.selectionStart ?? before.length;
            const digitsBeforeCaret = before
                .slice(0, caret)
                .replace(/\D/g, '').length;

            const detected = detect_country_from_input(before);
            if (detected && detected !== currentIso && countryByIso[detected]) {
                setCountry(detected);
            }

            const formatted = format_phone_as_you_type(before, currentIso);
            inp.value = formatted;

            // Put the caret back after the same number of digits it preceded.
            let pos = 0;
            let seen = 0;
            while (pos < formatted.length && seen < digitsBeforeCaret) {
                if (/\d/.test(formatted[pos])) seen++;
                pos++;
            }
            try { inp.setSelectionRange(pos, pos); } catch (_) {}

            updateValidityHint();
        };

        // ---------- Resend cooldown ----------
        const fmtMMSS = (s) => {
            const m = Math.floor(s / 60);
            const sec = s % 60;
            return `${m}:${sec < 10 ? '0' : ''}${sec}`;
        };
        const startResendCooldown = (secs) => {
            const $link = $(el_window).find('.phone-resend-code');
            let remaining = secs;
            const render = () => {
                // Self-heal: stop ticking if the window is gone.
                if (!document.body.contains(el_window)) {
                    if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
                    return;
                }
                if (remaining <= 0) {
                    if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
                    $link.removeClass('disabled').text(T.resend_code);
                    return;
                }
                $link.addClass('disabled').text(
                    i18n('phone_resend_in', [fmtMMSS(remaining)]),
                );
                remaining--;
            };
            if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
            render();
            resendTimer = setInterval(render, 1000);
        };

        // ---------- WebOTP: auto-fill the SMS code on supporting devices ----------
        const fillCode = (code) => {
            const digits = (code || '').replace(/\D/g, '').slice(0, 6).split('');
            if (!digits.length) return;
            numberCodeInputs.forEach((inp, i) => {
                inp.value = digits[i] ?? '';
            });
            final_code = digits.join('');
            if (final_code.length === 6) {
                $(el_window).find('.phone-verify-btn').prop('disabled', false);
                doVerify();
            } else {
                (numberCodeInputs[digits.length] ?? numberCodeInputs[numberCodeInputs.length - 1]).focus();
            }
        };
        const startWebOTP = () => {
            if (!('OTPCredential' in window)) return;
            try {
                if (otpAbort) { try { otpAbort.abort(); } catch (_) {} }
                otpAbort = new AbortController();
                navigator.credentials
                    .get({ otp: { transport: ['sms'] }, signal: otpAbort.signal })
                    .then((otp) => {
                        if (otp && otp.code) fillCode(String(otp.code));
                    })
                    .catch(() => {});
            } catch (_) {}
        };

        // -- Step 1: send the code --
        const sendCode = async () => {
            if (is_sending) return;
            clearError();
            const inp = el_window.querySelector('#phone-verif-input');
            const raw = (inp ? inp.value : '').trim();
            const digits = raw.replace(/\D/g, '');
            if (digits.length < 4) {
                showError(T.enter_valid);
                return;
            }
            // Canonical E.164 from libphonenumber; fall back to a naive join
            // only if parsing fails entirely, so we always send *something* and
            // let the server be the final arbiter (never block a real signup).
            const { e164 } = inspect_phone(raw, currentIso);
            const phone = e164 || `${currentDial}${digits}`;

            is_sending = true;
            $(el_window)
                .find('.phone-send-btn')
                .prop('disabled', true)
                .html(spinner);

            // Two best-effort device signals, both gathered on this number-entry
            // page. The fingerprint lets the abuse extension cap SMS sends per
            // device across accounts; the Prelude dispatch id forwards browser
            // signals into Prelude's own Verify abuse model. A failure/timeout
            // on either just omits it (everything downstream fails open).
            let fingerprint = null;
            let dispatchId = null;
            try {
                [fingerprint, dispatchId] = await Promise.all([
                    window.getDeviceFingerprint?.(),
                    window.getPreludeDispatchId?.(),
                ]);
            } catch (_) {}

            const sendData = { phone };
            if ( fingerprint ) sendData.fingerprint = fingerprint;
            if ( dispatchId ) sendData.dispatch_id = dispatchId;

            $.ajax({
                url: `${window.api_origin}/send-confirm-phone`,
                type: 'POST',
                data: JSON.stringify(sendData),
                async: true,
                contentType: 'application/json',
                headers: { Authorization: `Bearer ${window.auth_token}` },
                statusCode: { 401: (xhr) => window.handle401(xhr) },
                success: function (res) {
                    // Advance to the code-entry step with a clean slate.
                    $(el_window).find('.phone-target').text(phone);
                    // `channel` is where Prelude actually delivered the code;
                    // point the user at WhatsApp when it wasn't a plain text.
                    $(el_window)
                        .find('.phone-code-sent-msg')
                        .text(
                            res?.channel === 'whatsapp'
                                ? T.code_sent_whatsapp
                                : T.code_sent_to,
                        );
                    numberCodeInputs.forEach((i) => {
                        i.value = '';
                        i.disabled = false;
                    });
                    final_code = '';
                    $(el_window)
                        .find('.phone-verify-btn')
                        .prop('disabled', true)
                        .html(verify_btn_txt);
                    $(el_window).find('.phone-step-1').hide();
                    $(el_window).find('.phone-step-2').show();
                    numberCodeInputs[0]?.focus();
                    startResendCooldown(RESEND_COOLDOWN_SECONDS);
                    startWebOTP();
                },
                error: function (xhr) {
                    const reason = xhr.responseJSON?.reason;
                    let msg =
                        SEND_REASON_MESSAGES[reason] ??
                        xhr.responseJSON?.error ??
                        T.could_not_send;
                    // Append the support reference id the backend minted for
                    // this failure (it logged the real reason against it), so
                    // the user can quote it when they email support.
                    const errorId = xhr.responseJSON?.error_id;
                    if (errorId)
                        msg += ' ' + i18n('phone_error_reference', { id: errorId });
                    showError(msg);
                },
                complete: function () {
                    is_sending = false;
                    $(el_window)
                        .find('.phone-send-btn')
                        .prop('disabled', false)
                        .html(send_btn_txt);
                },
            });
        };

        // -- Step 2: verify the code --
        const doVerify = () => {
            if (is_checking_code) return;
            if (!final_code || final_code.length !== 6) return;
            is_checking_code = true;
            clearError();
            $(el_window).find('.phone-verify-btn').prop('disabled', true).html(spinner);
            $(el_window).find('.digit-input').prop('disabled', true);

            $.ajax({
                url: `${window.api_origin}/confirm-phone`,
                type: 'POST',
                data: JSON.stringify({ code: final_code }),
                async: true,
                contentType: 'application/json',
                headers: { Authorization: `Bearer ${window.auth_token}` },
                statusCode: { 401: (xhr) => window.handle401(xhr) },
                success: function (res) {
                    if (res.phone_verified) {
                        // Settle before close() so the on_close hook's
                        // settle(false) is a no-op; cleanup runs via on_close.
                        settle(true);
                        window.refresh_user_data(window.auth_token);
                        $(el_window).close();
                    } else {
                        showError(T.invalid_code);
                        $(el_window).find('.digit-input').val('').prop('disabled', false);
                        final_code = '';
                        numberCodeInputs[0]?.focus();
                        $(el_window)
                            .find('.phone-verify-btn')
                            .prop('disabled', true)
                            .html(verify_btn_txt);
                    }
                },
                error: function (xhr) {
                    showError(xhr.responseJSON?.error ?? T.could_not_verify);
                    $(el_window).find('.digit-input').val('').prop('disabled', false);
                    final_code = '';
                    numberCodeInputs[0]?.focus();
                    $(el_window)
                        .find('.phone-verify-btn')
                        .prop('disabled', true)
                        .html(verify_btn_txt);
                },
                complete: function () {
                    is_checking_code = false;
                },
            });
        };

        // ---------- Wire up events ----------
        $(el_window).find('.phone-country-btn').on('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            toggleCombo();
        });

        const sEl = searchEl();
        if (sEl) {
            sEl.addEventListener('input', (e) => filterOptions(e.target.value));
            sEl.addEventListener('keydown', (e) => {
                const vis = visibleOptions();
                const active = el_window.querySelector('.phone-country-option.active');
                const idx = vis.indexOf(active);
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (vis.length) setActiveOption(vis[Math.min(idx + 1, vis.length - 1)] ?? vis[0]);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (vis.length) setActiveOption(vis[Math.max(idx - 1, 0)]);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    selectOption(active || vis[0]);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    closeCombo();
                    $(el_window).find('.phone-country-btn').focus();
                }
            });
        }

        $(el_window)
            .find('.phone-country-list')
            .on('click', '.phone-country-option', function () {
                selectOption(this);
            });

        document.addEventListener('mousedown', onDocMouseDown, true);

        const $inp = $(el_window).find('#phone-verif-input');
        $inp.on('input', handleNationalInput);
        $inp.on('focus', function () {
            $(this).closest('.phone-input-group').addClass('focused');
        });
        $inp.on('blur', function () {
            $(this).closest('.phone-input-group').removeClass('focused');
        });

        $(el_window).find('.phone-send-btn').on('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            sendCode();
        });
        $(el_window).find('.phone-step-1').on('submit', function (e) {
            e.preventDefault();
            sendCode();
        });

        $(el_window).find('.phone-verify-btn').on('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            doVerify();
        });
        $(el_window).find('.phone-step-2').on('submit', function (e) {
            e.preventDefault();
            doVerify();
        });

        // Re-send / change number on the code step.
        $(el_window).find('.phone-resend-code').on('click', function () {
            if ($(this).hasClass('disabled')) return;
            sendCode();
        });
        $(el_window).find('.phone-change-number').on('click', function () {
            clearError();
            try { otpAbort?.abort(); } catch (_) {}
            $(el_window).find('.phone-step-2').hide();
            $(el_window).find('.phone-step-1').show();
            $(el_window).find('#phone-verif-input').focus();
        });

        // logout — handled by the global 'logout' event; flag it so the
        // close hook doesn't resolve(false) and trigger a caller re-open.
        // (Teardown for the close button and all other paths runs via on_close.)
        $(el_window).find('.phone-log-out').on('click', function () {
            logging_out = true;
            window.logout();
            $(el_window).close();
        });

        // -- 6-digit input handling (mirrors the email confirmation dialog) --
        numberCodeForm.addEventListener('input', ({ target }) => {
            if (!target.value.length) {
                final_code = '';
                $(el_window).find('.phone-verify-btn').prop('disabled', true);
                return (target.value = null);
            }
            const inputLength = target.value.length;
            let currentIndex = Number(target.dataset.numberCodeInput);
            if (inputLength === 2) {
                const inputValues = target.value.split('');
                target.value = inputValues[0];
            } else if (inputLength > 1) {
                const inputValues = target.value.split('');
                inputValues.forEach((value, valueIndex) => {
                    const nextValueIndex = currentIndex + valueIndex;
                    if (nextValueIndex >= numberCodeInputs.length) {
                        return;
                    }
                    numberCodeInputs[nextValueIndex].value = value;
                });
                currentIndex += inputValues.length - 2;
            }

            const nextIndex = currentIndex + 1;
            if (nextIndex < numberCodeInputs.length) {
                numberCodeInputs[nextIndex].focus();
            }

            final_code = '';
            for (let i = 0; i < numberCodeInputs.length; i++) {
                final_code += numberCodeInputs[i].value;
            }
            if (final_code.length === 6) {
                $(el_window).find('.phone-verify-btn').prop('disabled', false);
                $(el_window).find('.digit-input').prop('disabled', false);
                doVerify();
            }
        });

        numberCodeForm.addEventListener('keydown', (e) => {
            const { code, target } = e;
            const currentIndex = Number(target.dataset.numberCodeInput);
            const previousIndex = currentIndex - 1;
            const nextIndex = currentIndex + 1;
            const hasPreviousIndex = previousIndex >= 0;
            const hasNextIndex = nextIndex <= numberCodeInputs.length - 1;

            switch (code) {
                case 'ArrowLeft':
                case 'ArrowUp':
                    if (hasPreviousIndex)
                        numberCodeInputs[previousIndex].focus();
                    e.preventDefault();
                    break;
                case 'ArrowRight':
                case 'ArrowDown':
                    if (hasNextIndex) numberCodeInputs[nextIndex].focus();
                    e.preventDefault();
                    break;
                case 'Backspace':
                    if (!e.target.value.length && hasPreviousIndex) {
                        numberCodeInputs[previousIndex].value = null;
                        numberCodeInputs[previousIndex].focus();
                    }
                    break;
                default:
                    break;
            }
        });

        // Initialize the picker button (flag, dial, placeholder example).
        setCountry(currentIso);
    });
}

def(UIWindowPhoneVerificationRequired, 'ui.UIConfirmPhone');

export default UIWindowPhoneVerificationRequired;
