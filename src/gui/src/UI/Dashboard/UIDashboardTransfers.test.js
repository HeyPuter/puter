// @vitest-environment jsdom
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key, replacements) => {
    if ( Array.isArray(replacements) && replacements.length ) return `${key}:${replacements.join()}`;
    if ( replacements && typeof replacements === 'object' && ! Array.isArray(replacements) ) return `${key}:${JSON.stringify(replacements)}`;
    return key;
};
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { default: UIDashboardTransfer } = await import('./UIDashboardTransfers.js');

const summary = () => $('.dashboard-transfers-summary').text();
// Lets a removed row (and then the tray) finish fading out.
const settle = () => vi.advanceTimersByTimeAsync(500);

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(async () => {
    $('.dashboard-transfer').each(function () {
        this.dashboardTransferClose?.();
    });
    await settle();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('UIDashboardTransfer', () => {
    it('adds a row to a tray without blocking the page', () => {
        const transfer = UIDashboardTransfer({ title: 'Copying', operation_id: 7 });
        expect($('.dashboard-transfers .dashboard-transfer')).toHaveLength(1);
        expect($('.dashboard-dialog-overlay, .window')).toHaveLength(0);
        expect($('.dashboard-transfer-title').text()).toBe('Copying');
        expect($('.dashboard-transfer-status').text()).toBe('preparing');
        expect($(transfer.element).attr('data-operation-id')).toBe('7');
        expect(summary()).toBe('tasks_in_progress_one:{"count":1}');
        const $bar = $('[role="progressbar"]');
        expect($bar.hasClass('dashboard-progress-indeterminate')).toBe(true);
        expect($bar.attr('aria-valuenow')).toBeUndefined();
    });

    it('mounts inside the dashboard, under its drawer and dialogs', () => {
        $('<div class="window window-dashboard"><div class="dashboard"></div></div>').appendTo('body');
        UIDashboardTransfer({ title: 'Copying' });
        expect($('.window-dashboard .dashboard > .dashboard-transfers')).toHaveLength(1);
    });

    it('mounts a new tray when the old one was taken out of the page', () => {
        UIDashboardTransfer({ title: 'Copying' });
        $('.dashboard-transfers').detach();
        UIDashboardTransfer({ title: 'Moving' });
        expect($('.dashboard-transfers')).toHaveLength(1);
        expect($('.dashboard-transfer-title').text()).toBe('Moving');
    });

    it('does not take focus', () => {
        const $input = $('<input>').appendTo('body');
        $input.get(0).focus();
        UIDashboardTransfer({ title: 'Uploading', on_cancel: () => {} });
        expect(document.activeElement).toBe($input.get(0));
    });

    it('shares one tray between tasks and counts the running ones', () => {
        const a = UIDashboardTransfer({ title: 'Uploading' });
        UIDashboardTransfer({ title: 'Copying' });
        expect($('.dashboard-transfers')).toHaveLength(1);
        expect(summary()).toBe('tasks_in_progress_other:{"count":2}');
        a.complete();
        expect(summary()).toBe('tasks_in_progress_one:{"count":1}');
        expect($('.dashboard-transfers-close').prop('hidden')).toBe(true);
    });

    it('leads with the status when there is no title', () => {
        const transfer = UIDashboardTransfer({ status: 'Emptying' });
        expect($('.dashboard-transfer-title').text()).toBe('Emptying');
        expect($('.dashboard-transfer-status')).toHaveLength(0);
        transfer.set_status('Still emptying');
        expect($('.dashboard-transfer-title').text()).toBe('Still emptying');
    });

    it('turns determinate on the first percentage, clamping what callers pass', () => {
        const transfer = UIDashboardTransfer({ title: 'Uploading' });
        transfer.set_progress('1.0e+2');
        const $bar = $('[role="progressbar"]');
        expect($bar.hasClass('dashboard-progress-indeterminate')).toBe(false);
        expect($bar.attr('aria-valuenow')).toBe('100');
        expect($('.dashboard-progress-percent').text()).toBe('100%');
        expect($('.dashboard-progress-eta').text()).toBe('progress_finishing');

        transfer.set_progress(42.4);
        expect($bar.attr('aria-valuenow')).toBe('42');
        expect($('.dashboard-progress-fill').get(0).style.transform).toBe('scaleX(0.42)');
    });

    it('keeps a time-left estimate for a slow transfer', async () => {
        // The uploader reports to the hundredth every 100ms; at 0.15%/s the
        // whole percentage can stand still for longer than the rate window.
        const transfer = UIDashboardTransfer({ title: 'Uploading' });
        let blank = 0;
        for ( let t = 0; t <= 60_000; t += 100 ) {
            transfer.set_progress((0.15 * t / 1000).toFixed(2));
            if ( t >= 3000 && $('.dashboard-progress-eta').text() === '' ) blank++;
            await vi.advanceTimersByTimeAsync(100);
        }
        expect(blank).toBe(0);
    });

    it('takes the caller\'s encoded status as HTML', () => {
        const transfer = UIDashboardTransfer({ title: 'Moving' });
        transfer.set_status('Moving <strong>a&amp;b</strong>');
        expect($('.dashboard-transfer-status strong').text()).toBe('a&b');
    });

    it('cancels from its row and drops the tray with its last row', async () => {
        const on_cancel = vi.fn();
        UIDashboardTransfer({ title: 'Uploading', on_cancel });
        expect($('.dashboard-transfer-cancel').attr('aria-describedby')).toBe($('.dashboard-transfer-title').attr('id'));
        $('.dashboard-transfer-cancel').trigger('click');
        expect(on_cancel).toHaveBeenCalledOnce();
        await settle();
        expect($('.dashboard-transfers')).toHaveLength(0);
    });

    it('has no Cancel button without on_cancel', () => {
        UIDashboardTransfer({ title: 'Deleting' });
        expect($('.dashboard-transfer-cancel')).toHaveLength(0);
    });

    it('shows a done state that ignores later updates', () => {
        const transfer = UIDashboardTransfer({ title: 'Uploading', on_cancel: () => {} });
        transfer.set_progress(60);
        transfer.complete();
        expect($('.dashboard-transfer').hasClass('dashboard-transfer-done')).toBe(true);
        expect($('.dashboard-progress-percent').text()).toBe('100%');
        expect($('.dashboard-progress-eta').text()).toBe('done');
        expect($('.dashboard-transfer-cancel')).toHaveLength(0);
        transfer.set_progress(10);
        expect($('.dashboard-progress-percent').text()).toBe('100%');
        expect(summary()).toBe('tasks_done');
        expect($('.dashboard-transfers-close').prop('hidden')).toBe(false);
    });

    it('keeps a failure until it is dismissed, and opens a collapsed tray for it', async () => {
        const transfer = UIDashboardTransfer({ title: 'Uploading', on_cancel: () => {} });
        $('.dashboard-transfers-toggle').trigger('click');
        expect($('.dashboard-transfers').hasClass('dashboard-transfers-collapsed')).toBe(true);

        transfer.show_error('Failed to upload', 'Disk <full>');
        expect($('.dashboard-transfers').hasClass('dashboard-transfers-collapsed')).toBe(false);
        expect($('[role="alert"]').text()).toContain('Disk <full>');
        expect($('[role="progressbar"], .dashboard-transfer-cancel')).toHaveLength(0);
        expect(summary()).toBe('tasks_failed_one:{"count":1}');

        transfer.set_status('later');
        expect($('[role="alert"]').text()).not.toContain('later');

        await vi.advanceTimersByTimeAsync(60_000);
        expect($('.dashboard-transfer-error')).toHaveLength(1);
        $('.dashboard-transfer-dismiss').trigger('click');
        await settle();
        expect($('.dashboard-transfers')).toHaveLength(0);
    });

    it('collapses to its summary and back', () => {
        UIDashboardTransfer({ title: 'Copying' });
        const $toggle = $('.dashboard-transfers-toggle');
        expect($toggle.attr('aria-expanded')).toBe('true');
        $toggle.trigger('click');
        expect($toggle.attr('aria-expanded')).toBe('false');
        expect($toggle.attr('aria-label')).toBe('tasks_expand');
        $toggle.trigger('click');
        expect($toggle.attr('aria-expanded')).toBe('true');
    });

    it('clears finished rows from the header once nothing is running', async () => {
        const a = UIDashboardTransfer({ title: 'Uploading' });
        const b = UIDashboardTransfer({ title: 'Copying' });
        a.complete();
        b.show_error('Failed', '');
        $('.dashboard-transfers-close').trigger('click');
        await settle();
        expect($('.dashboard-transfers')).toHaveLength(0);
    });
});
