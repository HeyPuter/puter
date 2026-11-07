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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';
import { MAX_ATTACHMENTS } from '../../helpers/contact_attachments.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key, values = []) => [key, ...values].join(' ');
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.matchMedia = () => ({ matches: false });
window.byte_format = (bytes) => `${bytes} B`;
URL.createObjectURL = vi.fn(() => 'blob:preview');
URL.revokeObjectURL = vi.fn();

const { default: UIDashboardContactDialog } = await import('./UIDashboardContactDialog.js');

const settle = async () => {
    for ( let i = 0; i < 10; i++ ) await new Promise(resolve => setTimeout(resolve, 0));
};
const message = () => $('.dashboard-form-input[name="message"]');
const status = () => $('.dashboard-form-status').text();
const fileNames = () => $('.dashboard-contact-file-name').map((_, el) => el.textContent).get();
const png = (name = 'shot.png', size = 1024) => new File([new Uint8Array(size)], name, { type: 'image/png' });
const mp4 = (name = 'clip.mp4') => new File([new Uint8Array(2048)], name, { type: 'video/mp4' });

/** Picks files through the hidden file input, as the system picker would. */
const pick = (...files) => {
    const input = $('.dashboard-contact-file-input').get(0);
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    $(input).trigger('change');
};

/** A native-event stand-in for jQuery to wrap, carrying `fields`. */
const nativeEvent = (fields) => ({ preventDefault () {}, stopPropagation () {}, ...fields });

/** A file drag event carrying `files`, as the browser sends it. */
const fileDrag = (type, files = []) => $.Event(type, {
    originalEvent: nativeEvent({ dataTransfer: { types: ['Files'], files, dropEffect: 'none' } }),
});

const submit = async () => {
    $('.dashboard-form-dialog').trigger('submit');
    await settle();
};

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    window.api_origin = 'https://api.puter.test';
    window.auth_token = 'tok-1';
});

