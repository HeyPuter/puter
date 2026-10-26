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
import { afterEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key, replacements) => (Array.isArray(replacements) && replacements.length ? `${key}:${replacements.join()}` : key);
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { default: UIDashboardProgressModal } = await import('./UIDashboardProgressModal.js');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

afterEach(() => {
    document.body.innerHTML = '';
});

describe('UIDashboardProgressModal', () => {
    it('renders a dashboard dialog card with an indeterminate bar, not a window', () => {
        const progress = UIDashboardProgressModal({ title: 'Copying', operation_id: 7 });
        expect($('.dashboard-dialog-overlay .dashboard-progress-dialog')).toHaveLength(1);
        expect($('.window')).toHaveLength(0);
        expect($('.dashboard-dialog-title').text()).toBe('Copying');
        expect($(progress.element).attr('data-operation-id')).toBe('7');
        expect($('.dashboard-progress-status').text()).toBe('preparing');
        const $bar = $('[role="progressbar"]');
        expect($bar.hasClass('dashboard-progress-indeterminate')).toBe(true);
        expect($bar.attr('aria-valuenow')).toBeUndefined();
        expect($('.dashboard-progress-meta').prop('hidden')).toBe(true);
        expect(document.activeElement).toBe(progress.element);
    });

    it('labels itself by its status when it has no title', () => {
        UIDashboardProgressModal({ status: 'Emptying' });
        expect($('.dashboard-dialog-header')).toHaveLength(0);
        const labelledby = $('.dashboard-progress-dialog').attr('aria-labelledby');
        expect(document.getElementById(labelledby).textContent).toBe('Emptying');
    });

    it('turns determinate on the first percentage, clamping what callers pass', () => {
        const progress = UIDashboardProgressModal({ title: 'Uploading' });
        progress.set_progress('1.0e+2');
        const $bar = $('[role="progressbar"]');
        expect($bar.hasClass('dashboard-progress-indeterminate')).toBe(false);
        expect($bar.attr('aria-valuenow')).toBe('100');
        expect($('.dashboard-progress-percent').text()).toBe('100%');
        expect($('.dashboard-progress-meta').prop('hidden')).toBe(false);
        expect($('.dashboard-progress-eta').text()).toBe('progress_finishing');

        progress.set_progress(42.4);
        expect($bar.attr('aria-valuenow')).toBe('42');
        expect($('.dashboard-progress-fill').get(0).style.transform).toBe('scaleX(0.42)');
        expect($('.dashboard-progress-eta').text()).toBe('');
    });

    it('takes the caller\'s encoded status as HTML', () => {
        const progress = UIDashboardProgressModal({ title: 'Moving' });
        progress.set_status('Moving <strong>a&amp;b</strong>');
        expect($('.dashboard-progress-status strong').text()).toBe('a&b');
    });

    it('stays up through Escape and backdrop clicks while running', async () => {
        UIDashboardProgressModal({ title: 'Copying', on_cancel: () => {} });
        await tick();
        escape();
        const el_overlay = $('.dashboard-dialog-overlay').get(0);
        el_overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el_overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect($('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show')).toBe(true);
    });

    it('cancels through its Cancel button, and has none without on_cancel', async () => {
        const on_cancel = vi.fn();
        UIDashboardProgressModal({ title: 'Uploading', on_cancel });
        $('.dashboard-progress-cancel').trigger('click');
        expect(on_cancel).toHaveBeenCalledOnce();
        expect($('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show')).toBe(false);

        document.body.innerHTML = '';
        UIDashboardProgressModal({ title: 'Deleting' });
        expect($('.dashboard-progress-cancel')).toHaveLength(0);
        expect($('.dashboard-dialog-footer')).toHaveLength(0);
    });

    it('shows a done state that ignores later updates', () => {
        const progress = UIDashboardProgressModal({ title: 'Uploading', on_cancel: () => {} });
        progress.set_progress(60);
        progress.complete();
        expect($('.dashboard-progress-dialog').hasClass('dashboard-progress-complete')).toBe(true);
        expect($('.dashboard-progress-percent').text()).toBe('100%');
        expect($('.dashboard-progress-eta').text()).toBe('done');
        expect($('.dashboard-progress-cancel').prop('disabled')).toBe(true);
    });

    it('swaps to a dismissable error with an OK button', async () => {
        const progress = UIDashboardProgressModal({ title: 'Uploading', on_cancel: () => {} });
        await tick();
        progress.show_error('Failed to upload', 'Disk <full>');
        expect($('.dashboard-progress-dialog').hasClass('dashboard-dialog-error')).toBe(true);
        expect($('[role="alert"]').text()).toContain('Disk <full>');
        expect($('[role="progressbar"]')).toHaveLength(0);
        expect($('.dashboard-progress-cancel')).toHaveLength(0);
        expect(document.activeElement).toBe($('.dashboard-progress-ok').get(0));

        progress.set_progress(50);
        progress.set_status('later');
        expect($('[role="alert"]').text()).not.toContain('later');

        escape();
        expect($('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show')).toBe(false);
    });

    it('adds a footer for the error when there was no Cancel button', () => {
        const progress = UIDashboardProgressModal({ title: 'Deleting' });
        progress.show_error('Failed', '');
        expect($('.dashboard-dialog-footer .dashboard-progress-ok')).toHaveLength(1);
        $('.dashboard-progress-ok').trigger('click');
        expect($('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show')).toBe(false);
    });
});
