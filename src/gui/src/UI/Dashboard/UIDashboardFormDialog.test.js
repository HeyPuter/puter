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
globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.matchMedia = () => ({ matches: false });

const { default: UIDashboardFormDialog, copyRowHtml } = await import('./UIDashboardFormDialog.js');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const submit = () => $('.dashboard-form-dialog').trigger('submit');

const open = (opts = {}) => UIDashboardFormDialog({
    title: 'Change it',
    submitLabel: 'Save',
    fields: [
        { name: 'name', label: 'Name', value: 'Ada <3' },
        { name: 'secret', type: 'password', label: 'Password' },
        { name: 'about', type: 'textarea', label: 'About', value: 'hi' },
        { name: 'when', type: 'select', label: 'When', value: '7d', options: [{ value: '', label: 'Never' }, { value: '7d', label: 'A week' }] },
        { name: 'code', label: 'Code', hidden: true },
    ],
    onSubmit: () => {},
    ...opts,
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('UIDashboardFormDialog', () => {
    it('renders a dashboard dialog card with labelled fields, not a window', () => {
        open();
        expect($('.dashboard-dialog-overlay .dashboard-form-dialog')).toHaveLength(1);
        expect($('.window')).toHaveLength(0);
        expect($('.dashboard-dialog-title').text()).toBe('Change it');
        const $name = $('.dashboard-form-input[name="name"]');
        expect($(`label[for="${$name.attr('id')}"]`).text()).toBe('Name');
        expect($name.val()).toBe('Ada <3');
        expect($('.dashboard-form-field[data-field="code"]').prop('hidden')).toBe(true);
    });

    it('ignores Escape and backdrop clicks while the handler runs, but not the close button', async () => {
        let release;
        const dialog = open({ onSubmit: () => new Promise((resolve) => {
            release = resolve;
        }) });
        const $overlay = $('.dashboard-dialog-overlay');
        submit();
        $(document).trigger($.Event('keydown', { key: 'Escape' }));
        $overlay.trigger($.Event('mousedown', { target: $overlay[0] }));
        $overlay.trigger($.Event('click', { target: $overlay[0] }));
        expect($('.dashboard-dialog-overlay')).toHaveLength(1);

        $('.dashboard-dialog-close').trigger('click');
        release();
        await tick();
        expect(dialog.$dialog.closest('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show')).toBe(false);
    });

    it('keeps content shown once up through a backdrop click, not through Escape', () => {
        const dialog = open();
        dialog.finish({ html: '<p>token</p>', keepOnBackdrop: true });
        const $overlay = $('.dashboard-dialog-overlay');
        $overlay.trigger($.Event('mousedown', { target: $overlay[0] }));
        $overlay.trigger($.Event('click', { target: $overlay[0] }));
        expect($overlay.find('p').text()).toBe('token');
        $(document).trigger($.Event('keydown', { key: 'Escape' }));
        expect($overlay.hasClass('dashboard-dialog-show')).toBe(false);
    });

    it('reads every field back by name', () => {
        const dialog = open();
        expect(dialog.values()).toEqual({ name: 'Ada <3', secret: '', about: 'hi', when: '7d', code: '' });
    });

    it('locks the fields and shows progress while the handler runs', async () => {
        let release;
        const onSubmit = vi.fn(() => new Promise((resolve) => {
            release = resolve;
        }));
        open({ onSubmit });

        submit();
        expect(onSubmit).toHaveBeenCalledOnce();
        expect($('.dashboard-form-input[name="name"]').prop('disabled')).toBe(true);
        expect($('.dashboard-form-submit').hasClass('dashboard-form-busy')).toBe(true);
        // A second press while busy is ignored.
        submit();
        expect(onSubmit).toHaveBeenCalledOnce();

        release();
        await tick();
        expect($('.dashboard-form-input[name="name"]').prop('disabled')).toBe(false);
        expect($('.dashboard-form-submit').hasClass('dashboard-form-busy')).toBe(false);
    });

    it('marks the named field invalid and focuses it once the fields unlock', async () => {
        open({ onSubmit: (dialog) => dialog.setStatus('Nope', { field: 'secret' }) });

        submit();
        await tick();

        expect($('.dashboard-form-status').text()).toBe('Nope');
        expect($('.dashboard-form-status').hasClass('dashboard-form-status-error')).toBe(true);
        const secret = $('.dashboard-form-input[name="secret"]');
        expect(secret.attr('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(secret.get(0));

        secret.val('x').trigger('input');
        expect(secret.attr('aria-invalid')).toBeUndefined();
    });

    it('gives focus back to the submitting control when locking it dropped focus', async () => {
        open({ onSubmit: (dialog) => {
            // A browser drops focus to the page when the focused control is
            // disabled; jsdom doesn't, so move it there by hand.
            const el_away = $('<button>').appendTo('body').get(0);
            el_away.focus();
            el_away.remove();
            dialog.setStatus('Server says no');
        } });
        const name = $('.dashboard-form-input[name="name"]').get(0);
        name.focus();
        submit();
        await tick();
        expect(document.activeElement).toBe(name);
    });

    it('leaves focus where the handler put it inside the dialog', async () => {
        open({ onSubmit: (dialog) => dialog.finish({ message: 'Done' }) });
        $('.dashboard-form-input[name="name"]').get(0).focus();
        submit();
        await tick();
        expect(document.activeElement).toBe($('.dashboard-form-done-btn').get(0));
    });

    it('scrolls a named field back into view when the status pushed it off the top', () => {
        const dialog = open();
        const body = $('.dashboard-dialog-body').get(0);
        const row = $('.dashboard-form-field[data-field="name"]').get(0);
        Object.defineProperty(body, 'scrollHeight', { value: 500 });
        let scroll_top = 0;
        Object.defineProperty(body, 'scrollTop', { get: () => scroll_top, set: (v) => {
            scroll_top = v;
        } });
        body.getBoundingClientRect = () => ({ top: 100 });
        row.getBoundingClientRect = () => ({ top: 100 - 60 });

        dialog.setStatus('Nope', { field: 'name' });
        expect(scroll_top).toBe(500 - 60);
    });

    it('shows a thrown error in the status line', async () => {
        open({ onSubmit: async () => {
            throw new Error('Server says no');
        } });
        submit();
        await tick();
        expect($('.dashboard-form-status').text()).toBe('Server says no');
    });

    it("has Done read out the part of the caller's html it names", async () => {
        open({ onSubmit: (dialog) => dialog.finish({ html: '<p class="warn">Shown once</p><input value="tok">', describe: '.warn' }) });
        submit();
        await tick();

        const described_by = $('.dashboard-form-done-btn').attr('aria-describedby');
        expect($(`#${described_by}`).text()).toBe('Shown once');
    });

    it('swaps the form for a done state whose button closes it', async () => {
        open({ onSubmit: (dialog) => dialog.finish({ message: 'All <good>' }) });
        submit();
        await tick();

        expect($('.dashboard-form-input')).toHaveLength(0);
        expect($('.dashboard-form-done p').text()).toBe('All <good>');
        expect(document.activeElement).toBe($('.dashboard-form-done-btn').get(0));
        const described_by = $('.dashboard-form-done-btn').attr('aria-describedby');
        expect($(`#${described_by}`).text()).toBe('All <good>');
        $('.dashboard-form-done-btn').trigger('click');
        expect($('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show')).toBe(false);
    });

    it('shows a message and the caller\'s html together, with a working copy row', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        open({ onSubmit: (dialog) => dialog.finish({
            message: 'Live',
            html: copyRowHtml({ value: 'https://a.example', label: 'Address' }),
        }) });
        submit();
        await tick();

        expect($('.dashboard-form-done p').text()).toBe('Live');
        expect($(`#${$('.dashboard-form-done-btn').attr('aria-describedby')}`).text()).toBe('Live');
        expect($('.dashboard-copy-value').val()).toBe('https://a.example');
        $('.dashboard-copy-btn').trigger('click');
        await tick();
        expect(writeText).toHaveBeenCalledWith('https://a.example');
        expect($('.dashboard-copy-btn').text()).toBe('copied');
    });

    it('draws a suffix inside the field and has it read with the field', () => {
        open({ fields: [{ name: 'name', label: 'Address', suffix: '.puter.site <b>' }] });
        const $input = $('.dashboard-form-input[name="name"]');
        expect($input.closest('.dashboard-form-affix')).toHaveLength(1);
        expect($(`#${$input.attr('aria-describedby')}`).text()).toBe('.puter.site <b>');
    });

    it('types into a suffixed field when its suffix is pressed', () => {
        open({ fields: [{ name: 'name', label: 'Address', value: 'my-site', suffix: '.puter.site' }] });
        const $input = $('.dashboard-form-input[name="name"]');
        $input.get(0).blur();
        const down = $.Event('mousedown');
        $('.dashboard-form-suffix').trigger(down);
        expect(down.isDefaultPrevented()).toBe(true);
        expect(document.activeElement).toBe($input.get(0));
        expect($input.get(0).selectionStart).toBe('my-site'.length);
    });

    it('reads a switch back as a boolean', () => {
        const dialog = open({ fields: [
            { name: 'on', type: 'switch', label: 'On', checked: true },
            { name: 'off', type: 'switch', label: 'Off' },
        ] });
        expect($('.dashboard-form-input[name="on"]').attr('role')).toBe('switch');
        expect(dialog.values()).toEqual({ on: true, off: false });
    });

    it('toggles a password between hidden and shown', () => {
        open();
        const $input = $('.dashboard-form-input[name="secret"]');
        const $reveal = $('.dashboard-form-reveal');
        $reveal.trigger('click');
        expect($input.attr('type')).toBe('text');
        expect($reveal.attr('aria-label')).toBe('hide_password');
        // A label that flips with the state, so no aria-pressed on top of it.
        expect($reveal.attr('aria-pressed')).toBeUndefined();
        $reveal.trigger('click');
        expect($input.attr('type')).toBe('password');
        expect($reveal.attr('aria-label')).toBe('show_password');
    });

    it('closes on Cancel and on Escape without submitting', async () => {
        const onSubmit = vi.fn();
        open({ onSubmit });
        await tick();
        $('.dashboard-form-cancel').trigger('click');
        expect($('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show')).toBe(false);

        document.body.innerHTML = '';
        open({ onSubmit });
        await tick();
        $(document).trigger($.Event('keydown', { key: 'Escape' }));
        expect($('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show')).toBe(false);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('gives the danger tone a warning icon and a red submit button', () => {
        open({ tone: 'danger' });
        expect($('.dashboard-dialog-icon')).toHaveLength(1);
        expect($('.dashboard-form-submit').hasClass('dashboard-dialog-btn-danger')).toBe(true);
    });
});
