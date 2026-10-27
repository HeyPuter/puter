// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from './Auth.js';
import { fetchUrl } from '../lib/networkUtils.js';

vi.mock('../lib/networkUtils.js', () => ({ fetchUrl: vi.fn() }));

let popups;
let auth;
let active;

const respond = (
    popup,
    token,
    msgId = new URL(popup.url).searchParams.get('msg_id'),
) => {
    window.dispatchEvent(
        new MessageEvent('message', {
            origin: 'https://puter.com',
            source: popup,
            data: { msg: 'puter.token', msg_id: msgId, success: true, token },
        }),
    );
};

beforeEach(() => {
    vi.useFakeTimers();
    fetchUrl.mockReset();
    active = true;
    popups = [];
    vi.stubGlobal('puter', {
        env: 'web',
        defaultGUIOrigin: 'https://puter.com',
        setAuthToken: vi.fn(),
        trackOpenedWindow_: vi.fn(),
    });
    vi.stubGlobal('origin', 'https://app.test');
    Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: {
            get hasBeenActive() {
                return active;
            },
            get isActive() {
                return active;
            },
        },
    });
    vi.spyOn(window, 'open').mockImplementation((url, name) => {
        let popup = popups.find((p) => p.name === name);
        if (!popup) {
            popup = { name, closed: false };
            popups.push(popup);
        }
        popup.url = url;
        return popup;
    });
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    auth = new AuthModule(puter);
});

afterEach(() => {
    document.body.replaceChildren();
    delete navigator.userActivation;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('signIn popup binding', () => {
    it('ignores an old popup response while waiting for the new consent click', async () => {
        active = false;
        const first = auth.signIn();
        let settled = false;
        first.then(() => {
            settled = true;
        });
        respond({}, 'old-token', '1');
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(puter.setAuthToken).not.toHaveBeenCalled();

        document
            .querySelector('puter-dialog')
            .shadowRoot.querySelector('#launch-auth-popup')
            .click();
        respond(popups[0], 'fresh-token');
        await expect(first).resolves.toMatchObject({ token: 'fresh-token' });
    });

    it('uses a different correlation value when a reloaded SDK starts another sign-in', async () => {
        const first = auth.signIn();
        const firstId = new URL(popups[0].url).searchParams.get('msg_id');
        respond(popups[0], 'first-token');
        await first;
        auth = new AuthModule(puter);
        const second = auth.signIn();
        const secondPopup = popups.at(-1);
        const secondId = new URL(secondPopup.url).searchParams.get('msg_id');
        expect(secondId).not.toBe(firstId);
        respond(secondPopup, 'second-token');
        await second;
    });

    it.each([true, false])(
        'keeps concurrent popup attempts separate with user activation %s',
        async (hasActivation) => {
            active = hasActivation;
            const first = auth.signIn();
            const second = auth.signIn();
            if (!hasActivation) {
                for (const dialog of document.querySelectorAll(
                    'puter-dialog',
                )) {
                    dialog.shadowRoot
                        .querySelector('#launch-auth-popup')
                        .click();
                }
            }
            expect(popups).toHaveLength(2);
            expect(popups[0].name).not.toBe(popups[1].name);
            respond(popups[1], 'second-token');
            await expect(second).resolves.toMatchObject({
                token: 'second-token',
            });
            respond(popups[0], 'first-token');
            await expect(first).resolves.toMatchObject({
                token: 'first-token',
            });
        },
    );

    it('notifies explicit sign-in once using the cached user lookup', async () => {
        const user = { username: 'alice' };
        puter.whoamiCache_ = Promise.resolve(user);
        puter.onAuth = vi.fn();
        puter.getUser = vi.fn();
        const signedIn = auth.signIn();
        respond(popups[0], 'token');
        await signedIn;
        expect(puter.onAuth).toHaveBeenCalledExactlyOnceWith(user);
        expect(puter.getUser).not.toHaveBeenCalled();
    });

    it('keeps the isolated-page relay independent of popup messages', async () => {
        vi.stubGlobal('crossOriginIsolated', true);
        let answer;
        fetchUrl.mockImplementation(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        );
        const pending = auth.signIn();
        respond(popups[0], 'wrong-message-token');
        expect(puter.setAuthToken).not.toHaveBeenCalled();
        answer({ ok: true, json: async () => ({ auth_token: 'relay-token' }) });
        await expect(pending).resolves.toMatchObject({ token: 'relay-token' });
        expect(puter.setAuthToken).toHaveBeenCalledWith('relay-token');
    });

    it('rejects a blocked popup', async () => {
        window.open.mockReturnValue(null);
        await expect(auth.signIn()).rejects.toMatchObject({
            error: 'popup_blocked',
        });
    });

    it('rejects a closed popup and stops listening for its response', async () => {
        const pending = auth.signIn();
        const refusal = expect(pending).rejects.toMatchObject({
            error: 'auth_window_closed',
        });
        popups[0].closed = true;
        await vi.advanceTimersByTimeAsync(100);
        await refusal;
        respond(popups[0], 'late-token');
        expect(puter.setAuthToken).not.toHaveBeenCalled();
    });

    it('ignores another source even with the correct request id', async () => {
        const pending = auth.signIn();
        const popup = popups[0];
        respond(
            {},
            'wrong-token',
            new URL(popup.url).searchParams.get('msg_id'),
        );
        expect(puter.setAuthToken).not.toHaveBeenCalled();
        respond(popup, 'right-token');
        await expect(pending).resolves.toMatchObject({ token: 'right-token' });
    });
});
