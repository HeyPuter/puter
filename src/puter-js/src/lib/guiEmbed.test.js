// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canFrameGuiEmbed, showFeedbackEmbed } from './guiEmbed.js';

const GUI_ORIGIN = 'https://puter.test';
const USER = '0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40';

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};

const frame = () => document.querySelector('dialog.puter-feedback-embed iframe');

/** A message from the embed, by default from its frame on the GUI origin. */
const fromEmbed = (data, { origin = GUI_ORIGIN, source = frame().contentWindow } = {}) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
});

describe('canFrameGuiEmbed', () => {
    it.each([
        ['https://notes.puter.com/a', 'https://puter.com', true],
        ['https://NOTES.puter.com./a', 'https://puter.com', true],
        ['http://notes.puter.localhost:4100/', 'http://puter.localhost:4100', true],
        ['https://puter.com/', 'https://puter.com', false],
        ['https://a.b.puter.com/', 'https://puter.com', false],
        ['https://notputer.com/', 'https://puter.com', false],
        ['https://notes.puter.com.evil.com/', 'https://puter.com', false],
        ['http://notes.puter.com/', 'https://puter.com', false],
        ['https://notes.puter.com:8443/', 'https://puter.com', false],
        ['https://notes.puter.site/', 'https://puter.com', false],
        [undefined, 'https://puter.com', false],
    ])('%s under %s is %s', (page, gui, expected) => {
        expect(canFrameGuiEmbed(page, gui)).toBe(expected);
    });
});

