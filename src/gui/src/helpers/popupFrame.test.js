// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    POPUP_FRAME_MSG,
    canShowCustomDomainFrame,
    canShowEmailConfirmationFrame,
    canShowTopUpFrame,
    canShowUpgradeFrame,
    closeAccountChecksOnEscape,
    confirmEmailInFrame,
    focusOnFrameFocus,
    framedPopupAction,
    framedPopupParams,
    framedUpgradeDetails,
    framesHostUser,
    showFramedTopUp,
    showFramedUpgrade,
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
    document.documentElement.classList.remove('popup-frame-transparent');
});

describe('framedPopupAction', () => {
    it.each([
        ['/embed/sign-in', 'sign-in'],
        ['/embed/sign-in/', 'sign-in'],
        ['/embed/show-open-file-picker', 'show-open-file-picker'],
        ['/embed/show-save-file-picker', 'show-save-file-picker'],
        ['/embed/show-directory-picker', 'show-directory-picker'],
        ['/embed/upgrade', 'upgrade'],
        ['/embed/top-up', 'top-up'],
        ['/embed/request-email-confirmation', 'request-email-confirmation'],
        ['/embed/attach-custom-domain', 'attach-custom-domain'],
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
        const params = framedPopupParams('#msg_id=7&options=%7B%22multiple%22%3Atrue%7D&request_auth=true&subdomain=mysite&user=abc&auth_token=x&attempt_temp_user_creation=true&api_origin=https%3A%2F%2Fevil.test');
        expect(Object.fromEntries(params)).toEqual({
            msg_id: '7',
            options: '{"multiple":true}',
            request_auth: 'true',
            subdomain: 'mysite',
        });
    });

    it('is empty without a fragment', () => {
        expect([...framedPopupParams('')]).toEqual([]);
        expect([...framedPopupParams(undefined)]).toEqual([]);
    });
});

describe('framesHostUser', () => {
    it.each([
        ['show-open-file-picker', true],
        ['show-save-file-picker', true],
        ['show-directory-picker', true],
        ['upgrade', true],
        ['top-up', true],
        ['request-email-confirmation', true],
        ['attach-custom-domain', true],
        ['sign-in', false],
        [null, false],
    ])('%s serves only the framing page\'s user: %s', (action, expected) => {
        expect(framesHostUser(action)).toBe(expected);
    });
});

describe('framedUpgradeDetails', () => {
    it('keeps a known reason and the method', () => {
        expect(framedUpgradeDetails('#user=abc&reason=storage&method=puter.fs.upload&appUid=app-x'))
            .toEqual({ reason: 'storage', method: 'puter.fs.upload' });
    });

    it('drops an unknown reason and an overlong method', () => {
        expect(framedUpgradeDetails(`#reason=free-money&method=${'m'.repeat(201)}`)).toEqual({});
        expect(framedUpgradeDetails('')).toEqual({});
        expect(framedUpgradeDetails(undefined)).toEqual({});
    });
});

describe('canShowUpgradeFrame', () => {
    const win = { UIUpgradeAccount: Object.assign(function () {}, { embeddable: true }) };
    const session = { uuid: 'u-1' };

    it('shows for a session with nothing to verify, when the dialog reports its close', () => {
        expect(canShowUpgradeFrame(win, session)).toBe(true);
    });

    it('needs a dialog that reports its close', () => {
        expect(canShowUpgradeFrame({}, session)).toBe(false);
        expect(canShowUpgradeFrame({ UIUpgradeAccount: function () {} }, session)).toBe(false);
    });

    it.each([
        'requires_email_confirmation',
        'requires_phone_verification',
        'requires_card_verification',
        'requires_password_change',
    ])('leaves an account with %s to the tab', (check) => {
        expect(canShowUpgradeFrame(win, { ...session, [check]: true })).toBe(false);
    });

    it('needs a session', () => {
        expect(canShowUpgradeFrame(win, null)).toBe(false);
    });
});

