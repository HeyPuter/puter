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

// A dashboard dialog holding a small form: the same card as the confirm and
// prompt dialogs (a centered card on desktop, a bottom sheet on phones),
// with labelled fields, a status line, and a submit button that shows
// progress while the caller's handler runs.

import { isTouchPrimaryDevice } from './ContextMenu/ContextMenu.js';
import mountDashboardOverlay from './dashboardOverlay.js';
import { ICONS, SVG } from './UIDashboardDialog.js';

const FORM_ICONS = {
    done: SVG('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'),
    copy: SVG('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    copied: SVG('<path d="M20 6L9 17l-5-5"/>'),
    show: SVG('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    hide: SVG('<path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 5.1-5.9"/><path d="M9.9 5.2A9.1 9.1 0 0 1 12 5c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M2 2l20 20"/>'),
};

/**
 * @typedef {object} FormDialogField
 * @property {string} name Key in `values()`.
 * @property {string} label HTML the caller has already encoded.
 * @property {'text'|'email'|'password'|'textarea'|'select'|'switch'} [type] Defaults to text.
 * @property {string} [value]
 * @property {boolean} [checked] A switch's initial state.
 * @property {string} [suffix] Plain text shown at the end of a text field, as
 *   in a domain after the name typed into it.
 * @property {string} [placeholder] Already encoded.
 * @property {string} [hint] HTML the caller has already encoded, shown under the field.
 * @property {boolean} [hidden] Rendered but not shown; see `showField`.
 * @property {Record<string, string|number|boolean>} [attrs] Extra attributes
 *   for the control (`autocomplete`, `maxlength`, `inputmode`, ...).
 * @property {Array<{ value: string, label: string }>} [options] A select's
 *   choices; labels already encoded.
 */

/**
 * @typedef {object} FormDialog
 * @property {jQuery} $dialog
 * @property {() => void} close
 * @property {() => Record<string, string|boolean>} values Every field's
 *   current value; a switch's is a boolean.
 * @property {(name: string) => jQuery} field A field's control.
 * @property {(name: string, show: boolean) => void} showField
 * @property {(text: string, opts?: { kind?: 'error'|'info', field?: string }) => void} setStatus
 *   Plain text; an empty string clears it. Naming a field marks it invalid and focuses it.
 * @property {(opts: { message?: string, html?: string, describe?: string, keepOnBackdrop?: boolean }) => void} finish
 *   Swaps the form for a done state (a plain-text `message`, then the
 *   caller's encoded `html`, either or both) with a single Done button. `describe` selects the part of
 *   `html` the focused Done button reads out. `keepOnBackdrop` stops a stray
 *   click outside the card from closing it, for content shown only once.
 */

const COPIED_RESET_MS = 2000;

const attrs_html = (attrs) => Object.entries(attrs ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => (value === true ? ` ${key}` : ` ${key}="${html_encode(String(value))}"`))
    .join('');

const field_html = (field, id) => {
    const control_id = `${id}-${field.name}`;
    const hint_id = `${control_id}-hint`;
    const suffix_id = `${control_id}-suffix`;
    const type = field.type ?? 'text';
    // A switch is drawn by its slider, not the text-box style.
    const control_class = type === 'switch' ? 'dashboard-form-input' : 'dashboard-dialog-input dashboard-form-input';
    const described_by = [field.suffix && suffix_id, field.hint && hint_id].filter(Boolean).join(' ');
    const common = ` id="${control_id}" name="${html_encode(field.name)}" class="${control_class}"`
        + (described_by ? ` aria-describedby="${described_by}"` : '')
        + attrs_html(field.attrs);

    if ( type === 'switch' ) {
        return `<div class="dashboard-form-field dashboard-form-switch-field" data-field="${html_encode(field.name)}"${field.hidden ? ' hidden' : ''}>`
            + '<div class="dashboard-form-switch-text">'
            + `<label class="dashboard-form-label" for="${control_id}">${field.label}</label>`
            + (field.hint ? `<p class="dashboard-form-hint" id="${hint_id}">${field.hint}</p>` : '')
            + '</div>'
            + '<label class="dashboard-switch">'
            + `<input type="checkbox" role="switch"${common}${field.checked ? ' checked' : ''}>`
            + '<span class="dashboard-switch-slider"></span>'
            + '</label>'
            + '</div>';
    }

    let control;
    if ( type === 'textarea' ) {
        control = `<textarea${common} placeholder="${field.placeholder ?? ''}">${html_encode(field.value ?? '')}</textarea>`;
    } else if ( type === 'select' ) {
        control = `<select${common}>${(field.options ?? []).map((option) =>
            `<option value="${html_encode(option.value)}"${option.value === field.value ? ' selected' : ''}>${option.label}</option>`).join('')}</select>`;
    } else {
        control = `<input type="${type}"${common} placeholder="${field.placeholder ?? ''}" value="${html_encode(field.value ?? '')}">`;
    }
    if ( field.suffix ) {
        control = `<div class="dashboard-form-affix">${control}<span class="dashboard-form-suffix" id="${suffix_id}">${html_encode(field.suffix)}</span></div>`;
    } else if ( type === 'password' ) {
        control = '<div class="dashboard-form-secret">'
            + control
            + `<button type="button" class="dashboard-form-reveal" aria-controls="${control_id}"`
            + ` aria-label="${i18n('show_password')}" title="${i18n('show_password')}">${FORM_ICONS.show}</button>`
            + '</div>';
    }

    return `<div class="dashboard-form-field" data-field="${html_encode(field.name)}"${field.hidden ? ' hidden' : ''}>`
        + `<label class="dashboard-form-label" for="${control_id}">${field.label}</label>`
        + control
        + (field.hint ? `<p class="dashboard-form-hint" id="${hint_id}">${field.hint}</p>` : '')
        + '</div>';
};

/**
 * A read-only value with a Copy button, for a `finish` screen. The dialog
 * wires the button.
 *
 * @param {object} opts
 * @param {string} opts.value Plain text.
 * @param {string} opts.label Plain text naming the value for screen readers.
 * @param {string} [opts.copiedLabel] Plain text the button shows once copied.
 * @param {boolean} [opts.compact] Icon buttons, leaving the value the width;
 *   `after` should hold `dashboard-icon-btn`s too.
 * @param {string} [opts.after] HTML the caller has already encoded, after the button.
 * @returns {string}
 */
export const copyRowHtml = ({ value, label, copiedLabel, compact = false, after = '' }) =>
    `<div class="dashboard-copy-row${compact ? ' dashboard-copy-row-compact' : ''}">`
    + `<input type="text" class="dashboard-dialog-input dashboard-copy-value" readonly value="${html_encode(value)}" aria-label="${html_encode(label)}" spellcheck="false">`
    + `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-quiet dashboard-copy-btn${compact ? ' dashboard-icon-btn' : ''}"`
    + ` data-copied="${html_encode(copiedLabel ?? i18n('copied', [], false))}"`
    + (compact ? ` aria-label="${i18n('copy')}" title="${i18n('copy')}">${FORM_ICONS.copy}` : `>${i18n('copy')}`)
    + '</button>'
    + after
    + '</div>';

/**
 * @param {object} opts
 * @param {string} opts.title Plain text.
 * @param {string} [opts.intro] HTML the caller has already encoded, above the fields.
 * @param {'danger'} [opts.tone] Adds the warning icon and makes the submit button red.
 * @param {FormDialogField[]} [opts.fields]
 * @param {string} opts.submitLabel Plain text.
 * @param {(dialog: FormDialog) => Promise<void> | void} opts.onSubmit Runs on
 *   the submit button or Enter, with the fields locked and the button busy
 *   until it settles. It reports back through the dialog: `setStatus`,
 *   `finish`, or `close`.
 * @param {jQuery} [opts.$container] Where the overlay mounts; defaults to body.
 * @param {HTMLElement} [opts.returnFocusTo] Where focus goes on close.
 * @returns {FormDialog}
 */
export default function UIDashboardFormDialog ({ title, intro, tone, fields = [], submitLabel, onSubmit, $container, returnFocusTo }) {
    const id = `dashboard-form-${window.uuidv4?.() ?? Date.now()}`;
    const danger = tone === 'danger';

    let h = `<form class="dashboard-dialog dashboard-form-dialog${danger ? ' dashboard-dialog-danger' : ''}" role="dialog" aria-modal="true" tabindex="-1" novalidate`;
    h += ` aria-labelledby="${id}-title"${intro ? ` aria-describedby="${id}-intro"` : ''}>`;
    h += '<div class="dashboard-dialog-header">';
    h += `<span class="dashboard-dialog-title" id="${id}-title">${html_encode(title)}</span>`;
    h += `<button type="button" class="dashboard-dialog-close" aria-label="${i18n('close')}" title="${i18n('close')}">${ICONS.close}</button>`;
    h += '</div>';
    h += '<div class="dashboard-dialog-body">';
    if ( danger ) h += `<div class="dashboard-dialog-icon">${ICONS.danger}</div>`;
    h += '<div class="dashboard-dialog-content">';
    if ( intro ) h += `<div class="dashboard-dialog-message" id="${id}-intro">${intro}</div>`;
    h += fields.map((field) => field_html(field, id)).join('');
    h += '<div class="dashboard-form-status" role="status" aria-live="polite"></div>';
    h += '</div></div>';
    h += '<div class="dashboard-dialog-footer">';
    h += `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-quiet dashboard-form-cancel">${i18n('cancel')}</button>`;
    h += `<button type="submit" class="dashboard-dialog-btn dashboard-dialog-btn-${danger ? 'danger' : 'primary'} dashboard-form-submit">`;
    h += '<span class="dashboard-form-spinner" aria-hidden="true"></span>';
    h += `<span class="dashboard-form-submit-label">${html_encode(submitLabel)}</span>`;
    h += '</button>';
    h += '</div></form>';

    let busy = false;
    let keep_on_backdrop = false;
    // While the handler runs, the dialog is where its outcome will show, so
    // only the explicit ✕ closes it then; a stray click or Escape does not.
    const { $dialog, close, isClosed } = mountDashboardOverlay({
        html: h,
        $container,
        returnFocusTo,
        canDismiss: (via) => via === 'close' || ! (busy || (keep_on_backdrop && via === 'backdrop')),
    });
    const $status = $dialog.find('.dashboard-form-status');
    const $submit = $dialog.find('.dashboard-form-submit');
    const $controls = () => $dialog.find('.dashboard-form-input');

    /** @type {HTMLElement | null} */
    let focus_after = null;

    /** @type {FormDialog} */
    const dialog = {
        $dialog,
        close,
        values () {
            const out = {};
            $controls().each(function () {
                out[this.name] = this.type === 'checkbox' ? this.checked : String($(this).val() ?? '');
            });
            return out;
        },
        field: (name) => $controls().filter((_, el) => el.name === name),
        showField (name, show) {
            $dialog.find('.dashboard-form-field').filter((_, el) => el.dataset.field === name).prop('hidden', ! show);
        },
        setStatus (text, { kind = 'error', field } = {}) {
            $status.text(text ?? '')
                .toggleClass('dashboard-form-status-error', !! text && kind === 'error')
                .toggleClass('dashboard-form-status-info', !! text && kind === 'info');
            if ( ! text ) return;
            const body = $dialog.find('.dashboard-dialog-body').get(0);
            if ( body ) body.scrollTop = body.scrollHeight;
            if ( field ) {
                const $field = dialog.field(field).attr('aria-invalid', 'true');
                // The status sits below the fields; on a short screen, the
                // field wins the space.
                const el_row = $field.closest('.dashboard-form-field').get(0);
                if ( body && el_row ) {
                    const hidden_above = body.getBoundingClientRect().top - el_row.getBoundingClientRect().top;
                    if ( hidden_above > 0 ) body.scrollTop -= hidden_above;
                }
                // A locked field can't take focus; the submit handler hands
                // it over once the fields are unlocked again.
                if ( busy ) focus_after = $field.get(0);
                else $field.get(0)?.focus({ preventScroll: true });
            }
        },
        finish ({ message, html, describe, keepOnBackdrop = false }) {
            keep_on_backdrop = keepOnBackdrop;
            const content = (message === undefined ? '' : `<div class="dashboard-form-done">${FORM_ICONS.done}<p id="${id}-done">${html_encode(message)}</p></div>`)
                + (html ?? '');
            $dialog.attr('aria-describedby', null);
            $dialog.find('.dashboard-dialog-body').html(`<div class="dashboard-dialog-content" role="status">${content}</div>`);
            const described = message !== undefined
                || (describe && $dialog.find('.dashboard-dialog-body').find(describe).first().attr('id', `${id}-done`).length > 0);
            // A status region that arrives with its text isn't announced;
            // the focused Done button reads the message out instead.
            $dialog.find('.dashboard-dialog-footer').html(
                `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-primary dashboard-form-done-btn"${described ? ` aria-describedby="${id}-done"` : ''}>${i18n('done')}</button>`);
            $dialog.find('.dashboard-form-done-btn').get(0)?.focus({ preventScroll: true });
        },
    };

    // A keyboard popping up mid-animation on a phone hides half the sheet;
    // there the user taps the field they want.
    const $first_field = $controls().filter(':visible').first();
    (isTouchPrimaryDevice() || ! $first_field.length ? $dialog : $first_field).get(0)?.focus({ preventScroll: true });

    $dialog.on('input change', '.dashboard-form-input', function () {
        $(this).removeAttr('aria-invalid');
    });

    $dialog.on('click', '.dashboard-form-cancel, .dashboard-form-done-btn', () => close());

    let copied_timer = null;
    $dialog.on('click', '.dashboard-copy-btn', function () {
        const $btn = $(this);
        const $value = $btn.siblings('.dashboard-copy-value');
        const show = (done) => {
            const text = done ? $btn.attr('data-copied') : i18n('copy', [], false);
            if ( $btn.hasClass('dashboard-icon-btn') ) {
                $btn.attr({ 'aria-label': text, title: text }).html(done ? FORM_ICONS.copied : FORM_ICONS.copy);
            } else {
                $btn.text(text);
            }
        };
        const copied = () => {
            show(true);
            clearTimeout(copied_timer);
            copied_timer = setTimeout(() => show(false), COPIED_RESET_MS);
        };
        // No clipboard access (an insecure origin has no navigator.clipboard
        // at all): select it, try the legacy copy, and leave it selected so
        // the user can copy it by hand.
        const by_hand = () => {
            $value.get(0)?.select();
            try {
                if ( document.execCommand('copy') ) copied();
            } catch { /* stays selected */ }
        };
        if ( navigator.clipboard?.writeText ) {
            navigator.clipboard.writeText(String($value.val())).then(copied, by_hand);
        } else {
            by_hand();
        }
    });
    $dialog.on('focus', '.dashboard-copy-value', function () {
        this.select();
    });

    // Keep the field focused (and a phone's keyboard up) while toggling. The
    // label names the action, so the button carries no aria-pressed as well.
    $dialog.on('pointerdown mousedown', '.dashboard-form-reveal', (e) => e.preventDefault());
    $dialog.on('click', '.dashboard-form-reveal', function () {
        const $input = $(this).siblings('input');
        const reveal = $input.attr('type') === 'password';
        const label = i18n(reveal ? 'hide_password' : 'show_password', [], false);
        $input.attr('type', reveal ? 'text' : 'password');
        $(this).attr({ 'aria-label': label, title: label })
            .html(reveal ? FORM_ICONS.hide : FORM_ICONS.show);
    });

    $dialog.on('submit', async (e) => {
        e.preventDefault();
        if ( busy || isClosed() ) return;
        busy = true;
        dialog.setStatus('');
        // Disabling the focused control drops focus to the page; it gets it back after.
        const el_had_focus = document.activeElement;
        const $locked = $controls().not(':disabled');
        $locked.prop('disabled', true);
        $submit.prop('disabled', true).addClass('dashboard-form-busy').attr('aria-busy', 'true');
        try {
            await onSubmit(dialog);
        } catch ( err ) {
            dialog.setStatus(err?.message || i18n('error_unknown_cause', [], false));
        } finally {
            busy = false;
            $locked.prop('disabled', false);
            $submit.prop('disabled', false).removeClass('dashboard-form-busy').removeAttr('aria-busy');
            const el_dialog = $dialog.get(0);
            const el_refocus = focus_after
                ?? (el_dialog.contains(document.activeElement) ? null : el_had_focus);
            focus_after = null;
            if ( ! isClosed() && el_dialog.contains(el_refocus) ) el_refocus.focus({ preventScroll: true });
        }
    });

    return dialog;
}
