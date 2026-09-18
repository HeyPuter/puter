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

// The dashboard's own confirm / alert / prompt: an overlay card like the
// share and properties modals, not a UIWindow. Resolves with the pressed
// button's value (or the input's text), and `false` when dismissed.

const SVG = (body) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
    close: SVG('<path d="M18 6L6 18"/><path d="M6 6l12 12"/>'),
    danger: SVG('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    warning: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
    error: SVG('<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/>'),
};

const TONES = new Set(['danger', 'warning', 'error']);
const BUTTON_TYPES = new Set(['primary', 'danger', 'quiet']);

/**
 * @param {object} opts
 * @param {string} [opts.title] Plain text.
 * @param {string} opts.message HTML the caller has already encoded.
 * @param {'danger'|'warning'|'error'} [opts.tone] Adds an icon; the primary
 *   button of a `danger` dialog is red.
 * @param {Array<{ label: string, value: unknown, type?: 'primary'|'danger'|'quiet' }>} [opts.buttons]
 *   Rendered in order, right-aligned. Defaults to a single OK.
 * @param {{ label?: string, placeholder?: string, value?: string }} [opts.input]
 *   Turns the dialog into a prompt: Enter presses the primary button and the
 *   result is the trimmed text rather than the button's value.
 * @param {jQuery} [opts.$container] Where the overlay mounts; defaults to body.
 * @param {HTMLElement} [opts.returnFocusTo] Where focus goes on close.
 * @returns {Promise<unknown>}
 */
export default function UIDashboardDialog ({ title, message, tone, buttons, input, $container, returnFocusTo }) {
    const { html_encode } = window;
    const $root = $container && $container.length ? $container : $('body');
    const id = window.uuidv4?.() ?? String(Date.now());
    const toneClass = TONES.has(tone) ? ` dashboard-dialog-${tone}` : '';
    const actions = buttons?.length
        ? buttons
        : [{ label: i18n('ok'), value: true, type: 'primary' }];
    const primary = actions.find(b => b.type === 'primary' || b.type === 'danger') ?? actions[actions.length - 1];

    let h = '<div class="dashboard-dialog-overlay">';
    h += `<div class="dashboard-dialog${toneClass}" role="${input ? 'dialog' : 'alertdialog'}" aria-modal="true" tabindex="-1"`;
    h += ` aria-labelledby="dashboard-dialog-title-${id}" aria-describedby="dashboard-dialog-message-${id}">`;
    if ( title ) {
        h += '<div class="dashboard-dialog-header">';
        h += `<span class="dashboard-dialog-title" id="dashboard-dialog-title-${id}">${html_encode(title)}</span>`;
        h += `<button type="button" class="dashboard-dialog-close" aria-label="${html_encode(i18n('close', [], false))}">${ICONS.close}</button>`;
        h += '</div>';
    }
    h += '<div class="dashboard-dialog-body">';
    if ( toneClass ) h += `<div class="dashboard-dialog-icon">${ICONS[tone]}</div>`;
    h += '<div class="dashboard-dialog-content">';
    h += `<div class="dashboard-dialog-message" id="dashboard-dialog-message-${id}">${message ?? ''}</div>`;
    if ( input ) {
        h += '<label class="dashboard-dialog-field">';
        if ( input.label ) h += `<span>${html_encode(input.label)}</span>`;
        h += `<input type="text" class="dashboard-dialog-input" autocomplete="off" spellcheck="false"`;
        h += ` placeholder="${html_encode(input.placeholder ?? '')}" value="${html_encode(input.value ?? '')}">`;
        h += '</label>';
    }
    h += '</div></div>';
    h += '<div class="dashboard-dialog-footer">';
    actions.forEach((button, index) => {
        const type = BUTTON_TYPES.has(button.type) ? button.type : 'quiet';
        h += `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-${type}" data-index="${index}">${html_encode(button.label)}</button>`;
    });
    h += '</div></div></div>';

    const $overlay = $(h);
    $root.append($overlay);
    requestAnimationFrame(() => $overlay.addClass('dashboard-dialog-show'));

    const el_previous_focus = document.activeElement;
    const $input = $overlay.find('.dashboard-dialog-input');
    // A prompt wants the text; anything else, the safest button.
    const $first = $input.length
        ? $input
        : $overlay.find('.dashboard-dialog-btn-quiet').first().add($overlay.find('.dashboard-dialog-btn').first()).first();
    ($first.get(0) ?? $overlay.find('.dashboard-dialog').get(0))?.focus({ preventScroll: true });
    if ( $input.length ) $input.get(0).select();

    return new Promise((resolve) => {
        let closed = false;
        const close = (value) => {
            if ( closed ) return;
            closed = true;
            $overlay.removeClass('dashboard-dialog-show');
            $(document).off(`keydown.dashboard-dialog-${id}`);
            setTimeout(() => $overlay.remove(), 200);
            const el_focus_target = [returnFocusTo, el_previous_focus].find((el) => el && document.contains(el));
            try {
                el_focus_target?.focus({ preventScroll: true });
            } catch { /* focus restoration is best-effort */ }
            resolve(value);
        };

        const submit = (button) => {
            if ( ! button ) return close(false);
            if ( $input.length && button === primary ) return close(String($input.val() ?? '').trim());
            close(button.value);
        };

        $overlay.on('click', '.dashboard-dialog-btn', function () {
            submit(actions[Number($(this).attr('data-index'))]);
        });
        $overlay.on('click', '.dashboard-dialog-close', () => close(false));

        // Backdrop close goes by where the press started, so a drag that
        // starts in the card and ends outside does not dismiss it.
        let backdrop_pressed = false;
        $overlay.on('mousedown', function (e) {
            backdrop_pressed = e.target === $overlay[0];
            // A press inside the overlay must not let initgui's global mousedown
            // hand focus (and the z-index) back to the window underneath it.
            window.mouseover_window = undefined;
        });
        $overlay.on('click', function (e) {
            if ( e.target === $overlay[0] && backdrop_pressed ) close(false);
        });
        $(document).on(`keydown.dashboard-dialog-${id}`, function (e) {
            if ( e.key === 'Escape' ) close(false);
        });
        $input.on('keydown', function (e) {
            if ( e.key === 'Enter' ) {
                e.preventDefault();
                submit(primary);
            }
        });

        // Keep Tab cycling inside the dialog while it's up.
        $overlay.on('keydown', function (e) {
            if ( e.key !== 'Tab' ) return;
            const focusables = $overlay
                .find('button, input, [tabindex]:not([tabindex="-1"])')
                .filter(':visible:not(:disabled)');
            if ( ! focusables.length ) return;
            const first = focusables.get(0);
            const last = focusables.get(focusables.length - 1);
            if ( focusables.index(document.activeElement) === -1 ) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
            } else if ( e.shiftKey && document.activeElement === first ) {
                e.preventDefault();
                last.focus();
            } else if ( ! e.shiftKey && document.activeElement === last ) {
                e.preventDefault();
                first.focus();
            }
        });
    });
}
