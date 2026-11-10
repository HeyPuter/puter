// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://notes.puter.test/doc"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from './Auth.js';

// An isolated page polls the sign-in relay; nothing here answers it.
vi.mock('../lib/networkUtils.js', () => ({ fetchUrl: vi.fn(() => new Promise(() => {})) }));

const GUI_ORIGIN = 'https://puter.test';

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
};

const signInFrame = () => document.querySelector('dialog.puter-popup-frame iframe');

/** The framed sign-in's `msg_id`, from its fragment. */
const frameMsgId = () => new URLSearchParams(new URL(signInFrame().src).hash.slice(1)).get('msg_id');

const fromFrame = (data, source = signInFrame().contentWindow) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin: GUI_ORIGIN, source }));

let auth;

beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('puter', {
        env: 'web',
        defaultGUIOrigin: GUI_ORIGIN,
        setAuthToken: vi.fn(),
        trackOpenedWindow_: vi.fn(),
    });
    vi.spyOn(window, 'open').mockImplementation((url, name) => ({ name, url, closed: false }));
    Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: { hasBeenActive: true, isActive: true },
    });
    auth = new AuthModule(puter);
});

afterEach(() => {
    delete navigator.userActivation;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('auth.signIn on a first-party page', () => {
    it('signs in through the frame instead of a popup', async () => {
        const result = auth.signIn();
        const url = new URL(signInFrame().src);
        expect(url.origin + url.pathname).toBe(`${GUI_ORIGIN}/embed/sign-in`);
        expect(url.search).toBe('');
        expect(auth.pendingSignInMessageIds_.has(frameMsgId())).toBe(true);

        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puter.token', msg_id: frameMsgId(), success: true, token: 'tok', app_uid: 'app-1', username: 'alice' });

        await expect(result).resolves.toEqual({ success: true, token: 'tok', app_uid: 'app-1', username: 'alice' });
        expect(puter.setAuthToken).toHaveBeenCalledWith('tok');
        expect(window.open).not.toHaveBeenCalled();
        expect(signInFrame()).toBeNull();
        expect(auth.pendingSignInMessageIds_.size).toBe(0);
    });

    it('passes request_auth on to the frame', () => {
        auth.signIn({ request_auth: true }).catch(() => {});
        expect(new URLSearchParams(new URL(signInFrame().src).hash.slice(1)).get('request_auth')).toBe('true');
    });

    it('ignores a token for another sign-in or from another window', async () => {
        const result = auth.signIn();
        let settled = false;
        result.then(() => {
            settled = true;
        }, () => {
            settled = true;
        });
        fromFrame({ msg: 'puter.token', msg_id: 'other', success: true, token: 'x' });
        fromFrame({ msg: 'puter.token', msg_id: frameMsgId(), success: true, token: 'x' }, window);
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(puter.setAuthToken).not.toHaveBeenCalled();
    });

    it('rejects as a closed popup when the user closes the frame', async () => {
        const result = auth.signIn();
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        document.querySelector('.puter-popup-frame-close').click();
        await expect(result).rejects.toMatchObject({ error: 'auth_window_closed' });
        expect(window.open).not.toHaveBeenCalled();
    });

    it('rejects as a closed popup when the frame closes without a token', async () => {
        const result = auth.signIn();
        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(result).rejects.toMatchObject({ error: 'auth_window_closed' });
    });

    it('shares one framed sign-in between calls made while it is open', async () => {
        const first = auth.signIn();
        const second = auth.signIn();
        expect(document.querySelectorAll('dialog.puter-popup-frame')).toHaveLength(1);
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puter.token', msg_id: frameMsgId(), success: true, token: 'tok' });
        await expect(first).resolves.toEqual({ success: true, token: 'tok' });
        await expect(second).resolves.toEqual({ success: true, token: 'tok' });

        // Once it settles, the next call starts a new one.
        const third = auth.signIn();
        expect(signInFrame()).not.toBeNull();
        fromFrame({ msg: 'puterPopupFrame', state: 'closed' });
        await expect(third).rejects.toMatchObject({ error: 'auth_window_closed' });
    });

    it('shares the framed sign-in with a call that differs in request_auth', async () => {
        // Implicit auth (a `puter.*` call without a token) asks with request_auth.
        const implicit = auth.signIn({ request_auth: true });
        const explicit = auth.signIn();
        expect(document.querySelectorAll('dialog.puter-popup-frame')).toHaveLength(1);
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puter.token', msg_id: frameMsgId(), success: true, token: 'tok' });
        await expect(implicit).resolves.toEqual({ success: true, token: 'tok' });
        await expect(explicit).resolves.toEqual({ success: true, token: 'tok' });
    });

    it('rejects with the reply a failed sign-in sends, as the popup does', async () => {
        const result = auth.signIn();
        fromFrame({ msg: 'puter.token', msg_id: frameMsgId(), success: false, token: null });
        await expect(result).rejects.toEqual({ success: false, token: null });
        expect(puter.setAuthToken).not.toHaveBeenCalled();
    });

    it('continues in the popup when the frame hands off, such as for a federated provider', async () => {
        const result = auth.signIn();
        fromFrame({ msg: 'puterPopupFrame', state: 'loading' });
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        const [url] = window.open.mock.calls[0];
        expect(url).toContain(`${GUI_ORIGIN}/action/sign-in?embedded_in_popup=true`);
        expect(signInFrame()).toBeNull();

        const popup = window.open.mock.results[0].value;
        const msgId = new URL(url).searchParams.get('msg_id');
        window.dispatchEvent(new MessageEvent('message', {
            data: { msg: 'puter.token', msg_id: msgId, success: true, token: 'tok' },
            origin: GUI_ORIGIN,
            source: popup,
        }));
        await expect(result).resolves.toMatchObject({ success: true, token: 'tok' });
    });

    it('opens the provider the user picked in the frame straight in the popup', async () => {
        const result = auth.signIn();
        const msgId = frameMsgId();
        const start = `${GUI_ORIGIN}/auth/oidc/google/start?flow=login&referrer=x&embedded_in_popup=true&msg_id=${msgId}&opener_origin=https%3A%2F%2Fnotes.puter.test`;
        const frameWindow = signInFrame().contentWindow;
        fromFrame({ msg: 'puterPopupFrame', state: 'ready' });
        fromFrame({ msg: 'puterPopupFrame', state: 'provider', url: start });
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' }, frameWindow);
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        expect(window.open.mock.calls[0][0]).toBe(start);
        expect(signInFrame()).toBeNull();
        expect(auth.pendingSignInMessageIds_.has(msgId)).toBe(true);

        // The provider returns the popup as a sign-in popup for the same attempt.
        window.dispatchEvent(new MessageEvent('message', {
            data: { msg: 'puter.token', msg_id: msgId, success: true, token: 'tok' },
            origin: GUI_ORIGIN,
            source: window.open.mock.results[0].value,
        }));
        await expect(result).resolves.toMatchObject({ success: true, token: 'tok' });
        expect(puter.setAuthToken).toHaveBeenCalledWith('tok');
        expect(auth.pendingSignInMessageIds_.size).toBe(0);
    });

    it.each([
        ['another origin', (id) => `https://evil.test/auth/oidc/google/start?embedded_in_popup=true&msg_id=${id}`],
        ['another path', (id) => `${GUI_ORIGIN}/action/sign-in?embedded_in_popup=true&msg_id=${id}&auth_token=x`],
        ['another sign-in', () => `${GUI_ORIGIN}/auth/oidc/google/start?embedded_in_popup=true&msg_id=other`],
        ['no popup return', (id) => `${GUI_ORIGIN}/auth/oidc/google/start?msg_id=${id}`],
        ['no URL', () => undefined],
    ])('opens the sign-in popup instead of a provider URL to %s', async (_, url) => {
        auth.signIn();
        fromFrame({ msg: 'puterPopupFrame', state: 'provider', url: url(frameMsgId()) });
        fromFrame({ msg: 'puterPopupFrame', state: 'unavailable' });
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
        expect(window.open.mock.calls[0][0]).toContain(`${GUI_ORIGIN}/action/sign-in?embedded_in_popup=true`);
    });

    it('continues in the popup when the frame is refused', async () => {
        vi.useFakeTimers();
        auth.signIn();
        signInFrame().dispatchEvent(new Event('load'));
        await vi.advanceTimersByTimeAsync(1000);
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(signInFrame()).toBeNull();
    });

    it('keeps the popup for a temporary account', () => {
        auth.signIn({ attempt_temp_user_creation: true });
        expect(signInFrame()).toBeNull();
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(window.open.mock.calls[0][0]).toContain('attempt_temp_user_creation=true');
    });

    it('keeps the popup for a page outside the Puter origin', () => {
        puter.defaultGUIOrigin = 'https://puter.com';
        auth.signIn();
        expect(signInFrame()).toBeNull();
        expect(window.open).toHaveBeenCalledTimes(1);
    });

    it('keeps the popup for a page in a frame of another site', () => {
        Object.defineProperty(window.location, 'ancestorOrigins', { configurable: true, value: ['https://other.test'] });
        try {
            auth.signIn();
            expect(signInFrame()).toBeNull();
            expect(window.open).toHaveBeenCalledTimes(1);
        } finally {
            delete window.location.ancestorOrigins;
        }
    });

    it('keeps the popup for a cross-origin isolated page', () => {
        vi.stubGlobal('crossOriginIsolated', true);
        auth.signIn().catch(() => {});
        expect(signInFrame()).toBeNull();
        expect(window.open).toHaveBeenCalledTimes(1);
    });
});
