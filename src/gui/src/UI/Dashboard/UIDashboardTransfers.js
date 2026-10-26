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

// The dashboard's progress for uploads, copies and moves: a row in a tray in
// the bottom-right corner that leaves the rest of the dashboard usable. Each
// row has the handle UIWindowProgress returns, so the shared file helpers
// drive either.

import { ICONS, SVG } from './UIDashboardDialog.js';
import { createRemainingEstimator, normalizePercent, roundSecondsLeft } from './transferProgress.js';

const TRAY_ICONS = {
    done: SVG('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'),
    chevron: SVG('<path d="M6 9l6 6 6-6"/>'),
};

// Matches the row's fade-out in dashboard.css.
const LEAVE_MS = 200;

/**
 * @typedef {object} DashboardTransfer
 * @property {HTMLElement} element The task's row.
 * @property {(html: string) => void} set_status HTML the caller has already encoded.
 * @property {(percent: number|string) => void} set_progress The first call
 *   turns the bar from indeterminate to a percentage with an estimate of the time left.
 * @property {(html?: string) => void} complete Fills the bar and shows a done
 *   state until `close`; `html` (already encoded) replaces the status.
 * @property {(title: string, message: string) => void} show_error Plain text;
 *   the row stays until the user dismisses it.
 * @property {() => void} close Removes the row.
 */

/** @type {jQuery | null} */
let $tray = null;
let collapsed = false;

const rows = () => $tray?.find('.dashboard-transfer:not(.dashboard-transfer-leaving)') ?? $();

const countText = (prefix, count) =>
    i18n(count === 1 ? `${prefix}_one` : `${prefix}_other`, { count }, false);

function refreshHeader () {
    if ( ! $tray ) return;
    const $rows = rows();
    const running = $rows.not('.dashboard-transfer-done, .dashboard-transfer-error').length;
    const failed = $rows.filter('.dashboard-transfer-error').length;
    let summary;
    if ( running > 0 ) summary = countText('tasks_in_progress', running);
    else if ( failed > 0 ) summary = countText('tasks_failed', failed);
    else summary = i18n('tasks_done', [], false);
    $tray.find('.dashboard-transfers-summary').text(summary);
    // Running tasks can be hidden but not cleared; only Cancel stops one.
    $tray.find('.dashboard-transfers-close').prop('hidden', running > 0);
}

function setCollapsed (value) {
    collapsed = value;
    const label = i18n(collapsed ? 'tasks_expand' : 'tasks_collapse', [], false);
    $tray.toggleClass('dashboard-transfers-collapsed', collapsed);
    $tray.find('.dashboard-transfers-toggle').attr({ 'aria-expanded': String(! collapsed), 'aria-label': label, title: label });
}

function mountTray () {
    if ( $tray?.get(0).isConnected ) return $tray;
    const id = `dashboard-transfers-${window.uuidv4?.() ?? Date.now()}`;
    let h = `<section class="dashboard-transfers" aria-labelledby="${id}-summary">`;
    h += '<div class="dashboard-transfers-header">';
    h += `<span class="dashboard-transfers-summary" id="${id}-summary"></span>`;
    h += `<button type="button" class="dashboard-transfers-btn dashboard-transfers-toggle" aria-controls="${id}-list">${TRAY_ICONS.chevron}</button>`;
    h += `<button type="button" class="dashboard-transfers-btn dashboard-transfers-close" aria-label="${i18n('close')}" title="${i18n('close')}" hidden>${ICONS.close}</button>`;
    h += '</div>';
    h += `<ul class="dashboard-transfers-list" id="${id}-list"></ul>`;
    h += '</section>';

    // Inside the dashboard, so its drawer, sheets and dialogs stack above the tray.
    const $dashboard = $('.window-dashboard .dashboard').first();
    $tray = $(h).appendTo($dashboard.length ? $dashboard : 'body');
    setCollapsed(collapsed);
    requestAnimationFrame(() => $tray?.addClass('dashboard-transfers-show'));

    $tray.on('click', '.dashboard-transfers-toggle', () => setCollapsed(! collapsed));
    $tray.on('click', '.dashboard-transfers-close', () => {
        rows().each(function () {
            this.dashboardTransferClose?.();
        });
    });
    return $tray;
}

/** Takes a row out, and the tray with the last one. */
function removeRow ($row) {
    if ( $row.hasClass('dashboard-transfer-leaving') ) return;
    // Keep focus in the tray rather than letting it drop to the page.
    const had_focus = $row.get(0).contains(document.activeElement);
    $row.addClass('dashboard-transfer-leaving');
    refreshHeader();
    if ( had_focus ) $tray.find('.dashboard-transfers-toggle').get(0)?.focus({ preventScroll: true });

    setTimeout(() => {
        $row.remove();
        if ( $tray && rows().length === 0 && $tray.find('.dashboard-transfer').length === 0 ) {
            const $old = $tray;
            $tray = null;
            collapsed = false;
            $old.removeClass('dashboard-transfers-show');
            setTimeout(() => $old.remove(), LEAVE_MS);
        }
    }, LEAVE_MS);
}

