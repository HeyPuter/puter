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

// The Turnstile captcha of an auth form. Interaction-only, so it shows only
// when Cloudflare wants the user to do something.

const TURNSTILE_POLL_MS = 100;

/**
 * The widget's place in a form, above the submit button.
 *
 * @param {string} siteKey
 * @returns {string}
 */
export const turnstileHtml = (siteKey) => '<div class="auth-turnstile">'
    + `<div class="cf-turnstile" data-sitekey="${html_encode(siteKey)}" data-appearance="interaction-only"></div>`
    + '</div>';

/**
 * Renders the widget placed by `turnstileHtml` once the captcha script has
 * loaded (index.js loads it when a site key is configured).
 *
 * @param {jQuery} $form
 * @param {string} siteKey
 * @param {() => boolean} isClosed Stops waiting for the script once the form is gone.
 * @returns {{ token: () => string | null, reset: () => void }} `token` is null
 *   when there is nothing to answer (the script never loaded), and empty until
 *   the widget has produced one. `reset` asks for a fresh token, for a retry.
 */
export const mountTurnstile = ($form, siteKey, isClosed) => {
    const $turnstile = $form.find('.cf-turnstile');
    let widget = null;

    const render = () => {
        if ( ! $turnstile.length || isClosed() ) return;
        if ( ! window.turnstile ) {
            setTimeout(render, TURNSTILE_POLL_MS);
            return;
        }
        widget = window.turnstile.render($turnstile.get(0), {
            sitekey: siteKey,
            callback: (token) => {
                $turnstile.attr('data-token', token).addClass('captcha-completed');
            },
            'expired-callback': () => {
                $turnstile.removeAttr('data-token').removeClass('captcha-completed');
            },
        });
    };
    render();

    return {
        token: () => (window.turnstile ? $turnstile.attr('data-token') || '' : null),
        reset: () => {
            try {
                if ( window.turnstile && widget !== null ) {
                    window.turnstile.reset(widget);
                    $turnstile.removeAttr('data-token').removeClass('captcha-completed');
                }
            } catch ( e ) {
                console.log(e);
            }
        },
    };
};
