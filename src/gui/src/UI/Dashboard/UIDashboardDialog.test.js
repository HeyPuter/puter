// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { default: UIDashboardDialog } = await import('./UIDashboardDialog.js');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const overlay = () => $('.dashboard-dialog-overlay');

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('UIDashboardDialog', () => {
    it('mounts an overlay card, not a window, and reveals it after a frame', async () => {
        UIDashboardDialog({ title: 'T', message: 'hello' });
        expect(overlay()).toHaveLength(1);
        expect($('.window')).toHaveLength(0);
        expect(overlay().hasClass('dashboard-dialog-show')).toBe(false);
        await tick();
        expect(overlay().hasClass('dashboard-dialog-show')).toBe(true);
        expect($('.dashboard-dialog-title').text()).toBe('T');
        expect($('.dashboard-dialog-message').html()).toBe('hello');
    });

    it('resolves with the pressed button value', async () => {
        const p = UIDashboardDialog({
            message: 'm',
            buttons: [{ label: 'No', value: 'no' }, { label: 'Yes', value: 'yes', type: 'danger' }],
        });
        expect($('.dashboard-dialog-btn-danger').text()).toBe('Yes');
        $('.dashboard-dialog-btn-danger').trigger('click');
        await expect(p).resolves.toBe('yes');
    });

    it('resolves false on Escape, on the close button, and on a backdrop press-and-release', async () => {
        const a = UIDashboardDialog({ title: 'T', message: 'm' });
        $(document).trigger($.Event('keydown', { key: 'Escape' }));
        await expect(a).resolves.toBe(false);

        const b = UIDashboardDialog({ title: 'T', message: 'm' });
        $('.dashboard-dialog-close').last().trigger('click');
        await expect(b).resolves.toBe(false);

        const c = UIDashboardDialog({ title: 'T', message: 'm' });
        const el = overlay().last().get(0);
        $(el).trigger($.Event('mousedown', { target: el }));
        $(el).trigger($.Event('click', { target: el }));
        await expect(c).resolves.toBe(false);
    });

    it('does not dismiss when a press starts inside the card and ends on the backdrop', async () => {
        const resolved = vi.fn();
        UIDashboardDialog({ title: 'T', message: 'm' }).then(resolved);
        const el = overlay().get(0);
        const card = $('.dashboard-dialog').get(0);
        $(card).trigger($.Event('mousedown', { target: card }));
        $(el).trigger($.Event('click', { target: el }));
        await tick();
        expect(resolved).not.toHaveBeenCalled();
    });

    it('as a prompt, returns the trimmed text from the primary button or Enter', async () => {
        const a = UIDashboardDialog({
            message: 'm',
            input: { value: 'old' },
            buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: 'ok', type: 'primary' }],
        });
        expect($('.dashboard-dialog-input').val()).toBe('old');
        $('.dashboard-dialog-input').val('  new name ');
        $('.dashboard-dialog-btn-primary').trigger('click');
        await expect(a).resolves.toBe('new name');

        const b = UIDashboardDialog({ message: 'm', input: {}, buttons: [{ label: 'Save', value: 'ok', type: 'primary' }] });
        $('.dashboard-dialog-input').last().val('typed').trigger($.Event('keydown', { key: 'Enter' }));
        await expect(b).resolves.toBe('typed');

        const c = UIDashboardDialog({ message: 'm', input: {}, buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: 'ok', type: 'primary' }] });
        $('.dashboard-dialog-btn-quiet').last().trigger('click');
        await expect(c).resolves.toBe(false);
    });

    it('escapes the title and button labels but trusts the message as HTML', () => {
        UIDashboardDialog({ title: '<b>x</b>', message: '<p>ok</p>', buttons: [{ label: '<i>y</i>', value: 1 }] });
        expect($('.dashboard-dialog-title').html()).toBe('&lt;b&gt;x&lt;/b&gt;');
        expect($('.dashboard-dialog-btn').html()).toBe('&lt;i&gt;y&lt;/i&gt;');
        expect($('.dashboard-dialog-message p')).toHaveLength(1);
    });

    it('mounts into the given container and marks the tone', () => {
        document.body.innerHTML = '<div class="host"></div>';
        UIDashboardDialog({ message: 'm', tone: 'danger', $container: $('.host') });
        expect($('.host .dashboard-dialog-overlay')).toHaveLength(1);
        expect($('.dashboard-dialog').hasClass('dashboard-dialog-danger')).toBe(true);
        expect($('.dashboard-dialog-icon')).toHaveLength(1);
    });

    it('removes itself from the DOM after the exit transition', async () => {
        vi.useFakeTimers();
        const p = UIDashboardDialog({ message: 'm' });
        $('.dashboard-dialog-btn').trigger('click');
        await p;
        expect(overlay()).toHaveLength(1);
        vi.advanceTimersByTime(250);
        expect(overlay()).toHaveLength(0);
    });
});