describe('canShowTopUpFrame', () => {
    const win = { UITopUp: Object.assign(function () {}, { embeddable: true }) };
    const session = { uuid: 'u-1' };

    it('shows for a session with nothing to verify, when the dialog reports its close', () => {
        expect(canShowTopUpFrame(win, session)).toBe(true);
    });

    it('needs a top-up dialog that reports its close, whatever the upgrade dialog does', () => {
        expect(canShowTopUpFrame({}, session)).toBe(false);
        expect(canShowTopUpFrame({ UITopUp: function () {} }, session)).toBe(false);
        expect(canShowTopUpFrame({ UIUpgradeAccount: Object.assign(function () {}, { embeddable: true }) }, session)).toBe(false);
    });

    it.each([
        'requires_email_confirmation',
        'requires_phone_verification',
        'requires_card_verification',
        'requires_password_change',
    ])('leaves an account with %s to the tab', (check) => {
        expect(canShowTopUpFrame(win, { ...session, [check]: true })).toBe(false);
    });

    it('needs a session', () => {
        expect(canShowTopUpFrame(win, null)).toBe(false);
    });
});

describe('canShowCustomDomainFrame', () => {
    const session = { uuid: 'u-1' };

    it('shows for a session with nothing to verify', () => {
        expect(canShowCustomDomainFrame(session)).toBe(true);
    });

    it.each([
        'requires_email_confirmation',
        'requires_phone_verification',
        'requires_card_verification',
        'requires_password_change',
    ])('leaves an account with %s to the popup', (check) => {
        expect(canShowCustomDomainFrame({ ...session, [check]: true })).toBe(false);
    });

    it('needs a session', () => {
        expect(canShowCustomDomainFrame(null)).toBe(false);
    });
});

describe('canShowEmailConfirmationFrame', () => {
    const session = { uuid: 'u-1' };

    it('shows for a session with nothing to verify, or only the email', () => {
        expect(canShowEmailConfirmationFrame(session)).toBe(true);
        expect(canShowEmailConfirmationFrame({ ...session, requires_email_confirmation: true })).toBe(true);
    });

    it.each([
        'requires_phone_verification',
        'requires_card_verification',
        'requires_password_change',
    ])('leaves an account with %s unavailable', (check) => {
        expect(canShowEmailConfirmationFrame({ ...session, [check]: true })).toBe(false);
    });

    it('needs a session', () => {
        expect(canShowEmailConfirmationFrame(null)).toBe(false);
    });
});

