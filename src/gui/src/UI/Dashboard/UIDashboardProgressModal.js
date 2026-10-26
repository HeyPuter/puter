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

// The dashboard's progress card for uploads, copies and moves: the same
// overlay card as its other dialogs (a bottom sheet on phones), with the
// handle UIWindowProgress returns so the shared file helpers drive either.

import mountDashboardOverlay from './dashboardOverlay.js';
import { ICONS, SVG } from './UIDashboardDialog.js';
import { createRemainingEstimator, normalizePercent, roundSecondsLeft } from './transferProgress.js';

const DONE_ICON = SVG('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>');

/**
 * @typedef {object} DashboardProgress
 * @property {HTMLElement} element The card.
 * @property {(html: string) => void} set_status HTML the caller has already encoded.
 * @property {(percent: number|string) => void} set_progress The first call
 *   turns the bar from indeterminate to a percentage with an estimate of the time left.
 * @property {(html?: string) => void} complete Fills the bar and shows a done
 *   state until `close`; `html` (already encoded) replaces the status.
 * @property {(title: string, message: string) => void} show_error Plain text;
 *   swaps the progress for an error the user dismisses.
 * @property {() => void} close
 */

/**
 * @param {object} [opts]
 * @param {string} [opts.title] Plain text; without one the card has no header.
 * @param {string} [opts.status] HTML the caller has already encoded; defaults to "Preparing...".
 * @param {number|string} [opts.operation_id] Saved in `data-operation-id` for later lookup.
 * @param {() => void} [opts.on_cancel] Runs after the Cancel button closes the
 *   card. Without it there is no Cancel button.
 * @param {jQuery} [opts.$container] Where the overlay mounts; defaults to body.
 * @returns {DashboardProgress}
 */
export default function UIDashboardProgressModal ({ title, status, operation_id, on_cancel, $container } = {}) {
    const id = `dashboard-progress-${window.uuidv4?.() ?? Date.now()}`;

    let h = '<div class="dashboard-dialog dashboard-progress-dialog" role="dialog" aria-modal="true" tabindex="-1"';
    h += ` aria-labelledby="${title ? `${id}-title` : `${id}-status`}"${title ? ` aria-describedby="${id}-status"` : ''}`;
    if ( operation_id !== null && operation_id !== undefined ) h += ` data-operation-id="${html_encode(String(operation_id))}"`;
    h += '>';
    if ( title ) {
        h += '<div class="dashboard-dialog-header">';
        h += `<span class="dashboard-dialog-title" id="${id}-title">${html_encode(title)}</span>`;
        h += '</div>';
    }
    h += '<div class="dashboard-dialog-body">';
    h += '<div class="dashboard-dialog-content dashboard-progress-content">';
    h += `<div class="dashboard-progress-status" id="${id}-status">${status ?? i18n('preparing')}</div>`;
    // No aria-valuenow until there is a percentage: that reads as indeterminate.
    h += `<div class="dashboard-progress-track dashboard-progress-indeterminate" role="progressbar" aria-labelledby="${id}-status" aria-valuemin="0" aria-valuemax="100">`;
    h += '<div class="dashboard-progress-fill"></div>';
    h += '</div>';
    h += '<div class="dashboard-progress-meta" hidden>';
    h += '<span class="dashboard-progress-eta"></span>';
    h += '<span class="dashboard-progress-percent"></span>';
    h += '</div>';
    h += '</div></div>';
    if ( on_cancel ) {
        h += '<div class="dashboard-dialog-footer">';
        h += `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-quiet dashboard-progress-cancel">${i18n('cancel')}</button>`;
        h += '</div>';
    }
    h += '</div>';

    let failed = false;
    // A stray click or Escape mustn't abandon a transfer the card is still
    // tracking; only Cancel stops it. An error, once shown, closes any way.
    const { $dialog, close, isClosed } = mountDashboardOverlay({
        html: h,
        $container,
        canDismiss: () => failed,
    });
    const el_dialog = $dialog.get(0);
    el_dialog.focus({ preventScroll: true });

    const $status = $dialog.find('.dashboard-progress-status');
    const $track = $dialog.find('.dashboard-progress-track');
    const $fill = $dialog.find('.dashboard-progress-fill');
    const $meta = $dialog.find('.dashboard-progress-meta');
    const $eta = $dialog.find('.dashboard-progress-eta');
    const $percent = $dialog.find('.dashboard-progress-percent');
    const estimator = createRemainingEstimator();

    const time_left = (seconds) => {
        const rounded = seconds === null ? null : roundSecondsLeft(seconds);
        if ( ! rounded ) return i18n('progress_few_seconds_left', [], false);
        let time;
        try {
            time = new Intl.NumberFormat(window.locale, { style: 'unit', unit: rounded.unit, unitDisplay: 'long' }).format(rounded.value);
        } catch {
            time = String(rounded.value);
        }
        return i18n('progress_time_left', { time }, false);
    };

    const fill_to = (pct) => {
        $track.removeClass('dashboard-progress-indeterminate').attr('aria-valuenow', pct);
        $fill.css('transform', `scaleX(${pct / 100})`);
        $percent.text(`${pct}%`);
        $meta.prop('hidden', false);
    };

    $dialog.on('click', '.dashboard-progress-cancel', () => {
        close();
        on_cancel();
    });

    return {
        element: el_dialog,
        set_status (html) {
            if ( ! failed ) $status.html(html);
        },
        set_progress (percent) {
            if ( failed || isClosed() ) return;
            const pct = normalizePercent(percent);
            const seconds = estimator.push(pct);
            fill_to(pct);
            // Every byte is sent, but the server hasn't confirmed the write yet.
            if ( pct >= 100 ) $eta.text(i18n('progress_finishing', [], false));
            else if ( seconds === null ) $eta.text('');
            else $eta.text(time_left(seconds));
        },
        complete (html) {
            if ( failed || isClosed() ) return;
            fill_to(100);
            $dialog.addClass('dashboard-progress-complete');
            $eta.html(`${DONE_ICON}<span>${i18n('done')}</span>`);
            if ( html !== undefined ) $status.html(html);
            $dialog.find('.dashboard-progress-cancel').prop('disabled', true);
        },
        close,
        show_error (error_title, message) {
            if ( isClosed() ) return;
            failed = true;
            $dialog.addClass('dashboard-dialog-error');
            let body = `<div class="dashboard-dialog-icon">${ICONS.error}</div>`;
            body += '<div class="dashboard-dialog-content" role="alert">';
            body += `<div class="dashboard-dialog-message"><p><strong>${html_encode(error_title ?? '')}</strong></p>`;
            if ( message ) body += `<p>${html_encode(message)}</p>`;
            body += '</div></div>';
            $dialog.find('.dashboard-dialog-body').html(body);
            $dialog.attr('aria-describedby', null);

            const ok = `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-primary dashboard-progress-ok">${i18n('ok')}</button>`;
            const $footer = $dialog.find('.dashboard-dialog-footer');
            if ( $footer.length ) $footer.html(ok);
            else $dialog.append(`<div class="dashboard-dialog-footer">${ok}</div>`);
            $dialog.find('.dashboard-progress-ok').on('click', () => close()).get(0)?.focus({ preventScroll: true });
        },
    };
}
