// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ancestorsAllowGuiEmbed, canFrameGuiEmbed, showFeedbackEmbed, showPopupFrame } from './guiEmbed.js';

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
        ['https://docs.puter.com/playground/', 'https://puter.com', false],
        ['https://api.puter.com/', 'https://puter.com', false],
        ['https://www.puter.com/', 'https://puter.com', false],
        ['http://apps.puter.localhost:4100/', 'http://puter.localhost:4100', false],
        [undefined, 'https://puter.com', false],
    ])('%s under %s is %s', (page, gui, expected) => {
        expect(canFrameGuiEmbed(page, gui)).toBe(expected);
    });
});

describe('ancestorsAllowGuiEmbed', () => {
    const PAGE = 'https://notes.puter.test';
    /** A window at `origin` under `parent`; a cross-origin parent throws on `location`, as in a browser. */
    const fakeWindow = ({ origin = PAGE, ancestorOrigins, parent } = {}) => {
        const win = { location: { origin, ancestorOrigins } };
        win.parent = parent ?? win;
        return win;
    };
    const crossOrigin = () => {
        const win = {};
        Object.defineProperty(win, 'location', { get: () => { throw new DOMException('Blocked', 'SecurityError'); } });
        win.parent = win;
        return win;
    };

    it.each([
        ['a top-level page', [], true],
        ['a frame of the same page', [PAGE], true],
        ['a frame in the GUI', [PAGE, GUI_ORIGIN], true],
        ['a frame of another site', ['https://other.test'], false],
        ['a frame of the page inside another site', [PAGE, 'https://other.test'], false],
    ])('reads ancestorOrigins for %s', (_, ancestorOrigins, expected) => {
        expect(ancestorsAllowGuiEmbed(fakeWindow({ ancestorOrigins }), GUI_ORIGIN)).toBe(expected);
    });

    it('walks same-origin parents without ancestorOrigins', () => {
        expect(ancestorsAllowGuiEmbed(fakeWindow(), GUI_ORIGIN)).toBe(true);
        expect(ancestorsAllowGuiEmbed(fakeWindow({ parent: fakeWindow() }), GUI_ORIGIN)).toBe(true);
        expect(ancestorsAllowGuiEmbed(fakeWindow({ parent: crossOrigin() }), GUI_ORIGIN)).toBe(false);
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
        expect(dialog.querySelector('[role="status"]').hasAttribute('aria-hidden')).toBe(false);

        fromEmbed({ msg: 'feedbackEmbed', state: 'ready' });
        expect(dialog.classList.contains('is-loading')).toBe(false);
        expect(dialog.querySelector('[role="status"]').getAttribute('aria-hidden')).toBe('true');
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

describe('showPopupFrame', () => {
    const popupFrame = () => document.querySelector('dialog.puter-popup-frame iframe');
    const fromPopup = (data, { origin = GUI_ORIGIN, source = popupFrame().contentWindow } = {}) =>
        window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
    const show = (overrides = {}) => showPopupFrame({
        guiOrigin: GUI_ORIGIN,
        action: 'show-open-file-picker',
        fragment: { msg_id: '3', user: USER },
        title: 'Open file',
        closed: () => 'closed',
        onMessage: () => {},
        ...overrides,
    });

    it('loads the popup action with its parameters in the fragment, hidden until ready', () => {
        let framed;
        show({ onFrame: (win) => {
            framed = win;
        } });
        const url = new URL(popupFrame().src);
        expect(url.origin + url.pathname).toBe(`${GUI_ORIGIN}/embed/show-open-file-picker`);
        expect(url.search).toBe('');
        expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({ msg_id: '3', user: USER });
        expect(popupFrame().getAttribute('referrerpolicy')).toBe('origin');
        expect(popupFrame().closest('dialog').getAttribute('aria-label')).toBe('Open file');
        expect(popupFrame().getAttribute('allow')).toBe('otp-credentials');
        expect(framed).toBe(popupFrame().contentWindow);
        expect(popupFrame().closest('dialog').open).toBe(false);
    });

    it('sizes the box like the popup window it replaces', () => {
        show({ action: 'sign-in', fragment: { msg_id: 'a' } });
        const box = document.querySelector('.puter-popup-frame-box');
        expect(box.style.getPropertyValue('--puter-popup-frame-width')).toBe('600px');
        expect(box.style.getPropertyValue('--puter-popup-frame-height')).toBe('700px');
        expect(box.contains(popupFrame())).toBe(true);
    });

    it('shows once ready and hands every other message to the caller to finish with', async () => {
        const seen = [];
        const result = show({ onMessage: (data, finish) => {
            seen.push(data.msg);
            if ( data.msg === 'fileOpenPicked' ) finish('picked');
        } });
        const dialog = popupFrame().closest('dialog');
        const status = dialog.querySelector('[role="status"]');
        expect(status.getAttribute('aria-hidden')).toBe('true');
        fromPopup({ msg: 'puterPopupFrame', state: 'loading' });
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        expect(dialog.open).toBe(true);
        expect(status.getAttribute('aria-hidden')).toBe('true');
        expect(document.activeElement).toBe(popupFrame());
        fromPopup({ msg: 'puter.token', success: true });
        fromPopup({ msg: 'fileOpenPicked' });
        await expect(result).resolves.toBe('picked');
        expect(seen).toEqual(['puter.token', 'fileOpenPicked']);
        expect(dialog.isConnected).toBe(false);
    });

    it('opens itself again when the embed reloads into a refused frame, once per ready', async () => {
        vi.useFakeTimers();
        const result = show();
        const iframe = popupFrame();
        const dialog = iframe.closest('dialog');
        const srcSet = vi.spyOn(iframe, 'src', 'set');
        const load = () => iframe.dispatchEvent(new Event('load'));
        fromPopup({ msg: 'puterPopupFrame', state: 'loading' });
        load();
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });

        // A reload the embed starts itself loads a document that never posts.
        load();
        expect(dialog.classList.contains('is-loading')).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(srcSet).toHaveBeenCalledTimes(1);
        // Not just the refused URL again, which WebKit takes as a fragment
        // navigation of the error page: the server redirects the query away.
        const opened = new URL(iframe.src);
        const reopened = new URL(srcSet.mock.calls[0][0]);
        expect(reopened.search).not.toBe('');
        expect(reopened.origin + reopened.pathname + reopened.hash).toBe(opened.origin + opened.pathname + opened.hash);
        expect(dialog.classList.contains('is-loading')).toBe(true);

        // The page's own reload boots, before or after its load event.
        fromPopup({ msg: 'puterPopupFrame', state: 'loading' });
        load();
        vi.advanceTimersByTime(1000);
        expect(srcSet).toHaveBeenCalledTimes(1);
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        expect(dialog.classList.contains('is-loading')).toBe(false);

        // Ready again, so a later refusal is retried too, but not twice running.
        load();
        vi.advanceTimersByTime(1000);
        expect(srcSet).toHaveBeenCalledTimes(2);
        load();
        vi.advanceTimersByTime(1000);
        await expect(result).resolves.toBeNull();
        expect(srcSet).toHaveBeenCalledTimes(2);
    });

    it('falls back to the popup when the embed it opens again never loads', async () => {
        vi.useFakeTimers();
        const result = show();
        const iframe = popupFrame();
        const dialog = iframe.closest('dialog');
        const load = () => iframe.dispatchEvent(new Event('load'));
        fromPopup({ msg: 'puterPopupFrame', state: 'loading' });
        load();
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });

        // Refused after a reload of its own, then reopened on a stalled connection.
        load();
        vi.advanceTimersByTime(1000);
        vi.advanceTimersByTime(14_999);
        expect(dialog.isConnected).toBe(true);
        vi.advanceTimersByTime(1);
        await expect(result).resolves.toBeNull();
        expect(dialog.isConnected).toBe(false);
    });

    it('keeps showing an embed that was ready before its load event fired', () => {
        vi.useFakeTimers();
        show();
        const iframe = popupFrame();
        const dialog = iframe.closest('dialog');
        const srcSet = vi.spyOn(iframe, 'src', 'set');
        const load = () => iframe.dispatchEvent(new Event('load'));
        fromPopup({ msg: 'puterPopupFrame', state: 'loading' });
        load();
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        load();
        vi.advanceTimersByTime(1000);
        expect(srcSet).toHaveBeenCalledTimes(1);

        // The page's reload shows its UI while a slow image still loads.
        fromPopup({ msg: 'puterPopupFrame', state: 'loading' });
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        load();
        vi.advanceTimersByTime(5000);
        expect(dialog.classList.contains('is-loading')).toBe(false);
        expect(srcSet).toHaveBeenCalledTimes(1);
        expect(dialog.isConnected).toBe(true);
    });

    it('closes on Escape outside the frame once ready, as Escape inside it does', async () => {
        const result = show();
        const dialog = popupFrame().closest('dialog');
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        const cancel = new Event('cancel', { cancelable: true });
        dialog.dispatchEvent(cancel);
        expect(cancel.defaultPrevented).toBe(true);
        await expect(result).resolves.toBe('closed');
        expect(dialog.isConnected).toBe(false);
    });

    it('finishes as closed when the popup closes itself', async () => {
        const result = show();
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        fromPopup({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(result).resolves.toBe('closed');
        expect(document.querySelector('dialog')).toBeNull();
    });

    it('offers a close button only when asked, which finishes as closed', async () => {
        show();
        expect(document.querySelector('.puter-popup-frame-close')).toBeNull();
        document.body.innerHTML = '';

        const result = show({ action: 'sign-in', closeLabel: 'Close' });
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        const close = document.querySelector('.puter-popup-frame-close');
        expect(close.getAttribute('aria-label')).toBe('Close');
        close.click();
        await expect(result).resolves.toBe('closed');
    });

    it('resolves null for the popup when the frame is unavailable or refused', async () => {
        const unavailable = show();
        fromPopup({ msg: 'puterPopupFrame', state: 'loading' });
        fromPopup({ msg: 'puterPopupFrame', state: 'unavailable' });
        await expect(unavailable).resolves.toBeNull();

        vi.useFakeTimers();
        const refused = show();
        popupFrame().dispatchEvent(new Event('load'));
        await vi.advanceTimersByTimeAsync(1000);
        await expect(refused).resolves.toBeNull();
    });

    it('lets the user dismiss the loading scrim, finishing as closed', async () => {
        vi.useFakeTimers();
        const result = show();
        await vi.advanceTimersByTimeAsync(200);
        document.querySelector('.puter-popup-frame-loading').click();
        await expect(result).resolves.toBe('closed');
    });

    it('replaces a popup frame that is showing, finishing it as closed', async () => {
        const button = document.createElement('button');
        document.body.append(button);
        button.focus();
        const first = show();
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        const firstDialog = popupFrame().closest('dialog');
        const second = show({ fragment: { msg_id: '4', user: USER } });
        await expect(first).resolves.toBe('closed');
        expect(firstDialog.isConnected).toBe(false);
        expect(document.querySelectorAll('dialog.puter-popup-frame')).toHaveLength(1);
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        fromPopup({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(second).resolves.toBe('closed');
        expect(document.activeElement).toBe(button);
    });

    it('leaves a popup frame for another action showing, as its popup window would stay open', async () => {
        const picker = show();
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        const pickerFrame = popupFrame();
        const signIn = show({ action: 'sign-in', fragment: { msg_id: 'a' } });
        expect(document.querySelectorAll('dialog.puter-popup-frame')).toHaveLength(2);
        const signInFrame = document.querySelectorAll('dialog.puter-popup-frame iframe')[1];
        fromPopup({ msg: 'puterPopupFrame', state: 'closed' }, { source: signInFrame.contentWindow });
        await expect(signIn).resolves.toBe('closed');
        expect(pickerFrame.isConnected).toBe(true);
        fromPopup({ msg: 'puterPopupFrame', state: 'closed' }, { source: pickerFrame.contentWindow });
        await expect(picker).resolves.toBe('closed');
    });

    it('finishes as closed when the page removes it, letting the page scroll again', async () => {
        const result = show({ action: 'upgrade', fragment: { user: USER } });
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        expect(document.documentElement.style.overflow).toBe('hidden');
        document.body.innerHTML = '<main>re-rendered</main>';
        await expect(result).resolves.toBe('closed');
        expect(document.documentElement.style.overflow).toBe('');
    });

    it('keeps the scrim behind a ready frame from dismissing it', () => {
        show();
        fromPopup({ msg: 'puterPopupFrame', state: 'ready' });
        document.querySelector('.puter-popup-frame-loading').click();
        expect(popupFrame().closest('dialog').isConnected).toBe(true);
    });

    it('ignores messages from another origin or another window', async () => {
        const onMessage = vi.fn();
        show({ onMessage });
        fromPopup({ msg: 'puterPopupFrame', state: 'closed' }, { origin: 'https://other.test' });
        fromPopup({ msg: 'fileOpenPicked' }, { source: window });
        expect(onMessage).not.toHaveBeenCalled();
        expect(popupFrame().closest('dialog').isConnected).toBe(true);
    });
});

describe('page scroll behind an embed', () => {
    const root = document.documentElement;
    const popupFrame = (action) => document.querySelector(`dialog.puter-popup-frame iframe[src*="/embed/${action}"]`);
    const show = (action, closed = () => 'closed') => showPopupFrame({
        guiOrigin: GUI_ORIGIN,
        action,
        fragment: { user: USER },
        title: action,
        closed,
        onMessage: () => {},
    });
    const tell = (action, state) => window.dispatchEvent(new MessageEvent('message', {
        data: { msg: 'puterPopupFrame', state },
        origin: GUI_ORIGIN,
        source: popupFrame(action).contentWindow,
    }));
    /**
     * Gives the page a classic scrollbar this wide, or none, whose space comes
     * back once the root stops scrolling unless the page keeps its gutter.
     */
    const scrollbar = (width, { gutterKept = false } = {}) => {
        vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(window.innerWidth - width);
        vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({
            width: window.innerWidth - (root.style.overflow === 'hidden' && ! gutterKept ? 0 : width),
        }));
    };

    // Earlier tests leave dialogs that never closed, which locked the page.
    beforeEach(() => {
        root.removeAttribute('style');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        root.removeAttribute('style');
        document.body.removeAttribute('style');
    });

    it('stops while the embed shows and comes back as the page had it once it closes', async () => {
        scrollbar(0);
        root.style.overflow = 'clip';
        const result = show('upgrade');
        tell('upgrade', 'loading');
        expect(root.style.overflow).toBe('clip');

        tell('upgrade', 'ready');
        expect(root.style.overflow).toBe('hidden');
        expect(root.style.paddingRight).toBe('');

        tell('upgrade', 'closed');
        await expect(result).resolves.toBe('closed');
        expect(root.style.overflow).toBe('clip');
    });

    it('stops the body instead when the viewport scrolls by the body\'s overflow', async () => {
        scrollbar(0);
        root.style.overflow = 'visible';
        document.body.style.overflowX = 'hidden';
        const result = show('upgrade');
        tell('upgrade', 'ready');
        expect(document.body.style.overflow).toBe('hidden');
        expect(root.style.overflow).toBe('visible');

        tell('upgrade', 'closed');
        await result;
        expect(document.body.style.overflowX).toBe('hidden');
        expect(document.body.style.overflowY).toBe('');
    });

    it('keeps the space of a classic scrollbar, so the page doesn\'t shift', async () => {
        scrollbar(15);
        root.style.paddingRight = '8px';
        const result = show('upgrade');
        tell('upgrade', 'ready');
        expect(root.style.overflow).toBe('hidden');
        expect(root.style.paddingRight).toBe('23px');
        tell('upgrade', 'closed');
        await result;
        expect(root.style.paddingRight).toBe('8px');
        expect(root.style.overflow).toBe('');
    });

    it('adds no space for a scrollbar whose gutter the page keeps', async () => {
        scrollbar(15, { gutterKept: true });
        const result = show('upgrade');
        tell('upgrade', 'ready');
        expect(root.style.overflow).toBe('hidden');
        expect(root.style.paddingRight).toBe('');
        tell('upgrade', 'closed');
        await result;
    });

    it('stops behind the loading scrim too, and stays stopped until the last embed closes', async () => {
        vi.useFakeTimers();
        scrollbar(0);
        const upgrade = show('upgrade');
        await vi.advanceTimersByTimeAsync(200);
        expect(root.style.overflow).toBe('hidden');
        const signIn = show('sign-in');
        tell('sign-in', 'ready');

        tell('sign-in', 'closed');
        await signIn;
        expect(root.style.overflow).toBe('hidden');
        tell('upgrade', 'closed');
        await upgrade;
        expect(root.style.overflow).toBe('');
    });

    it('gives the page its own styles back after an embed the page removed itself', async () => {
        scrollbar(15);
        root.style.paddingRight = '8px';
        show('upgrade');
        tell('upgrade', 'ready');
        document.querySelector('dialog.puter-popup-frame').remove();

        const signIn = show('sign-in');
        tell('sign-in', 'ready');
        expect(root.style.overflow).toBe('hidden');
        expect(root.style.paddingRight).toBe('23px');
        tell('sign-in', 'closed');
        await signIn;

        expect(root.style.overflow).toBe('');
        expect(root.style.paddingRight).toBe('8px');
    });

    it('leaves the page alone for an embed that never showed', async () => {
        scrollbar(0);
        const result = show('upgrade');
        tell('upgrade', 'unavailable');
        await expect(result).resolves.toBeNull();
        expect(root.style.overflow).toBe('');
    });
});
