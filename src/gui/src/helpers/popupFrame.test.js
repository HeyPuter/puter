// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    POPUP_FRAME_MSG,
    closeAccountChecksOnEscape,
    focusOnFrameFocus,
    framedPopupAction,
    framedPopupParams,
    startPopupFrame,
} from './popupFrame.js';

const HOST = 'https://notes.puter.test';

/** A stand-in for the frame's window, with its own parent to post to. */
const frameWindow = () => {
    const parent = { postMessage: vi.fn() };
    const open = vi.fn(() => 'opened');
    return {
        parent,
        open,
        opener: null,
        close: () => {},
        document,
        MutationObserver: window.MutationObserver,
    };
};

const statesSent = (win) => win.parent.postMessage.mock.calls.map(([data, origin]) => {
    expect(origin).toBe(HOST);
    expect(data.msg).toBe(POPUP_FRAME_MSG);
    return data.state;
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('framedPopupAction', () => {
    it.each([
        ['/embed/sign-in', 'sign-in'],
        ['/embed/sign-in/', 'sign-in'],
        ['/embed/show-open-file-picker', 'show-open-file-picker'],
        ['/embed/show-save-file-picker', 'show-save-file-picker'],
        ['/embed/show-directory-picker', 'show-directory-picker'],
        ['/embed/apps', null],
        ['/embed/feedback', null],
        ['/embed/request-permission', null],
        ['/action/sign-in', null],
        ['/embed/sign-in/extra', null],
        ['/', null],
        [undefined, null],
    ])('%s frames %s', (pathname, expected) => {
        expect(framedPopupAction(pathname)).toBe(expected);
    });
});

describe('framedPopupParams', () => {
    it('keeps only the popup parameters a framing page may pass', () => {
        const params = framedPopupParams('#msg_id=7&options=%7B%22multiple%22%3Atrue%7D&request_auth=true&user=abc&auth_token=x&attempt_temp_user_creation=true&api_origin=https%3A%2F%2Fevil.test');
        expect(Object.fromEntries(params)).toEqual({
            msg_id: '7',
            options: '{"multiple":true}',
            request_auth: 'true',
        });
    });

    it('is empty without a fragment', () => {
        expect([...framedPopupParams('')]).toEqual([]);
        expect([...framedPopupParams(undefined)]).toEqual([]);
    });
});

describe('startPopupFrame', () => {
    it('does nothing without a framing page to answer', () => {
        const win = frameWindow();
        expect(startPopupFrame(win, null)).toBeNull();
        const top = frameWindow();
        top.parent = top;
        expect(startPopupFrame(top, HOST)).toBeNull();
        expect(win.opener).toBeNull();
    });

    it('makes the framing page the opener and tells it the frame is loading', () => {
        const win = frameWindow();
        startPopupFrame(win, HOST);
        expect(win.opener).toBe(win.parent);
        expect(statesSent(win)).toEqual(['loading']);
    });

    it('asks the framing page to remove the frame on close, either way the popup closes', () => {
        const win = frameWindow();
        startPopupFrame(win, HOST);
        win.close();
        win.open('', '_self').close();
        expect(statesSent(win)).toEqual(['loading', 'closed', 'closed']);
    });

    it('sends the fields that go with a state, without letting them rename it', () => {
        const win = frameWindow();
        const tell = startPopupFrame(win, HOST);
        tell('provider', { url: 'https://puter.test/auth/oidc/google/start', msg: 'x', state: 'y' });
        expect(win.parent.postMessage).toHaveBeenLastCalledWith(
            { url: 'https://puter.test/auth/oidc/google/start', msg: POPUP_FRAME_MSG, state: 'provider' },
            HOST,
        );
    });

    it('leaves other window.open calls alone', () => {
        const win = frameWindow();
        const open = win.open;
        startPopupFrame(win, HOST);
        expect(win.open('https://puter.com/terms', '_blank')).toBe('opened');
        expect(open).toHaveBeenCalledWith('https://puter.com/terms', '_blank');
    });

    it('tells the framing page it is ready once the popup shows something', async () => {
        const win = frameWindow();
        startPopupFrame(win, HOST);
        document.body.append(Object.assign(document.createElement('div'), { className: 'busy' }));
        await Promise.resolve();
        expect(statesSent(win)).toEqual(['loading']);

        const dialog = document.createElement('div');
        dialog.className = 'dashboard-dialog-overlay auth-dialog-page';
        document.body.append(dialog);
        await Promise.resolve();
        document.body.append(Object.assign(document.createElement('div'), { className: 'window' }));
        await Promise.resolve();
        expect(statesSent(win)).toEqual(['loading', 'ready']);
    });
});

describe('focusOnFrameFocus', () => {
    /** A window of its own, so patching its focus() leaves the test's alone. */
    const ownWindow = () => {
        const iframe = document.createElement('iframe');
        document.body.append(iframe);
        const win = iframe.contentWindow;
        const input = win.document.createElement('input');
        win.document.body.append(input);
        return { win, input };
    };
    /** The frame losing its focus, then the framing page focusing it again. */
    const refocusFrame = (win) => {
        win.document.activeElement?.blur();
        win.dispatchEvent(new win.FocusEvent('focus'));
    };

    it('gives the popup\'s latest focus back each time the frame gains focus with nothing focused', () => {
        const { win, input } = ownWindow();
        focusOnFrameFocus(win);
        input.focus();
        refocusFrame(win);
        expect(win.document.activeElement).toBe(input);
        refocusFrame(win);
        expect(win.document.activeElement).toBe(input);
    });

    it('leaves focus to the user once they press a key or the pointer', () => {
        for ( const type of ['keydown', 'pointerdown'] ) {
            const { win, input } = ownWindow();
            const focus = win.HTMLElement.prototype.focus;
            focusOnFrameFocus(win);
            input.focus();
            win.document.body.dispatchEvent(new win.Event(type, { bubbles: true }));
            refocusFrame(win);
            expect(win.document.activeElement).toBe(win.document.body);
            expect(win.HTMLElement.prototype.focus).toBe(focus);
        }
    });

    it('leaves an element that has focus, and one that has left the page', () => {
        const { win, input } = ownWindow();
        const nativeFocus = win.HTMLElement.prototype.focus;
        const other = win.document.createElement('button');
        win.document.body.append(other);
        focusOnFrameFocus(win);
        input.focus();
        nativeFocus.call(other);
        win.dispatchEvent(new win.FocusEvent('focus'));
        expect(win.document.activeElement).toBe(other);

        input.remove();
        refocusFrame(win);
        expect(win.document.activeElement).toBe(win.document.body);
    });
});

describe('closeAccountChecksOnEscape', () => {
    /** A sign-in window with its own document, whose close() is spied on. */
    const signInWindow = () => {
        const win = { document: document.implementation.createHTMLDocument(), close: vi.fn() };
        closeAccountChecksOnEscape(win);
        return win;
    };
    const escapeOn = (el, init = {}) => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init }));
    };
    const showWindow = (win, className = 'window window-active window-confirm-email-using-code') => {
        const el = Object.assign(win.document.createElement('div'), { className });
        el.innerHTML = '<input class="digit-input">';
        win.document.body.append(el);
        return el;
    };

    it.each([
        'window-confirm-email-using-code',
        'window-confirm-phone-using-code',
        'window-card-verification',
    ])('closes on Escape in the %s window', (cls) => {
        const win = signInWindow();
        escapeOn(showWindow(win, `window window-active ${cls}`).querySelector('input'));
        expect(win.close).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape with focus on the page behind an account check', () => {
        const win = signInWindow();
        showWindow(win);
        escapeOn(win.document.body);
        expect(win.close).toHaveBeenCalledTimes(1);
    });

    it('leaves Escape that something or an IME handled, other keys, and other windows alone', () => {
        const win = signInWindow();
        const input = showWindow(win).querySelector('input');
        input.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
        escapeOn(input);
        escapeOn(input, { key: 'Enter' });
        escapeOn(input, { isComposing: true });
        escapeOn(showWindow(win, 'window window-alert').querySelector('input'));
        expect(win.close).not.toHaveBeenCalled();
    });
});