describe('showFeedbackEmbed', () => {
    it('loads the embed for the named user, hidden until it is ready', () => {
        showFeedbackEmbed({ guiOrigin: `${GUI_ORIGIN}/`, userUuid: USER });
        const url = new URL(frame().src);
        expect(url.origin + url.pathname).toBe(`${GUI_ORIGIN}/embed/feedback`);
        expect(url.search).toBe('');
        expect(new URLSearchParams(url.hash.slice(1)).get('user')).toBe(USER);
        expect(frame().getAttribute('referrerpolicy')).toBe('origin');
        // WebKit hands the frame this as its preferred scheme; it must follow the OS.
        expect(frame().getAttribute('style')).toContain('color-scheme: light dark');
        expect(frame().closest('dialog').open).toBe(false);
    });

    it('shows the dialog once ready and resolves what it reports, restoring focus', async () => {
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();
        const result = showFeedbackEmbed({ guiOrigin: GUI_ORIGIN, userUuid: USER });
        const dialog = frame().closest('dialog');

        fromEmbed({ msg: 'feedbackEmbed', state: 'loading' });
        expect(dialog.open).toBe(false);
        fromEmbed({ msg: 'feedbackEmbed', state: 'ready' });
        expect(dialog.open).toBe(true);
        expect(document.activeElement).toBe(frame());

        fromEmbed({ msg: 'feedbackDialogClosed', sent: true });
        await expect(result).resolves.toEqual({ sent: true });
        expect(dialog.isConnected).toBe(false);
        expect(document.activeElement).toBe(trigger);
    });

    it('shows a loading scrim over the page while a slow session check runs, then the dialog', async () => {
        vi.useFakeTimers();
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();
        const result = showFeedbackEmbed({ guiOrigin: GUI_ORIGIN, userUuid: USER });
        const dialog = frame().closest('dialog');
        fromEmbed({ msg: 'feedbackEmbed', state: 'loading' });
        await vi.advanceTimersByTimeAsync(199);
        expect(dialog.open).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(dialog.open).toBe(true);
        expect(dialog.classList.contains('is-loading')).toBe(true);
        expect(dialog.querySelector('[role="status"]')).not.toBeNull();

        fromEmbed({ msg: 'feedbackEmbed', state: 'ready' });
        expect(dialog.classList.contains('is-loading')).toBe(false);
        expect(document.activeElement).toBe(frame());
        fromEmbed({ msg: 'feedbackDialogClosed', sent: true });
        await expect(result).resolves.toEqual({ sent: true });
        expect(document.activeElement).toBe(trigger);
    });

    it('never shows the loading scrim when the embed is ready quickly', async () => {
        vi.useFakeTimers();
        showFeedbackEmbed({ guiOrigin: GUI_ORIGIN, userUuid: USER });
        const dialog = frame().closest('dialog');
        fromEmbed({ msg: 'feedbackEmbed', state: 'ready' });
        await vi.advanceTimersByTimeAsync(1000);
        expect(dialog.open).toBe(true);
        expect(dialog.classList.contains('is-loading')).toBe(false);
    });

    it('takes the loading scrim down for the popup when the embed turns out unavailable', async () => {
        vi.useFakeTimers();
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();
        const result = showFeedbackEmbed({ guiOrigin: GUI_ORIGIN, userUuid: USER });
        await vi.advanceTimersByTimeAsync(200);
        fromEmbed({ msg: 'feedbackEmbed', state: 'unavailable' });
        await expect(result).resolves.toBeNull();
        expect(document.querySelector('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it.each([
        ['Escape', (dialog) => dialog.dispatchEvent(new Event('cancel', { cancelable: true }))],
        ['a click on the scrim', (dialog) => dialog.querySelector('[role="status"]').click()],
    ])('lets %s cancel while loading, without falling back to the popup', async (_label, cancel) => {
        vi.useFakeTimers();
        const result = showFeedbackEmbed({ guiOrigin: GUI_ORIGIN, userUuid: USER });
        await vi.advanceTimersByTimeAsync(200);
        cancel(frame().closest('dialog'));
        await expect(result).resolves.toEqual({ sent: false });
        expect(document.querySelector('dialog')).toBeNull();
    });

    it('resolves null without showing anything when the embed is unavailable', async () => {
        const result = showFeedbackEmbed({ guiOrigin: GUI_ORIGIN, userUuid: USER });
        const dialog = frame().closest('dialog');
        fromEmbed({ msg: 'feedbackEmbed', state: 'loading' });
        fromEmbed({ msg: 'feedbackEmbed', state: 'unavailable' });
        await expect(result).resolves.toBeNull();
        expect(dialog.open).toBe(false);
        expect(dialog.isConnected).toBe(false);
    });

    it('ignores messages from another origin or another window', async () => {
        const result = showFeedbackEmbed({ guiOrigin: GUI_ORIGIN, userUuid: USER });
        fromEmbed({ msg: 'feedbackDialogClosed', sent: true }, { origin: 'https://other.test' });
        fromEmbed({ msg: 'feedbackDialogClosed', sent: true }, { source: window });
        fromEmbed({ msg: 'feedbackEmbed', state: 'ready' }, { origin: 'https://notes.puter.test' });
        expect(frame().closest('dialog').open).toBe(false);

        fromEmbed({ msg: 'feedbackDialogClosed', sent: false });
        await expect(result).resolves.toEqual({ sent: false });
    });

    it('resolves null when the frame loads without the embed answering', async () => {
        vi.useFakeTimers();
        const result = showFeedbackEmbed({ guiOrigin: GUI_ORIGIN, userUuid: USER });
        frame().dispatchEvent(new Event('load'));
        await vi.advanceTimersByTimeAsync(1000);
        await expect(result).resolves.toBeNull();
        expect(document.querySelector('dialog')).toBeNull();
    });

    it('gives a loading embed time to check the session, then gives up', async () => {
        vi.useFakeTimers();
        const result = showFeedbackEmbed({ guiOrigin: GUI_ORIGIN, userUuid: USER });
        fromEmbed({ msg: 'feedbackEmbed', state: 'loading' });
        frame().dispatchEvent(new Event('load'));
        let settled = false;
        result.then(() => {
            settled = true;
        });
        await vi.advanceTimersByTimeAsync(5000);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(10_000);
        await expect(result).resolves.toBeNull();
    });

    it('keeps the dialog open on Escape outside the frame, since the embed owns dismissal', () => {
        showFeedbackEmbed({ guiOrigin: GUI_ORIGIN, userUuid: USER });
        fromEmbed({ msg: 'feedbackEmbed', state: 'ready' });
        const dialog = frame().closest('dialog');
        const cancel = new Event('cancel', { cancelable: true });
        dialog.dispatchEvent(cancel);
        expect(cancel.defaultPrevented).toBe(true);
        expect(dialog.isConnected).toBe(true);
    });

    it('resolves null for an unusable GUI origin', async () => {
        await expect(showFeedbackEmbed({ guiOrigin: 'not a url', userUuid: USER })).resolves.toBeNull();
        expect(document.querySelector('dialog')).toBeNull();
    });
});
