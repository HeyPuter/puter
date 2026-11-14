// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PuterDialog from './PuterDialog.js';

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
};

const GUI_ORIGIN = 'https://puter.test';

let popup;
let resolve;
let reject;

const part = (dialog, selector) => dialog.shadowRoot.querySelector(selector);

/** The sign-in consent dialog on the page, as the implicit-auth flow shows it. */
const showConsent = () => {
    const dialog = new PuterDialog(resolve, reject);
    document.body.appendChild(dialog);
    part(dialog, 'dialog').showModal();
    return dialog;
};

const postToPage = (data, { origin = GUI_ORIGIN, source = popup } = {}) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));

const TOKEN_MESSAGE = { msg: 'puter.token', token: 'token-1', app_uid: 'app-1' };

/** A caller queued behind the open prompt. */
const queueCaller = () => {
    const caller = { resolve: vi.fn(), reject: vi.fn() };
    globalThis.puter.puterAuthState.resolvers.push(caller);
    return caller;
};

beforeEach(() => {
    document.body.innerHTML = '';
    popup = { closed: false };
    window.open = vi.fn(() => popup);
    resolve = vi.fn();
    reject = vi.fn();
    globalThis.puter = {
        defaultGUIOrigin: GUI_ORIGIN,
        setAuthToken: vi.fn(),
        setAppID: vi.fn(),
        getUser: vi.fn(async () => ({ username: 'alice' })),
        puterAuthState: { isPromptOpen: true, authGranted: null, resolvers: [] },
    };
});

afterEach(() => {
    // The dialog listens on the window until it is answered.
    document.querySelectorAll('puter-dialog').forEach((dialog) => {
        window.removeEventListener('message', dialog.messageListener);
    });
    Object.defineProperty(window, 'parent', { configurable: true, value: window });
    Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, value: false });
    vi.unstubAllGlobals();
    delete globalThis.puter;
});

describe('the sign-in consent dialog', () => {
    it('opens the sign-in popup on the Puter origin from Continue', () => {
        const dialog = showConsent();

        part(dialog, '#launch-auth-popup').click();

        expect(window.open).toHaveBeenCalledOnce();
        const [url, name] = window.open.mock.calls[0];
        const opened = new URL(url);
        expect(opened.origin).toBe(GUI_ORIGIN);
        expect(opened.searchParams.get('embedded_in_popup')).toBe('true');
        expect(opened.searchParams.get('request_auth')).toBe('true');
        expect(opened.searchParams.get('msg_id')).toMatch(/^\d+$/);
        expect(opened.searchParams.has('cross_origin_isolated')).toBe(false);
        expect(name).toBe('Puter');
        // Stays up until the popup answers.
        expect(part(dialog, 'dialog').open).toBe(true);
    });

    it('tells the popup when the page is cross-origin isolated', () => {
        Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, value: true });
        const dialog = showConsent();

        part(dialog, '#launch-auth-popup').click();

        expect(new URL(window.open.mock.calls[0][0]).searchParams.get('cross_origin_isolated')).toBe('true');
    });

    it('gives each dialog its own request id', () => {
        part(showConsent(), '#launch-auth-popup').click();
        part(showConsent(), '#launch-auth-popup').click();

        const [first, second] = window.open.mock.calls.map(([url]) => new URL(url).searchParams.get('msg_id'));
        expect(second).not.toBe(first);
    });

    it('signs the page in with the token the popup sends', async () => {
        const dialog = showConsent();
        const onAuth = vi.fn();
        globalThis.puter.onAuth = onAuth;
        const waiting = queueCaller();
        part(dialog, '#launch-auth-popup').click();

        postToPage(TOKEN_MESSAGE);

        expect(globalThis.puter.setAuthToken).toHaveBeenCalledWith('token-1');
        expect(globalThis.puter.setAppID).toHaveBeenCalledWith('app-1');
        expect(resolve).toHaveBeenCalledOnce();
        expect(reject).not.toHaveBeenCalled();
        expect(part(dialog, 'dialog').open).toBe(false);
        expect(globalThis.puter.puterAuthState).toEqual({ isPromptOpen: false, authGranted: true, resolvers: [] });
        expect(waiting.resolve).toHaveBeenCalledOnce();
        expect(waiting.reject).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(onAuth).toHaveBeenCalledWith({ username: 'alice' }));
    });

    it('takes the token once', () => {
        const dialog = showConsent();
        part(dialog, '#launch-auth-popup').click();

        postToPage(TOKEN_MESSAGE);
        postToPage({ ...TOKEN_MESSAGE, token: 'token-2' });

        expect(globalThis.puter.setAuthToken.mock.calls).toEqual([['token-1']]);
        expect(resolve).toHaveBeenCalledOnce();
    });

    it.each([
        ['another origin', { origin: 'https://evil.test' }],
        ['a window it did not open', { source: { closed: false } }],
    ])('ignores a token from %s', (_sender, from) => {
        const dialog = showConsent();
        part(dialog, '#launch-auth-popup').click();

        postToPage(TOKEN_MESSAGE, from);

        expect(globalThis.puter.setAuthToken).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
        expect(part(dialog, 'dialog').open).toBe(true);
    });

    it('ignores other messages from the popup', () => {
        const dialog = showConsent();
        part(dialog, '#launch-auth-popup').click();

        postToPage({ msg: 'puter.ready' });

        expect(globalThis.puter.setAuthToken).not.toHaveBeenCalled();
        expect(part(dialog, 'dialog').open).toBe(true);
    });

    it.each([
        ['Cancel', (dialog) => part(dialog, '#launch-auth-popup-cancel').click()],
        ['the X', (dialog) => part(dialog, '.close-btn').click()],
        ['Escape', (dialog) => part(dialog, 'dialog').dispatchEvent(new Event('cancel', { cancelable: true }))],
    ])('rejects every caller when the user dismisses it with %s', (_control, dismiss) => {
        const dialog = showConsent();
        const waiting = queueCaller();

        dismiss(dialog);

        const cancelled = expect.objectContaining({ message: 'User cancelled the authentication' });
        expect(reject).toHaveBeenCalledWith(cancelled);
        expect(waiting.reject).toHaveBeenCalledWith(cancelled);
        expect(resolve).not.toHaveBeenCalled();
        expect(part(dialog, 'dialog').open).toBe(false);
        expect(globalThis.puter.puterAuthState).toEqual({ isPromptOpen: false, authGranted: false, resolvers: [] });
        expect(window.open).not.toHaveBeenCalled();
    });

    it('stops listening for a token once dismissed', () => {
        const dialog = showConsent();
        part(dialog, '#launch-auth-popup-cancel').click();

        postToPage(TOKEN_MESSAGE, { source: null });

        expect(globalThis.puter.setAuthToken).not.toHaveBeenCalled();
    });
});