/**
 * Adds a task to the tray, opening the tray if it isn't up.
 *
 * @param {object} [opts]
 * @param {string} [opts.title] Plain text, such as "Uploading 3 items".
 * @param {string} [opts.status] HTML the caller has already encoded; defaults to "Preparing...".
 * @param {number|string} [opts.operation_id] Saved in `data-operation-id` for later lookup.
 * @param {() => void} [opts.on_cancel] Runs after the row's Cancel button
 *   removes it. Without it the row has no Cancel button.
 * @returns {DashboardTransfer}
 */
export default function UIDashboardTransfer ({ title, status, operation_id, on_cancel } = {}) {
    const id = `dashboard-transfer-${window.uuidv4?.() ?? Date.now()}`;

    let h = `<li class="dashboard-transfer" aria-labelledby="${id}-title"`;
    if ( operation_id !== null && operation_id !== undefined ) h += ` data-operation-id="${html_encode(String(operation_id))}"`;
    h += '>';
    h += '<div class="dashboard-transfer-row">';
    h += '<div class="dashboard-transfer-text">';
    // A task without a title (emptying the Trash) leads with its status.
    h += `<span class="dashboard-transfer-title" id="${id}-title">${title ? html_encode(title) : ''}</span>`;
    h += `<span class="dashboard-transfer-status">${status ?? i18n('preparing')}</span>`;
    h += '</div>';
    if ( on_cancel ) {
        h += `<button type="button" class="dashboard-transfers-btn dashboard-transfer-cancel" aria-label="${i18n('cancel')}" title="${i18n('cancel')}" aria-describedby="${id}-title">${ICONS.close}</button>`;
    }
    h += '</div>';
    // No aria-valuenow until there is a percentage: that reads as indeterminate.
    h += `<div class="dashboard-progress-track dashboard-progress-indeterminate" role="progressbar" aria-labelledby="${id}-title" aria-valuemin="0" aria-valuemax="100">`;
    h += '<div class="dashboard-progress-fill"></div>';
    h += '</div>';
    h += '<div class="dashboard-progress-meta" hidden>';
    h += '<span class="dashboard-progress-eta"></span>';
    h += '<span class="dashboard-progress-percent"></span>';
    h += '</div>';
    h += '</li>';

    const $row = $(h).appendTo(mountTray().find('.dashboard-transfers-list'));
    const el_row = $row.get(0);
    const $title = $row.find('.dashboard-transfer-title');
    const $status = $row.find('.dashboard-transfer-status');
    if ( ! title ) {
        $title.html($status.html());
        $status.remove();
    }
    refreshHeader();

    const $track = $row.find('.dashboard-progress-track');
    const $fill = $row.find('.dashboard-progress-fill');
    const $meta = $row.find('.dashboard-progress-meta');
    const $eta = $row.find('.dashboard-progress-eta');
    const $percent = $row.find('.dashboard-progress-percent');
    const estimator = createRemainingEstimator();

    let settled = false;
    const isClosed = () => $row.hasClass('dashboard-transfer-leaving') || ! el_row.isConnected;
    const close = () => removeRow($row);
    el_row.dashboardTransferClose = close;

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

    $row.on('click', '.dashboard-transfer-cancel', () => {
        close();
        on_cancel();
    });

    return {
        element: el_row,
        set_status (html) {
            if ( settled ) return;
            (title ? $status : $title).html(html);
        },
        set_progress (percent) {
            if ( settled || isClosed() ) return;
            const pct = normalizePercent(percent);
            const seconds = estimator.push(pct);
            fill_to(pct);
            // Every byte is sent, but the server hasn't confirmed the write yet.
            if ( pct >= 100 ) $eta.text(i18n('progress_finishing', [], false));
            else if ( seconds === null ) $eta.text('');
            else $eta.text(time_left(seconds));
        },
        complete (html) {
            if ( settled || isClosed() ) return;
            settled = true;
            fill_to(100);
            $row.addClass('dashboard-transfer-done');
            $eta.html(`${TRAY_ICONS.done}<span>${i18n('done')}</span>`);
            if ( html !== undefined ) (title ? $status : $title).html(html);
            $row.find('.dashboard-transfer-cancel').remove();
            refreshHeader();
        },
        close,
        show_error (error_title, message) {
            if ( isClosed() ) return;
            settled = true;
            $row.addClass('dashboard-transfer-error');
            let body = '<div class="dashboard-transfer-row">';
            body += `<span class="dashboard-transfer-icon">${ICONS.error}</span>`;
            body += '<div class="dashboard-transfer-text" role="alert">';
            body += `<span class="dashboard-transfer-title" id="${id}-title">${html_encode(error_title ?? '')}</span>`;
            if ( message ) body += `<span class="dashboard-transfer-status">${html_encode(message)}</span>`;
            body += '</div>';
            body += `<button type="button" class="dashboard-transfers-btn dashboard-transfer-dismiss" aria-label="${i18n('dismiss')}" title="${i18n('dismiss')}" aria-describedby="${id}-title">${ICONS.close}</button>`;
            body += '</div>';
            // The Cancel button may have had focus; the Dismiss button takes it over.
            const had_focus = el_row.contains(document.activeElement);
            $row.html(body);
            $row.find('.dashboard-transfer-dismiss').on('click', close);
            if ( had_focus ) $row.find('.dashboard-transfer-dismiss').get(0).focus({ preventScroll: true });
            // A collapsed tray would hide the failure behind its summary.
            if ( collapsed ) setCollapsed(false);
            refreshHeader();
        },
    };
}