describe('confirmEmailInFrame', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const confirmWindow = ({ user, width = 1280, height = 800 } = {}) =>
        Object.assign(new EventTarget(), { user, innerWidth: width, innerHeight: height });

    it('resolves true for a confirmed email without showing anything', async () => {
        const confirm = vi.fn();
        const tell = vi.fn();
        await expect(confirmEmailInFrame(confirmWindow({ user: { email_confirmed: true } }), confirm, tell))
            .resolves.toBe(true);
        expect(confirm).not.toHaveBeenCalled();
        expect(tell).not.toHaveBeenCalled();
    });

    it.each([
        ['confirms', true, true],
        ['backs out', false, false],
        ['gets no answer', undefined, false],
    ])('resolves whether the email is confirmed when the user %s', async (_label, answer, expected) => {
        const confirm = vi.fn(async () => answer);
        await expect(confirmEmailInFrame(confirmWindow({ user: { email_confirmed: false } }), confirm, vi.fn()))
            .resolves.toBe(expected);
        expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('walks a temporary account through it', async () => {
        const confirm = vi.fn(async () => true);
        await expect(confirmEmailInFrame(confirmWindow({ user: { is_temp: true } }), confirm, vi.fn()))
            .resolves.toBe(true);
        expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('has a hidden frame shown before its windows open', async () => {
        vi.useFakeTimers();
        const win = confirmWindow({ user: {}, width: 0, height: 0 });
        const sizes = [];
        const tell = vi.fn();
        const result = confirmEmailInFrame(win, async () => {
            sizes.push([win.innerWidth, win.innerHeight]);
            return true;
        }, tell);
        await vi.advanceTimersByTimeAsync(0);
        expect(tell).toHaveBeenCalledWith('ready');
        expect(sizes).toEqual([]);

        win.innerWidth = 1280;
        win.innerHeight = 800;
        win.dispatchEvent(new Event('resize'));
        await expect(result).resolves.toBe(true);
        expect(sizes).toEqual([[1280, 800]]);
    });
});

describe('showFramedUpgrade', () => {
    const upgradeWindow = (openAsWindow, { width = 1280, height = 800 } = {}) => {
        const created = [];
        const events = new EventTarget();
        const win = {
            document,
            innerWidth: width,
            innerHeight: height,
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
            dispatchEvent: events.dispatchEvent.bind(events),
            MutationObserver: window.MutationObserver,
            UIUpgradeAccount: function (options) {
                created.push(options);
                this.open_as_window = () => openAsWindow(options);
            },
        };
        return { win, created };
    };
    /** Stands in for the dialog's own modal root. */
    const showModal = () => {
        const root = document.createElement('div');
        root.setAttribute('aria-modal', 'true');
        document.body.append(root);
        return root;
    };

    afterEach(() => {
        vi.useRealTimers();
    });

    it('passes what prompted it, tells the page it is ready once open, and resolves the close', async () => {
        const tell = vi.fn();
        let options;
        const { win, created } = upgradeWindow(async (o) => {
            options = o;
        });
        const result = showFramedUpgrade(win, { appUid: 'app-1', reason: 'funds' }, tell);
        await vi.waitFor(() => expect(tell).toHaveBeenCalledWith('ready'));
        expect(created[0].attribution).toEqual({ appUid: 'app-1', reason: 'funds' });
        expect(tell).toHaveBeenCalledTimes(1);

        options.onClose({ upgraded: true });
        await expect(result).resolves.toBe(true);
    });

    it('passes no attribution when nothing is known, so the dialog credits the prompt it remembers', async () => {
        const { win, created } = upgradeWindow(async (o) => o.onClose());
        await showFramedUpgrade(win, {}, vi.fn());
        expect(created[0].attribution).toBeNull();
    });

    it('resolves false for a close without an upgrade, even one before it opened', async () => {
        const { win } = upgradeWindow(async (o) => o.onClose({ upgraded: false }));
        await expect(showFramedUpgrade(win, {}, vi.fn())).resolves.toBe(false);
        const { win: bare } = upgradeWindow(async (o) => o.onClose());
        await expect(showFramedUpgrade(bare, {}, vi.fn())).resolves.toBe(false);
    });

    it('resolves false once the dialog is gone without reporting a close', async () => {
        vi.useFakeTimers();
        const tell = vi.fn();
        let root;
        const { win } = upgradeWindow(async () => {
            root = showModal();
        });
        const result = showFramedUpgrade(win, {}, tell);
        await vi.advanceTimersByTimeAsync(0);
        expect(tell).toHaveBeenCalledWith('ready');

        root.remove();
        await vi.advanceTimersByTimeAsync(499);
        await expect(Promise.race([result, 'pending'])).resolves.toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        await expect(result).resolves.toBe(false);
    });

    it('keeps waiting while one window replaces another', async () => {
        vi.useFakeTimers();
        let options;
        const { win } = upgradeWindow(async (o) => {
            options = o;
            // An alert, which is a GUI window, rather than the dialog itself.
            document.body.append(Object.assign(document.createElement('div'), { className: 'window' }));
        });
        const result = showFramedUpgrade(win, {}, vi.fn());
        await vi.advanceTimersByTimeAsync(0);
        document.querySelector('.window').remove();
        showModal();
        await vi.advanceTimersByTimeAsync(2000);
        await expect(Promise.race([result, 'pending'])).resolves.toBe('pending');

        options.onClose({ upgraded: true });
        await expect(result).resolves.toBe(true);
    });

    it('waits for the dialog to show before watching for it to go', async () => {
        vi.useFakeTimers();
        let options;
        const { win } = upgradeWindow(async (o) => {
            options = o;
        });
        const result = showFramedUpgrade(win, {}, vi.fn());
        await vi.advanceTimersByTimeAsync(2000);
        await expect(Promise.race([result, 'pending'])).resolves.toBe('pending');
        options.onClose({ upgraded: false });
        await expect(result).resolves.toBe(false);
    });

    it('has a hidden frame shown before opening the dialog, so it lays out on a real viewport', async () => {
        vi.useFakeTimers();
        const tell = vi.fn();
        const sizes = [];
        const { win, created } = upgradeWindow(async () => {
            sizes.push([win.innerWidth, win.innerHeight]);
        }, { width: 0, height: 0 });
        const result = showFramedUpgrade(win, {}, tell);
        await vi.advanceTimersByTimeAsync(0);
        expect(tell).toHaveBeenCalledWith('ready');
        expect(created).toHaveLength(0);

        win.innerWidth = 1280;
        win.innerHeight = 800;
        win.dispatchEvent(new Event('resize'));
        await vi.advanceTimersByTimeAsync(0);
        expect(sizes).toEqual([[1280, 800]]);
        // Told once, not again once it opens.
        expect(tell).toHaveBeenCalledTimes(1);

        created[0].onClose({ upgraded: false });
        await expect(result).resolves.toBe(false);
    });

    it('opens the dialog anyway when a hidden frame never gets a viewport', async () => {
        vi.useFakeTimers();
        const { win, created } = upgradeWindow(async () => {}, { width: 0, height: 0 });
        showFramedUpgrade(win, {}, vi.fn());
        await vi.advanceTimersByTimeAsync(999);
        expect(created).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(created).toHaveLength(1);
    });

    it('rejects when the dialog fails to open', async () => {
        const { win } = upgradeWindow(async () => {
            throw new Error('broken');
        });
        await expect(showFramedUpgrade(win, {}, vi.fn())).rejects.toThrow('broken');
    });
});

describe('showFramedTopUp', () => {
    const topUpWindow = (open) => {
        const events = new EventTarget();
        return {
            document,
            innerWidth: 1280,
            innerHeight: 800,
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
            MutationObserver: window.MutationObserver,
            UITopUp: function (options) {
                this.open = () => open(options);
            },
        };
    };

    afterEach(() => {
        vi.useRealTimers();
    });

    it('tells the page it is ready once open, and resolves whether credit was bought', async () => {
        const tell = vi.fn();
        let options;
        const result = showFramedTopUp(topUpWindow(async (o) => {
            options = o;
        }), tell);
        await vi.waitFor(() => expect(tell).toHaveBeenCalledWith('ready'));
        expect(tell).toHaveBeenCalledTimes(1);

        options.onClose({ toppedUp: true });
        await expect(result).resolves.toBe(true);
    });

    it('resolves false for a close without a purchase', async () => {
        await expect(showFramedTopUp(topUpWindow(async (o) => o.onClose({ toppedUp: false })), vi.fn())).resolves.toBe(false);
        await expect(showFramedTopUp(topUpWindow(async (o) => o.onClose()), vi.fn())).resolves.toBe(false);
    });

    it('resolves false once the dialog is gone without reporting a close', async () => {
        vi.useFakeTimers();
        const root = document.createElement('div');
        root.setAttribute('aria-modal', 'true');
        const result = showFramedTopUp(topUpWindow(async () => {
            document.body.append(root);
        }), vi.fn());
        await vi.advanceTimersByTimeAsync(0);
        root.remove();
        await vi.advanceTimersByTimeAsync(600);
        await expect(result).resolves.toBe(false);
    });

    it('rejects when the dialog fails to open', async () => {
        await expect(showFramedTopUp(topUpWindow(async () => {
            throw new Error('no dialog');
        }), vi.fn())).rejects.toThrow('no dialog');
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

    it('lets the framing page show through a top-up frame', () => {
        startPopupFrame({ ...frameWindow(), location: { pathname: '/embed/top-up' } }, HOST);
        expect(document.documentElement.classList.contains('popup-frame-transparent')).toBe(true);
    });

    it('lets the framing page show through an upgrade or email confirmation frame only', () => {
        startPopupFrame({ ...frameWindow(), location: { pathname: '/embed/sign-in' } }, HOST);
        expect(document.documentElement.classList.contains('popup-frame-transparent')).toBe(false);

        startPopupFrame({ ...frameWindow(), location: { pathname: '/embed/upgrade' } }, HOST);
        expect(document.documentElement.classList.contains('popup-frame-transparent')).toBe(true);

        document.documentElement.classList.remove('popup-frame-transparent');
        startPopupFrame({ ...frameWindow(), location: { pathname: '/embed/request-email-confirmation' } }, HOST);
        expect(document.documentElement.classList.contains('popup-frame-transparent')).toBe(true);

        document.documentElement.classList.remove('popup-frame-transparent');
        startPopupFrame({ ...frameWindow(), location: { pathname: '/embed/attach-custom-domain' } }, HOST);
        expect(document.documentElement.classList.contains('popup-frame-transparent')).toBe(true);
    });

    it('sends a boolean field with a state', () => {
        const win = frameWindow();
        const tell = startPopupFrame(win, HOST);
        tell('closed', { upgraded: true });
        expect(win.parent.postMessage).toHaveBeenLastCalledWith(
            { upgraded: true, msg: POPUP_FRAME_MSG, state: 'closed' },
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

    /** A window whose focus() is ignored while `blocked`, as a frame just shown is. */
    const blockableWindow = () => {
        const { win, input } = ownWindow();
        const nativeFocus = win.HTMLElement.prototype.focus;
        const state = { blocked: true };
        win.HTMLElement.prototype.focus = function (...args) {
            if ( ! state.blocked ) nativeFocus.apply(this, args);
        };
        return { win, input, state };
    };

    it('retries a focus() the frame ignored until it takes', async () => {
        vi.useFakeTimers();
        try {
            const { win, input, state } = blockableWindow();
            focusOnFrameFocus(win);
            input.focus();
            expect(win.document.activeElement).toBe(win.document.body);
            await vi.advanceTimersByTimeAsync(120);
            expect(win.document.activeElement).toBe(win.document.body);
            state.blocked = false;
            await vi.advanceTimersByTimeAsync(50);
            expect(win.document.activeElement).toBe(input);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops retrying after a while, and once the user presses a key', async () => {
        vi.useFakeTimers();
        try {
            const { win, input, state } = blockableWindow();
            focusOnFrameFocus(win);
            input.focus();
            await vi.advanceTimersByTimeAsync(1000);
            state.blocked = false;
            await vi.advanceTimersByTimeAsync(1000);
            expect(win.document.activeElement).toBe(win.document.body);

            const other = blockableWindow();
            focusOnFrameFocus(other.win);
            other.input.focus();
            other.win.document.body.dispatchEvent(new other.win.Event('keydown', { bubbles: true }));
            other.state.blocked = false;
            await vi.advanceTimersByTimeAsync(1000);
            expect(other.win.document.activeElement).toBe(other.win.document.body);
        } finally {
            vi.useRealTimers();
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
        'window-save-account',
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
        // Safari ends a conversion with keyCode 229 and isComposing false.
        escapeOn(input, { keyCode: 229 });
        escapeOn(showWindow(win, 'window window-alert').querySelector('input'));
        expect(win.close).not.toHaveBeenCalled();
    });

    it('hands the account window to the close it is given, leaving the frame open', () => {
        const win = { document: document.implementation.createHTMLDocument(), close: vi.fn() };
        const close = vi.fn();
        closeAccountChecksOnEscape(win, close);
        const el = showWindow(win);
        escapeOn(el.querySelector('input'));
        escapeOn(win.document.body);
        expect(close.mock.calls).toEqual([[el], [el]]);
        expect(win.close).not.toHaveBeenCalled();
    });
});