describe('Contact Us dialog', () => {
    it('opens as a dashboard form dialog with no attachments listed', () => {
        UIDashboardContactDialog();
        expect($('.dashboard-dialog-overlay .dashboard-contact-dialog').length).toBe(1);
        expect(message().length).toBe(1);
        expect($('.dashboard-contact-files').prop('hidden')).toBe(true);
    });

    it('asks for a message before sending', async () => {
        UIDashboardContactDialog();
        message().val('   ');
        await submit();
        expect(fetch).not.toHaveBeenCalled();
        expect(status()).toBe('contact_us_message_required');
        expect(message().attr('aria-invalid')).toBe('true');
    });

    it('posts the message and attachments as multipart and confirms', async () => {
        UIDashboardContactDialog();
        pick(png(), mp4());
        message().val('It broke');
        await submit();

        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe('https://api.puter.test/contactUs');
        expect(init.headers).toEqual({ Authorization: 'Bearer tok-1' });
        expect(init.body.get('message')).toBe('It broke');
        expect(init.body.getAll('attachments').map(f => f.name)).toEqual(['shot.png', 'clip.mp4']);
        expect($('.dashboard-form-done').text()).toContain('feedback_sent_confirmation');
        expect($('.dashboard-contact-attachments').length).toBe(0);
    });

    it('says when the sender is rate limited and keeps the form', async () => {
        fetch.mockResolvedValueOnce(new Response('{}', { status: 429 }));
        UIDashboardContactDialog();
        message().val('Hello');
        await submit();
        expect(status()).toBe('contact_us_rate_limited');
        expect(message().val()).toBe('Hello');
        expect(message().prop('disabled')).toBe(false);
    });

    it('shows a generic error when the request fails', async () => {
        fetch.mockRejectedValueOnce(new TypeError('offline'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        UIDashboardContactDialog();
        message().val('Hello');
        await submit();
        expect(status()).toBe('contact_us_error');
    });

    it('locks the attachments while sending', async () => {
        let respond;
        fetch.mockReturnValueOnce(new Promise(resolve => {
            respond = resolve;
        }));
        UIDashboardContactDialog();
        pick(png());
        message().val('Hello');
        $('.dashboard-form-dialog').trigger('submit');
        await settle();

        expect($('.dashboard-contact-dropzone').prop('disabled')).toBe(true);
        expect($('.dashboard-contact-file-remove').prop('disabled')).toBe(true);
        pick(png('late.png'));
        expect(fileNames()).toEqual(['shot.png']);

        respond(new Response('{}', { status: 500 }));
        await settle();
        expect($('.dashboard-contact-dropzone').prop('disabled')).toBe(false);
        expect($('.dashboard-contact-file-remove').prop('disabled')).toBe(false);
    });
});

describe('attachments', () => {
    it('lists picked files with a preview for images', () => {
        UIDashboardContactDialog();
        pick(png('a.png'), mp4('b.mp4'));
        expect(fileNames()).toEqual(['a.png', 'b.mp4']);
        expect($('.dashboard-contact-files').prop('hidden')).toBe(false);
        expect($('.dashboard-contact-file').eq(0).find('img').attr('src')).toBe('blob:preview');
        expect($('.dashboard-contact-file').eq(1).find('img').length).toBe(0);
        expect($('.dashboard-contact-file-remove').eq(0).attr('aria-label')).toBe('contact_us_attachment_remove_named a.png');
    });

    it('keeps the files that fit and reports the first rejection', () => {
        UIDashboardContactDialog();
        const text = new File(['x'], 'notes.txt', { type: 'text/plain' });
        pick(png('a.png'), text, png('b.png'));
        expect(fileNames()).toEqual(['a.png', 'b.png']);
        expect(status()).toBe('contact_us_attachment_unsupported');
    });

    it('stops offering to attach once the count cap is reached', () => {
        UIDashboardContactDialog();
        pick(...Array.from({ length: MAX_ATTACHMENTS }, (_, i) => png(`${i}.png`)));
        expect($('.dashboard-contact-dropzone').prop('disabled')).toBe(true);
        pick(png('extra.png'));
        expect(fileNames()).toHaveLength(MAX_ATTACHMENTS);
        expect(status()).toBe(`contact_us_attachment_too_many ${MAX_ATTACHMENTS}`);
    });

    it('removes the file whose button is pressed and moves focus to the next one', async () => {
        UIDashboardContactDialog();
        pick(png('a.png'), png('b.png'), png('c.png'));
        $('.dashboard-contact-file-remove').eq(1).trigger('click');
        expect(fileNames()).toEqual(['a.png', 'c.png']);
        expect(document.activeElement).toBe($('.dashboard-contact-file-remove').get(1));

        message().val('Hello');
        await submit();
        expect(fetch.mock.calls[0][1].body.getAll('attachments').map(f => f.name)).toEqual(['a.png', 'c.png']);
    });

    it('returns focus to the attach button when the last file is removed', () => {
        UIDashboardContactDialog();
        pick(png());
        $('.dashboard-contact-file-remove').trigger('click');
        expect($('.dashboard-contact-files').prop('hidden')).toBe(true);
        expect(document.activeElement).toBe($('.dashboard-contact-dropzone').get(0));
    });

    it('takes files dropped anywhere on the overlay, without letting the drop through', () => {
        const onWindowDrop = vi.fn();
        const $win = $('<div class="window"></div>').appendTo('body').on('drop', onWindowDrop);
        UIDashboardContactDialog({ $container: $win });
        const $overlay = $('.dashboard-dialog-overlay');

        $overlay.trigger(fileDrag('dragenter'));
        expect($('.dashboard-contact-dialog').hasClass('dashboard-contact-dragging')).toBe(true);
        const drop = fileDrag('drop', [png('dropped.png')]);
        $overlay.trigger(drop);

        expect(drop.isDefaultPrevented()).toBe(true);
        expect(onWindowDrop).not.toHaveBeenCalled();
        expect(fileNames()).toEqual(['dropped.png']);
        expect($('.dashboard-contact-dialog').hasClass('dashboard-contact-dragging')).toBe(false);
    });

    it('clears the drop highlight when the drag leaves', () => {
        UIDashboardContactDialog();
        const $overlay = $('.dashboard-dialog-overlay');
        $overlay.trigger(fileDrag('dragenter'));
        $overlay.find('.dashboard-contact-dropzone').trigger(fileDrag('dragenter'));
        $overlay.find('.dashboard-contact-dropzone').trigger($.Event('dragleave', { originalEvent: nativeEvent({}) }));
        expect($('.dashboard-contact-dialog').hasClass('dashboard-contact-dragging')).toBe(true);
        $overlay.trigger($.Event('dragleave', { originalEvent: nativeEvent({}) }));
        expect($('.dashboard-contact-dialog').hasClass('dashboard-contact-dragging')).toBe(false);
    });

    it('ignores drags that carry no files', () => {
        UIDashboardContactDialog();
        const drag = $.Event('dragenter', { originalEvent: nativeEvent({ dataTransfer: { types: ['text/plain'] } }) });
        $('.dashboard-dialog-overlay').trigger(drag);
        expect(drag.isDefaultPrevented()).toBe(false);
        expect($('.dashboard-contact-dialog').hasClass('dashboard-contact-dragging')).toBe(false);
    });

    it('attaches an image pasted into the message', () => {
        UIDashboardContactDialog();
        const paste = $.Event('paste', {
            originalEvent: nativeEvent({ clipboardData: { files: [png('pasted.png')], getData: () => '' } }),
        });
        message().trigger(paste);
        expect(fileNames()).toEqual(['pasted.png']);
        expect(paste.isDefaultPrevented()).toBe(true);
    });
});

describe('keyboard', () => {
    it('sends on Cmd/Ctrl+Enter but not on Enter alone', async () => {
        UIDashboardContactDialog();
        message().val('Hello');
        message().trigger($.Event('keydown', { key: 'Enter' }));
        await settle();
        expect(fetch).not.toHaveBeenCalled();

        message().trigger($.Event('keydown', { key: 'Enter', ctrlKey: true }));
        await settle();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