describe('a launcher dialog', () => {
    it('reports Escape as a cancel and keeps the native dismissal from hiding it silently', () => {
        const onCancel = vi.fn();
        const dialog = PuterDialog.show({ popupURL: `${GUI_ORIGIN}/action/x`, onCancel });
        const escape = new Event('cancel', { cancelable: true });

        part(dialog, 'dialog').dispatchEvent(escape);

        expect(escape.defaultPrevented).toBe(true);
        expect(onCancel).toHaveBeenCalledOnce();
        expect(reject).not.toHaveBeenCalled();
        expect(globalThis.puter.puterAuthState.isPromptOpen).toBe(true);
    });

    it('leaves the token message to its caller', () => {
        const dialog = PuterDialog.show({ popupURL: `${GUI_ORIGIN}/action/x`, onLaunch: () => {} });
        part(dialog, '#launch-auth-popup').click();

        postToPage(TOKEN_MESSAGE);

        expect(globalThis.puter.setAuthToken).not.toHaveBeenCalled();
    });

    it('says what the caller asks it to', () => {
        const dialog = PuterDialog.show({ popupURL: `${GUI_ORIGIN}/action/x`, message: 'This website wants to send you notifications.' });

        expect(part(dialog, '.about').textContent).toBe('This website wants to send you notifications.');
    });
});

// A page with no origin can't be signed in; the dialog explains instead of offering Continue.
describe('on a page the browser gives no origin', () => {
    beforeEach(() => {
        vi.stubGlobal('origin', 'null');
    });

    it('explains the file:// case on a top-level page', () => {
        const dialog = showConsent();

        const text = part(dialog, '.error-container').textContent;
        expect(text).toContain('Unsupported Origin');
        expect(text).toContain('opened this file directly in your browser');
        expect(text).toContain('Serve the page from a local development server');
        expect(part(dialog, '#launch-auth-popup')).toBeNull();
    });

    it('explains the sandbox case inside a frame', () => {
        Object.defineProperty(window, 'parent', { configurable: true, value: {} });
        const dialog = showConsent();

        const text = part(dialog, '.error-container').textContent;
        expect(text).toContain('sandboxed without allow-same-origin');
        expect(text).toContain('Add allow-same-origin to the iframe\'s sandbox attribute');
        expect(text).not.toContain('opened this file directly');
    });

    it('closes from the X', () => {
        const dialog = showConsent();

        part(dialog, '.close-btn').click();

        expect(part(dialog, 'dialog').open).toBe(false);
    });
});
